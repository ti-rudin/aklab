import { seedStrapiAdmin } from './admin';
import { seedTestUsers } from './test-users';
import { seedPermissions } from './permissions';

/**
 * Оркестратор seeders — вызывается из bootstrap()
 */
export async function runSeeders(strapi: any): Promise<void> {
  strapi.log.info('[Seeders] Запуск seeders...');

  await seedStrapiAdmin(strapi);
  await seedTestUsers(strapi);
  await seedPermissions(strapi);

  strapi.log.info('[Seeders] Все seeders завершены');
}
