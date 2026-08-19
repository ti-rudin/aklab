/**
 * Pipeline Service — run-aware orchestration for parsing, analysis and digest.
 */

import { randomUUID } from 'node:crypto';
import type { StrapiInstance } from '../../types/strapi';
import { getQueueService } from '../queueService';
import { createParserRunTelemetry } from '../parser-run-telemetry';
import { broadcastSSE } from '../pipeline-sse';
import { buildAllActiveSnapshot, buildSingleUserSnapshot } from '../user-profile';
import type { UserFilterSnapshot } from '../user-profile';
import type { PipelineState } from './state';
import { getState, updateState, resetState, emptyState, tryAcquireIdleState, sanitizePipelineState, validateDepth } from './state';
import { parseAll, analyze, digest } from './stages';
import type { PipelineContext } from './stages';

export type PipelineMode = 'full' | 'parse' | 'analyze' | 'digest';

export class PipelineBusyError extends Error {
  readonly code = 'PIPELINE_BUSY';

  constructor() {
    super('Pipeline уже выполняется или отменяется');
    this.name = 'PipelineBusyError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class PipelineInputError extends Error {
  readonly code = 'PIPELINE_INPUT_INVALID';

  constructor() {
    super('Invalid pipeline input.');
    this.name = 'PipelineInputError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class PipelineConfigurationError extends Error {
  readonly code = 'PIPELINE_CONFIGURATION_INVALID';

  constructor() {
    super('Pipeline configuration is invalid.');
    this.name = 'PipelineConfigurationError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

type PreparedRun = {
  depth: number;
  snapshot: UserFilterSnapshot | null;
  noOp: boolean;
};

// Re-export types for external consumers
export type { PipelineStage, PipelineStatus, PipelineState } from './state';
export { sanitizePipelineState, validateDepth } from './state';

export class PipelineService implements PipelineContext {
  strapi: StrapiInstance;
  private activeRunId: string | null = null;
  private activeParserRunId: number | null = null;
  private activeFilterSnapshot: UserFilterSnapshot | null = null;
  /** True while this process still has a live preflight/stage handler. */
  private handlerActive = false;
  private cancelRequestedRunId: string | null = null;
  private activeJobIds = new Set<number>();
  /** Prevent duplicate cancellation requests when cancel and a stage deadline race. */
  private cancellationRequestedJobIds = new Set<number>();
  /** Set only while a post-restart cancellation finalizer owns this lifecycle. */
  private recoveringRunId: string | null = null;

  constructor(strapi: StrapiInstance) {
    this.strapi = strapi;
  }

  async getState(): Promise<PipelineState> {
    return getState(this.strapi);
  }

  async updateState(patch: Partial<PipelineState>, message?: string): Promise<void> {
    return updateState(this.strapi, patch, message);
  }

  async resetState(): Promise<void> {
    return resetState(this.strapi);
  }

  /**
   * Reconstitute an interrupted lifecycle after the API process restarts.
   * This method returns after scheduling the terminal-state poll: Strapi bootstrap
   * must not wait for independent worker processes to finish.
   */
  async recoverAfterRestart(): Promise<void> {
    const state = await this.getState();
    if (state.status !== 'running' && state.status !== 'cancelling') return;

    if (!this.hasRecoverableRunMetadata(state)) {
      const reason = 'Восстановление после рестарта невозможно: отсутствуют корректные run_id/job_ids. Состояние заблокировано; выполните ручной force reset после проверки очереди';
      this.strapi.log.error(`[pipeline] ${reason}`);
      await this.publishRecoveryError(null, reason);
      return;
    }

    const runId = state.run_id;
    if (this.recoveringRunId === runId) {
      this.strapi.log.warn(`[pipeline] Recovery for run ${runId} is already in progress`);
      return;
    }
    if (this.activeRunId && this.activeRunId !== runId) {
      const reason = `Восстановление run ${runId} отклонено: сервис уже удерживает lifecycle ${this.activeRunId}`;
      this.strapi.log.error(`[pipeline] ${reason}`);
      await this.publishRecoveryError(runId, reason);
      return;
    }

    const jobIds = [...new Set(state.job_ids)];
    this.activeRunId = runId;
    this.handlerActive = false;
    this.cancelRequestedRunId = runId;
    this.activeJobIds = new Set(jobIds);
    this.cancellationRequestedJobIds.clear();
    this.recoveringRunId = runId;

    try {
      await updateState(
        this.strapi,
        { status: 'cancelling' },
        'Восстановление после рестарта: отменяем только задачи сохранённого запуска и ожидаем terminal states',
        true,
      );
    } catch {
      this.strapi.log.error('[pipeline] Recovery state persistence failed; cancellation not started');
      return;
    }

    try {
      const snapshot = this.recordedJobSnapshot(jobIds);
      if (snapshot.missingJobIds.length) {
        throw new Error(`не найдены сохранённые jobs: ${snapshot.missingJobIds.join(', ')}`);
      }
      await this.requestCancellation(snapshot.liveJobIds, 'Восстановление после рестарта: ожидаем terminal states задач');
    } catch (err: any) {
      const reason = `Восстановление run ${runId} остановлено: ошибка проверки очереди`;
      this.strapi.log.error(`[pipeline] ${reason}`);
      // Снимаем in-memory locks чтобы forceReset не блокировался до рестарта процесса
      this.activeRunId = null;
      this.recoveringRunId = null;
      this.activeJobIds.clear();
      this.cancellationRequestedJobIds.clear();
      await this.publishRecoveryError(runId, reason);
      return;
    }

    void this.finalizeRecoveredRun(runId, jobIds).catch(async (err: any) => {
      const reason = `Восстановление run ${runId} завершилось ошибкой проверки очереди`;
      this.strapi.log.error(`[pipeline] ${reason}`);
      await this.publishRecoveryError(runId, reason);
    });
  }

  // ── Run lifecycle ─────────────────────────────────────────────────────────

  private initialStage(mode: PipelineMode): PipelineState['stage'] {
    if (mode === 'analyze') return 'analyzing';
    if (mode === 'digest') return 'digesting';
    return 'parsing_scan';
  }

  /** Acquire the single lifecycle lock and assign the immutable run id. */
  private async acquireLock(trigger: 'manual' | 'cron', mode: PipelineMode): Promise<string | null> {
    const state = await this.getState();
    // The in-memory guard prevents duplicate work within this API process. The
    // conditional persisted write below is the authoritative winner selection
    // when two Strapi instances read idle at the same time.
    if (this.activeRunId || state.status !== 'idle') return null;

    const now = new Date().toISOString();
    const runId = randomUUID();
    const initialState: PipelineState = {
      ...emptyState(),
      run_id: runId,
      status: 'running',
      stage: this.initialStage(mode),
      trigger,
      started_at: now,
      updated_at: now,
    };

    let acquired = false;
    try {
      acquired = await tryAcquireIdleState(this.strapi, initialState);
    } catch (err: any) {
      this.strapi.log.error('[pipeline] Failed to atomically acquire lifecycle lock');
      return null;
    }
    if (!acquired) return null;

    this.activeRunId = runId;
    this.handlerActive = true;
    this.cancelRequestedRunId = null;
    this.activeJobIds.clear();
    this.cancellationRequestedJobIds.clear();
    try {
      const parserRun = await createParserRunTelemetry(this.strapi).ensureParserRun({ runId, mode, trigger });
      if (!Number.isSafeInteger(parserRun?.id)) throw new Error('Parser run telemetry row has no numeric id');
      this.activeParserRunId = parserRun.id;
    } catch (err: any) {
      this.handlerActive = false;
      this.activeParserRunId = null;
      const message = 'Не удалось создать telemetry-запись запуска';
      try {
        await updateState(this.strapi, {
          status: 'idle',
          stage: 'error',
          errors: [message],
        }, message, true);
        this.activeRunId = null;
      } catch {
        // Keep the in-memory lock if durable idle cleanup failed. A retry must
        // not enqueue another run while the persisted lifecycle is uncertain.
        this.strapi.log.error('[pipeline] Telemetry preflight cleanup failed; lifecycle lock retained');
      }
      throw err;
    }
    return runId;
  }

  /**
   * Resolve all run inputs after lifecycle lock + parser telemetry creation and
   * before the first queue job. The selected snapshot is built exactly once.
   */
  private async prepareRun(
    runId: string,
    depth: number | undefined,
    targetUserId: unknown,
    trigger: 'manual' | 'cron',
  ): Promise<PreparedRun> {
    let resolvedDepth: number;
    if (depth === undefined) {
      let setting: any;
      try {
        setting = await this.strapi.db.query('api::setting.setting').findOne({});
      } catch {
        throw new PipelineConfigurationError();
      }
      try {
        validateDepth(setting?.parse_depth);
      } catch {
        throw new PipelineConfigurationError();
      }
      resolvedDepth = setting.parse_depth;
    } else {
      validateDepth(depth);
      resolvedDepth = depth;
    }

    let snapshot: UserFilterSnapshot | null;
    if (trigger === 'cron') {
      if (targetUserId !== undefined) throw new PipelineInputError();
      snapshot = await buildAllActiveSnapshot(this.strapi as any);
    } else {
      if (typeof targetUserId !== 'number' || !Number.isSafeInteger(targetUserId) || targetUserId <= 0) {
        throw new PipelineInputError();
      }
      snapshot = await buildSingleUserSnapshot(this.strapi as any, targetUserId);
    }

    const profileScope = snapshot?.scope ?? 'none';
    await updateState(this.strapi, {
      filter_snapshot: snapshot,
      filter_snapshot_hash: snapshot?.hash ?? null,
      filter_snapshot_scope: profileScope,
      filter_snapshot_schema_version: snapshot?.schemaVersion ?? null,
      filter_snapshot_window_end_at: snapshot?.windowEndAt ?? null,
    }, undefined, true);
    await createParserRunTelemetry(this.strapi).ensureParserRunSnapshot({
      runId,
      profileScope,
      ...(profileScope === 'single' && typeof targetUserId === 'number' ? { targetUserId } : {}),
      snapshot,
    });

    this.activeFilterSnapshot = snapshot;
    return { depth: resolvedDepth, snapshot, noOp: !snapshot || snapshot.profiles.length === 0 };
  }

  private safeExecutionMessage(error: unknown): string {
    const code = typeof (error as any)?.code === 'string' ? (error as any).code : '';
    if (code === 'USER_PROFILE_UNAVAILABLE') return 'Профиль пользователя недоступен для запуска.';
    if (code === 'USER_PROFILE_MALFORMED') return 'Сохранённый профиль пользователя некорректен.';
    if (code === 'PIPELINE_CONFIGURATION_INVALID') return 'Настройка pipeline некорректна.';
    if (code === 'PARSER_RUN_SNAPSHOT_CONFLICT') return 'Конфликт immutable snapshot запуска.';
    return 'Ошибка выполнения pipeline.';
  }

  private async finishParserTelemetry(
    runId: string,
    status: 'succeeded' | 'degraded' | 'failed' | 'cancelled',
    errorSummary?: string,
  ): Promise<boolean> {
    try {
      await createParserRunTelemetry(this.strapi).finishParserRun({
        runId,
        status,
        ...(errorSummary ? { errorSummary } : {}),
      });
      return true;
    } catch {
      this.strapi.log.error('[pipeline] Parser telemetry terminal persistence failed');
      return false;
    }
  }

  private async persistTerminalState(patch: Partial<PipelineState>, message: string): Promise<boolean> {
    try {
      await updateState(this.strapi, patch, message, true);
      return true;
    } catch {
      this.strapi.log.error('[pipeline] Terminal pipeline state persistence failed; lifecycle lock retained');
      return false;
    }
  }

  private async blockLifecycle(message: string, errors: string[]): Promise<boolean> {
    try {
      await updateState(this.strapi, { status: 'cancelling', stage: 'error', errors }, message, true);
      return true;
    } catch {
      this.strapi.log.error('[pipeline] Could not persist lifecycle recovery lock');
      return false;
    }
  }

  private async failBeforeExecution(runId: string, error: unknown): Promise<void> {
    const message = this.safeExecutionMessage(error);
    let stateIsIdle = false;
    try {
      // Preflight failure must be fail-closed. Do not release the in-memory
      // lifecycle unless the durable state really became terminal/idle.
      await updateState(this.strapi, { status: 'idle', stage: 'error', errors: [message] }, message, true);
      stateIsIdle = true;
    } catch {
      this.strapi.log.error('[pipeline] Preflight state cleanup failed; lifecycle lock retained');
    }

    const telemetryFinished = await this.finishParserTelemetry(runId, 'failed', message);

    if (stateIsIdle && !telemetryFinished) {
      // A terminal telemetry failure must never release the in-memory lifecycle,
      // even if persisting the preferred durable blocking state also fails.
      // The stored state is then uncertain and a process restart/operator recovery
      // is required before another run may be admitted.
      await this.blockLifecycle('Pipeline preflight requires operator recovery', [message]);
      stateIsIdle = false;
    }

    if (stateIsIdle) {
      broadcastSSE('error', sanitizePipelineState(await this.getState()));
      this.releaseLifecycle(runId);
    } else {
      // Keep activeRunId when the durable state is uncertain or explicitly
      // blocking. forceReset() remains the deliberate operator escape hatch.
      this.handlerActive = false;
      this.activeParserRunId = null;
      this.activeFilterSnapshot = null;
      this.cancelRequestedRunId = null;
      this.activeJobIds.clear();
      this.cancellationRequestedJobIds.clear();
    }
  }

  private releaseLifecycle(runId: string): void {
    if (this.activeRunId !== runId) return;
    this.activeRunId = null;
    this.handlerActive = false;
    this.activeParserRunId = null;
    this.activeFilterSnapshot = null;
    this.cancelRequestedRunId = null;
    this.activeJobIds.clear();
    this.cancellationRequestedJobIds.clear();
  }

  /** Start a background run after its fail-closed snapshot preflight. */
  async start(mode: PipelineMode, depth: number | undefined, targetUserId?: unknown, trigger: 'manual' | 'cron' = 'manual'): Promise<string> {
    const runId = await this.acquireLock(trigger, mode);
    if (!runId) throw new PipelineBusyError();

    let prepared: PreparedRun;
    try {
      prepared = await this.prepareRun(runId, depth, targetUserId, trigger);
    } catch (error) {
      await this.failBeforeExecution(runId, error);
      throw error;
    }
    this.handlerActive = true;
    void this.executeRun(runId, mode, prepared).catch((err: any) => {
      this.handlerActive = false;
      this.strapi.log.error(`[pipeline] Unhandled run ${runId} error: ${this.safeExecutionMessage(err)}`);
    });
    return runId;
  }

  /** Awaited full-pipeline entry point used by cron. It never accepts a target. */
  async run(depth: number | undefined, targetUserId?: unknown, trigger: 'manual' | 'cron' = 'manual', mode: PipelineMode = 'full'): Promise<void> {
    const runId = await this.acquireLock(trigger, mode);
    if (!runId) throw new PipelineBusyError();
    let prepared: PreparedRun;
    try {
      prepared = await this.prepareRun(runId, depth, targetUserId, trigger);
    } catch (error) {
      await this.failBeforeExecution(runId, error);
      throw error;
    }
    this.handlerActive = true;
    await this.executeRun(runId, mode, prepared);
  }

  private async executeRun(runId: string, mode: PipelineMode, prepared: PreparedRun): Promise<void> {
    const allErrors: string[] = [];
    let releaseLifecycle = false;
    let parserRunStatus: 'succeeded' | 'degraded' | 'failed' | 'cancelled' | null = null;

    try {
      if (prepared.noOp) {
        const cancelled = this.isCancelled();
        parserRunStatus = cancelled ? 'cancelled' : 'succeeded';
        if (!await this.finishParserTelemetry(runId, parserRunStatus)) {
          await this.blockLifecycle('Pipeline telemetry requires operator recovery', ['Не удалось завершить telemetry pipeline.']);
          return;
        }
        if (!await this.persistTerminalState({
          status: 'idle',
          stage: cancelled ? 'cancelled' : 'done',
          errors: [],
        }, cancelled ? 'Пайплайн отменён' : 'Пайплайн завершён без готовых профилей')) return;
        broadcastSSE('done', sanitizePipelineState(await this.getState()));
        releaseLifecycle = true;
        return;
      }

      if ((mode === 'full' || mode === 'parse') && !this.isCancelled()) {
        const parseResult = await this.parseAll(prepared.depth);
        allErrors.push(...parseResult.errors);
        if (!await this.waitForRunJobsToSettle(runId, 'После парсинга проверяем terminal states задач текущего запуска')) return;
      }

      if ((mode === 'full' || mode === 'analyze') && !this.isCancelled()) {
        const analyzeResult = await this.analyze();
        allErrors.push(...analyzeResult.errors);
        if (!await this.waitForRunJobsToSettle(runId, 'После анализа проверяем terminal states задач текущего запуска')) return;
      }

      if ((mode === 'full' || mode === 'digest') && !this.isCancelled()) {
        const digestResult = await this.digest();
        allErrors.push(...digestResult.errors);
      }

      // Stages normally provide this guarantee themselves. Keep a lifecycle-level
      // guard too: an unexpected stage error can never publish idle while a
      // current-run handler is still pending or active.
      if (!await this.waitForRunJobsToSettle(runId, 'Ожидаем завершения задач текущего запуска')) return;

      parserRunStatus = this.isCancelled() ? 'cancelled' : (allErrors.length > 0 ? 'degraded' : 'succeeded');
      if (!await this.finishParserTelemetry(runId, parserRunStatus, allErrors.length ? allErrors.join('\n') : undefined)) {
        await this.blockLifecycle('Pipeline telemetry requires operator recovery', ['Не удалось завершить telemetry pipeline.']);
        return;
      }
      if (!await this.persistTerminalState(
        this.isCancelled()
          ? { status: 'idle', stage: 'cancelled', errors: allErrors }
          : allErrors.length > 0
            ? { status: 'idle', stage: 'done_with_errors', errors: allErrors }
            : { status: 'idle', stage: 'done', errors: [] },
        this.isCancelled()
          ? 'Пайплайн отменён'
          : allErrors.length > 0
            ? 'Пайплайн завершён с ошибками'
            : '✓ Пайплайн завершён',
      )) return;
      broadcastSSE('done', sanitizePipelineState(await this.getState()));
      releaseLifecycle = true;
    } catch (err: any) {
      const safeMessage = this.safeExecutionMessage(err);
      allErrors.push(safeMessage);
      if (!await this.waitForRunJobsToSettle(runId, `${safeMessage}; ожидаем terminal states задач`)) return;
      const cancelled = this.isCancelled();
      parserRunStatus = cancelled ? 'cancelled' : 'failed';
      if (!await this.finishParserTelemetry(runId, parserRunStatus, allErrors.join('\n'))) {
        await this.blockLifecycle('Pipeline telemetry requires operator recovery', ['Не удалось завершить telemetry pipeline.']);
        return;
      }
      if (!await this.persistTerminalState({
        status: 'idle',
        stage: cancelled ? 'cancelled' : 'error',
        errors: allErrors,
      }, cancelled ? 'Пайплайн отменён' : safeMessage)) return;
      broadcastSSE(cancelled ? 'done' : 'error', sanitizePipelineState(await this.getState()));
      releaseLifecycle = true;
    } finally {
      this.handlerActive = false;
      if (releaseLifecycle && this.activeRunId === runId) {
        this.activeRunId = null;
        this.activeParserRunId = null;
        this.activeFilterSnapshot = null;
        this.cancelRequestedRunId = null;
        this.activeJobIds.clear();
        this.cancellationRequestedJobIds.clear();
      }
    }
  }

  // ── Run-owned jobs ─────────────────────────────────────────────────────────

  getRunId(): string {
    if (!this.activeRunId) throw new Error('Pipeline run is not active');
    return this.activeRunId;
  }

  getParserRunId(): number {
    if (!this.activeParserRunId) throw new Error('Parser run telemetry is not active');
    return this.activeParserRunId;
  }

  getFilterSnapshot(): UserFilterSnapshot | null {
    return this.activeFilterSnapshot;
  }

  async recordJobIds(ids: number[]): Promise<void> {
    if (!ids.length || !this.activeRunId) return;
    for (const id of ids) this.activeJobIds.add(id);

    // Атомарный JSON-array merge через SQLite, чтобы избежать race read-modify-write.
    // Если строки нет или run_id сменился — ничего не делаем.
    const runId = this.activeRunId;
    try {
      const setting = await this.strapi.db.query('api::setting.setting').findOne({});
      if (!setting) return;
      await this.strapi.db.connection.raw(
        `UPDATE setting
           SET pipeline_state = json_set(
             pipeline_state,
             '$.job_ids',
             (SELECT json_group_array(DISTINCT value)
              FROM (
                SELECT value FROM json_each(COALESCE(json_extract(pipeline_state, '$.job_ids'), '[]'))
                UNION SELECT value FROM json_each(?)
              ))
           )
         WHERE id = ?
           AND json_extract(pipeline_state, '$.run_id') = ?`,
        [JSON.stringify(ids), setting.id, runId],
      );
    } catch (err: any) {
      this.strapi.log.warn(`[pipeline] recordJobIds atomic merge failed: ${err.message}`);
    }
  }

  /**
   * Request cancellation for current-run jobs exactly once, then leave the
   * lifecycle locked until callers observe their terminal states.
   */
  async requestCancellation(jobIds: number[], message: string): Promise<void> {
    const runId = this.activeRunId;
    if (!runId) throw new Error('Pipeline run is not active');

    this.cancelRequestedRunId = runId;
    await updateState(this.strapi, { status: 'cancelling' }, message, true);

    const qs = getQueueService();
    for (const id of new Set(jobIds)) {
      if (this.cancellationRequestedJobIds.has(id)) continue;
      let job;
      try {
        job = qs.getJob(id);
      } catch (err: any) {
        this.strapi.log.warn(`[pipeline] Failed to inspect job ${id} before cancellation`);
        continue;
      }
      // Never send a cancellation request to terminal work. This is essential
      // during restart recovery because the durable id list includes completed jobs.
      if (!job || (job.status !== 'pending' && job.status !== 'active')) continue;
      // Record before calling the queue so a concurrent cancel/deadline cannot
      // issue a duplicate request even if the queue operation throws.
      this.cancellationRequestedJobIds.add(id);
      try {
        qs.requestCancellation(id);
      } catch (err: any) {
        this.strapi.log.warn(`[pipeline] Failed to request cancellation for job ${id}`);
      }
    }
  }

  private hasRecoverableRunMetadata(state: PipelineState): state is PipelineState & { run_id: string } {
    return typeof state.run_id === 'string'
      && state.run_id.length > 0
      && Array.isArray(state.job_ids)
      && state.job_ids.every(id => Number.isSafeInteger(id) && id > 0);
  }

  /** Inspect exactly the durable ids; a missing job is never presumed terminal. */
  private recordedJobSnapshot(jobIds: number[]): { liveJobIds: number[]; missingJobIds: number[] } {
    const qs = getQueueService();
    const liveJobIds: number[] = [];
    const missingJobIds: number[] = [];
    for (const id of jobIds) {
      const job = qs.getJob(id);
      if (!job) {
        missingJobIds.push(id);
      } else if (job.status === 'pending' || job.status === 'active') {
        liveJobIds.push(id);
      }
    }
    return { liveJobIds, missingJobIds };
  }

  /** Background finalizer: publish idle only after every recorded job is terminal. */
  private async finalizeRecoveredRun(runId: string, jobIds: number[]): Promise<void> {
    while (this.activeRunId === runId && this.recoveringRunId === runId) {
      const snapshot = this.recordedJobSnapshot(jobIds);
      if (snapshot.missingJobIds.length) {
        throw new Error(`не найдены сохранённые jobs: ${snapshot.missingJobIds.join(', ')}`);
      }
      if (!snapshot.liveJobIds.length) {
        if (!await this.persistTerminalState({ status: 'idle', stage: 'cancelled' }, 'Пайплайн отменён после восстановления API')) {
          await this.blockLifecycle('Recovery requires operator reset', ['Не удалось завершить восстановленный pipeline.']);
          return;
        }
        broadcastSSE('done', sanitizePipelineState(await this.getState()));
        this.releaseRecoveredLifecycle(runId);
        return;
      }
      await this.requestCancellation(snapshot.liveJobIds, 'Восстановление после рестарта: ожидаем terminal states задач');
      await new Promise<void>(resolve => setTimeout(resolve, 1_000));
    }
  }

  /** Keep a durable blocking state on recovery failure until an operator force-resets it. */
  private async publishRecoveryError(runId: string | null, reason: string): Promise<void> {
    const state = await this.getState();
    if (runId && state.run_id !== runId) return;
    try {
      await updateState(this.strapi, {
        status: 'cancelling',
        stage: 'error',
        errors: [...state.errors, `Recovery: ${reason}`],
      }, reason, true);
    } catch {
      this.strapi.log.error('[pipeline] Recovery error state persistence failed; lifecycle lock retained');
      return;
    }
    broadcastSSE('error', sanitizePipelineState(await this.getState()));
    if (runId) this.releaseRecoveredLifecycle(runId);
  }

  private releaseRecoveredLifecycle(runId: string): void {
    if (this.activeRunId !== runId) return;
    this.activeRunId = null;
    this.handlerActive = false;
    this.activeParserRunId = null;
    this.activeFilterSnapshot = null;
    this.cancelRequestedRunId = null;
    this.activeJobIds.clear();
    this.cancellationRequestedJobIds.clear();
    if (this.recoveringRunId === runId) this.recoveringRunId = null;
  }

  private async currentRunJobSnapshot(runId: string): Promise<{ liveJobIds: number[]; missingJobIds: number[] } | null> {
    if (this.activeRunId !== runId) return { liveJobIds: [], missingJobIds: [] };
    try {
      const state = await this.getState();
      if (state.run_id !== runId) return null;
      const jobIds = [...new Set([...state.job_ids, ...this.activeJobIds])];
      return this.recordedJobSnapshot(jobIds);
    } catch (err: any) {
      this.strapi.log.error(`[pipeline] Cannot inspect jobs for run ${runId}`);
      return null;
    }
  }

  /**
   * Unexpected errors have the same safety rule as a stage deadline. There is
   * intentionally no post-cancel escape hatch: unknown/live work preserves
   * `cancelling` and the lock rather than claiming a clean idle lifecycle.
   */
  private async waitForRunJobsToSettle(runId: string, message: string): Promise<boolean> {
    let snapshot = await this.currentRunJobSnapshot(runId);
    if (snapshot === null) {
      await updateState(this.strapi, { status: 'cancelling' }, `${message}; не удалось проверить состояние очереди, lifecycle lock сохранён`, true);
      return false;
    }
    if (snapshot.missingJobIds.length) {
      await updateState(this.strapi, { status: 'cancelling' }, `${message}; не найдены recorded jobs (${snapshot.missingJobIds.join(', ')}), lifecycle lock сохранён`, true);
      return false;
    }
    if (!snapshot.liveJobIds.length) return true;

    await this.requestCancellation(snapshot.liveJobIds, message);
    while (this.activeRunId === runId) {
      await new Promise<void>(resolve => setTimeout(resolve, 1_000));
      snapshot = await this.currentRunJobSnapshot(runId);
      if (snapshot === null) {
        await updateState(this.strapi, { status: 'cancelling' }, `${message}; не удалось проверить состояние очереди, lifecycle lock сохранён`, true);
        return false;
      }
      if (snapshot.missingJobIds.length) {
        await updateState(this.strapi, { status: 'cancelling' }, `${message}; не найдены recorded jobs (${snapshot.missingJobIds.join(', ')}), lifecycle lock сохранён`, true);
        return false;
      }
      if (!snapshot.liveJobIds.length) return true;
    }
    return false;
  }

  // ── Cancel / reset ─────────────────────────────────────────────────────────

  async cancel(): Promise<void> {
    const state = await this.getState();
    if (state.status === 'idle' || !state.run_id) return;

    const runId = state.run_id;
    // Do not clear whole queues: only current run jobs may be touched. Pending jobs
    // become terminal immediately; active jobs cooperatively finish in their worker.
    const ids = new Set<number>(state.job_ids);
    if (this.activeRunId === runId) {
      for (const id of this.activeJobIds) ids.add(id);
      await this.requestCancellation([...ids], 'Отмена запрошена: ожидаем завершения активных задач');
      return;
    }

    // Bootstrap normally claims this lifecycle through recoverAfterRestart(). Keep
    // a safe fallback for a cancel request racing bootstrap: inspect only durable,
    // run-owned ids and request cancellation only while they are nonterminal.
    await updateState(this.strapi, { status: 'cancelling' }, 'Отмена запрошена: ожидаем завершения активных задач', true);
    try {
      const snapshot = this.recordedJobSnapshot([...ids]);
      const qs = getQueueService();
      for (const id of snapshot.liveJobIds) qs.requestCancellation(id);
    } catch (err: any) {
      this.strapi.log.warn(`[pipeline] Failed to request cancellation for persisted run ${runId}`);
    }
  }

  /**
   * Reset only an already-terminal lifecycle. It never clears queues or marks a
   * running handler as cancelled, preventing reset from affecting another run.
   */
  async forceReset(): Promise<void> {
    const state = await this.getState();
    if (!state.run_id && this.activeRunId) {
      throw new Error('Нельзя сбросить pipeline: durable lifecycle не подтверждён.');
    }
    if (state.run_id && this.activeRunId && this.activeRunId !== state.run_id) {
      throw new Error('Нельзя сбросить pipeline: другой lifecycle всё ещё активен.');
    }
    if (state.run_id && (this.handlerActive || this.recoveringRunId === state.run_id)) {
      throw new Error('Нельзя сбросить активный pipeline: дождитесь terminal jobs или отмените запуск');
    }
    if (state.job_ids.length) {
      let snapshot;
      try {
        snapshot = this.recordedJobSnapshot(state.job_ids);
      } catch {
        throw new Error('Нельзя безопасно сбросить pipeline: не удалось проверить recorded jobs.');
      }
      if (snapshot.liveJobIds.length) {
        throw new Error('Нельзя сбросить активный pipeline: дождитесь terminal jobs или отмените запуск');
      }
      if (snapshot.missingJobIds.length) {
        throw new Error(`Нельзя безопасно сбросить pipeline: не найдены recorded jobs (${snapshot.missingJobIds.join(', ')})`);
      }
    }
    // An operator reset is the only escape hatch for irrecoverable recovery
    // state. Reset durable state first; only then stop its finalizer/release its lock.
    await this.resetState();
    if (state.run_id && this.recoveringRunId === state.run_id) this.releaseRecoveredLifecycle(state.run_id);
    if (state.run_id && this.activeRunId === state.run_id) this.releaseLifecycle(state.run_id);
  }

  isCancelled(): boolean {
    return this.activeRunId !== null && this.cancelRequestedRunId === this.activeRunId;
  }

  // ── Stage delegates ────────────────────────────────────────────────────────

  async parseAll(depth: number): Promise<{ created: number; errors: string[] }> {
    return parseAll(this, depth);
  }

  async analyze(): Promise<{ undervalued: number; errors: string[] }> {
    return analyze(this);
  }

  async digest(): Promise<{ sent: boolean; errors: string[] }> {
    return digest(this);
  }

  async getSourceStats(slugs: string[]): Promise<any[]> {
    try {
      const sources = await this.strapi.entityService.findMany('api::source.source', {
        filters: { slug: { $in: slugs } },
        limit: 100,
      });
      return sources || [];
    } catch {
      return [];
    }
  }
}

let instance: PipelineService | null = null;

export function getPipelineService(strapi?: StrapiInstance): PipelineService {
  if (!instance && strapi) instance = new PipelineService(strapi);
  if (!instance) throw new Error('PipelineService not initialized — pass strapi on first call');
  return instance;
}
