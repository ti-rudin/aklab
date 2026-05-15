import type { Core } from '@strapi/strapi';

const config = ({ env }: Core.Config.Shared.ConfigParams) => ({
  host: env('HOST', '0.0.0.0'),
  port: env.int('PORT', 1338),
  app: {
    keys: env.array('APP_KEYS'),
  },
  allowedHosts: ['api.todoit.ru', 'todoit.ru'],
});

export default config;
