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
  await seedApiPermissions(strapi);
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
    // Используем db.query вместо entityService — надёжнее для singleton,
    // entityService.findMany может не находить записи из-за draft/published state
    const existing = await strapi.db.query('api::setting.setting').findOne({});
    if (existing) {
      // Обновляем smtp_to если пустой
      if (!existing.smtp_to) {
        const defaultSmtpTo = process.env.SMTP_TO || 'a@rudin.ru';
        await strapi.db.query('api::setting.setting').update({
          where: { id: existing.id },
          data: { smtp_to: defaultSmtpTo },
        });
        strapi.log.info(`[seed] Setting smtp_to обновлён: ${defaultSmtpTo}`);
      }
      strapi.log.info('[seed] Setting уже существует — skip create');
      return;
    }

    await strapi.entityService.create('api::setting.setting', {
      data: {
        threshold_percent: 20,
        work_hours_start: 9,
        work_hours_end: 21,
        digest_time: '09:00',
        retention_months: 6,
        active_sources: ['fabrikant', 'torgi-gov', 'aggregator-bankrot', 'alfalot', 'etprf', 'sberbank-ast', 'invest-mosreg', 'investmoscow', 'roseltorg', 'm-ets'],
        smtp_to: process.env.SMTP_TO || 'a@rudin.ru',
        monitored_regions: ['moscow', 'mo'],
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
      schedule: '0 3 * * *',
      health_port: 1345,
    },
    {
      name: 'Федресурс',
      slug: 'fedresurs',
      url: 'https://bankrot.fedresurs.ru',
      parser: 'fedresurs' as const,
      auction_type: 'bankruptcy' as const,
      region: 'Россия',
      is_active: false, // Qrator 403 — отложен
      schedule: '0 3 * * *',
      health_port: 1347,
    },
    {
      name: 'ГИС Торги',
      slug: 'torgi-gov',
      url: 'https://torgi.gov.ru/new/public/lots/reg',
      parser: 'torgi-gov' as const,
      auction_type: 'privatization' as const,
      region: 'Москва и МО',
      is_active: true,
      schedule: '0 3 * * *',
      health_port: 1346,
    },
    {
      name: 'Агрегатор банкрот',
      slug: 'aggregator-bankrot',
      url: 'https://xn----etbpba5admdlad.xn--p1ai',
      parser: 'aggregator-bankrot' as const,
      auction_type: 'bankruptcy' as const,
      region: 'Россия',
      is_active: true,
      schedule: '0 4 * * *',
      health_port: 1348,
    },
    {
      name: 'Alfalot',
      slug: 'alfalot',
      url: 'https://ecosystem.alfalot.ru/showcase/list?categories=1',
      parser: 'alfalot' as const,
      auction_type: 'bankruptcy' as const,
      region: 'Россия',
      is_active: true,
      schedule: '0 4 * * *',
      health_port: 1349,
    },
    {
      name: 'ЕТП РФ',
      slug: 'etprf',
      url: 'https://sale.etprf.ru/Notification',
      parser: 'etprf' as const,
      auction_type: 'bankruptcy' as const,
      region: 'Россия',
      is_active: true,
      schedule: '0 5 * * *',
      health_port: 1350,
    },
    {
      name: 'Сбербанк-АСТ',
      slug: 'sberbank-ast',
      url: 'https://utp.sberbank-ast.ru/Property/List/BidListComReal',
      parser: 'sberbank-ast' as const,
      auction_type: 'bankruptcy' as const,
      region: 'Россия',
      is_active: true,
      schedule: '0 5 * * *',
      health_port: 1351,
    },
    {
      name: 'Инвест МО',
      slug: 'invest-mosreg',
      url: 'https://invest.mosreg.ru',
      parser: 'invest-mosreg' as const,
      auction_type: 'marketplace' as const,
      region: 'Московская область',
      is_active: true,
      schedule: '0 5 * * *',
      health_port: 1352,
    },
    {
      name: 'Инвест Москва',
      slug: 'investmoscow',
      url: 'https://investmoscow.ru',
      parser: 'investmoscow' as const,
      auction_type: 'marketplace' as const,
      region: 'Москва',
      is_active: true,
      schedule: '0 5 * * *',
      health_port: 1353,
    },
    {
      name: 'Росэлторг',
      slug: 'roseltorg',
      url: 'https://roseltorg.ru',
      parser: 'roseltorg' as const,
      auction_type: 'marketplace' as const,
      region: 'Россия',
      is_active: true,
      schedule: '0 6 * * *',
      health_port: 1354,
    },
    {
      name: 'М-ЕТС',
      slug: 'm-ets',
      url: 'https://m-ets.ru',
      parser: 'm-ets' as const,
      auction_type: 'marketplace' as const,
      region: 'Россия',
      is_active: true,
      schedule: '0 6 * * *',
      health_port: 1355,
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
 * Открывает доступ к нашим content-types для роли Authenticated.
 *
 * Без этого /api/properties и т.п. отдают 404/403 для авторизованных
 * пользователей. Strapi 5 по умолчанию ставит "no permissions" для новых
 * content-types.
 *
 * Идемпотентно: проверяет, есть ли уже permission, и не дублирует.
 */
async function seedApiPermissions(strapi: StrapiInstance): Promise<void> {
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
      'api::market-reference.market-reference.find',
      'api::market-reference.market-reference.findOne',
      'api::user-comment.user-comment.find',
      'api::user-comment.user-comment.findOne',
      'api::cron-log.cron-log.find',
      'api::cron-log.cron-log.findOne',
      // create / update только для user-comment (пользователи могут комментировать)
      'api::user-comment.user-comment.create',
      'api::user-comment.user-comment.update',
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
