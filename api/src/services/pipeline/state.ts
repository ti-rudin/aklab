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
      return typeof setting.pipeline_state === 'string'
        ? JSON.parse(setting.pipeline_state)
        : setting.pipeline_state;
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
