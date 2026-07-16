/**
 * Pipeline stages. Completion is scoped to concrete queue jobs recorded for the
 * current run — never to a global queue drain or Source.last_parse_status.
 */

import type { Job } from '@aklab/sqlite-queue';
import type { StrapiInstance } from '../../types/strapi';
import { getQueueService } from '../queueService';
import { scorePropertiesBatch } from '../focusEngine';
import { buildParseRules } from '../parseRules';
import type { RunOptions } from './state';
import { updateState } from './state';

export interface PipelineContext {
  strapi: StrapiInstance;
  isCancelled(): boolean;
  /** Marks this run cancelling and requests cooperative cancellation once per job. */
  requestCancellation(jobIds: number[], message: string): Promise<void>;
  getRunId(): string;
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
        errors: missing.map(id => `${label}: job ${id} не найдена в очереди`),
        timedOut: false,
      };
    }

    if (jobs.every(terminal)) {
      return {
        jobs,
        errors: [
          ...(timedOut ? [`${label}: deadline превышен; cancellation подтверждена terminal states задач`] : []),
          ...jobs
            .filter(job => job.status === 'failed')
            .map(job => `${label}: job ${job.id} завершилась с ошибкой: ${job.error || 'unknown error'}`),
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

// ── Parse ───────────────────────────────────────────────────────────────────

export async function parseAll(ctx: PipelineContext, depth: number, filters?: RunOptions['filters']): Promise<{ created: number; errors: string[] }> {
  const qs = getQueueService();
  const errors: string[] = [];
  const runId = ctx.getRunId();
  const scanArtifactId = `scan-${runId}`; // trace/artifact identifier, not idempotency

  const sources = await ctx.strapi.entityService.findMany('api::source.source', {
    filters: { is_active: true },
    limit: 100,
  });
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

  const resetData = {
    total_details_fetched: 0,
    total_details_needed: 0,
    total_found: 0,
    total_created: 0,
    last_parse_status: null,
    last_parse_error: null,
  };
  for (const source of sources) {
    if (ctx.isCancelled()) break;
    try {
      await ctx.strapi.db.query('api::source.source').update({
        where: { documentId: (source as any).documentId },
        data: resetData,
      });
    } catch { /* Source progress is informational, queue result is authoritative. */ }
  }

  const settings = await ctx.strapi.db.query('api::setting.setting').findOne({});
  const rules = buildParseRules(settings);
  if (filters?.priceFrom != null) rules.priceFrom = filters.priceFrom;
  if (filters?.priceTo != null) rules.priceTo = filters.priceTo;
  if (filters?.city?.length) rules.cities = filters.city;

  const scanJobs: Array<{ slug: string; id: number }> = [];
  for (const source of sources) {
    if (ctx.isCancelled()) break;
    const src = source as any;
    const job = qs.addToQueue(`parse-${src.slug}`, {
      source: src.slug,
      sourceId: src.id,
      documentId: src.documentId,
      depth,
      rules,
      correlationId: scanArtifactId,
      phase: 'scan',
    }, {
      correlationId: scanArtifactId,
      idempotencyKey: `${runId}:${src.slug}:scan`,
    });
    scanJobs.push({ slug: src.slug, id: job.id });
    // Persist the returned id before enqueueing another source; cancel can now be exact.
    await ctx.recordJobIds([job.id]);
  }

  const scanWait = await waitForJobs(qs, ctx, scanJobs.map(job => job.id), 'Сканирование', async jobs => {
    const done = jobs.filter(terminal).length;
    await updateState(ctx.strapi, {
      stage: 'parsing_scan',
      sources_done: done,
    }, `Фаза 1: сканирование... (${done}/${total})`);
  });
  errors.push(...scanWait.errors);

  if (ctx.isCancelled() || scanWait.timedOut) return { created: 0, errors };

  const completedScanSlugs = scanJobs
    .filter(({ id }) => qs.getJob(id)?.status === 'completed')
    .map(({ slug }) => slug);
  if (!completedScanSlugs.length) {
    await updateState(ctx.strapi, { stage: 'parsing_done', sources_done: scanJobs.length, errors }, 'Парсинг: успешных scan jobs нет');
    return { created: 0, errors };
  }

  // Source counters remain UI metrics only. They never decide phase completion.
  const scanStats = await ctx.getSourceStats(completedScanSlugs);
  const totalFound = scanStats.reduce((sum, source: any) => sum + (Number(source.total_found) || 0), 0);
  const totalDetailsNeeded = scanStats.reduce((sum, source: any) => sum + (Number(source.total_details_needed) || 0), 0);
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
    const job = qs.addToQueue(`parse-${slug}`, {
      source: slug,
      sourceId: src.id,
      documentId: src.documentId,
      depth,
      rules,
      correlationId: scanArtifactId,
      phase: 'details',
    }, {
      correlationId: scanArtifactId,
      idempotencyKey: `${runId}:${slug}:details`,
    });
    detailJobs.push({ slug, id: job.id });
    await ctx.recordJobIds([job.id]);
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
  errors.push(...detailWait.errors);

  const created = sumResult(detailWait.jobs, 'created');
  const fetched = sumResult(detailWait.jobs, 'detailsFetched');
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

export async function analyze(ctx: PipelineContext, filters?: RunOptions['filters']): Promise<{ undervalued: number; errors: string[] }> {
  const qs = getQueueService();
  const errors: string[] = [];
  const runId = ctx.getRunId();

  const analysisWhere: any = { status: 'new', is_undervalued: { $null: true } };
  if (filters?.priceFrom != null && !isNaN(filters.priceFrom)) analysisWhere.price = { ...(analysisWhere.price || {}), $gte: filters.priceFrom };
  if (filters?.priceTo != null && !isNaN(filters.priceTo)) analysisWhere.price = { ...(analysisWhere.price || {}), $lte: filters.priceTo };
  if (filters?.city?.length) analysisWhere.city = { $in: filters.city };

  if (filters?.force) {
    // `analysisWhere` intentionally selects only unanalysed candidates. Force
    // must first reset the same filtered status='new' set without that null
    // predicate, then query fresh analysis candidates after the reset.
    const resetWhere = { ...analysisWhere };
    delete resetWhere.is_undervalued;
    if (ctx.isCancelled()) return { undervalued: 0, errors };
    const toReset = await ctx.strapi.db.query('api::property.property').findMany({ where: resetWhere, select: ['documentId'] });
    for (const prop of toReset || []) {
      if (ctx.isCancelled()) return { undervalued: 0, errors };
      await ctx.strapi.db.query('api::property.property').update({
        where: { documentId: prop.documentId },
        data: { is_undervalued: null, deviation: null, price_per_sqm_ref: null },
      });
    }
  }

  if (ctx.isCancelled()) return { undervalued: 0, errors };
  const properties = await ctx.strapi.entityService.findMany('api::property.property', { filters: analysisWhere, limit: -1 });
  const total = properties?.length || 0;
  if (!total) {
    await updateState(ctx.strapi, { stage: 'analyzing_skipped', analyze_total: 0, analyze_done: 0 }, 'Анализ пропущен — нет новых объектов');
    return { undervalued: 0, errors };
  }

  await updateState(ctx.strapi, { stage: 'analyzing', analyze_total: total, analyze_done: 0 }, `Анализ: 0/${total} объектов`);
  const jobIds: number[] = [];
  for (const prop of properties) {
    if (ctx.isCancelled()) break;
    const documentId = (prop as any).documentId;
    const job = qs.addToQueue('analyze-property', {
      documentId,
      threshold: filters?.threshold,
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
    await scorePropertiesBatch({
      city: filters?.city,
      priceFrom: filters?.priceFrom,
      priceTo: filters?.priceTo,
      threshold: filters?.threshold,
    });
  } catch (err: any) {
    errors.push(`Score: ${err.message}`);
    ctx.strapi.log.error(`[pipeline] Score error: ${err.message}`);
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
  const setting = await ctx.strapi.db.query('api::setting.setting').findOne({});
  if (setting?.digest_enabled === false) {
    await updateState(ctx.strapi, { stage: 'digest_done' }, 'Дайджест отключён в настройках');
    return { sent: false, errors };
  }

  await updateState(ctx.strapi, { stage: 'digesting' }, 'Отправка дайджеста...');
  const job = qs.addToQueue('digest-send', {
    date: new Date().toISOString().slice(0, 10),
    smtpTo: setting?.smtp_to || null,
    correlationId: `digest-${runId}`,
  }, {
    correlationId: `digest-${runId}`,
    idempotencyKey: `${runId}:digest`,
  });
  await ctx.recordJobIds([job.id]);

  const wait = await waitForJobs(qs, ctx, [job.id], 'Дайджест');
  errors.push(...wait.errors);
  const terminalJob = wait.jobs[0];
  if (ctx.isCancelled() || wait.timedOut || terminalJob?.status === 'failed') return { sent: false, errors };

  const sent = terminalJob?.status === 'completed' && (terminalJob.result as any)?.sent === true;
  await updateState(ctx.strapi, { stage: 'digest_done', errors }, sent ? '✓ Дайджест отправлен' : 'Дайджест завершён без отправки');
  return { sent, errors };
}
