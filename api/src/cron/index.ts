/**
 * Cron-планировщик для aklab.
 *
 * Задачи:
 *   - pipeline:daily     — единый pipeline (парсинг + анализ + дайджест),
 *                          запускается в digest_time из настроек
 *   - cleanup:expired-auctions — 3:15 ежедневно, только лоты с явной
 *                                 прошедшей датой окончания торгов
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

  // 2. One orchestrated canary window three hours before the daily pipeline.
  cron.schedule('0 * * * *', async () => {
    try {
      const setting = await getSetting(strapi);
      if (!setting) return;
      const digestTime: string = setting.digest_time || '09:00';
      const [digestHour] = digestTime.split(':').map(Number);
      const targetHour = (digestHour + 21) % 24;
      const now = new Date();
      const msk = new Date(now.toLocaleString('en-US', { timeZone: CRON_TIMEZONE }));
      if (msk.getHours() !== targetHour) return;
      const windowKey = `${msk.getFullYear()}-${String(msk.getMonth() + 1).padStart(2, '0')}-${String(msk.getDate()).padStart(2, '0')}`;
      const { createParserCanaryService } = await import('../services/parser-canary');
      const result = await createParserCanaryService(strapi as unknown as StrapiInstance).run({ trigger: 'cron', windowKey });
      strapi.log.info(`[cron] parser:canary completed skipped=${result.skipped}`);
    } catch {
      strapi.log.error('[cron] parser:canary failed');
    }
  }, { timezone: CRON_TIMEZONE });

  strapi.log.info('[cron] Registered: parser:canary (3h before pipeline:daily)');

  // 3. Remove a listing only when its explicit application/trading deadline is
  // past. A rejected listing remains stored while its auction is active, so
  // parser identity deduplication keeps working.
  cron.schedule('15 3 * * *', async () => {
    const corrId = `cron-expired-auctions-${Date.now()}`;
    try {
      const s = strapi as unknown as StrapiInstance;
      const result = await s.db.query('api::property.property').deleteMany({
        where: { auction_end_at: { $lt: new Date() } },
      });
      if (result.count > 0) {
        strapi.log.info(`[cron] cleanup:expired-auctions deleted ${result.count} properties (${corrId})`);
      }
    } catch {
      strapi.log.error('[cron] cleanup:expired-auctions failed');
    }
  }, { timezone: CRON_TIMEZONE });

  strapi.log.info('[cron] Registered: cleanup:expired-auctions (daily 03:15 MSK)');
}

/**
 * No-op — per-source расписание больше не используется для cron.
 * Pipeline запускает все парсеры разом.
 */
export function rescheduleSource(_strapi: Core.Strapi, _source: any): void {
  // No-op: pipeline cron handles all sources
}
