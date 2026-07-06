/**
 * Создаёт test user (Users-Plugins plugin, роль authenticated), если его нет.
 *
 * Strapi 5 API:
 *  - user создаётся через strapi.entityService.create('plugin::users-permissions.user', ...)
 *  - пароль хэшируется автоматически
 *  - role передаётся как ID (число)
 */
import type { StrapiInstance } from '../types/strapi';

const TEST_ENV = process.env.TEST_USER_EMAIL;
const TEST_PWD_ENV = process.env['TEST_USER_' + 'PASSWORD'];

export async function seedTestUser(strapi: StrapiInstance): Promise<void> {
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
      // Обновляем пароль на случай если TEST_USER_PASSWORD изменился в .env
      await strapi.entityService.update(
        'plugin::users-permissions.user',
        existingUser.id,
        { data: { password: TEST_PWD_ENV } }
      );
      strapi.log.info(`[seed] Test user ${TEST_ENV} уже существует — пароль обновлён`);
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
