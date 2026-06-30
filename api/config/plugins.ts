import type { Core } from '@strapi/strapi';

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Plugin => ({
  'users-permissions': {
    config: {
      jwtSecret: env('JWT_SECRET'),
      jwt: {
        expiresIn: '30d',
      },
      ratelimit: {
        enabled: true,
        interval: { min: 1 },
        max: 50,
      },
    },
  },
  email: {
    config: {
      provider: 'nodemailer',
      providerOptions: {
        host: env('EMAIL_SMTP_HOST'),
        port: env.int('EMAIL_SMTP_PORT', 465),
        secure: true, // true for 465
        auth: {
          user: env('EMAIL_SMTP_USER'),
          pass: env('EMAIL_SMTP_PASS'),
        },
      },
      settings: {
        defaultFrom: env('EMAIL_DEFAULT_FROM'),
        defaultReplyTo: env('EMAIL_DEFAULT_REPLY_TO'),
      },
    },
  },
});

export default config;
