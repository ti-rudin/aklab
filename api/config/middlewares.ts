import type { Core } from '@strapi/strapi';

const corsOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map((s) => s.trim())
  : [
      'https://aklab.tirobots.ru',
      'https://api-aklab.tirobots.ru',
      'https://aklab-dev.tirobots.ru',
      'https://api-aklab-dev.tirobots.ru',
      'http://localhost:5174',
      'http://localhost:4173',
    ];

const config: Core.Config.Middlewares = [
  'strapi::logger',
  'strapi::errors',
  'strapi::security',
  {
    name: 'strapi::cors',
    config: {
      origin: corsOrigins,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'],
      headers: ['Content-Type', 'Authorization', 'Origin', 'Accept'],
      keepHeaderOnError: true,
      credentials: true,
    },
  },
  'strapi::poweredBy',
  'strapi::query',
  'strapi::body',
  'strapi::session',
  {
    name: 'global::rate-limit',
    config: {
      max: 10,
      windowMs: 60 * 1000,
      message: { error: 'Too many requests, please try again later.' },
    },
  },
  'strapi::favicon',
  'strapi::public',
];

export default config;
