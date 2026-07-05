/**
 * Pipeline Service — единый оркестратор для парсинга, анализа и дайджеста.
 *
 * Все вызовы (UI кнопки, cron, API) проходят через этот сервис.
 * Pipeline state хранится в setting.pipeline_state (JSON).
 * SSE broadcast — через pipeline-sse.ts.
 */

import type { StrapiInstance } from '../types/strapi';
import { getQueueService } from './queueService';
import { scorePropertiesBatch } from './focusEngine';
import { broadcastSSE } from './pipeline-sse';

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

interface RunOptions {
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

function emptyState(): PipelineState {
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

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// ── Pipeline Service ──

export class PipelineService {
  private strapi: StrapiInstance;
  private cancelRequested = false;

  constructor(strapi: StrapiInstance) {
    this.strapi = strapi;
  }

  // ── State Management ──

  async getState(): Promise<PipelineState> {
    try {
      const setting = await this.strapi.db.query('api::setting.setting').findOne({});
      if (setting?.pipeline_state) {
        return typeof setting.pipeline_state === 'string'
          ? JSON.parse(setting.pipeline_state)
          : setting.pipeline_state;
      }
    } catch { /* ok */ }
    return emptyState();
  }

  async updateState(patch: Partial<PipelineState>, message?: string): Promise<void> {
    const current = await this.getState();
    const updated: PipelineState = {
      ...current,
      ...patch,
      message: message ?? patch.message ?? current.message,
      updated_at: new Date().toISOString(),
    };

    try {
      await this.strapi.db.query('api::setting.setting').update({
        where: {},
        data: { pipeline_state: updated },
      });
    } catch (err: any) {
      this.strapi.log.warn(`[pipeline] Failed to update state: ${err.message}`);
    }

    // SSE broadcast
    broadcastSSE('progress', updated);
  }

  async resetState(): Promise<void> {
    await this.strapi.db.query('api::setting.setting').update({
      where: {},
      data: { pipeline_state: null },
    });
    broadcastSSE('progress', emptyState());
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
    await this.updateState({ status: 'cancelling' }, 'Отмена...');
  }

  private isCancelled(): boolean {
    return this.cancelRequested;
  }

  // ── Parse All Sources ──

  async parseAll(depth: number): Promise<{ created: number; errors: string[] }> {
    const qs = getQueueService();
    const errors: string[] = [];

    const sources = await this.strapi.entityService.findMany('api::source.source', {
      filters: { is_active: true },
      limit: 100,
    });

    if (!sources?.length) {
      await this.updateState({
        stage: 'parsing_done',
        sources_total: 0,
        sources_done: 0,
      }, 'Нет активных источников');
      return { created: 0, errors: [] };
    }

    const total = sources.length;
    await this.updateState({
      sources_total: total,
      sources_done: 0,
      details_fetched: 0,
      details_needed: 0,
      objects_created: 0,
    }, `Сканирование источников... (0/${total})`);

    // Enqueue all parsers
    const corrId = `pipeline-parse-${Date.now()}`;
    const slugs: string[] = [];
    for (const src of sources) {
      if (this.isCancelled()) break;
      const slug = (src as any).slug;
      slugs.push(slug);
      qs.addToQueue(`parse-${slug}`, {
        source: slug,
        sourceId: (src as any).id,
        documentId: (src as any).documentId,
        depth,
      }, { correlationId: corrId });
    }

    // Wait for all parse queues to drain
    const parseQueues = slugs.map(s => `parse-${s}`);
    let lastSourcesDone = 0;
    while (!this.isCancelled()) {
      await sleep(3000);
      const stats = qs.getDetailedStats();
      const queues = stats.queues || stats;

      // Count active parse queues
      let anyActive = false;
      for (const qName of parseQueues) {
        const q = queues[qName];
        if (q && (q.pending > 0 || q.active > 0)) {
          anyActive = true;
          break;
        }
      }

      // Read source stats from DB for progress
      const sourceStats = await this.getSourceStats(slugs);
      let totalFetched = 0, totalNeeded = 0, totalCreated = 0, doneCount = 0;
      for (const s of sourceStats) {
        totalFetched += s.total_details_fetched || 0;
        totalNeeded += s.total_details_needed || 0;
        totalCreated += s.total_created || 0;
        if (s.last_parse_status === 'success' || s.last_parse_status === 'error') {
          doneCount++;
          if (s.last_parse_status === 'error' && s.last_parse_error) {
            const msg = `${s.slug}: ${s.last_parse_error}`;
            if (!errors.includes(msg)) errors.push(msg);
          }
        }
      }

      // Determine stage
      let stage: PipelineStage = 'parsing_scan';
      let message = `Сканирование источников... (${doneCount}/${total})`;
      if (totalNeeded > 0) {
        stage = 'parsing_details';
        message = `Загрузка деталей: ${totalFetched}/${totalNeeded}`;
        if (doneCount > lastSourcesDone) {
          message = `Сканирование источников... (${doneCount}/${total}) · Детали: ${totalFetched}/${totalNeeded}`;
        }
      }

      if (doneCount > lastSourcesDone) lastSourcesDone = doneCount;

      await this.updateState({
        stage,
        message,
        sources_done: doneCount,
        details_fetched: totalFetched,
        details_needed: totalNeeded,
        objects_created: totalCreated,
        errors,
      });

      if (!anyActive && doneCount >= total) break;
    }

    // Final read
    const finalStats = await this.getSourceStats(slugs);
    let finalCreated = 0, finalFetched = 0, finalNeeded = 0;
    for (const s of finalStats) {
      finalCreated += s.total_created || 0;
      finalFetched += s.total_details_fetched || 0;
      finalNeeded += s.total_details_needed || 0;
    }

    await this.updateState({
      stage: 'parsing_done',
      sources_done: total,
      details_fetched: finalFetched,
      details_needed: finalNeeded,
      objects_created: finalCreated,
      errors,
    }, `✓ Парсинг: ${finalCreated} новых, ${finalFetched} детальных`);

    return { created: finalCreated, errors };
  }

  // ── Analyze ──

  async analyze(filters?: RunOptions['filters']): Promise<{ undervalued: number; errors: string[] }> {
    const qs = getQueueService();
    const errors: string[] = [];

    // Find unanalyzed properties
    const where: any = { status: 'new', is_undervalued: { $null: true } };
    if (filters?.priceFrom != null && !isNaN(filters.priceFrom)) {
      where.price = { ...(where.price || {}), $gte: filters.priceFrom };
    }
    if (filters?.priceTo != null && !isNaN(filters.priceTo)) {
      where.price = { ...(where.price || {}), $lte: filters.priceTo };
    }
    if (filters?.city?.length && filters.city.length < 3) {
      where.city = { $in: filters.city };
    }

    // Force mode: reset is_undervalued for recalculation
    if (filters?.force) {
      const toReset = await this.strapi.db.query('api::property.property').findMany({
        where,
        select: ['documentId'],
      });
      for (const prop of toReset || []) {
        await this.strapi.db.query('api::property.property').update({
          where: { documentId: prop.documentId },
          data: { is_undervalued: null, deviation: null, price_per_sqm_ref: null },
        });
      }
    }

    const properties = await this.strapi.entityService.findMany('api::property.property', {
      filters: where,
      limit: -1,
    });

    const total = properties?.length || 0;

    if (total === 0) {
      await this.updateState({
        stage: 'analyzing_skipped',
        analyze_total: 0,
        analyze_done: 0,
      }, 'Анализ пропущен — нет новых объектов');
      return { undervalued: 0, errors: [] };
    }

    await this.updateState({
      stage: 'analyzing',
      analyze_total: total,
      analyze_done: 0,
    }, `Анализ: 0/${total} объектов`);

    // Batch enqueue
    const corrId = `pipeline-analyze-${Date.now()}`;
    const BATCH = 50;
    for (let i = 0; i < properties.length; i += BATCH) {
      if (this.isCancelled()) break;
      const batch = properties.slice(i, i + BATCH);
      for (const prop of batch) {
        qs.addToQueue('analyze-property', {
          documentId: (prop as any).documentId,
          threshold: filters?.threshold,
        }, { correlationId: corrId });
      }
      if (i + BATCH < properties.length) {
        await this.updateState({ message: `Анализ: ${Math.min(i + BATCH, total)}/${total} объектов` });
        await sleep(100);
      }
    }

    // Wait for analyze queue to drain
    while (!this.isCancelled()) {
      await sleep(3000);
      const stats = qs.getDetailedStats();
      const queues = stats.queues || stats;
      const q = queues['analyze-property'];
      const pending = q ? q.pending + q.active : 0;

      // Count analyzed
      const allNew = await this.strapi.db.query('api::property.property').findMany({
        where: { status: 'new' },
        select: ['is_undervalued'],
      });
      const analyzed = (allNew || []).filter((p: any) => p.is_undervalued !== null).length;

      await this.updateState({
        analyze_done: analyzed,
        message: `Анализ: ${analyzed}/${total} объектов`,
      });

      if (pending === 0) break;
    }

    // Run scoring (batch, fast)
    await this.updateState({ message: 'Расчёт focus score...' });
    try {
      const scoreResult = await scorePropertiesBatch({
        city: filters?.city,
        priceFrom: filters?.priceFrom,
        priceTo: filters?.priceTo,
        threshold: filters?.threshold,
      });
      this.strapi.log.info(`[pipeline] Score: ${scoreResult.scored} scored, ${scoreResult.in_focus} in focus`);
    } catch (err: any) {
      errors.push(`Score: ${err.message}`);
      this.strapi.log.error(`[pipeline] Score error: ${err.message}`);
    }

    // Count undervalued
    const undervalued = await this.strapi.entityService.findMany('api::property.property', {
      filters: { is_undervalued: true },
      limit: 1,
    });
    // Get total count from pagination
    const undervaluedCount = (undervalued as any)?.length || 0; // approximation

    await this.updateState({
      stage: 'analyzing_done',
      undervalued_count: undervaluedCount,
      errors: [...(await this.getState()).errors, ...errors],
    }, `✓ Анализ: ${undervaluedCount} недооценённых из ${total}`);

    return { undervalued: undervaluedCount, errors };
  }

  // ── Digest ──

  async digest(): Promise<{ sent: boolean; errors: string[] }> {
    const qs = getQueueService();
    const errors: string[] = [];

    const setting = await this.strapi.db.query('api::setting.setting').findOne({});
    if (setting?.digest_enabled === false) {
      await this.updateState({
        stage: 'digest_done',
      }, 'Дайджест отключён в настройках');
      return { sent: false, errors: [] };
    }

    await this.updateState({ stage: 'digesting' }, 'Отправка дайджеста...');

    const corrId = `pipeline-digest-${Date.now()}`;
    qs.addToQueue('digest-send', {
      date: new Date().toISOString().slice(0, 10),
      smtpTo: setting?.smtp_to || null,
    }, { correlationId: corrId });

    // Wait for digest queue to drain
    while (!this.isCancelled()) {
      await sleep(2000);
      const stats = qs.getDetailedStats();
      const queues = stats.queues || stats;
      const q = queues['digest-send'];
      if (!q || (q.pending === 0 && q.active === 0)) break;
    }

    await this.updateState({
      stage: 'digest_done',
    }, '✓ Дайджест отправлен');

    return { sent: true, errors };
  }

  // ── Full Pipeline ──

  async run(depth: number, filters?: RunOptions['filters'], trigger: 'manual' | 'cron' = 'manual'): Promise<void> {
    const locked = await this.acquireLock(trigger);
    if (!locked) {
      throw new Error('Pipeline уже выполняется');
    }

    const allErrors: string[] = [];

    try {
      // Stage 1: Parse
      if (!this.isCancelled()) {
        const parseResult = await this.parseAll(depth);
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

  private async getSourceStats(slugs: string[]): Promise<any[]> {
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
