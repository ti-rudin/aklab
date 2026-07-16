/**
 * Pipeline Service — run-aware orchestration for parsing, analysis and digest.
 */

import { randomUUID } from 'node:crypto';
import type { StrapiInstance } from '../../types/strapi';
import { getQueueService } from '../queueService';
import { broadcastSSE } from '../pipeline-sse';
import type { PipelineState, RunOptions } from './state';
import { getState, updateState, resetState, emptyState, tryAcquireIdleState } from './state';
import { parseAll, analyze, digest } from './stages';
import type { PipelineContext } from './stages';

export type PipelineMode = 'full' | 'parse' | 'analyze' | 'digest';

// Re-export types for external consumers
export type { PipelineStage, PipelineStatus, PipelineState } from './state';

export class PipelineService implements PipelineContext {
  strapi: StrapiInstance;
  private activeRunId: string | null = null;
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
    this.cancelRequestedRunId = runId;
    this.activeJobIds = new Set(jobIds);
    this.cancellationRequestedJobIds.clear();
    this.recoveringRunId = runId;

    await this.updateState(
      { status: 'cancelling' },
      'Восстановление после рестарта: отменяем только задачи сохранённого запуска и ожидаем terminal states',
    );

    try {
      const snapshot = this.recordedJobSnapshot(jobIds);
      if (snapshot.missingJobIds.length) {
        throw new Error(`не найдены сохранённые jobs: ${snapshot.missingJobIds.join(', ')}`);
      }
      await this.requestCancellation(snapshot.liveJobIds, 'Восстановление после рестарта: ожидаем terminal states задач');
    } catch (err: any) {
      const reason = `Восстановление run ${runId} остановлено: ${err?.message || err}`;
      this.strapi.log.error(`[pipeline] ${reason}`);
      await this.publishRecoveryError(runId, reason);
      return;
    }

    void this.finalizeRecoveredRun(runId, jobIds).catch(async (err: any) => {
      const reason = `Восстановление run ${runId} завершилось ошибкой: ${err?.message || err}`;
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
      this.strapi.log.error(`[pipeline] Failed to atomically acquire lifecycle lock: ${err?.message || err}`);
      return null;
    }
    if (!acquired) return null;

    this.activeRunId = runId;
    this.cancelRequestedRunId = null;
    this.activeJobIds.clear();
    this.cancellationRequestedJobIds.clear();
    return runId;
  }

  /**
   * Start a background run and immediately return its stable id to the API client.
   * All modes use the same lifecycle lock; partial modes cannot mutate state outside it.
   */
  async start(mode: PipelineMode, depth: number, filters?: RunOptions['filters'], trigger: 'manual' | 'cron' = 'manual'): Promise<string> {
    const runId = await this.acquireLock(trigger, mode);
    if (!runId) throw new Error('Pipeline уже выполняется или отменяется');

    void this.executeRun(runId, mode, depth, filters).catch((err: any) => {
      // executeRun owns its error state; this guard only prevents an unhandled promise.
      this.strapi.log.error(`[pipeline] Unhandled run ${runId} error: ${err?.message || err}`);
    });
    return runId;
  }

  /** Backward-compatible awaited entry point used by cron for a full pipeline. */
  async run(depth: number, filters?: RunOptions['filters'], trigger: 'manual' | 'cron' = 'manual'): Promise<void> {
    const runId = await this.acquireLock(trigger, 'full');
    if (!runId) throw new Error('Pipeline уже выполняется или отменяется');
    await this.executeRun(runId, 'full', depth, filters);
  }

  private async executeRun(runId: string, mode: PipelineMode, depth: number, filters?: RunOptions['filters']): Promise<void> {
    const allErrors: string[] = [];
    let releaseLifecycle = false;

    try {
      if ((mode === 'full' || mode === 'parse') && !this.isCancelled()) {
        const parseResult = await this.parseAll(depth, filters);
        allErrors.push(...parseResult.errors);
        if (!await this.waitForRunJobsToSettle(runId, 'После парсинга проверяем terminal states задач текущего запуска')) return;
      }

      if ((mode === 'full' || mode === 'analyze') && !this.isCancelled()) {
        const analyzeResult = await this.analyze(filters);
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

      if (this.isCancelled()) {
        await this.updateState({
          status: 'idle',
          stage: 'cancelled',
          errors: allErrors,
        }, 'Пайплайн отменён');
      } else if (allErrors.length > 0) {
        await this.updateState({
          status: 'idle',
          stage: 'done_with_errors',
          errors: allErrors,
        }, 'Пайплайн завершён с ошибками');
      } else {
        await this.updateState({
          status: 'idle',
          stage: 'done',
          errors: [],
        }, '✓ Пайплайн завершён');
      }
      broadcastSSE('done', await this.getState());
      releaseLifecycle = true;
    } catch (err: any) {
      allErrors.push(`Pipeline: ${err.message}`);
      if (!await this.waitForRunJobsToSettle(runId, `Ошибка pipeline: ${err.message}; ожидаем terminal states задач`)) return;
      const cancelled = this.isCancelled();
      await this.updateState({
        status: 'idle',
        stage: cancelled ? 'cancelled' : 'error',
        errors: allErrors,
      }, cancelled ? 'Пайплайн отменён' : `Ошибка: ${err.message}`);
      broadcastSSE(cancelled ? 'done' : 'error', await this.getState());
      releaseLifecycle = true;
    } finally {
      if (releaseLifecycle && this.activeRunId === runId) {
        this.activeRunId = null;
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

  async recordJobIds(ids: number[]): Promise<void> {
    if (!ids.length || !this.activeRunId) return;
    for (const id of ids) this.activeJobIds.add(id);

    const state = await this.getState();
    if (state.run_id !== this.activeRunId) return;
    const jobIds = [...new Set([...state.job_ids, ...ids])];
    await this.updateState({ job_ids: jobIds });
  }

  /**
   * Request cancellation for current-run jobs exactly once, then leave the
   * lifecycle locked until callers observe their terminal states.
   */
  async requestCancellation(jobIds: number[], message: string): Promise<void> {
    const runId = this.activeRunId;
    if (!runId) throw new Error('Pipeline run is not active');

    this.cancelRequestedRunId = runId;
    await this.updateState({ status: 'cancelling' }, message);

    const qs = getQueueService();
    for (const id of new Set(jobIds)) {
      if (this.cancellationRequestedJobIds.has(id)) continue;
      let job;
      try {
        job = qs.getJob(id);
      } catch (err: any) {
        this.strapi.log.warn(`[pipeline] Failed to inspect job ${id} before cancellation: ${err?.message || err}`);
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
        this.strapi.log.warn(`[pipeline] Failed to request cancellation for job ${id}: ${err?.message || err}`);
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
        await this.updateState({ status: 'idle', stage: 'cancelled' }, 'Пайплайн отменён после восстановления API');
        broadcastSSE('done', await this.getState());
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
    await this.updateState({
      status: 'cancelling',
      stage: 'error',
      errors: [...state.errors, `Recovery: ${reason}`],
    }, reason);
    broadcastSSE('error', await this.getState());
    if (runId) this.releaseRecoveredLifecycle(runId);
  }

  private releaseRecoveredLifecycle(runId: string): void {
    if (this.activeRunId !== runId) return;
    this.activeRunId = null;
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
      this.strapi.log.error(`[pipeline] Cannot inspect jobs for run ${runId}: ${err?.message || err}`);
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
      await this.updateState({ status: 'cancelling' }, `${message}; не удалось проверить состояние очереди, lifecycle lock сохранён`);
      return false;
    }
    if (snapshot.missingJobIds.length) {
      await this.updateState({ status: 'cancelling' }, `${message}; не найдены recorded jobs (${snapshot.missingJobIds.join(', ')}), lifecycle lock сохранён`);
      return false;
    }
    if (!snapshot.liveJobIds.length) return true;

    await this.requestCancellation(snapshot.liveJobIds, message);
    while (this.activeRunId === runId) {
      await new Promise<void>(resolve => setTimeout(resolve, 1_000));
      snapshot = await this.currentRunJobSnapshot(runId);
      if (snapshot === null) {
        await this.updateState({ status: 'cancelling' }, `${message}; не удалось проверить состояние очереди, lifecycle lock сохранён`);
        return false;
      }
      if (snapshot.missingJobIds.length) {
        await this.updateState({ status: 'cancelling' }, `${message}; не найдены recorded jobs (${snapshot.missingJobIds.join(', ')}), lifecycle lock сохранён`);
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
    await this.updateState({ status: 'cancelling' }, 'Отмена запрошена: ожидаем завершения активных задач');
    try {
      const snapshot = this.recordedJobSnapshot([...ids]);
      const qs = getQueueService();
      for (const id of snapshot.liveJobIds) qs.requestCancellation(id);
    } catch (err: any) {
      this.strapi.log.warn(`[pipeline] Failed to request cancellation for persisted run ${runId}: ${err?.message || err}`);
    }
  }

  /**
   * Reset only an already-terminal lifecycle. It never clears queues or marks a
   * running handler as cancelled, preventing reset from affecting another run.
   */
  async forceReset(): Promise<void> {
    const state = await this.getState();
    if (state.job_ids.length) {
      let snapshot;
      try {
        snapshot = this.recordedJobSnapshot(state.job_ids);
      } catch (err: any) {
        throw new Error(`Нельзя безопасно сбросить pipeline: не удалось проверить recorded jobs (${err?.message || err})`);
      }
      if (snapshot.liveJobIds.length) {
        throw new Error('Нельзя сбросить активный pipeline: дождитесь terminal jobs или отмените запуск');
      }
      if (snapshot.missingJobIds.length) {
        throw new Error(`Нельзя безопасно сбросить pipeline: не найдены recorded jobs (${snapshot.missingJobIds.join(', ')})`);
      }
    }
    // An operator reset is the only escape hatch for irrecoverable recovery
    // state. Stop its background finalizer and release its reconstituted lock.
    if (state.run_id && this.recoveringRunId === state.run_id) this.releaseRecoveredLifecycle(state.run_id);
    await this.resetState();
  }

  isCancelled(): boolean {
    return this.activeRunId !== null && this.cancelRequestedRunId === this.activeRunId;
  }

  // ── Stage delegates ────────────────────────────────────────────────────────

  async parseAll(depth: number, filters?: RunOptions['filters']): Promise<{ created: number; errors: string[] }> {
    return parseAll(this, depth, filters);
  }

  async analyze(filters?: RunOptions['filters']): Promise<{ undervalued: number; errors: string[] }> {
    return analyze(this, filters);
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
