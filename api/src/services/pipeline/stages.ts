/**
 * Pipeline stages. Completion is scoped to concrete queue jobs recorded for the
 * current run — never to a global queue drain or Source.last_parse_status.
 */

import type { Job } from '@aklab/sqlite-queue';
import type { StrapiInstance } from '../../types/strapi';
import { getQueueService } from '../queueService';
import { createParserRunTelemetry } from '../parser-run-telemetry';
import { isSafeParserTelemetryError } from '../parser-error-safety';
import { recordParserRunSourceHealth } from '../parser-source-health';
import { isNormalParserSourceAllowed } from '../parser-source-quarantine';
import { scorePropertiesBatch } from '../focusEngine';
import type { UserFilterSnapshot } from '../user-profile';
import { updateState } from './state';

export interface PipelineContext {
  strapi: StrapiInstance;
  isCancelled(): boolean;
  /** Marks this run cancelling and requests cooperative cancellation once per job. */
  requestCancellation(jobIds: number[], message: string): Promise<void>;
  getRunId(): string;
  getParserRunId(): number;
  /** The one immutable snapshot selected during lifecycle preflight. */
  getFilterSnapshot(): UserFilterSnapshot | null;
  recordJobIds(ids: number[]): Promise<void>;
  getSourceStats(slugs: string[]): Promise<any[]>;
}

type QueueService = ReturnType<typeof getQueueService>;

interface WaitResult {
  jobs: Job[];
  errors: string[];
  timedOut: boolean;
}

const POLL_MS = 1_000;
// A verified depth=1000 production run can exceed 2.5 hours. This is a per-stage
// safety boundary, so leave headroom while retaining PIPELINE_STAGE_TIMEOUT_MS override.
const DEFAULT_STAGE_TIMEOUT_MS = 4 * 60 * 60 * 1_000;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function stageTimeoutMs(): number {
  const configured = Number(process.env.PIPELINE_STAGE_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_STAGE_TIMEOUT_MS;
}

function terminal(job: Job | null): boolean {
  return job?.status === 'completed' || job?.status === 'failed';
}

function isCancellationTerminal(job: Job): boolean {
  return job.cancellation_requested_at !== null && job.cancellation_requested_at !== undefined;
}

function safeTerminalParserError(job: Job): string {
  if (isCancellationTerminal(job)) return 'parser.cancelled';
  return isSafeParserTelemetryError(job.error) ? job.error : 'parser.transient';
}

/**
 * Await only jobs recorded for this run. Cancellation intentionally does not
 * short-circuit this loop: active workers must acknowledge cancellation and
 * become terminal before the run leaves `cancelling`.
 */
async function waitForJobs(
  qs: QueueService,
  ctx: PipelineContext,
  jobIds: number[],
  label: string,
  onPoll?: (jobs: Job[]) => Promise<void>,
): Promise<WaitResult> {
  if (!jobIds.length) return { jobs: [], errors: [], timedOut: false };

  const deadline = Date.now() + stageTimeoutMs();
  let jobs: Job[] = [];
  let deadlineCancellationRequested = false;
  let timedOut = false;
  while (true) {
    const missing: number[] = [];
    jobs = jobIds.flatMap(id => {
      const job = qs.getJob(id);
      if (!job) missing.push(id);
      return job ? [job] : [];
    });

    if (onPoll) await onPoll(jobs);

    if (missing.length) {
      return {
        jobs,
        errors: missing.map(() => 'pipeline.queue_missing'),
        timedOut: false,
      };
    }

    if (jobs.every(terminal)) {
      return {
        jobs,
        errors: [
          ...(timedOut ? ['pipeline.deadline'] : []),
          ...jobs
            .filter(job => job.status === 'failed')
            .map(safeTerminalParserError),
        ],
        timedOut,
      };
    }

    if (Date.now() >= deadline && !deadlineCancellationRequested) {
      // A deadline is a cancellation request, not permission to abandon workers.
      // Keep polling these exact ids until every one is terminal; the run lifecycle
      // remains locked and `cancelling` for the entire acknowledgement period.
      deadlineCancellationRequested = true;
      timedOut = true;
      await ctx.requestCancellation(
        jobs.filter(job => !terminal(job)).map(job => job.id),
        `${label}: превышен deadline ожидания ${stageTimeoutMs()}ms; ожидаем terminal states задач`,
      );
    }

    await sleep(POLL_MS);
  }
}

function sumResult(jobs: Job[], field: string): number {
  return jobs
    .filter(job => job.status === 'completed')
    .reduce((total, job) => total + (Number((job.result as any)?.[field]) || 0), 0);
}

type DigestCounters = {
  runId: string;
  scheduled: number;
  sent: number;
  skipped: number;
  failed: number;
};

type DigestResultKind = 'sent' | 'skipped' | 'malformed';

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const expected = [...keys].sort();
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function safeDigestReason(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 256
    && value.trim() === value
    && !/[\u0000-\u001f\u007f]/.test(value)
    && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function classifyDigestResult(result: unknown): DigestResultKind {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return 'malformed';
  const value = result as Record<string, unknown>;
  if (value.sent === true) {
    return exactKeys(value, ['sent', 'count'])
      && typeof value.count === 'number'
      && Number.isSafeInteger(value.count)
      && value.count >= 0
      ? 'sent'
      : 'malformed';
  }
  return value.sent === false
    && exactKeys(value, ['sent', 'count', 'reason'])
    && value.count === 0
    && safeDigestReason(value.reason)
    ? 'skipped'
    : 'malformed';
}

function snapshotUserIds(snapshot: UserFilterSnapshot): number[] {
  if (!Array.isArray(snapshot.profiles)) throw new Error('Digest snapshot is invalid.');
  const seen = new Set<number>();
  const userIds: number[] = [];
  for (const profile of snapshot.profiles) {
    const userId = (profile as any)?.userId;
    if (typeof userId !== 'number' || !Number.isSafeInteger(userId) || userId <= 0) {
      throw new Error('Digest snapshot is invalid.');
    }
    if (seen.has(userId)) throw new Error('Digest snapshot contains duplicate users.');
    seen.add(userId);
    userIds.push(userId);
  }
  return userIds;
}

async function persistDigestCounters(
  telemetry: ReturnType<typeof createParserRunTelemetry>,
  counters: DigestCounters,
): Promise<void> {
  await telemetry.setDigestCounters(counters);
}

async function reconcileQueueFailures(
  ctx: PipelineContext,
  telemetry: ReturnType<typeof createParserRunTelemetry>,
  runId: string,
  stage: 'scan' | 'details',
  jobs: Array<{ slug: string; id: number }>,
  terminalJobs: Job[],
): Promise<void> {
  const slugByJobId = new Map(jobs.map(job => [job.id, job.slug]));
  for (const job of terminalJobs) {
    if (job.status !== 'failed') continue;
    const sourceSlug = slugByJobId.get(job.id);
    if (!sourceSlug) continue;
    const cancelled = isCancellationTerminal(job);
    const errorMessage = safeTerminalParserError(job);
    try {
      await telemetry.reconcileSourceStageQueueFailure({
        runId,
        sourceSlug,
        stage,
        jobId: job.id,
        cancelled,
        errorMessage,
      });
    } catch (error: any) {
      ctx.strapi.log.error(`[pipeline] Cannot reconcile ${stage} telemetry job`);
    }
  }
}

// ── Parse ───────────────────────────────────────────────────────────────────

export async function parseAll(ctx: PipelineContext, depth: number): Promise<{ created: number; errors: string[] }> {
  const qs = getQueueService();
  const errors: string[] = [];
  const runId = ctx.getRunId();
  const scanArtifactId = `scan-${runId}`; // trace/artifact identifier, not idempotency
  const filterSnapshot = ctx.getFilterSnapshot();
  if (!filterSnapshot || filterSnapshot.profiles.length === 0) {
    await updateState(ctx.strapi, { stage: 'parsing_done', sources_total: 0, sources_done: 0 }, 'Парсинг пропущен — нет готовых профилей');
    return { created: 0, errors };
  }

  const sourceCandidates = await ctx.strapi.entityService.findMany('api::source.source', {
    filters: { is_active: true },
    limit: 100,
  });
  const sources = (sourceCandidates ?? []).filter(isNormalParserSourceAllowed);
  if (!sources?.length) {
    await updateState(ctx.strapi, { stage: 'parsing_done', sources_total: 0, sources_done: 0 }, 'Нет активных источников');
    return { created: 0, errors };
  }

  const total = sources.length;
  await updateState(ctx.strapi, {
    stage: 'parsing_scan',
    sources_total: total,
    sources_done: 0,
    details_fetched: 0,
    details_needed: 0,
    objects_created: 0,
  }, `Фаза 1: сканирование... (0/${total})`);


  const scanJobs: Array<{ slug: string; id: number }> = [];
  const telemetry = createParserRunTelemetry(ctx.strapi);
  const parserRunId = ctx.getParserRunId();
  for (const source of sources) {
    if (ctx.isCancelled()) break;
    const src = source as any;
    await telemetry.ensureSourceStage({
      runId,
      sourceSlug: src.slug,
      stage: 'scan',
      parserRunId,
      sourceId: src.id,
    });
    const job = qs.addToQueue(`parse-${src.slug}`, {
      source: src.slug,
      sourceId: src.id,
      documentId: src.documentId,
      depth,
      filterSnapshot,
      filterSnapshotHash: filterSnapshot.hash,
      correlationId: scanArtifactId,
      phase: 'scan',
      telemetryIdentityKey: `${runId}:${src.slug}:scan`,
    }, {
      correlationId: scanArtifactId,
      idempotencyKey: `${runId}:${src.slug}:scan`,
    });
    scanJobs.push({ slug: src.slug, id: job.id });
    // Own the queue job before any later operation may throw. This keeps lifecycle
    // settlement exact even when telemetry attachment fails after enqueue.
    await ctx.recordJobIds([job.id]);
    await telemetry.attachSourceStageJob({ runId, sourceSlug: src.slug, stage: 'scan', jobId: job.id });
  }

  const scanWait = await waitForJobs(qs, ctx, scanJobs.map(job => job.id), 'Сканирование', async jobs => {
    const done = jobs.filter(terminal).length;
    await updateState(ctx.strapi, {
      stage: 'parsing_scan',
      sources_done: done,
    }, `Фаза 1: сканирование... (${done}/${total})`);
  });
  await reconcileQueueFailures(ctx, telemetry, runId, 'scan', scanJobs, scanWait.jobs);
  errors.push(...scanWait.errors);

  if (ctx.isCancelled() || scanWait.timedOut) return { created: 0, errors };

  const completedScanSlugs = scanJobs
    .filter(({ id }) => qs.getJob(id)?.status === 'completed')
    .map(({ slug }) => slug);
  if (!completedScanSlugs.length) {
    await updateState(ctx.strapi, { stage: 'parsing_done', sources_done: scanJobs.length, errors }, 'Парсинг: успешных scan jobs нет');
    return { created: 0, errors };
  }

  // Telemetry is derived only from terminal jobs of this run; Source is health summary only.
  const completedScanJobs = scanWait.jobs.filter(job => job.status === 'completed');
  const totalFound = sumResult(completedScanJobs, 'total');
  const totalDetailsNeeded = sumResult(completedScanJobs, 'detailsNeeded');
  await updateState(ctx.strapi, {
    stage: 'parsing_scan_done',
    sources_done: scanJobs.length,
    details_needed: totalDetailsNeeded,
  }, `✓ Фаза 1: ${totalFound} найдено, ${totalDetailsNeeded} к детальной загрузке`);

  await updateState(ctx.strapi, { stage: 'parsing_details' }, `Фаза 2: загрузка деталей... (0/${totalDetailsNeeded})`);
  const detailJobs: Array<{ slug: string; id: number }> = [];
  for (const slug of completedScanSlugs) {
    if (ctx.isCancelled()) break;
    const src = sources.find((source: any) => source.slug === slug) as any;
    const refreshed = await ctx.strapi.entityService.findMany('api::source.source', {
      filters: { slug },
      limit: 1,
    });
    if (!isNormalParserSourceAllowed(refreshed?.[0])) {
      ctx.strapi.log.warn(`[pipeline] Details skipped for quarantined source ${slug}`);
      continue;
    }
    await telemetry.ensureSourceStage({
      runId,
      sourceSlug: slug,
      stage: 'details',
      parserRunId,
      sourceId: src.id,
    });
    const job = qs.addToQueue(`parse-${slug}`, {
      source: slug,
      sourceId: src.id,
      documentId: src.documentId,
      depth,
      filterSnapshot,
      filterSnapshotHash: filterSnapshot.hash,
      correlationId: scanArtifactId,
      phase: 'details',
      telemetryIdentityKey: `${runId}:${slug}:details`,
    }, {
      correlationId: scanArtifactId,
      idempotencyKey: `${runId}:${slug}:details`,
    });
    detailJobs.push({ slug, id: job.id });
    await ctx.recordJobIds([job.id]);
    await telemetry.attachSourceStageJob({ runId, sourceSlug: slug, stage: 'details', jobId: job.id });
  }

  const detailWait = await waitForJobs(qs, ctx, detailJobs.map(job => job.id), 'Детальная загрузка', async jobs => {
    const completed = jobs.filter(job => job.status === 'completed');
    const done = jobs.filter(terminal).length;
    await updateState(ctx.strapi, {
      stage: 'parsing_details',
      sources_done: done,
      details_fetched: sumResult(completed, 'detailsFetched'),
      objects_created: sumResult(completed, 'created'),
    }, `Фаза 2: ${sumResult(completed, 'detailsFetched')}/${totalDetailsNeeded} деталей, ${sumResult(completed, 'created')} создано`);
  });
  await reconcileQueueFailures(ctx, telemetry, runId, 'details', detailJobs, detailWait.jobs);
  errors.push(...detailWait.errors);

  const created = sumResult(detailWait.jobs, 'created');
  const fetched = sumResult(detailWait.jobs, 'detailsFetched');
  for (const { slug, id } of detailJobs) {
    if (qs.getJob(id)?.status !== 'completed') continue;
    const source = sources.find((candidate: any) => candidate.slug === slug);
    if (!source) continue;
    try {
      await recordParserRunSourceHealth(ctx.strapi, { runId, source });
    } catch {
      errors.push('pipeline.health_summary_failed');
      ctx.strapi.log.error('[pipeline] Parser source health summary failed');
    }
  }
  if (!ctx.isCancelled()) {
    await updateState(ctx.strapi, {
      stage: 'parsing_done',
      sources_done: detailJobs.length,
      details_fetched: fetched,
      details_needed: totalDetailsNeeded,
      objects_created: created,
      errors,
    }, `✓ Парсинг: ${created} новых, ${fetched} детальных`);
  }
  return { created, errors };
}

// ── Analyze ─────────────────────────────────────────────────────────────────

export async function analyze(ctx: PipelineContext): Promise<{ undervalued: number; errors: string[] }> {
  const qs = getQueueService();
  const errors: string[] = [];
  const runId = ctx.getRunId();
  // Shared analysis candidates are selected only by the canonical marker;
  // personal status and user/profile filters do not apply here.
  const analysisWhere: any = { is_undervalued: { $null: true } };

  if (ctx.isCancelled()) return { undervalued: 0, errors };
  const properties = await ctx.strapi.entityService.findMany('api::property.property', { filters: analysisWhere, limit: -1 });
  const total = properties?.length || 0;
  if (!total) {
    await updateState(ctx.strapi, { stage: 'analyzing_skipped', analyze_total: 0, analyze_done: 0 }, 'Анализ пропущен — нет необработанных shared объектов');
    return { undervalued: 0, errors };
  }

  await updateState(ctx.strapi, { stage: 'analyzing', analyze_total: total, analyze_done: 0 }, `Анализ: 0/${total} объектов`);
  const jobIds: number[] = [];
  for (const prop of properties) {
    if (ctx.isCancelled()) break;
    const documentId = (prop as any).documentId;
    const job = qs.addToQueue('analyze-property', {
      documentId,
    }, {
      correlationId: `analyze-${runId}`,
      idempotencyKey: `${runId}:${documentId}:analyze`,
    });
    jobIds.push(job.id);
    await ctx.recordJobIds([job.id]);
  }

  const wait = await waitForJobs(qs, ctx, jobIds, 'Анализ', async jobs => {
    const done = jobs.filter(terminal).length;
    await updateState(ctx.strapi, { analyze_done: done }, `Анализ: ${done}/${total} объектов`);
  });
  errors.push(...wait.errors);
  if (ctx.isCancelled() || wait.timedOut) return { undervalued: 0, errors };

  try {
    await updateState(ctx.strapi, { message: 'Расчёт focus score...' });
    await scorePropertiesBatch();
  } catch (err: any) {
    errors.push('Score: расчёт focus score завершился ошибкой');
    ctx.strapi.log.error('[pipeline] Score calculation failed');
  }

  const undervaluedRows = await ctx.strapi.db.query('api::property.property').findMany({
    where: { is_undervalued: true },
    select: ['id'],
  });
  const undervalued = undervaluedRows?.length || 0;
  await updateState(ctx.strapi, {
    stage: 'analyzing_done',
    analyze_done: wait.jobs.filter(job => job.status === 'completed').length,
    undervalued_count: undervalued,
    errors,
  }, `✓ Анализ: ${undervalued} недооценённых из ${total}`);
  return { undervalued, errors };
}

// ── Digest ──────────────────────────────────────────────────────────────────

export async function digest(ctx: PipelineContext): Promise<{ sent: boolean; errors: string[] }> {
  const qs = getQueueService();
  const errors: string[] = [];
  const runId = ctx.getRunId();
  const filterSnapshot = ctx.getFilterSnapshot();
  const telemetry = createParserRunTelemetry(ctx.strapi);
  if (!filterSnapshot || filterSnapshot.profiles.length === 0) {
    const counters = { scheduled: 0, sent: 0, skipped: 0, failed: 0 };
    await persistDigestCounters(telemetry, { runId, ...counters });
    await updateState(
      ctx.strapi,
      {
        stage: 'digest_done',
        errors,
        digest_scheduled: counters.scheduled,
        digest_sent: counters.sent,
        digest_skipped: counters.skipped,
        digest_failed: counters.failed,
      },
      'Дайджест пропущен — нет готовых профилей',
    );
    return { sent: false, errors };
  }

  const userIds = snapshotUserIds(filterSnapshot);
  await telemetry.setDigestWindowEndAt({ runId, windowEndAt: new Date().toISOString() });
  await updateState(ctx.strapi, { stage: 'digesting' }, `Дайджест: запланировано ${userIds.length}`);

  const jobIds: number[] = [];
  for (const userId of userIds) {
    if (ctx.isCancelled()) break;
    const correlationId = `digest-${runId}`;
    const job = qs.addToQueue('digest-send', {
      runId,
      userId,
      snapshotHash: filterSnapshot.hash,
      correlationId,
    }, {
      correlationId,
      idempotencyKey: `digest:${runId}:${userId}`,
    });
    // Persist ownership before any later operation can throw. If add() returns
    // an idempotent winner, its exact existing id is recorded again safely.
    await ctx.recordJobIds([job.id]);
    jobIds.push(job.id);
  }

  const wait = await waitForJobs(qs, ctx, jobIds, 'Дайджест');
  let sentCount = 0;
  let skippedCount = 0;
  let failedCount = Math.max(0, jobIds.length - wait.jobs.length);
  for (const job of wait.jobs) {
    if (job.status === 'failed') {
      failedCount += 1;
      continue;
    }
    if (job.status !== 'completed') {
      failedCount += 1;
      continue;
    }
    const resultKind = classifyDigestResult(job.result);
    if (resultKind === 'sent') sentCount += 1;
    else if (resultKind === 'skipped') skippedCount += 1;
    else failedCount += 1;
  }
  if (failedCount > 0) errors.push(`Дайджест: ${failedCount} задач завершились с ошибкой`);
  if (wait.timedOut) errors.push('Дайджест: deadline ожидания превышен');

  const counters = {
    runId,
    scheduled: jobIds.length,
    sent: sentCount,
    skipped: skippedCount,
    failed: failedCount,
  };
  await persistDigestCounters(telemetry, counters);
  const sent = sentCount > 0;
  await updateState(
    ctx.strapi,
    {
      stage: 'digest_done',
      errors,
      digest_scheduled: counters.scheduled,
      digest_sent: counters.sent,
      digest_skipped: counters.skipped,
      digest_failed: counters.failed,
    },
    `Дайджест: ${sentCount} отправлено, ${skippedCount} пропущено, ${failedCount} ошибок`,
  );
  return { sent, errors };
}
