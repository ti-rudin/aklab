/**
 * Открывает доступ к нашим content-types для роли Authenticated.
 *
 * Без этого /api/properties и т.п. отдают 404/403 для авторизованных
 * пользователей. Strapi 5 по умолчанию ставит "no permissions" для новых
 * content-types.
 *
 * Идемпотентно: проверяет, есть ли уже permission, и не дублирует.
 */
import type { StrapiInstance } from '../types/strapi';

export async function seedApiPermissions(strapi: StrapiInstance): Promise<void> {
  try {
    const authRole = await strapi.db
      .query('plugin::users-permissions.role')
      .findOne({ where: { type: 'authenticated' } });

    if (!authRole) {
      strapi.log.warn('[seed] Authenticated role не найдена — skip permissions seed');
      return;
    }

    const actions = [
      // find / findOne (чтение) — для frontend
      'api::source.source.find',
      'api::source.source.findOne',
      'api::property.property.find',
      'api::property.property.findOne',
      'api::setting.setting.find',
      'api::setting.setting.findOne',
      'api::setting.setting.update',
      'api::property.property.update',
      'api::market-reference.market-reference.find',
      'api::market-reference.market-reference.findOne',
      'api::user-comment.user-comment.find',
      'api::user-comment.user-comment.findOne',
      'api::cron-log.cron-log.find',
      'api::cron-log.cron-log.findOne',
      // create / update только для user-comment (пользователи могут комментировать)
      'api::user-comment.user-comment.create',
      'api::user-comment.user-comment.update',
      // focus-rule — read-only для authenticated
      'api::focus-rule.focus-rule.find',
      'api::focus-rule.focus-rule.findOne',
      // property-event — read-only для authenticated
      'api::property-event.property-event.find',
      'api::property-event.property-event.findOne',
      // Остальные content-types — read-only для authenticated.
      // Парсеры/API-токены используют STRAPI_API_TOKEN (admin-level).
    ];

    let added = 0;
    for (const action of actions) {
      const existing = await strapi.db
        .query('plugin::users-permissions.permission')
        .findOne({ where: { action, role: authRole.id } });

      if (existing) continue;

      await strapi.db
        .query('plugin::users-permissions.permission')
        .create({ data: { action, role: authRole.id } });
      added++;
    }

    if (added > 0) {
      strapi.log.info(`[seed] ✅ Authenticated permissions добавлено: ${added} actions`);
    } else {
      strapi.log.info('[seed] Authenticated permissions уже настроены — skip');
    }
  } catch (err: any) {
    strapi.log.error(`[seed] Ошибка создания public permissions: ${err.message}`);
    strapi.log.error(err);
  }
}
