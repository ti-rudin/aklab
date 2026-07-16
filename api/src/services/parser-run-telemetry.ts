type ParserStage = 'scan' | 'details';
type SourceStageStatus =
  | 'queued'
  | 'running'
  | 'success'
  | 'success_empty'
  | 'degraded'
  | 'blocked'
  | 'schema_changed'
  | 'failed'
  | 'cancelled';

export type StageCounters = {
  listed: number;
  eligible: number;
  existing: number;
  pre_filtered: number;
  details_attempted: number;
  details_ok: number;
  created: number;
  skipped: number;
  failed: number;
};

type EnsureSourceStage = {
  runId: string;
  sourceSlug: string;
  stage: ParserStage;
  jobId?: number;
  parserRunId?: number;
  sourceId?: number;
};

type SourceStageJobRef = Omit<EnsureSourceStage, 'jobId' | 'parserRunId' | 'sourceId'> & { jobId: number };

type FinishSourceStage = SourceStageJobRef & {
  jobId: number;
  status: Exclude<SourceStageStatus, 'queued' | 'running'>;
  counters: StageCounters;
  errorClass?: 'transient' | 'rate_limited' | 'blocked' | 'schema_changed' | 'permanent' | 'cancelled';
  errorMessage?: string;
};

const SOURCE_STAGE_UID = 'api::parser-run-source.parser-run-source';
const PARSER_RUN_UID = 'api::parser-run.parser-run';
const TERMINAL_STATUSES = new Set<SourceStageStatus>([
  'success', 'success_empty', 'degraded', 'blocked', 'schema_changed', 'failed', 'cancelled',
]);

const ZERO_COUNTERS: StageCounters = {
  listed: 0,
  eligible: 0,
  existing: 0,
  pre_filtered: 0,
  details_attempted: 0,
  details_ok: 0,
  created: 0,
  skipped: 0,
  failed: 0,
};

function identityKey(runId: string, sourceSlug: string, stage: ParserStage): string {
  return `${runId}:${sourceSlug}:${stage}`;
}

function assertOwned(row: any, jobId: number, key: string): void {
  if (!row) throw new Error(`Telemetry row does not exist: ${key}`);
  if (Number(row.job_id) !== jobId) {
    throw new Error(`Queue job ${jobId} does not own telemetry row ${key}`);
  }
}

/** Run-scoped parser telemetry. Source remains a health summary, never a coordination record. */
export function createParserRunTelemetry(strapi: any) {
  const sourceStages = () => strapi.db.query(SOURCE_STAGE_UID);
  const parserRuns = () => strapi.db.query(PARSER_RUN_UID);

  return {
    async ensureParserRun({ runId, mode, trigger }: {
      runId: string;
      mode: 'full' | 'parse' | 'analyze' | 'digest';
      trigger: 'manual' | 'cron';
    }) {
      const existing = await parserRuns().findOne({ where: { run_id: runId } });
      if (existing) return existing;

      return parserRuns().create({
        data: {
          run_id: runId,
          mode,
          trigger,
          status: 'running',
          started_at: new Date().toISOString(),
        },
      });
    },

    async finishParserRun({ runId, status, errorSummary }: {
      runId: string;
      status: 'succeeded' | 'degraded' | 'failed' | 'cancelled';
      errorSummary?: string;
    }) {
      const existing = await parserRuns().findOne({ where: { run_id: runId } });
      if (!existing) throw new Error(`Parser run does not exist: ${runId}`);
      if (['succeeded', 'degraded', 'failed', 'cancelled'].includes(existing.status)) return existing;
      return parserRuns().update({
        where: { id: existing.id },
        data: {
          status,
          finished_at: new Date().toISOString(),
          ...(errorSummary ? { error_summary: errorSummary.slice(0, 4_000) } : {}),
        },
      });
    },

    async ensureSourceStage({ runId, sourceSlug, stage, jobId, parserRunId, sourceId }: EnsureSourceStage) {
      const key = identityKey(runId, sourceSlug, stage);
      const existing = await sourceStages().findOne({ where: { identity_key: key } });
      if (existing) {
        if (jobId != null) assertOwned(existing, jobId, key);
        return existing;
      }

      try {
        return await sourceStages().create({
          data: {
            identity_key: key,
            source_slug: sourceSlug,
            stage,
            status: 'queued',
            ...(parserRunId ? { parser_run: parserRunId } : {}),
            ...(sourceId ? { source: sourceId } : {}),
            ...ZERO_COUNTERS,
            ...(jobId != null ? { job_id: jobId } : {}),
          },
        });
      } catch (error: any) {
        if (!/unique|constraint/i.test(String(error?.message || error))) throw error;
        const winner = await sourceStages().findOne({ where: { identity_key: key } });
        if (!winner) throw error;
        if (jobId != null) assertOwned(winner, jobId, key);
        return winner;
      }
    },

    async attachSourceStageJob({ runId, sourceSlug, stage, jobId }: SourceStageJobRef) {
      const key = identityKey(runId, sourceSlug, stage);
      const existing = await sourceStages().findOne({ where: { identity_key: key } });
      if (!existing) throw new Error(`Telemetry row does not exist: ${key}`);
      if (existing.job_id != null && Number(existing.job_id) !== jobId) {
        throw new Error(`Queue job ${jobId} does not own telemetry row ${key}`);
      }
      if (Number(existing.job_id) === jobId) return existing;

      return sourceStages().update({ where: { id: existing.id }, data: { job_id: jobId } });
    },

    async markSourceStageRunning({ runId, sourceSlug, stage, jobId }: SourceStageJobRef) {
      const key = identityKey(runId, sourceSlug, stage);
      const existing = await sourceStages().findOne({ where: { identity_key: key } });
      assertOwned(existing, jobId, key);
      if (TERMINAL_STATUSES.has(existing.status as SourceStageStatus)) return existing;

      return sourceStages().update({
        where: { id: existing.id },
        data: { status: 'running', started_at: new Date().toISOString() },
      });
    },

    /** Queue persistence is authoritative when cancellation races a worker's success callback. */
    async reconcileSourceStageQueueFailure({ runId, sourceSlug, stage, jobId, cancelled, errorMessage }: SourceStageJobRef & {
      cancelled: boolean;
      errorMessage?: string;
    }) {
      const key = identityKey(runId, sourceSlug, stage);
      const existing = await sourceStages().findOne({ where: { identity_key: key } });
      assertOwned(existing, jobId, key);
      return sourceStages().update({
        where: { id: existing.id },
        data: {
          status: cancelled ? 'cancelled' : 'failed',
          finished_at: new Date().toISOString(),
          ...(cancelled ? { error_class: 'cancelled' } : { error_class: 'permanent' }),
          ...(errorMessage ? { error_message: errorMessage.slice(0, 1_000) } : {}),
        },
      });
    },

    async finishSourceStage({ runId, sourceSlug, stage, jobId, status, counters, errorClass, errorMessage }: FinishSourceStage) {
      const key = identityKey(runId, sourceSlug, stage);
      const existing = await sourceStages().findOne({ where: { identity_key: key } });
      assertOwned(existing, jobId, key);
      if (TERMINAL_STATUSES.has(existing.status as SourceStageStatus)) return existing;

      return sourceStages().update({
        where: { id: existing.id },
        data: {
          status,
          ...counters,
          finished_at: new Date().toISOString(),
          ...(errorClass ? { error_class: errorClass } : {}),
          ...(errorMessage ? { error_message: errorMessage } : {}),
        },
      });
    },
  };
}
