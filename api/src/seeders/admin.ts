/**
 * Создание Strapi Admin при старте, если не существует
 * Env: STRAPI_ADMIN_EMAIL, STRAPI_ADMIN_PASSWORD
 */
export async function seedStrapiAdmin(strapi: any): Promise<void> {
  try {
    const adminEmail = process.env.STRAPI_ADMIN_EMAIL;
    const adminPassword = process.env.STRAPI_ADMIN_PASSWORD;

    if (!adminEmail || !adminPassword) {
      strapi.log.warn('[Seeders] STRAPI_ADMIN_EMAIL или STRAPI_ADMIN_PASSWORD не установлены, пропускаем создание админа');
      return;
    }

    const existingAdmin = await strapi.db.query('admin::user').findOne({
      where: { email: adminEmail },
    });

    if (existingAdmin) {
      strapi.log.info(`[Seeders] Admin ${adminEmail} уже существует`);
      return;
    }

    const superAdminRole = await strapi.db.query('admin::role').findOne({
      where: { code: 'strapi-super-admin' },
    });

    if (!superAdminRole) {
      strapi.log.warn('[Seeders] Роль strapi-super-admin не найдена, пропускаем создание админа');
      return;
    }

    // H2: Хешируем пароль ДО создания пользователя
    const adminAuthService = strapi.service('admin::auth');
    const hashedPassword = await adminAuthService.hashPassword(adminPassword);

    // H1: db.query вместо entityService
    const newAdmin = await strapi.db.query('admin::user').create({
      data: {
        email: adminEmail,
        password: hashedPassword,
        firstname: 'Admin',
        lastname: 'User',
        isActive: true,
        roles: [superAdminRole.id],
      },
    });

    strapi.log.info(`[Seeders] Admin ${adminEmail} создан с ролью Super Admin`);
  } catch (error: any) {
    strapi.log.error('[Seeders] Ошибка создания admin:', error.message);
  }
}
