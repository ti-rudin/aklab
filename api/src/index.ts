import type { Core } from '@strapi/strapi';
import { runSeeders } from './seeders';

export default {
  register(/* { strapi }: { strapi: Core.Strapi } */) {},

  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    // Валидация обязательных env vars
    const required = ['APP_KEYS', 'JWT_SECRET', 'ADMIN_JWT_SECRET', 'API_TOKEN_SALT', 'TRANSFER_TOKEN_SALT'];
    const missing = required.filter((v) => !process.env[v]);
    if (missing.length > 0) {
      strapi.log.error(`[Bootstrap] Отсутствуют критические env переменные: ${missing.join(', ')}`);
      process.exit(1);
    }

    // Seeders
    await runSeeders(strapi);
  },
};
