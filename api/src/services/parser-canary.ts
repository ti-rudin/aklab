import { createHash, randomUUID } from 'node:crypto';
import type { StrapiInstance } from '../types/strapi';
import { getQueueService } from './queueService';
import { emptyState, tryAcquireIdleState, tryReleaseOwnedState, updateState } from './pipeline/state';
import type { ParserSourceHealthClassification, ParserSourceHealthCounters } from './parser-source-health';
import { recordParserSourceHealth } from './parser-health-alerts';

export type CanaryTrigger = 'manual' | 'cron';

interface CanaryOptions {
  trigger: CanaryTrigger;
  windowKey: string;
  maxItems?: number;
  probeTimeoutMs?: number;
}

interface CanaryDependencies {
  queue?: ReturnType<typeof getQueueService>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  runId?: () => string;
  recordHealth?: typeof recordParserSourceHealth;
}

const SAFE_FINGERPRINT = createHash('sha256').update(JSON.stringify(['canary_result_missing'])).digest('hex');

function safeProbeResult(source: string, value: unknown): any | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result = value as Record<string, unknown>;
  const keys = [
    'source', 'checked', 'listing_ok', 'detail_supported', 'detail_ok', 'property_block_found', 'location_label_found',
    'confirmed_address', 'confirmed_region_only', 'missing', 'semantic_fingerprint', 'status', 'reason',
  ];
  if (Object.keys(result).some(key => !keys.includes(key)) || result.source !== source) return null;
  const counts = ['checked', 'property_block_found', 'location_label_found', 'confirmed_address', 'confirmed_region_only', 'missing'];
  if (counts.some(key => !Number.isSafeInteger(result[key]) || (result[key] as number) < 0)) return null;
  if (typeof result.listing_ok !== 'boolean' || typeof result.detail_supported !== 'boolean'
    || typeof result.detail_ok !== 'boolean') return null;
  if (counts.slice(1).some(key => (result[key] as number) > (result.checked as number))) return null;
  const locationTotal = (result.confirmed_address as number)
    + (result.confirmed_region_only as number)
    + (result.missing as number);
  if (locationTotal > (result.checked as number)) return null;
  if (!['healthy', 'degraded', 'schema_changed', 'blocked'].includes(String(result.status))) return null;
  if (typeof result.semantic_fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(result.semantic_fingerprint)) return null;
  if (result.reason !== undefined && (typeof result.reason !== 'string' || !/^[a-z0-9_]{1,64}$/.test(result.reason))) return null;
  return result;
}

function degradedResult(source: string, reason: 'job_failed' | 'malformed_result') {
  return {
    source,
    checked: 0,
    listing_ok: false,
    detail_supported: true,
    detail_ok: false,
    property_block_found: 0,
    location_label_found: 0,
    confirmed_address: 0,
    confirmed_region_only: 0,
    missing: 0,
    semantic_fingerprint: SAFE_FINGERPRINT,
    status: 'degraded' as const,
    reason,
  };
}

export function createParserCanaryService(strapi: StrapiInstance, dependencies: CanaryDependencies = {}) {
  const queue = dependencies.queue ?? getQueueService();
  const sleep = dependencies.sleep ?? ((ms: number) => new Promise(resolve => setTimeout(resolve, ms)));
  const now = dependencies.now ?? Date.now;
  const makeRunId = dependencies.runId ?? (() => `canary-${randomUUID()}`);
  const recordHealth = dependencies.recordHealth ?? recordParserSourceHealth;

  return {
    async run(options: CanaryOptions) {
      if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(options.windowKey)) throw new Error('Invalid canary window key.');
      const maxItems = options.maxItems ?? 2;
      const probeTimeoutMs = options.probeTimeoutMs ?? 120_000;
      if (!Number.isSafeInteger(maxItems) || maxItems < 1 || maxItems > 3
        || !Number.isSafeInteger(probeTimeoutMs) || probeTimeoutMs < 1_000 || probeTimeoutMs > 120_000) {
        throw new Error('Invalid canary bounds.');
      }

      const runId = makeRunId();
      const startedAt = new Date(now()).toISOString();
      const acquired = await tryAcquireIdleState(strapi, {
        ...emptyState(),
        run_id: runId,
        status: 'running',
        stage: 'canary',
        message: 'Parser canary выполняется',
        trigger: options.trigger,
        started_at: startedAt,
        updated_at: startedAt,
      });
      if (!acquired) return { run_id: runId, skipped: true, reason: 'pipeline_not_idle', results: [] };

      let acknowledgementExpired = false;
      try {
        const sources = await strapi.entityService.findMany('api::source.source', {
          filters: { is_active: true },
          limit: 100,
        }) as any[];
        const jobs = (sources ?? []).map((source: any) => {
          const correlationId = `${runId}:${source.slug}`;
          const job = queue.addToQueue(`parse-${source.slug}`, {
            operation: 'probe',
            origin: 'canary',
            runId,
            stage: 'probe',
            source: source.slug,
            maxItems,
            timeoutMs: probeTimeoutMs,
          }, {
            correlationId,
            idempotencyKey: `canary:${options.windowKey}:${source.slug}`,
            maxAttempts: 1,
          });
          return { id: job.id, slug: source.slug };
        });
        await updateState(strapi, { job_ids: jobs.map(job => job.id), sources_total: jobs.length }, 'Parser canary jobs enqueued', true);

        const deadline = now() + probeTimeoutMs + 30_000;
        let cancellationRequested = false;
        let cancellationDeadline = Number.POSITIVE_INFINITY;
        let terminalJobs: any[] = [];
        while (jobs.length > 0) {
          terminalJobs = jobs.map(({ id }) => queue.getJob(id)).filter(Boolean);
          if (terminalJobs.length === jobs.length && terminalJobs.every(job => job.status === 'completed' || job.status === 'failed')) break;
          if (now() >= deadline && !cancellationRequested) {
            cancellationRequested = true;
            cancellationDeadline = now() + 30_000;
            for (const { id } of jobs) {
              const current = queue.getJob(id);
              if (!current || (current.status !== 'completed' && current.status !== 'failed')) {
                queue.requestCancellation(id);
              }
            }
          }
          if (cancellationRequested && now() >= cancellationDeadline) {
            acknowledgementExpired = true;
            await updateState(
              strapi,
              {
                run_id: runId,
                status: 'cancelling',
                stage: 'canary',
                job_ids: jobs.map(job => job.id),
              },
              'Parser canary ожидает terminal acknowledgement задач',
              true,
            );
            break;
          }
          await sleep(250);
        }

        const jobById = new Map(terminalJobs.map(job => [job.id, job]));
        const results = jobs.map(({ id, slug }) => {
          const job = jobById.get(id) as any;
          if (!job || job.status !== 'completed') return degradedResult(slug, 'job_failed');
          return safeProbeResult(slug, job.result) ?? degradedResult(slug, 'malformed_result');
        });
        if (!acknowledgementExpired) for (const result of results) {
          const source = (sources ?? []).find((candidate: any) => candidate.slug === result.source);
          if (!source) continue;
          const healthCounters: ParserSourceHealthCounters = {
            details_attempted: result.detail_supported ? result.checked : 0,
            details_ok: result.detail_supported && result.detail_ok ? result.checked : 0,
            property_block_found: result.property_block_found,
            location_label_found: result.location_label_found,
            location_confirmed_address: result.confirmed_address,
            location_confirmed_region_only: result.confirmed_region_only,
            location_missing: result.missing,
            location_unresolved: result.missing,
            schema_mismatch: result.status === 'schema_changed'
              ? Math.max(0, result.checked - result.property_block_found)
              : 0,
          };
          const reason = result.status === 'healthy'
            ? 'healthy.within_baseline'
            : result.status === 'schema_changed'
              ? 'schema_changed.canary_property_block_missing'
              : result.status === 'blocked'
                ? 'blocked.typed_error'
                : result.reason === 'diagnostics_missing'
                  ? 'degraded.diagnostics_missing'
                  : result.reason === 'no_samples'
                    ? 'degraded.canary_no_samples'
                  : result.reason === 'location_missing'
                    ? 'degraded.canary_location_missing'
                    : 'degraded.zero_detail_success';
          const classification: ParserSourceHealthClassification = {
            status: result.status,
            reason_code: reason,
            schema_fingerprint: result.semantic_fingerprint,
          };
          await recordHealth(strapi, {
            source,
            classification,
            runId,
            stage: 'canary',
            counters: healthCounters,
            now: new Date(now()),
          });
        }
        return { run_id: runId, skipped: false, results };
      } finally {
        if (!acknowledgementExpired) {
          const released = await tryReleaseOwnedState(strapi, runId, {
            ...emptyState(),
            status: 'idle',
            stage: 'idle',
            updated_at: new Date(now()).toISOString(),
          });
          if (!released) strapi.log.warn('[parser-canary] Lifecycle ownership changed before release');
        }
      }
    },
  };
}
