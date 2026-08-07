import { canonicalJson, type UserFilterSnapshot } from '@aklab/parse-rules';

type ParserStage = 'scan' | 'details';
export type ParserRunProfileScope = 'all' | 'single' | 'none';
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

export type DigestCounters = {
  runId: string;
  scheduled: number;
  sent: number;
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

export class ParserRunSnapshotConflictError extends Error {
  readonly code = 'PARSER_RUN_SNAPSHOT_CONFLICT';

  constructor() {
    super('Parser run filter snapshot is already persisted with different metadata.');
    this.name = 'ParserRunSnapshotConflictError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

function identityKey(runId: string, sourceSlug: string, stage: ParserStage): string {
  return `${runId}:${sourceSlug}:${stage}`;
}

function assertOwned(row: any, jobId: number, key: string): void {
  if (!row) throw new Error(`Telemetry row does not exist: ${key}`);
  if (Number(row.job_id) !== jobId) {
    throw new Error(`Queue job ${jobId} does not own telemetry row ${key}`);
  }
}

function decodeStoredSnapshot(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
}

function sameSnapshot(left: unknown, right: UserFilterSnapshot | null): boolean {
  if (left == null || right == null) return left == null && right == null;
  try {
    return canonicalJson(decodeStoredSnapshot(left)) === canonicalJson(right);
  } catch {
    return false;
  }
}

function assertDigestCounters(counters: DigestCounters): void {
  if (
    !counters
    || typeof counters.runId !== 'string'
    || counters.runId.length === 0
    || counters.runId.trim() !== counters.runId
    || /[\u0000-\u001f\u007f]/.test(counters.runId)
  ) {
    throw new Error('Invalid digest counters.');
  }

  const values = [counters.scheduled, counters.sent, counters.skipped, counters.failed];
  if (values.some(value => !Number.isSafeInteger(value) || value < 0)) {
    throw new Error('Invalid digest counters.');
  }

  const classified = counters.sent + counters.skipped + counters.failed;
  if (!Number.isSafeInteger(classified) || counters.scheduled !== classified) {
    throw new Error('Invalid digest counters.');
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

    /**
     * Persist the one immutable snapshot selected for a parser run. The first
     * successful call wins; retries may only repeat the exact same metadata.
     */
    async ensureParserRunSnapshot({ runId, profileScope, targetUserId, snapshot }: {
      runId: string;
      profileScope: ParserRunProfileScope;
      targetUserId?: number;
      snapshot: UserFilterSnapshot | null;
    }) {
      const existing = await parserRuns().findOne({ where: { run_id: runId } });
      if (!existing) throw new Error(`Parser run does not exist: ${runId}`);

      const expectedTarget = profileScope === 'single' ? targetUserId : undefined;
      const hasMetadata = existing.profile_scope != null
        || existing.filter_snapshot_hash != null
        || existing.filter_snapshot_schema_version != null
        || existing.filter_snapshot != null
        || existing.target_user_id != null;
      const matches = existing.profile_scope === profileScope
        && (expectedTarget === undefined
          ? existing.target_user_id == null
          : Number(existing.target_user_id) === expectedTarget)
        && (existing.filter_snapshot_hash ?? null) === (snapshot?.hash ?? null)
        && (existing.filter_snapshot_schema_version ?? null) === (snapshot?.schemaVersion ?? null)
        && sameSnapshot(existing.filter_snapshot ?? null, snapshot);

      if (hasMetadata) {
        if (!matches) throw new ParserRunSnapshotConflictError();
        return existing;
      }

      const firstWrite = await parserRuns().update({
        // Conditional update makes the first metadata write atomic across API
        // processes. A find-then-unconditional-update would let two builders
        // overwrite each other's immutable snapshot.
        where: {
          id: existing.id,
          profile_scope: null,
          target_user_id: null,
          filter_snapshot: null,
          filter_snapshot_hash: null,
          filter_snapshot_schema_version: null,
        },
        data: {
          profile_scope: profileScope,
          ...(expectedTarget === undefined ? {} : { target_user_id: expectedTarget }),
          filter_snapshot: snapshot,
          filter_snapshot_hash: snapshot?.hash ?? null,
          filter_snapshot_schema_version: snapshot?.schemaVersion ?? null,
        },
      });
      if (firstWrite) return firstWrite;

      // Another process won the conditional write. Re-read the winner and
      // accept only an exact replay; otherwise fail closed without overwriting.
      const winner = await parserRuns().findOne({ where: { run_id: runId } });
      if (winner) {
        const winnerMatches = winner.profile_scope === profileScope
          && (expectedTarget === undefined
            ? winner.target_user_id == null
            : Number(winner.target_user_id) === expectedTarget)
          && (winner.filter_snapshot_hash ?? null) === (snapshot?.hash ?? null)
          && (winner.filter_snapshot_schema_version ?? null) === (snapshot?.schemaVersion ?? null)
          && sameSnapshot(winner.filter_snapshot ?? null, snapshot);
        if (winnerMatches) return winner;
      }
      throw new ParserRunSnapshotConflictError();
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

    /** Persist the exact digest fan-out outcome before parser-run terminalization. */
    async setDigestCounters(counters: DigestCounters) {
      assertDigestCounters(counters);
      const existing = await parserRuns().findOne({ where: { run_id: counters.runId } });
      if (!existing) throw new Error('Parser run does not exist.');
      if (existing.status !== 'running') throw new Error('Parser run is not running.');

      const samePersistedCounters = [
        ['digest_scheduled', counters.scheduled],
        ['digest_sent', counters.sent],
        ['digest_skipped', counters.skipped],
        ['digest_failed', counters.failed],
      ].every(([field, value]) => existing[field] !== undefined && Number(existing[field]) === value);
      if (samePersistedCounters && counters.scheduled > 0) return existing;

      const updated = await parserRuns().update({
        // The status predicate prevents a late digest finalizer from overwriting
        // a terminal parser run after the lifecycle has moved on.
        where: { id: existing.id, status: 'running' },
        data: {
          digest_scheduled: counters.scheduled,
          digest_sent: counters.sent,
          digest_skipped: counters.skipped,
          digest_failed: counters.failed,
        },
      });
      if (!updated) throw new Error('Parser run changed before digest counters were persisted.');
      return updated;
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
