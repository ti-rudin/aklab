/**
 * Config для микросервисов парсинга.
 * Валидация через Zod.
 */

import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().default(1340),
  SERVICE_NAME: z.string().min(1).default('parser-service'),
  QUEUE_NAME: z.string().min(1).default('parse-default'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  STRAPI_URL: z.string().url().default('http://127.0.0.1:1338'),
  STRAPI_API_TOKEN: z.string().min(1, 'STRAPI_API_TOKEN required'),
  QUEUE_DB_PATH: z.string().default('../../queue.db'),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = {
  port: parsed.data.PORT,
  serviceName: parsed.data.SERVICE_NAME,
  queueName: parsed.data.QUEUE_NAME,
  nodeEnv: parsed.data.NODE_ENV,
  strapi: {
    url: parsed.data.STRAPI_URL,
    apiToken: parsed.data.STRAPI_API_TOKEN,
  },
  queue: {
    dbPath: parsed.data.QUEUE_DB_PATH,
  },
  logging: {
    level: parsed.data.LOG_LEVEL,
  },
};
