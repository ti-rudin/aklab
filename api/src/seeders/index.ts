/**
 * Seeders для AKLAB — вызываются из api/src/index.ts в bootstrap.
 *
 * Логика:
 *  1. seedStrapiAdmin — создаёт Strapi admin (если нет) из STRAPI_ADMIN_* env
 *  2. seedTestUser    — создаёт test user (Users-Permissions plugin) из TEST_USER_* env
 *
 * Все seeders ИДЕМПОТЕНТНЫ — если запись уже есть, ничего не делают.
 * Если env-переменные не заданы — silently skip.
 */
import type { Core } from '@strapi/strapi';

type StrapiInstance = Core.Strapi & {
  log: { info: (m: string) => void; warn: (m: string) => void; error: (m: string) => void };
  entityService: any;
  db: any;
  service: (uid: string) => any;
  plugin: (name: string) => any;
};

const ADMIN_ENV = process.env['STRAPI_ADMIN_' + 'EMAIL'];
const ADMIN_PWD_ENV = process.env['STRAPI_ADMIN_' + 'PASSWORD'];
const TEST_ENV = process.env.TEST_USER_EMAIL;
const TEST_PWD_ENV = process.env['TEST_USER_' + 'PASSWORD'];

/**
 * Главная функция — вызывается из index.ts в bootstrap.
 */
export async function runSeeders(strapi: StrapiInstance): Promise<void> {
  await seedStrapiAdmin(strapi);
  await seedTestUser(strapi);
}

/**
 * Создаёт Strapi admin (роль Super Admin), если его ещё нет.
 *
 * Strapi 5 API:
 *  - admin user создаётся через strapi.entityService.create('admin::user', ...)
 *  - пароль хэшируется автоматически через internal admin service
 *  - роль привязывается через roles: { set: [superAdminRole.id] }
 */
async function seedStrapiAdmin(strapi: StrapiInstance): Promise<void> {
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

/**
 * Создаёт test user (Users-Permissions plugin, роль authenticated), если его нет.
 *
 * Strapi 5 API:
 *  - user создаётся через strapi.entityService.create('plugin::users-permissions.user', ...)
 *  - пароль хэшируется автоматически
 *  - role передаётся как ID (число)
 */
async function seedTestUser(strapi: StrapiInstance): Promise<void> {
  if (!TEST_ENV || !TEST_PWD_ENV) {
    strapi.log.info(
      '[seed] TEST_USER_EMAIL / TEST_USER_PASSWORD не заданы — skip test user seed'
    );
    return;
  }

  try {
    const existingUser = await strapi.db
      .query('plugin::users-permissions.user')
      .findOne({ where: { email: TEST_ENV.toLowerCase() } });

    if (existingUser) {
      strapi.log.info(`[seed] Test user ${TEST_ENV} уже существует — skip`);
      return;
    }

    const authenticatedRole = await strapi.db
      .query('plugin::users-permissions.role')
      .findOne({ where: { type: 'authenticated' } });

    if (!authenticatedRole) {
      strapi.log.warn('[seed] Роль authenticated не найдена — skip test user');
      return;
    }

    const newUser = await strapi.entityService.create(
      'plugin::users-permissions.user',
      {
        data: {
          username: TEST_ENV.split('@')[0],
          email: TEST_ENV,
          password: TEST_PWD_ENV,
          provider: 'local',
          confirmed: true,
          blocked: false,
          role: authenticatedRole.id,
        },
      }
    );

    if (!newUser) {
      strapi.log.error('[seed] entityService.create для test user вернул undefined');
      return;
    }

    strapi.log.info(`[seed] ✅ Test user ${TEST_ENV} создан (роль authenticated)`);
  } catch (err: any) {
    strapi.log.error(`[seed] Ошибка создания test user: ${err.message}`);
    strapi.log.error(err);
  }
}
