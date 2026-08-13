/**
 * Pipeline State — state management for the pipeline.
 *
 * getState / updateState / resetState — reads/writes Setting singleton (pipeline_state JSON).
 * SSE broadcast on every state change via pipeline-sse.ts.
 */

import type { StrapiInstance } from '../../types/strapi';
import { broadcastSSE } from '../pipeline-sse';
import type { UserFilterSnapshot } from '../user-profile';

// ── Types ──

export type PipelineStage =
  | 'idle'
  | 'parsing_scan'
  | 'parsing_scan_done'
  | 'parsing_details'
  | 'parsing_done'
  | 'analyzing'
  | 'analyzing_skipped'
  | 'analyzing_done'
  | 'digesting'
  | 'digest_done'
  | 'done'
  | 'done_with_errors'
  | 'cancelled'
  | 'error';

export type PipelineStatus = 'idle' | 'running' | 'cancelling';

export interface PipelineState {
  /** Stable identifier of the currently reported run. */
  run_id: string | null;
  /** Queue jobs owned by run_id; used for run-scoped cancellation/recovery. */
  job_ids: number[];
  status: PipelineStatus;
  stage: PipelineStage;
  message: string;
  trigger: 'manual' | 'cron';
  sources_total: number;
  sources_done: number;
  details_fetched: number;
  details_needed: number;
  analyze_total: number;
  analyze_done: number;
  undervalued_count: number;
  objects_created: number;
  digest_scheduled: number;
  digest_sent: number;
  digest_skipped: number;
  digest_failed: number;
  errors: string[];
  started_at: string;
  updated_at: string;
  /** Private, run-scoped immutable filter snapshot. Never expose through API/SSE. */
  filter_snapshot: UserFilterSnapshot | null;
  filter_snapshot_hash: string | null;
  filter_snapshot_scope: 'all' | 'single' | 'none' | null;
  filter_snapshot_schema_version: number | null;
  filter_snapshot_window_end_at: string | null;
}

export type SanitizedPipelineState = Pick<
  PipelineState,
  | 'run_id'
  | 'job_ids'
  | 'status'
  | 'stage'
  | 'message'
  | 'trigger'
  | 'sources_total'
  | 'sources_done'
  | 'details_fetched'
  | 'details_needed'
  | 'analyze_total'
  | 'analyze_done'
  | 'undervalued_count'
  | 'objects_created'
  | 'digest_scheduled'
  | 'digest_sent'
  | 'digest_skipped'
  | 'digest_failed'
  | 'errors'
  | 'started_at'
  | 'updated_at'
  | 'filter_snapshot_hash'
  | 'filter_snapshot_scope'
  | 'filter_snapshot_schema_version'
  | 'filter_snapshot_window_end_at'
>;

export class PipelineDepthError extends Error {
  readonly code = 'PIPELINE_INPUT_INVALID';

  constructor() {
    super('Pipeline depth must be an integer from 1 to 1000.');
    this.name = 'PipelineDepthError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function validateDepth(value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 1000) {
    throw new PipelineDepthError();
  }
}

// ── Helpers ──

function safeNonNegativeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function emptyState(): PipelineState {
  return {
    run_id: null,
    job_ids: [],
    status: 'idle',
    stage: 'idle',
    message: '',
    trigger: 'manual',
    sources_total: 0,
    sources_done: 0,
    details_fetched: 0,
    details_needed: 0,
    analyze_total: 0,
    analyze_done: 0,
    undervalued_count: 0,
    objects_created: 0,
    digest_scheduled: 0,
    digest_sent: 0,
    digest_skipped: 0,
    digest_failed: 0,
    errors: [],
    started_at: '',
    updated_at: '',
    filter_snapshot: null,
    filter_snapshot_hash: null,
    filter_snapshot_scope: null,
    filter_snapshot_schema_version: null,
    filter_snapshot_window_end_at: null,
  };
}

function unreadableState(): PipelineState {
  const state = emptyState();
  const message = 'Состояние pipeline не удалось прочитать; требуется восстановление.';
  return {
    ...state,
    status: 'cancelling',
    stage: 'error',
    message,
    errors: [message],
  };
}

/**
 * Public/admin state representation. The full snapshot is intentionally kept
 * only in the private Setting JSON and parser_run audit row.
 */
export function sanitizePipelineState(state: PipelineState): SanitizedPipelineState {
  // Do not spread the private state here. Besides the immutable snapshot and
  // target id, a stale/forward-compatible state row may contain additional
  // private fields. Clone the two mutable collections as well: callers of the
  // controller/SSE boundary must not be able to mutate the private state graph.
  return {
    run_id: state.run_id,
    job_ids: Array.isArray(state.job_ids) ? [...state.job_ids] : [],
    status: state.status,
    stage: state.stage,
    message: state.message,
    trigger: state.trigger,
    sources_total: state.sources_total,
    sources_done: state.sources_done,
    details_fetched: state.details_fetched,
    details_needed: state.details_needed,
    analyze_total: state.analyze_total,
    analyze_done: state.analyze_done,
    undervalued_count: state.undervalued_count,
    objects_created: state.objects_created,
    digest_scheduled: safeNonNegativeInteger(state.digest_scheduled),
    digest_sent: safeNonNegativeInteger(state.digest_sent),
    digest_skipped: safeNonNegativeInteger(state.digest_skipped),
    digest_failed: safeNonNegativeInteger(state.digest_failed),
    errors: Array.isArray(state.errors) ? [...state.errors] : [],
    started_at: state.started_at,
    updated_at: state.updated_at,
    filter_snapshot_hash: state.filter_snapshot_hash,
    filter_snapshot_scope: state.filter_snapshot_scope,
    filter_snapshot_schema_version: state.filter_snapshot_schema_version,
    filter_snapshot_window_end_at: state.filter_snapshot_window_end_at,
  };
}

// ── State Management ──

export async function getState(strapi: StrapiInstance): Promise<PipelineState> {
  try {
    const setting = await strapi.db.query('api::setting.setting').findOne({});
    if (setting?.pipeline_state) {
      const stored = typeof setting.pipeline_state === 'string'
        ? JSON.parse(setting.pipeline_state)
        : setting.pipeline_state;
      // States written before run-aware orchestration do not contain run metadata.
      // Normalize on read so existing Setting rows remain compatible after deploy.
      return {
        ...emptyState(),
        ...stored,
        run_id: stored?.run_id ?? null,
        job_ids: Array.isArray(stored?.job_ids) ? stored.job_ids : [],
        filter_snapshot: stored?.filter_snapshot ?? null,
        filter_snapshot_hash: stored?.filter_snapshot_hash ?? null,
        filter_snapshot_scope: stored?.filter_snapshot_scope ?? null,
        filter_snapshot_schema_version: stored?.filter_snapshot_schema_version ?? null,
        filter_snapshot_window_end_at: stored?.filter_snapshot_window_end_at ?? null,
        digest_scheduled: safeNonNegativeInteger(stored?.digest_scheduled),
        digest_sent: safeNonNegativeInteger(stored?.digest_sent),
        digest_skipped: safeNonNegativeInteger(stored?.digest_skipped),
        digest_failed: safeNonNegativeInteger(stored?.digest_failed),
      };
    }
  } catch {
    return unreadableState();
  }
  return emptyState();
}

export async function updateState(
  strapi: StrapiInstance,
  patch: Partial<PipelineState>,
  message?: string,
  failClosed = false,
): Promise<void> {
  const current = await getState(strapi);
  // Prevent implicit status downgrade from 'running' to 'idle'
  // Only explicit status changes (via patch.status) can change it
  const safePatch = { ...patch };
  if (current.status === 'running' && !('status' in patch)) {
    safePatch.status = 'running';
  }
  const updated: PipelineState = {
    ...current,
    ...safePatch,
    message: message ?? patch.message ?? current.message,
    updated_at: new Date().toISOString(),
  };
  updated.digest_scheduled = safeNonNegativeInteger(updated.digest_scheduled);
  updated.digest_sent = safeNonNegativeInteger(updated.digest_sent);
  updated.digest_skipped = safeNonNegativeInteger(updated.digest_skipped);
  updated.digest_failed = safeNonNegativeInteger(updated.digest_failed);

  try {
    const setting = await strapi.db.query('api::setting.setting').findOne({});
    if (setting) {
      await strapi.db.query('api::setting.setting').update({
        where: { id: setting.id },
        data: { pipeline_state: updated },
      });
    } else if (failClosed) {
      throw new Error('Pipeline setting row is missing.');
    }
  } catch (err: any) {
    strapi.log.warn('[pipeline] Failed to update state persistence');
    if (failClosed) throw new Error('Pipeline state persistence failed.');
  }

  // DEBUG: log status transitions
  if (updated.status !== current.status) {
    strapi.log.info(`[pipeline] status: ${current.status} → ${updated.status} (stage=${updated.stage})`);
  }

  // SSE broadcast
  broadcastSSE('progress', sanitizePipelineState(updated));
}

/**
 * Atomically claim the persisted lifecycle only while it is idle. `db.query()`
 * cannot expose an affected-row count here, so use Strapi's documented Knex
 * connection with SQLite's supported UPDATE ... RETURNING primitive instead.
 */
export async function tryAcquireIdleState(strapi: StrapiInstance, nextState: PipelineState): Promise<boolean> {
  const setting = await strapi.db.query('api::setting.setting').findOne({});
  if (!setting) return false;

  const result = await strapi.db.connection.raw(
    `UPDATE setting
       SET pipeline_state = ?, updated_at = ?
     WHERE id = ?
       AND (pipeline_state IS NULL OR json_extract(pipeline_state, '$.status') = 'idle')
     RETURNING id`,
    [JSON.stringify(nextState), nextState.updated_at, setting.id],
  );
  const rows = Array.isArray(result?.rows)
    ? result.rows
    : Array.isArray(result)
      ? result
      : [];
  if (rows.length !== 1) return false;

  broadcastSSE('progress', sanitizePipelineState(nextState));
  return true;
}

/** Atomically release only the lifecycle still owned by expectedRunId. */
export async function tryReleaseOwnedState(
  strapi: StrapiInstance,
  expectedRunId: string,
  nextState: PipelineState,
): Promise<boolean> {
  const setting = await strapi.db.query('api::setting.setting').findOne({});
  if (!setting) return false;

  const result = await strapi.db.connection.raw(
    `UPDATE setting
       SET pipeline_state = ?, updated_at = ?
     WHERE id = ?
       AND json_extract(pipeline_state, '$.run_id') = ?
     RETURNING id`,
    [JSON.stringify(nextState), nextState.updated_at, setting.id, expectedRunId],
  );
  const rows = Array.isArray(result?.rows)
    ? result.rows
    : Array.isArray(result)
      ? result
      : [];
  if (rows.length !== 1) return false;

  broadcastSSE('progress', sanitizePipelineState(nextState));
  return true;
}

export async function resetState(strapi: StrapiInstance): Promise<void> {
  const setting = await strapi.db.query('api::setting.setting').findOne({});
  if (!setting) throw new Error('Pipeline setting row is missing.');
  await strapi.db.query('api::setting.setting').update({
    where: { id: setting.id },
    data: { pipeline_state: null },
  });
  broadcastSSE('progress', sanitizePipelineState(emptyState()));
}
