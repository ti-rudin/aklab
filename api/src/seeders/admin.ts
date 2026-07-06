/**
 * Создаёт Strapi admin (роль Super Admin), если его ещё нет.
 *
 * Strapi 5 API:
 *  - admin user создаётся через strapi.entityService.create('admin::user', ...)
 *  - пароль хэшируется автоматически через internal admin service
 *  - роль привязывается через roles: { set: [superAdminRole.id] }
 */
import type { StrapiInstance } from '../types/strapi';

const ADMIN_ENV = process.env['STRAPI_ADMIN_' + 'EMAIL'];
const ADMIN_PWD_ENV = process.env['STRAPI_ADMIN_' + 'PASSWORD'];

export async function seedStrapiAdmin(strapi: StrapiInstance): Promise<void> {
  if (!ADMIN_ENV || !ADMIN_PWD_ENV) {
    strapi.log.info(
      '[seed] STRAPI_ADMIN_EMAIL / STRAPI_ADMIN_PASSWORD не заданы — skip admin seed'
    );
    return;
  }

  try {
    const existingAdmin = await strapi.db
      .query('admin::user')
      .findOne({ where: { email: ADMIN_ENV.toLowerCase() } });

    if (existingAdmin) {
      strapi.log.info(`[seed] Admin ${ADMIN_ENV} уже существует — skip`);
      return;
    }

    // Ищем роль Super Admin (всегда есть в Strapi 5)
    const superAdminRole = await strapi.db
      .query('admin::role')
      .findOne({ where: { code: 'strapi-super-admin' } });

    if (!superAdminRole) {
      strapi.log.warn(
        '[seed] Роль strapi-super-admin не найдена — skip admin seed'
      );
      return;
    }

    // Strapi 5: создаём через entityService. Пароль хэшируется автоматически.
    const newAdmin = await strapi.entityService.create('admin::user', {
      data: {
        email: ADMIN_ENV,
        username: ADMIN_ENV.split('@')[0],
        password: ADMIN_PWD_ENV,
        firstname: 'Admin',
        lastname: 'AKLAB',
        isActive: true,
        blocked: false,
      },
    });

    if (!newAdmin) {
      strapi.log.error('[seed] entityService.create вернул undefined');
      return;
    }

    // Привязываем к роли Super Admin
    await strapi.entityService.update('admin::user', newAdmin.id, {
      data: {
        roles: { set: [superAdminRole.id] },
      },
    });

    strapi.log.info(`[seed] ✅ Admin ${ADMIN_ENV} создан с ролью Super Admin`);
  } catch (err: any) {
    strapi.log.error(`[seed] Ошибка создания admin: ${err.message}`);
    strapi.log.error(err);
  }
}
