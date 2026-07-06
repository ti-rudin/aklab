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
import type { StrapiInstance } from '../types/strapi';

import { seedStrapiAdmin } from './admin';
import { seedTestUser } from './test-user';
import { seedSettings } from './settings';
import { seedSources } from './sources';
import { seedApiPermissions } from './permissions';
import { seedFocusRules } from './focus-rules';

export { seedStrapiAdmin, seedTestUser, seedSettings, seedSources, seedApiPermissions, seedFocusRules };

/**
 * Главная функция — вызывается из index.ts в bootstrap.
 */
export async function runSeeders(strapi: StrapiInstance): Promise<void> {
  await seedStrapiAdmin(strapi);
  await seedTestUser(strapi);
  await seedSettings(strapi);
  await seedSources(strapi);
  await seedApiPermissions(strapi);
  await seedFocusRules(strapi);
}
