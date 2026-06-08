/**
 * cron-log service
 *
 * Фаза 3: добавит createLog(name) → пишет started_at, потом update(finished_at, items_processed, error).
 */
import { factories } from '@strapi/strapi';

export default factories.createCoreService('api::cron-log.cron-log');
