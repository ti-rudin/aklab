/**
 * Cron-планировщик для aklab.
 *
 * Фаза 0: пустой stub. registerCrons() вызывается из bootstrap(),
 * только логирует, что шина готова. Реальные cron-задачи появятся в Фазе 3.
 *
 * Будущие cron'ы (см. docs/plan2.md):
 *   - parse:bankruptcy    (каждый час, Europe/Moscow, noOverlap)
 *   - analyze:properties  (каждые 30 мин)
 *   - digest:morning      (по setting.digest_time, динамически)
 *   - cleanup:old         (3:00 ежедневно, retention_months из Setting)
 */

import type { Core } from '@strapi/strapi';

/**
 * Регистрирует все cron-задачи. Вызывается из api/src/index.ts::bootstrap().
 */
export function registerCrons(strapi: Core.Strapi): void {
  strapi.log.info('[cron] registerCrons() called — no cron jobs registered yet (Phase 0 stub)');
}
