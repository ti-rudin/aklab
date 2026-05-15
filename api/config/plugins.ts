import type { Core } from '@strapi/strapi';

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Plugin => ({
  documentation: {
    config: {
      info: {
        contact: {
          name: 'TODOIT Support',
          email: 'tirobots@yandex.ru',
        },
      },
    },
  },
});

export default config;
