/**
 * Pipeline State — state management for the pipeline.
 *
 * getState / updateState / resetState — reads/writes Setting singleton (pipeline_state JSON).
 * SSE broadcast on every state change via pipeline-sse.ts.
 */

import type { StrapiInstance } from '../../types/strapi';
import { broadcastSSE } from '../pipeline-sse';

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
  errors: string[];
  started_at: string;
  updated_at: string;
}

export interface RunOptions {
  depth?: number;
  filters?: {
    priceFrom?: number;
    priceTo?: number;
    city?: string[];
    threshold?: number;
    force?: boolean;
  };
  trigger?: 'manual' | 'cron';
}

// ── Helpers ──

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
    errors: [],
    started_at: '',
    updated_at: '',
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
      };
    }
  } catch { /* ok */ }
  return emptyState();
}

export async function updateState(strapi: StrapiInstance, patch: Partial<PipelineState>, message?: string): Promise<void> {
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

  try {
    const setting = await strapi.db.query('api::setting.setting').findOne({});
    if (setting) {
      await strapi.db.query('api::setting.setting').update({
        where: { id: setting.id },
        data: { pipeline_state: updated },
      });
    }
  } catch (err: any) {
    strapi.log.warn(`[pipeline] Failed to update state: ${err.message}`);
  }

  // DEBUG: log status transitions
  if (updated.status !== current.status) {
    strapi.log.info(`[pipeline] status: ${current.status} → ${updated.status} (stage=${updated.stage})`);
  }

  // SSE broadcast
  broadcastSSE('progress', updated);
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

  broadcastSSE('progress', nextState);
  return true;
}

export async function resetState(strapi: StrapiInstance): Promise<void> {
  try {
    const setting = await strapi.db.query('api::setting.setting').findOne({});
    if (setting) {
      await strapi.db.query('api::setting.setting').update({
        where: { id: setting.id },
        data: { pipeline_state: null },
      });
    }
  } catch { /* ok */ }
  broadcastSSE('progress', emptyState());
}
