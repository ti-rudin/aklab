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
  await seedSettings(strapi);
  await seedSources(strapi);
  await seedPublicPermissions(strapi);
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

/**
 * Создаёт дефолтную запись Setting (singleton), если её ещё нет.
 *
 * Singleton в Strapi 5 — findOne возвращает null если ничего нет.
 * ДЕФОЛТЫ берутся из schema.json (threshold_percent=20, work_hours_start=9 и т.д.)
 * — но Strapi 5 на create требует явные значения, поэтому дублируем тут.
 */
async function seedSettings(strapi: StrapiInstance): Promise<void> {
  try {
    const existing = await strapi.entityService.findMany(
      'api::setting.setting',
      { limit: 1 }
    );

    if (existing && existing.length > 0) {
      strapi.log.info('[seed] Setting уже существует — skip');
      return;
    }

    await strapi.entityService.create('api::setting.setting', {
      data: {
        threshold_percent: 20,
        work_hours_start: 9,
        work_hours_end: 21,
        digest_time: '09:00',
        retention_months: 6,
        active_sources: ['fedresurs'], // MVP: один источник; UI расширит
        smtp_to: process.env.SMTP_TO || null,
      },
    });

    strapi.log.info('[seed] ✅ Setting создан с дефолтами (threshold=20%, digest=09:00)');
  } catch (err: any) {
    strapi.log.error(`[seed] Ошибка создания Setting: ${err.message}`);
    strapi.log.error(err);
  }
}

/**
 * Создаёт дефолтные источники парсинга, если их ещё нет.
 */
async function seedSources(strapi: StrapiInstance): Promise<void> {
  const defaults = [
    {
      name: 'Фабрикант',
      slug: 'fabrikant',
      url: 'https://www.fabrikant.ru/procedure/search/sales',
      parser: 'fabrikant' as const,
      auction_type: 'bankruptcy' as const,
      region: 'Россия',
      is_active: true,
    },
    {
      name: 'Федресурс',
      slug: 'fedresurs',
      url: 'https://bankrot.fedresurs.ru',
      parser: 'fedresurs' as const,
      auction_type: 'bankruptcy' as const,
      region: 'Россия',
      is_active: false, // Qrator 403 — отложен
    },
    {
      name: 'ГИС Торги',
      slug: 'torgi-gov',
      url: 'https://torgi.gov.ru/new/public/lots/reg',
      parser: 'torgi-gov' as const,
      auction_type: 'privatization' as const,
      region: 'Москва и МО',
      is_active: true,
    },
  ];

  for (const src of defaults) {
    try {
      const existing = await strapi.entityService.findMany('api::source.source', {
        filters: { slug: src.slug },
        limit: 1,
      });

      if (existing && existing.length > 0) {
        strapi.log.info(`[seed] Source "${src.name}" уже существует — skip`);
        continue;
      }

      await strapi.entityService.create('api::source.source', { data: src });
      strapi.log.info(`[seed] ✅ Source "${src.name}" создан`);
    } catch (err: any) {
      strapi.log.error(`[seed] Ошибка создания source "${src.name}": ${err.message}`);
    }
  }
}

/**
 * Открывает публичный доступ (find/findOne) к нашим 5 content-types.
 *
 * Без этого /api/properties и т.п. отдают 404 даже без auth — Strapi 5 по умолчанию
 * ставит "no permissions" для public роли на новые content-types. Это нужно для dev
 * удобства; в проде доступ к admin делается через login (admin panel).
 *
 * Идемпотентно: проверяет, есть ли уже permission, и не дублирует.
 */
async function seedPublicPermissions(strapi: StrapiInstance): Promise<void> {
  try {
    const publicRole = await strapi.db
      .query('plugin::users-permissions.role')
      .findOne({ where: { type: 'public' } });

    if (!publicRole) {
      strapi.log.warn('[seed] Public role не найдена — skip permissions seed');
      return;
    }

    const actions = [
      // find / findOne (чтение)
      'api::source.source.find',
      'api::source.source.findOne',
      'api::property.property.find',
      'api::property.property.findOne',
      'api::setting.setting.find',
      'api::setting.setting.findOne',
      'api::market-reference.market-reference.find',
      'api::market-reference.market-reference.findOne',
      'api::user-comment.user-comment.find',
      'api::user-comment.user-comment.findOne',
      'api::cron-log.cron-log.find',
      'api::cron-log.cron-log.findOne',
      // create / update / delete (запись) — для dev-режима, чтобы можно было дёргать API curl'ом
      'api::source.source.create',
      'api::source.source.update',
      'api::source.source.delete',
      'api::property.property.create',
      'api::property.property.update',
      'api::property.property.delete',
      'api::setting.setting.create',
      'api::setting.setting.update',
      'api::setting.setting.delete',
      'api::market-reference.market-reference.create',
      'api::market-reference.market-reference.update',
      'api::market-reference.market-reference.delete',
      'api::user-comment.user-comment.create',
      'api::user-comment.user-comment.update',
      'api::user-comment.user-comment.delete',
      'api::cron-log.cron-log.create',
      'api::cron-log.cron-log.update',
      'api::cron-log.cron-log.delete',
    ];

    let added = 0;
    for (const action of actions) {
      const existing = await strapi.db
        .query('plugin::users-permissions.permission')
        .findOne({ where: { action, role: publicRole.id } });

      if (existing) continue;

      await strapi.db
        .query('plugin::users-permissions.permission')
        .create({ data: { action, role: publicRole.id } });
      added++;
    }

    if (added > 0) {
      strapi.log.info(`[seed] ✅ Public permissions добавлено: ${added} actions`);
    } else {
      strapi.log.info('[seed] Public permissions уже настроены — skip');
    }
  } catch (err: any) {
    strapi.log.error(`[seed] Ошибка создания public permissions: ${err.message}`);
    strapi.log.error(err);
  }
}
