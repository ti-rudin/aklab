import { z } from 'zod';
import { resolvePhotoRoot } from './photo-storage';

const schema = z.object({
  PORT: z.coerce.number().default(1356),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  STRAPI_URL: z.string().url().default('http://127.0.0.1:1338'),
  STRAPI_API_TOKEN: z.string().min(1, 'STRAPI_API_TOKEN required'),
  QUEUE_DB_PATH: z.string().default('../../queue.db'),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  PRIVATE_PHOTO_ROOT: z.string().optional(),
  PHOTOS_BASE_DIR: z.string().optional(),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

// Resolve at worker initialization so missing, relative, or conflicting roots
// stop the worker before it can accept a write job.
const photoRoot = resolvePhotoRoot(parsed.data);

export const config = {
  port: parsed.data.PORT,
  nodeEnv: parsed.data.NODE_ENV,
  strapi: { url: parsed.data.STRAPI_URL, apiToken: parsed.data.STRAPI_API_TOKEN },
  queue: { dbPath: parsed.data.QUEUE_DB_PATH },
  photoStorage: { root: photoRoot },
  logging: { level: parsed.data.LOG_LEVEL },
};
