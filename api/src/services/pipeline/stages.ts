/**
 * Pipeline Stages — parseAll, analyze, digest.
 *
 * ДВУХФАЗНЫЙ ПАРСИНГ:
 *   Phase 1 (scan):     ВСЕ источники сканируют списки → фильтруют → сохраняют
 *   Phase 2 (details):  ТОЛЬКО ПОТОМ загружаем детали для ВСЕХ
 *
 * Глобальная синхронизация: Phase 2 начинается ТОЛЬКО после завершения ВСЕХ Phase 1.
 * Счётчики НЕ прыгают — pipeline читает их только после завершения фазы.
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

/**
 * Ждём пока ВСЕ очереди для данных slug'ов станут пустыми.
 * Возвращает true если все завершились, false если отменено.
 */
async function waitForQueues(
  qs: ReturnType<typeof getQueueService>,
  slugs: string[],
  ctx: PipelineContext,
  onPoll: (stats: any[], queues: Record<string, any>) => Promise<void>,
): Promise<boolean> {
  const queueNames = slugs.map(s => `parse-${s}`);
  while (!ctx.isCancelled()) {
    await sleep(3000);
    const stats = qs.getDetailedStats();
    const queues = stats.queues || stats;

    // Проверяем есть ли активные задачи
    let anyActive = false;
    for (const qName of queueNames) {
      const q = queues[qName];
      if (q && (q.pending > 0 || q.active > 0)) {
        anyActive = true;
        break;
      }
    }

    // Читаем статистику из БД
    const sourceStats = await ctx.getSourceStats(slugs);
    let doneCount = 0;
    for (const s of sourceStats) {
      if (s.last_parse_status === 'success' || s.last_parse_status === 'error') {
        doneCount++;
      }
    }

    // Вызываем callback для обновления UI
    await onPoll(sourceStats, queues);

    // Все очереди пусты + все источники отчитались
    if (!anyActive && doneCount >= slugs.length) break;
  }
  return !ctx.isCancelled();
}

// ── Parse All Sources ──

export async function parseAll(ctx: PipelineContext, depth: number, filters?: RunOptions['filters']): Promise<{ created: number; errors: string[] }> {
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

  // Сброс счётчиков ВСЕХ активных источников ДО enqueue
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
    } catch { /* ignore */ }
  }
  console.log(`[pipeline:reset] ${resetCount}/${total} sources reset to zero`);

  // Читаем правила парсинга
  const settings = await ctx.strapi.db.query('api::setting.setting').findOne({});
  const parseRules = buildParseRules(settings);
  if (filters) {
    if (filters.priceFrom != null) parseRules.priceFrom = filters.priceFrom;
    if (filters.priceTo != null) parseRules.priceTo = filters.priceTo;
    if (filters.city?.length) parseRules.cities = filters.city;
  }
  console.log(`[pipeline:enqueue] parseRules: ${JSON.stringify({ cities: parseRules.cities, priceFrom: parseRules.priceFrom, priceTo: parseRules.priceTo, areaFrom: parseRules.areaFrom })}`);

  const corrId = `pipeline-parse-${Date.now()}`;
  const slugs: string[] = [];

  // ═══════════════════════════════════════════════════════════════
  // ФАЗА 1: СКАНИРОВАНИЕ ВСЕХ ИСТОЧНИКОВ
  // Парсинг списков + дедуп + предфильтр → файлы с результатами
  // ═══════════════════════════════════════════════════════════════
  console.log(`[pipeline:phase1] Starting scan for ${total} sources`);
  await updateState(ctx.strapi, {
    stage: 'parsing_scan',
    message: `Фаза 1: сканирование... (0/${total})`,
  });

  for (const src of sources) {
    if (ctx.isCancelled()) break;
    const slug = (src as any).slug;
    slugs.push(slug);
    console.log(`[pipeline:enqueue:scan] ${slug} id=${(src as any).id} docId=${(src as any).documentId}`);
    qs.addToQueue(`parse-${slug}`, {
      source: slug,
      sourceId: (src as any).id,
      documentId: (src as any).documentId,
      depth,
      rules: parseRules,
      correlationId: corrId,
      phase: 'scan',
    }, { correlationId: corrId });
  }

  // Ждём завершения ВСЕХ сканирований
  const phase1Done = await waitForQueues(qs, slugs, ctx, async (sourceStats) => {
    let doneCount = 0;
    for (const s of sourceStats) {
      console.log(`[pipeline:scan:poll] ${s.slug}: found=${s.total_found||0} needed=${s.total_details_needed||0} status=${s.last_parse_status||'running'}`);
      if (s.last_parse_status === 'success' || s.last_parse_status === 'error') {
        doneCount++;
        if (s.last_parse_status === 'error' && s.last_parse_error) {
          const msg = `${s.slug}: ${s.last_parse_error}`;
          if (!errors.includes(msg)) errors.push(msg);
        }
      }
    }
    await updateState(ctx.strapi, {
      stage: 'parsing_scan',
      message: `Фаза 1: сканирование... (${doneCount}/${total})`,
      sources_done: doneCount,
    });
  });

  if (!phase1Done) return { created: 0, errors };

  // ═══════════════════════════════════════════════════════════════
  // ПРОМЕЖУТОЧНЫЙ ИТОГ ФАЗЫ 1
  // Теперь мы знаем ОБЩЕЕ количество объектов к детальной загрузке
  // ═══════════════════════════════════════════════════════════════
  const scanStats = await ctx.getSourceStats(slugs);
  let totalDetailsNeeded = 0, totalFound = 0;
  for (const s of scanStats) {
    totalDetailsNeeded += s.total_details_needed || 0;
    totalFound += s.total_found || 0;
    console.log(`[pipeline:scan:result] ${s.slug}: found=${s.total_found||0} needed=${s.total_details_needed||0}`);
  }
  console.log(`[pipeline:phase1:complete] totalFound=${totalFound} totalDetailsNeeded=${totalDetailsNeeded}`);

  await updateState(ctx.strapi, {
    stage: 'parsing_scan_done',
    details_needed: totalDetailsNeeded,
    sources_done: total,
    message: `✓ Фаза 1: ${totalFound} найдено, ${totalDetailsNeeded} к детальной загрузке`,
  });

  // ═══════════════════════════════════════════════════════════════
  // ФАЗА 2: ДЕТАЛЬНАЯ ЗАГРУЗКА
  // Загрузка детальных страниц + создание в Strapi
  // Начинается ТОЛЬКО после завершения ВСЕХ Phase 1
  // ═══════════════════════════════════════════════════════════════
  if (totalDetailsNeeded === 0) {
    console.log(`[pipeline:phase2] Skipping — nothing to fetch`);
    await updateState(ctx.strapi, {
      stage: 'parsing_done',
      message: `✓ Парсинг: 0 деталей к загрузке`,
    });
    return { created: 0, errors };
  }

  // Сбрасываем last_parse_status перед Phase 2,
  // чтобы polling loop не считал источники "завершёнными" по Phase 1
  for (const src of sources) {
    try {
      await ctx.strapi.db.query('api::source.source').update({
        where: { documentId: (src as any).documentId },
        data: { last_parse_status: null, last_parse_error: null },
      });
    } catch {}
  }

  console.log(`[pipeline:phase2] Starting detail fetch for ${slugs.length} sources (${totalDetailsNeeded} pages)`);
  await updateState(ctx.strapi, {
    stage: 'parsing_details',
    message: `Фаза 2: загрузка деталей... (0/${totalDetailsNeeded})`,
  });

  for (const slug of slugs) {
    if (ctx.isCancelled()) break;
    const src = sources.find((s: any) => s.slug === slug) as any;
    console.log(`[pipeline:enqueue:details] ${slug}`);
    qs.addToQueue(`parse-${slug}`, {
      source: slug,
      sourceId: src.id,
      documentId: src.documentId,
      depth,
      rules: parseRules,
      correlationId: corrId,
      phase: 'details',
    }, { correlationId: corrId });
  }

  // Ждём завершения ВСЕХ детальных загрузок
  const phase2Done = await waitForQueues(qs, slugs, ctx, async (sourceStats) => {
    let totalFetched = 0, totalCreated = 0, doneCount = 0;
    for (const s of sourceStats) {
      console.log(`[pipeline:details:poll] ${s.slug}: fetched=${s.total_details_fetched||0} created=${s.total_created||0} status=${s.last_parse_status||'running'}`);
      totalFetched += s.total_details_fetched || 0;
      totalCreated += s.total_created || 0;
      if (s.last_parse_status === 'success' || s.last_parse_status === 'error') {
        doneCount++;
        if (s.last_parse_status === 'error' && s.last_parse_error) {
          const msg = `${s.slug}: ${s.last_parse_error}`;
          if (!errors.includes(msg)) errors.push(msg);
        }
      }
    }
    await updateState(ctx.strapi, {
      stage: 'parsing_details',
      message: `Фаза 2: ${totalFetched}/${totalDetailsNeeded} деталей, ${totalCreated} создано`,
      details_fetched: totalFetched,
      objects_created: totalCreated,
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // ФИНАЛЬНЫЙ ИТОГ
  // ═══════════════════════════════════════════════════════════════
  const finalStats = await ctx.getSourceStats(slugs);
  let finalCreated = 0, finalFetched = 0, finalNeeded = 0;
  for (const s of finalStats) {
    finalCreated += s.total_created || 0;
    finalFetched += s.total_details_fetched || 0;
    finalNeeded += s.total_details_needed || 0;
    console.log(`[pipeline:final] ${s.slug}: created=${s.total_created||0} fetched=${s.total_details_fetched||0} needed=${s.total_details_needed||0}`);
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
  const undervaluedRows = await ctx.strapi.db.query('api::property.property').findMany({
    where: { is_undervalued: true },
    select: ['id'],
  });
  const undervaluedCount = undervaluedRows?.length || 0;

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
