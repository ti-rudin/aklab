/**
 * Cron-планировщик для aklab.
 *
 * Фаза 3: 4 cron-задачи по docs/plan2.md:
 *   - parse:bankruptcy    (каждый час, Europe/Moscow, noOverlap)
 *   - analyze:properties  (каждые 30 мин)
 *   - digest:morning      (по setting.digest_time, динамически)
 *   - cleanup:old         (3:00 ежедневно, retention_months из Setting)
 *
 * Все задачи только кладут jobs в очередь — реальную обработку делают
 * микросервисы (Фазы 4-7). Пока микросервисов нет, jobs просто лежат
 * в queue.db и обрабатываются вручную или логируются.
 */

import type { Core } from '@strapi/strapi';
import cron from 'node-cron';
import { getQueueService } from '../services/queueService';

const CRON_TIMEZONE = 'Europe/Moscow';

/** Получить singleton Setting (с cast'ом, т.к. Strapi entityService типы неточны) */
async function getSetting(strapi: Core.Strapi): Promise<any> {
  const list = await (strapi as any).entityService.findMany('api::setting.setting', { limit: 1 });
  return list?.[0] || null;
}

/**
 * Регистрирует все cron-задачи. Вызывается из api/src/index.ts::bootstrap().
 */
export function registerCrons(strapi: Core.Strapi): void {
  const queueService = getQueueService();

  // 1. parse:bankruptcy — каждый час
  cron.schedule('0 * * * *', async () => {
    const corrId = `cron-parse-${Date.now()}`;
    strapi.log.info(`[cron] parse:bankruptcy triggered (${corrId})`);
    try {
      const setting = await getSetting(strapi);
      const sources: string[] = setting?.active_sources || ['fedresurs'];
      for (const source of sources) {
        queueService.addToQueue('parse-bankruptcy', { source }, { correlationId: corrId });
        strapi.log.info(`[cron] → enqueued parse-bankruptcy for source=${source}`);
      }
    } catch (err: any) {
      strapi.log.error(`[cron] parse:bankruptcy error: ${err.message}`);
    }
  }, { timezone: CRON_TIMEZONE });

  strapi.log.info('[cron] Registered: parse:bankruptcy (every hour, Europe/Moscow)');

  // 2. analyze:properties — каждые 30 минут
  cron.schedule('*/30 * * * *', async () => {
    const corrId = `cron-analyze-${Date.now()}`;
    strapi.log.info(`[cron] analyze:properties triggered (${corrId})`);
    try {
      const properties = await (strapi as any).entityService.findMany('api::property.property', {
        filters: { status: 'new', is_undervalued: { $null: true } },
        limit: 50,
      });
      for (const prop of properties || []) {
        queueService.addToQueue('analyze-property', { property_id: prop.id }, { correlationId: corrId });
      }
      if (properties?.length) {
        strapi.log.info(`[cron] → enqueued ${properties.length} properties for analysis`);
      }
    } catch (err: any) {
      strapi.log.error(`[cron] analyze:properties error: ${err.message}`);
    }
  }, { timezone: CRON_TIMEZONE });

  strapi.log.info('[cron] Registered: analyze:properties (every 30 min)');

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

      strapi.log.info(`[cron] digest:morning triggered at ${digestTime} MSK (${corrId})`);
      queueService.addToQueue('digest-send', {
        date: new Date().toISOString().slice(0, 10),
        smtpTo: setting?.smtp_to || null,
      }, { correlationId: corrId });
      strapi.log.info(`[cron] → enqueued digest-send`);
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

      const old = await (strapi as any).entityService.findMany('api::property.property', {
        filters: { createdAt: { $lt: cutoffStr } },
        limit: 100,
      });

      let deleted = 0;
      for (const prop of old || []) {
        await (strapi as any).entityService.delete('api::property.property', prop.id);
        deleted++;
      }

      if (deleted > 0) {
        strapi.log.info(`[cron] cleanup:old deleted ${deleted} properties older than ${cutoffStr}`);
      }
    } catch (err: any) {
      strapi.log.error(`[cron] cleanup:old error: ${err.message}`);
    }
  }, { timezone: CRON_TIMEZONE });

  strapi.log.info('[cron] Registered: cleanup:old (daily 03:00 MSK)');
}
