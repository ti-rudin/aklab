/**
 * setting service
 *
 * Фаза 1: stub — singleton обслуживается Strapi автоматически.
 * Фаза 1.5+: методы для чтения/обновления из cron'ов и UI.
 */
import { factories } from '@strapi/strapi';

export default factories.createCoreService('api::setting.setting');
