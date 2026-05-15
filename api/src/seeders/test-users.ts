/**
 * Создание тестового пользователя при старте
 * Env: TEST_USER_EMAIL, TEST_USER_PASSWORD (обязательные)
 */
export async function seedTestUsers(strapi: any): Promise<void> {
  try {
    const email = process.env.TEST_USER_EMAIL;
    const password = process.env.TEST_USER_PASSWORD;

    if (!email || !password) {
      strapi.log.warn('[Seeders] TEST_USER_EMAIL или TEST_USER_PASSWORD не установлены, пропускаем создание test user');
      return;
    }

    const username = email.split('@')[0];

    // Проверяем существование
    const existingUser = await strapi.db.query('plugin::users-permissions.user').findOne({
      where: { email },
    });

    if (existingUser) {
      strapi.log.info(`[Seeders] Test user ${email} уже существует`);
      return;
    }

    // Получаем роль Authenticated (дефолтная роль для пользователей)
    const authRole = await strapi.db.query('plugin::users-permissions.role').findOne({
      where: { type: 'authenticated' },
    });

    if (!authRole) {
      strapi.log.warn('[Seeders] Роль authenticated не найдена, пропускаем создание test user');
      return;
    }

    // H2: Хешируем пароль ДО создания пользователя через users-permissions service
    const userService = strapi.plugin('users-permissions').service('user');
    const hashedPassword = await userService.hashPassword(password);

    // H1: db.query вместо entityService + hashed password
    await strapi.db.query('plugin::users-permissions.user').create({
      data: {
        username,
        email,
        password: hashedPassword,
        confirmed: true,
        blocked: false,
        provider: 'local',
        role: authRole.id,
      },
    });

    strapi.log.info(`[Seeders] Test user ${email} создан`);
  } catch (error: any) {
    strapi.log.error('[Seeders] Ошибка создания test user:', error.message);
  }
}
