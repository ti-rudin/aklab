import type { Core } from '@strapi/strapi';
import { runSeeders } from './seeders';

export default {
  /**
   * Runs before the application is initialized.
   */
  register() {},

  /**
   * Bootstrap: запускает seed'ы (admin + test user) перед стартом приложения.
   * Логика вынесена в src/seeders/index.ts (по образцу tirobots).
   */
  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    try {
      await runSeeders(strapi as any);
    } catch (err: any) {
      strapi.log.error(`[bootstrap] runSeeders failed: ${err.message}`);
    }
  },
};
