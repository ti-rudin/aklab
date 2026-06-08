import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().default(1342),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  STRAPI_URL: z.string().url().default('http://127.0.0.1:1338'),
  STRAPI_API_TOKEN: z.string().min(1, 'STRAPI_API_TOKEN required'),
  QUEUE_DB_PATH: z.string().default('../../queue.db'),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  EMAIL_SMTP_HOST: z.string().default('smtp.yandex.ru'),
  EMAIL_SMTP_PORT: z.coerce.number().default(465),
  EMAIL_SMTP_USER: z.string().min(1, 'EMAIL_SMTP_USER required'),
  EMAIL_SMTP_PASS: z.string().min(1, 'EMAIL_SMTP_PASS required'),
  EMAIL_DEFAULT_FROM: z.string().default('tirobots@yandex.ru'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = {
  port: parsed.data.PORT,
  nodeEnv: parsed.data.NODE_ENV,
  strapi: { url: parsed.data.STRAPI_URL, apiToken: parsed.data.STRAPI_API_TOKEN },
  queue: { dbPath: parsed.data.QUEUE_DB_PATH },
  logging: { level: parsed.data.LOG_LEVEL },
  smtp: {
    host: parsed.data.EMAIL_SMTP_HOST,
    port: parsed.data.EMAIL_SMTP_PORT,
    user: parsed.data.EMAIL_SMTP_USER,
    pass: parsed.data.EMAIL_SMTP_PASS,
    from: parsed.data.EMAIL_DEFAULT_FROM,
  },
};
