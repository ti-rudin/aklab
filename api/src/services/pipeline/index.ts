/**
 * Pipeline Service — единый оркестратор для парсинга, анализа и дайджеста.
 *
 * Все вызовы (UI кнопки, cron, API) проходят через этот сервис.
 * Pipeline state хранится в setting.pipeline_state (JSON).
 * SSE broadcast — через pipeline-sse.ts.
 *
 * Модуль разделён на 3 файла:
 *   state.ts  — getState / updateState / resetState + типы
 *   stages.ts — parseAll / analyze / digest
 *   index.ts  — PipelineService class shell + singleton
 */

import type { StrapiInstance } from '../../types/strapi';
import { getQueueService } from '../queueService';
import { broadcastSSE } from '../pipeline-sse';
import type { PipelineState, RunOptions } from './state';
import { getState, updateState, resetState, emptyState } from './state';
import { parseAll, analyze, digest } from './stages';
import type { PipelineContext } from './stages';

// Re-export types for external consumers
export type { PipelineStage, PipelineStatus, PipelineState } from './state';

// ── Pipeline Service ──

export class PipelineService implements PipelineContext {
  strapi: StrapiInstance;
  private cancelRequested = false;

  constructor(strapi: StrapiInstance) {
    this.strapi = strapi;
  }

  // ── State Management (delegates to state.ts) ──

  async getState(): Promise<PipelineState> {
    return getState(this.strapi);
  }

  async updateState(patch: Partial<PipelineState>, message?: string): Promise<void> {
    return updateState(this.strapi, patch, message);
  }

  async resetState(): Promise<void> {
    return resetState(this.strapi);
  }

  // ── Lock ──

  private async acquireLock(trigger: 'manual' | 'cron'): Promise<boolean> {
    const state = await this.getState();
    if (state.status === 'running') {
      return false;
    }
    const now = new Date().toISOString();
    await this.updateState({
      ...emptyState(),
      status: 'running',
      stage: 'parsing_scan',
      trigger,
      started_at: now,
      updated_at: now,
    });
    this.cancelRequested = false;
    return true;
  }

  // ── Cancel ──

  async cancel(): Promise<void> {
    this.cancelRequested = true;

    // Hard reset: clear all parse/analyze/digest queues so the pipeline can finish
    try {
      const qs = getQueueService();
      const stats = qs.getDetailedStats();
      const queues = stats.queues || stats;
      for (const qName of Object.keys(queues)) {
        if (qName.startsWith('parse-') || qName === 'analyze-property' || qName === 'digest-send') {
          qs.clearQueue(qName);
        }
      }
    } catch { /* ok */ }

    // Immediately set terminal state so UI updates
    await this.updateState({
      status: 'idle',
      stage: 'cancelled',
    }, 'Пайплайн отменён');
  }

  // ── Force Reset (for stuck states) ──

  async forceReset(): Promise<void> {
    this.cancelRequested = true;
    try {
      const qs = getQueueService();
      const stats = qs.getDetailedStats();
      const queues = stats.queues || stats;
      for (const qName of Object.keys(queues)) {
        if (qName.startsWith('parse-') || qName === 'analyze-property' || qName === 'digest-send') {
          qs.clearQueue(qName);
        }
      }
    } catch { /* ok */ }
    await this.resetState();
  }

  isCancelled(): boolean {
    return this.cancelRequested;
  }

  // ── Stage Delegates ──

  async parseAll(depth: number, filters?: RunOptions['filters']): Promise<{ created: number; errors: string[] }> {
    return parseAll(this, depth, filters);
  }

  async analyze(filters?: RunOptions['filters']): Promise<{ undervalued: number; errors: string[] }> {
    return analyze(this, filters);
  }

  async digest(): Promise<{ sent: boolean; errors: string[] }> {
    return digest(this);
  }

  // ── Full Pipeline ──

  async run(depth: number, filters?: RunOptions['filters'], trigger: 'manual' | 'cron' = 'manual'): Promise<void> {
    const locked = await this.acquireLock(trigger);
    if (!locked) {
      throw new Error('Pipeline уже выполняется');
    }

    const allErrors: string[] = [];

    try {
      // Stage 1: Parse (filters from form override global settings)
      if (!this.isCancelled()) {
        const parseResult = await this.parseAll(depth, filters);
        allErrors.push(...parseResult.errors);
      }

      // Stage 2: Analyze + Score
      if (!this.isCancelled()) {
        try {
          const analyzeResult = await this.analyze(filters);
          allErrors.push(...analyzeResult.errors);
        } catch (err: any) {
          allErrors.push(`Анализ: ${err.message}`);
          this.strapi.log.error(`[pipeline] Analyze failed: ${err.message}`);
        }
      }

      // Stage 3: Digest
      if (!this.isCancelled()) {
        try {
          const digestResult = await this.digest();
          allErrors.push(...digestResult.errors);
        } catch (err: any) {
          allErrors.push(`Дайджест: ${err.message}`);
          this.strapi.log.error(`[pipeline] Digest failed: ${err.message}`);
        }
      }

      // Final state
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
    } catch (err: any) {
      allErrors.push(`Pipeline: ${err.message}`);
      await this.updateState({
        status: 'idle',
        stage: 'error',
        errors: allErrors,
      }, `Ошибка: ${err.message}`);
      broadcastSSE('error', await this.getState());
    }
  }

  // ── Helpers ──

  async getSourceStats(slugs: string[]): Promise<any[]> {
    try {
      const sources = await this.strapi.entityService.findMany('api::source.source', {
        filters: { slug: { $in: slugs } },
        limit: 100,
      });
      return sources || [];
    } catch { return []; }
  }
}

// Singleton
let instance: PipelineService | null = null;

export function getPipelineService(strapi?: StrapiInstance): PipelineService {
  if (!instance && strapi) {
    instance = new PipelineService(strapi);
  }
  if (!instance) {
    throw new Error('PipelineService not initialized — pass strapi on first call');
  }
  return instance;
}
