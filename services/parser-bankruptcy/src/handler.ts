/**
 * Handler для parse-bankruptcy jobs.
 *
 * Получает source, вызывает парсер, дедуплицирует, создаёт Property в Strapi.
 */

import type { Job } from '@aklab/sqlite-queue';
import { getSourceParser } from './sources';
import { propertyExists, createProperty, logCron } from './strapi-client';
import { logger } from './utils/logger';

export interface ParseRequest {
  source: string;
  correlationId?: string;
}

/**
 * Обрабатывает parse-bankruptcy job.
 */
export async function handleParseJob(job: Job): Promise<{ processed: number; created: number; skipped: number }> {
  const req = job.data as ParseRequest;
  const source = req.source;
  const corrId = req.correlationId || job.correlation_id || `parse-${Date.now()}`;
  const startedAt = new Date().toISOString();

  logger.info(`Parsing source=${source}`, { correlationId: corrId });

  const parser = getSourceParser(source);
  if (!parser) {
    const msg = `Unknown source: ${source}`;
    logger.error(msg, { correlationId: corrId });
    throw new Error(msg); // retry не поможет — PermanentError в будущем
  }

  let processed = 0;
  let created = 0;
  let skipped = 0;
  let errorMsg: string | undefined;

  try {
    const properties = await parser.parse();
    processed = properties.length;
    logger.info(`Parsed ${processed} properties from ${source}`, { correlationId: corrId });

    for (const prop of properties) {
      try {
        // Дедупликация: проверяем source + external_id
        const exists = await propertyExists(source, prop.external_id);
        if (exists) {
          skipped++;
          continue;
        }

        await createProperty({
          source,
          external_id: prop.external_id,
          url: prop.url,
          title: prop.title,
          address: prop.address,
          city: prop.city,
          area_sqm: prop.area_sqm,
          price: prop.price,
          price_per_sqm: prop.price_per_sqm,
          property_type: prop.property_type,
          auction_type: prop.auction_type,
          published_at: prop.published_at,
          description: prop.description,
          contacts: prop.contacts,
        });
        created++;
      } catch (err: any) {
        logger.warn(`Failed to create property ${prop.external_id}: ${err.message}`, { correlationId: corrId });
        // Продолжаем — не падаем из-за одного объекта
      }
    }
  } catch (err: any) {
    errorMsg = err.message;
    logger.error(`Parse failed for ${source}: ${err.message}`, { correlationId: corrId });
    throw err; // пусть worker ретраит
  } finally {
    // Логируем CronLog
    await logCron({
      name: `parse-${source}`,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      items_processed: created,
      error: errorMsg,
    }).catch(() => {}); // не падаем если лог не записался
  }

  logger.info(`Done: ${created} created, ${skipped} skipped, ${processed} total`, { correlationId: corrId });
  return { processed, created, skipped };
}
