/**
 * Cron-планировщик для aklab.
 *
 * Задачи:
 *   - pipeline:daily     — единый pipeline (парсинг + анализ + дайджест),
 *                          запускается в digest_time из настроек
 *   - cleanup:old        — 3:00 ежедневно, retention_months из Setting
 *
 * Один pipeline replaces per-source crons + analyze cron + digest cron.
 */

import type { Core } from '@strapi/strapi';
import cron from 'node-cron';
import type { StrapiInstance } from '../types/strapi';

const CRON_TIMEZONE = 'Europe/Moscow';

async function getSetting(strapi: Core.Strapi): Promise<any> {
  const s = strapi as unknown as StrapiInstance;
  return await s.db.query('api::setting.setting').findOne({});
}

export function registerCrons(strapi: Core.Strapi): void {

  // 1. pipeline:daily — единый pipeline в digest_time
  //    Проверяем каждый час, запускаем когда час = digest_hour
  cron.schedule('0 * * * *', async () => {
    const corrId = `cron-pipeline-${Date.now()}`;
    try {
      const setting = await getSetting(strapi);
      if (!setting) return;

      const digestTime: string = setting.digest_time || '09:00';
      const [targetHour] = digestTime.split(':').map(Number);
      const now = new Date();
      const mskHour = new Date(now.toLocaleString('en-US', { timeZone: CRON_TIMEZONE })).getHours();

      if (mskHour !== targetHour) return;

      // Проверяем pipeline не запущен уже
      if (setting.pipeline_state?.status && setting.pipeline_state.status !== 'idle') {
        strapi.log.info(`[cron] pipeline:daily — already running, skipping (${corrId})`);
        return;
      }

      strapi.log.info(`[cron] pipeline:daily triggered at ${digestTime} MSK (${corrId})`);

      const { getPipelineService } = await import('../services/pipeline');
      const pipeline = getPipelineService(strapi as unknown as StrapiInstance);

      // mode='full' — парсинг → анализ → дайджест (как ручной запуск из UI)
      // The pipeline resolves fresh parse_depth and builds the all-active-user
      // snapshot itself. Cron never supplies a target user or request filters.
      await pipeline.run(undefined, undefined, 'cron');

      strapi.log.info(`[cron] pipeline:daily completed (${corrId})`);
    } catch (err: any) {
      strapi.log.error('[cron] pipeline:daily failed');
    }
  }, { timezone: CRON_TIMEZONE });

  strapi.log.info('[cron] Registered: pipeline:daily (at digest_time from settings)');

  // 2. cleanup:old — каждый день в 3:00 МСК
  cron.schedule('0 3 * * *', async () => {
    const corrId = `cron-cleanup-${Date.now()}`;
    strapi.log.info(`[cron] cleanup:old triggered (${corrId})`);
    try {
      const setting = await getSetting(strapi);
      const retentionMonths: number = setting?.retention_months || 6;
      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - retentionMonths);
      const cutoffStr = cutoff.toISOString().slice(0, 10);

      const BATCH = 100;
      let totalDeleted = 0;
      let maxBatches = 50;

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
      strapi.log.error('[cron] cleanup:old failed');
    }
  }, { timezone: CRON_TIMEZONE });

  strapi.log.info('[cron] Registered: cleanup:old (daily 03:00 MSK)');
}

/**
 * No-op — per-source расписание больше не используется для cron.
 * Pipeline запускает все парсеры разом.
 */
export function rescheduleSource(_strapi: Core.Strapi, _source: any): void {
  // No-op: pipeline cron handles all sources
}
