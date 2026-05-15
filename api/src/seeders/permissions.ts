/**
 * Назначение прав для роли Authenticated на content type zamer.
 * Вызывается при старте Strapi.
 */
export async function seedPermissions(strapi: any): Promise<void> {
  try {
    // Находим роль Authenticated
    const authRole = await strapi.db.query('plugin::users-permissions.role').findOne({
      where: { type: 'authenticated' },
    });

    if (!authRole) {
      strapi.log.warn('[Seeders] Роль authenticated не найдена, пропускаем назначение прав');
      return;
    }

    // Получаем все permissions для api::zamer.zamer
    const actions = [
      'api::zamer.zamer.find',
      'api::zamer.zamer.findOne',
      'api::zamer.zamer.create',
      'api::zamer.zamer.update',
      'api::zamer.zamer.delete',
      'api::zamer.zamer.calculate',
    ];

    for (const action of actions) {
      // Проверяем, существует ли permission
      const existing = await strapi.db.query('plugin::users-permissions.permission').findOne({
        where: {
          action,
          role: authRole.id,
        },
      });

      if (existing) {
        strapi.log.info(`[Seeders] Permission ${action} уже существует для authenticated`);
        continue;
      }

      // Создаём permission
      await strapi.db.query('plugin::users-permissions.permission').create({
        data: {
          action,
          role: authRole.id,
        },
      });

      strapi.log.info(`[Seeders] ✅ Permission ${action} создан для authenticated`);
    }

    strapi.log.info('[Seeders] Permissions для zamer назначены');
  } catch (error: any) {
    strapi.log.error('[Seeders] Ошибка назначения permissions:', error.message);
  }
}
