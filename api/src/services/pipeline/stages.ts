/**
 * Pipeline Stages — parseAll, analyze, digest.
 *
 * Each stage is a standalone async function that receives a PipelineContext
 * (strapi instance + callbacks for state updates and cancellation checks).
 */

import type { StrapiInstance } from '../../types/strapi';
import { getQueueService } from '../queueService';
import { scorePropertiesBatch } from '../focusEngine';
import { buildParseRules } from '../parseRules';
import type { PipelineStage, RunOptions } from './state';
import { updateState, getState } from './state';

// ── Context interface ──

export interface PipelineContext {
  strapi: StrapiInstance;
  isCancelled(): boolean;
  getSourceStats(slugs: string[]): Promise<any[]>;
}

// ── Helpers ──

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// ── Parse All Sources ──

export async function parseAll(ctx: PipelineContext, depth: number): Promise<{ created: number; errors: string[] }> {
  const qs = getQueueService();
  const errors: string[] = [];

  const sources = await ctx.strapi.entityService.findMany('api::source.source', {
    filters: { is_active: true },
    limit: 100,
  });

  if (!sources?.length) {
    await updateState(ctx.strapi, {
      stage: 'parsing_done',
      sources_total: 0,
      sources_done: 0,
    }, 'Нет активных источников');
    return { created: 0, errors: [] };
  }

  const total = sources.length;
  await updateState(ctx.strapi, {
    sources_total: total,
    sources_done: 0,
    details_fetched: 0,
    details_needed: 0,
    objects_created: 0,
  }, `Сканирование источников... (0/${total})`);

  // Сброс счётчиков ВСЕХ активных источников ДО enqueue,
  // чтобы агрегация не подхватывала stale значения от прошлого запуска
  const resetData = {
    total_details_fetched: 0,
    total_details_needed: 0,
    total_found: 0,
    total_created: 0,
    last_parse_status: null,
    last_parse_error: null,
  };
  let resetCount = 0;
  for (const src of sources) {
    try {
      await ctx.strapi.db.query('api::source.source').update({
        where: { documentId: (src as any).documentId },
        data: resetData,
      });
      resetCount++;
    } catch { /* ignore individual failures */ }
  }
  console.log(`[pipeline] Source counters reset for ${resetCount}/${total} sources`);

  // Enqueue all parsers
  const corrId = `pipeline-parse-${Date.now()}`;
  const slugs: string[] = [];
  // Читаем правила парсинга из Setting
  const settings = await ctx.strapi.db.query('api::setting.setting').findOne({});
  const parseRules = buildParseRules(settings);
  for (const src of sources) {
    if (ctx.isCancelled()) break;
    const slug = (src as any).slug;
    slugs.push(slug);
    qs.addToQueue(`parse-${slug}`, {
      source: slug,
      sourceId: (src as any).id,
      documentId: (src as any).documentId,
      depth,
      rules: parseRules,
    }, { correlationId: corrId });
  }

  // Wait for all parse queues to drain
  const parseQueues = slugs.map(s => `parse-${s}`);
  let lastSourcesDone = 0;
  while (!ctx.isCancelled()) {
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
    const sourceStats = await ctx.getSourceStats(slugs);
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

    await updateState(ctx.strapi, {
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
  const finalStats = await ctx.getSourceStats(slugs);
  let finalCreated = 0, finalFetched = 0, finalNeeded = 0;
  for (const s of finalStats) {
    finalCreated += s.total_created || 0;
    finalFetched += s.total_details_fetched || 0;
    finalNeeded += s.total_details_needed || 0;
  }

  await updateState(ctx.strapi, {
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

export async function analyze(ctx: PipelineContext, filters?: RunOptions['filters']): Promise<{ undervalued: number; errors: string[] }> {
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
    const toReset = await ctx.strapi.db.query('api::property.property').findMany({
      where,
      select: ['documentId'],
    });
    for (const prop of toReset || []) {
      await ctx.strapi.db.query('api::property.property').update({
        where: { documentId: prop.documentId },
        data: { is_undervalued: null, deviation: null, price_per_sqm_ref: null },
      });
    }
  }

  const properties = await ctx.strapi.entityService.findMany('api::property.property', {
    filters: where,
    limit: -1,
  });

  const total = properties?.length || 0;

  if (total === 0) {
    await updateState(ctx.strapi, {
      stage: 'analyzing_skipped',
      analyze_total: 0,
      analyze_done: 0,
    }, 'Анализ пропущен — нет новых объектов');
    return { undervalued: 0, errors: [] };
  }

  await updateState(ctx.strapi, {
    stage: 'analyzing',
    analyze_total: total,
    analyze_done: 0,
  }, `Анализ: 0/${total} объектов`);

  // Batch enqueue
  const corrId = `pipeline-analyze-${Date.now()}`;
  const BATCH = 50;
  for (let i = 0; i < properties.length; i += BATCH) {
    if (ctx.isCancelled()) break;
    const batch = properties.slice(i, i + BATCH);
    for (const prop of batch) {
      qs.addToQueue('analyze-property', {
        documentId: (prop as any).documentId,
        threshold: filters?.threshold,
      }, { correlationId: corrId });
    }
    if (i + BATCH < properties.length) {
      await updateState(ctx.strapi, { message: `Анализ: ${Math.min(i + BATCH, total)}/${total} объектов` });
      await sleep(100);
    }
  }

  // Wait for analyze queue to drain
  while (!ctx.isCancelled()) {
    await sleep(3000);
    const stats = qs.getDetailedStats();
    const queues = stats.queues || stats;
    const q = queues['analyze-property'];
    const pending = q ? q.pending + q.active : 0;

    // Count analyzed
    const allNew = await ctx.strapi.db.query('api::property.property').findMany({
      where: { status: 'new' },
      select: ['is_undervalued'],
    });
    const analyzed = (allNew || []).filter((p: any) => p.is_undervalued !== null).length;

    await updateState(ctx.strapi, {
      analyze_done: analyzed,
      message: `Анализ: ${analyzed}/${total} объектов`,
    });

    if (pending === 0) break;
  }

  // Run scoring (batch, fast)
  await updateState(ctx.strapi, { message: 'Расчёт focus score...' });
  try {
    const scoreResult = await scorePropertiesBatch({
      city: filters?.city,
      priceFrom: filters?.priceFrom,
      priceTo: filters?.priceTo,
      threshold: filters?.threshold,
    });
    ctx.strapi.log.info(`[pipeline] Score: ${scoreResult.scored} scored, ${scoreResult.in_focus} in focus`);
  } catch (err: any) {
    errors.push(`Score: ${err.message}`);
    ctx.strapi.log.error(`[pipeline] Score error: ${err.message}`);
  }

  // Count undervalued
  const undervalued = await ctx.strapi.entityService.findMany('api::property.property', {
    filters: { is_undervalued: true },
    limit: 1,
  });
  // Get total count from pagination
  const undervaluedCount = (undervalued as any)?.length || 0; // approximation

  await updateState(ctx.strapi, {
    stage: 'analyzing_done',
    undervalued_count: undervaluedCount,
    errors: [...(await getState(ctx.strapi)).errors, ...errors],
  }, `✓ Анализ: ${undervaluedCount} недооценённых из ${total}`);

  return { undervalued: undervaluedCount, errors };
}

// ── Digest ──

export async function digest(ctx: PipelineContext): Promise<{ sent: boolean; errors: string[] }> {
  const qs = getQueueService();
  const errors: string[] = [];

  const setting = await ctx.strapi.db.query('api::setting.setting').findOne({});
  if (setting?.digest_enabled === false) {
    await updateState(ctx.strapi, {
      stage: 'digest_done',
    }, 'Дайджест отключён в настройках');
    return { sent: false, errors: [] };
  }

  await updateState(ctx.strapi, { stage: 'digesting' }, 'Отправка дайджеста...');

  const corrId = `pipeline-digest-${Date.now()}`;
  qs.addToQueue('digest-send', {
    date: new Date().toISOString().slice(0, 10),
    smtpTo: setting?.smtp_to || null,
  }, { correlationId: corrId });

  // Wait for digest queue to drain
  while (!ctx.isCancelled()) {
    await sleep(2000);
    const stats = qs.getDetailedStats();
    const queues = stats.queues || stats;
    const q = queues['digest-send'];
    if (!q || (q.pending === 0 && q.active === 0)) break;
  }

  await updateState(ctx.strapi, {
    stage: 'digest_done',
  }, '✓ Дайджест отправлен');

  return { sent: true, errors };
}
