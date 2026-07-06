/**
 * Cron-планировщик для aklab.
 *
 * Задачи:
 *   - parse:<slug>         — per-source расписание из Source.schedule (cron expr)
 *   - analyze:properties   — ежедневно в 08:00 МСК (после парсеров 03:00–06:00)
 *   - digest:morning       — по setting.digest_time, динамически
 *   - cleanup:old          — 3:00 ежедневно, retention_months из Setting
 *
 * Источники читаются из коллекции Source (is_active=true).
 * Для каждого источника создаётся отдельный cron job по его schedule.
 */

import type { Core } from '@strapi/strapi';
import cron from 'node-cron';
import { getQueueService } from '../services/queueService';
import type { StrapiInstance } from '../types/strapi';
import { buildParseRules } from '../services/parseRules';

const CRON_TIMEZONE = 'Europe/Moscow';

// Хранилище активных cron jobs для пересоздания при изменении расписания
const activeCronJobs = new Map<string, cron.ScheduledTask>();

async function getSetting(strapi: Core.Strapi): Promise<any> {
  // db.query вместо entityService — надёжнее для singleton (gotcha #17)
  const s = strapi as unknown as StrapiInstance;
  return await s.db.query('api::setting.setting').findOne({});
}

async function getActiveSources(strapi: Core.Strapi): Promise<any[]> {
  const s = strapi as unknown as StrapiInstance;
  return s.entityService.findMany('api::source.source', {
    filters: { is_active: true },
    limit: 50,
  });
}

/**
 * Регистрирует cron job для одного источника.
 * Если job с таким slug уже есть — пересоздаёт (для обновления расписания).
 */
function registerSourceCron(strapi: Core.Strapi, source: any): void {
  const queueService = getQueueService();
  const slug = source.slug;
  const schedule = source.schedule || '0 3 * * *';
  const sourceId = source.id;
  const documentId = source.documentId;

  // Удаляем старый job если есть
  const existingJob = activeCronJobs.get(slug);
  if (existingJob) {
    existingJob.stop();
    activeCronJobs.delete(slug);
  }

  // Определяем имя очереди по парсеру
  const queueName = `parse-${slug}`;

  const job = cron.schedule(schedule, async () => {
    const corrId = `cron-parse-${slug}-${Date.now()}`;
    strapi.log.info(`[cron] parse:${slug} triggered (${corrId})`);
    try {
      const setting = await getSetting(strapi);
      const depth = setting?.parse_depth || 20;
      // Правила парсинга из Setting
      const rules = buildParseRules(setting);
      queueService.addToQueue(queueName, {
        source: slug,
        sourceId,
        documentId,
        depth,
        rules,
      }, { correlationId: corrId });
      strapi.log.info(`[cron] → enqueued ${queueName} for ${source.name} (depth=${depth}, rules=${JSON.stringify(rules)})`);
    } catch (err: any) {
      strapi.log.error(`[cron] parse:${slug} error: ${err.message}`);
    }
  }, { timezone: CRON_TIMEZONE });

  activeCronJobs.set(slug, job);
  strapi.log.info(`[cron] Registered: parse:${slug} (${schedule}, Europe/Moscow, queue=${queueName})`);
}

export function registerCrons(strapi: Core.Strapi): void {
  const queueService = getQueueService();

  // 1. Per-source parsing — регистрируем при старте
  (async () => {
    try {
      const sources = await getActiveSources(strapi);
      for (const src of sources || []) {
        registerSourceCron(strapi, src);
      }
      if (!sources?.length) {
        strapi.log.info('[cron] No active sources — no parse jobs registered');
      }
    } catch (err: any) {
      strapi.log.error(`[cron] Failed to register source crons: ${err.message}`);
    }
  })();

  // 2. analyze:properties + score — ежедневно в 08:00 МСК (после парсеров 03:00–06:00)
  cron.schedule('0 8 * * *', async () => {
    const corrId = `cron-analyze-${Date.now()}`;
    strapi.log.info(`[cron] analyze:properties triggered (${corrId})`);
    try {
      const { getPipelineService } = await import('../services/pipeline');
      const pipeline = getPipelineService(strapi as unknown as StrapiInstance);
      const setting = await getSetting(strapi);
      const filters: any = {};
      if (setting?.price_from != null) filters.priceFrom = Number(setting.price_from);
      if (setting?.price_to != null) filters.priceTo = Number(setting.price_to);
      if (setting?.threshold_percent) filters.threshold = Number(setting.threshold_percent);
      await pipeline.analyze(Object.keys(filters).length ? filters : undefined);
    } catch (err: any) {
      strapi.log.error(`[cron] analyze:properties error: ${err.message}`);
    }
  }, { timezone: CRON_TIMEZONE });

  strapi.log.info('[cron] Registered: analyze:properties (daily 08:00 MSK)');

  // 3. digest:morning — по времени из Setting (проверяем каждый час)
  cron.schedule('0 * * * *', async () => {
    const corrId = `cron-digest-${Date.now()}`;
    try {
      const setting = await getSetting(strapi);
      const digestTime: string = setting?.digest_time || '09:00';
      const [targetHour] = digestTime.split(':').map(Number);
      const now = new Date();
      const mskHour = new Date(now.toLocaleString('en-US', { timeZone: CRON_TIMEZONE })).getHours();

      if (mskHour !== targetHour) return;

      if (setting?.digest_enabled === false) {
        strapi.log.info(`[cron] digest:morning disabled in settings, skipping (${corrId})`);
        return;
      }

      strapi.log.info(`[cron] digest:morning triggered at ${digestTime} MSK (${corrId})`);
      const { getPipelineService } = await import('../services/pipeline');
      const pipeline = getPipelineService(strapi as unknown as StrapiInstance);
      await pipeline.digest();
    } catch (err: any) {
      strapi.log.error(`[cron] digest:morning error: ${err.message}`);
    }
  }, { timezone: CRON_TIMEZONE });

  strapi.log.info('[cron] Registered: digest:morning (dynamic from Setting.digest_time)');

  // 4. cleanup:old — каждый день в 3:00 МСК
  cron.schedule('0 3 * * *', async () => {
    const corrId = `cron-cleanup-${Date.now()}`;
    strapi.log.info(`[cron] cleanup:old triggered (${corrId})`);
    try {
      const setting = await getSetting(strapi);
      const retentionMonths: number = setting?.retention_months || 6;
      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - retentionMonths);
      const cutoffStr = cutoff.toISOString().slice(0, 10);

      // Batch delete с safety guard
      const BATCH = 100;
      let totalDeleted = 0;
      let maxBatches = 50; // safety guard

      while (maxBatches > 0) {
        const s = strapi as unknown as StrapiInstance;
        const old = await s.db.query('api::property.property').findMany({
          where: { createdAt: { $lt: cutoff } },
          limit: BATCH,
        });
        if (!old || old.length === 0) break;

        const ids = old.map((p: any) => p.id);
        await s.db.query('api::property.property').deleteMany({
          where: { id: { $in: ids } },
        });
        totalDeleted += ids.length;
        maxBatches--;
      }

      if (totalDeleted > 0) {
        strapi.log.info(`[cron] cleanup:old deleted ${totalDeleted} properties older than ${cutoffStr}`);
      }
    } catch (err: any) {
      strapi.log.error(`[cron] cleanup:old error: ${err.message}`);
    }
  }, { timezone: CRON_TIMEZONE });

  strapi.log.info('[cron] Registered: cleanup:old (daily 03:00 MSK)');
}

/**
 * Пересоздать cron job для источника (вызывается при изменении schedule через API).
 */
export function rescheduleSource(strapi: Core.Strapi, source: any): void {
  registerSourceCron(strapi, source);
}
