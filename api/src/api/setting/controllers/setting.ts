/**
 * setting controller
 *
 * Фаза 1: stub. Фаза 5 добавит кастомные эндпоинты если потребуется.
 */
import { factories } from '@strapi/strapi';

export default factories.createCoreController('api::setting.setting', ({ strapi }) => ({
  async internalFindAnalyzer(ctx) {
    const setting = await strapi.db.query('api::setting.setting').findOne({
      select: ['threshold_percent'],
    });
    if (!setting) {
      ctx.status = 404;
      ctx.body = { error: 'Setting not found' };
      return;
    }
    ctx.body = { data: { threshold_percent: setting.threshold_percent } };
  },
}));
