/**
 * Generic parse handler — используется всеми парсерами.
 * Устраняет дупликацию handler.ts (800+ строк идентичного кода).
 *
 * Поддерживает:
 *  — depth: ограничение кол-ва создаваемых объектов
 *  — smart stop: остановка при 3+ последовательных дубликатах
 *  — двухфазный парсинг: depth передаётся в parser.parse()
 */

import type { Job } from '@aklab/sqlite-queue';
import type { SourceParser, ParseResult } from './types';
import { propertyExists, createProperty, logCron, updateSourceStats, resetSourceDetailsCounters, resetDetailsCounters } from './strapi-client';
import { randomDelay } from './anti-ban';
import { logger } from './logger';

export interface ParseRequest {
  source: string;
  sourceId?: number;
  documentId?: string;
  correlationId?: string;
  depth?: number;
}

/** Порог последовательных дубликатов для smart stop. */
const SMART_STOP_THRESHOLD = 10;

/**
 * Создаёт generic handler для парсера.
 * Каждый парсер передаёт свой экземпляр SourceParser.
 */
export function createParseHandler(parser: SourceParser) {
  return async function handleParseJob(job: Job): Promise<ParseResult> {
    const req = job.data as ParseRequest;
    const corrId = req.correlationId || job.correlation_id || `parse-${Date.now()}`;
    const depth = req.depth ?? 20;
    const startedAt = new Date().toISOString();
    let total = 0, created = 0, filtered = 0, consecutiveDuplicates = 0, detailsFetched = 0, detailsNeeded = 0;
    let errorMsg: string | undefined;

    // Сброс счётчиков fetchDetails перед новым запуском
    if (req.documentId) {
      await resetSourceDetailsCounters(req.documentId);
    }

    try {
      // Фаза 1: парсинг — передаём depth, чтобы парсер мог ограничить кол-во страниц
      const properties = await parser.parse(depth);
      total = properties.length;
      logger.info(`Parsed ${total} from ${req.source} (depth=${depth})`, { correlationId: corrId });

      // Фаза 2a: проверка existence — собираем только новые объекты
      const newProperties: typeof properties = [];
      for (const prop of properties) {
        // Depth limit
        if (newProperties.length >= depth) break;

        try {
          await randomDelay(500, 1500);

          if (await propertyExists(req.source, prop.external_id)) {
            consecutiveDuplicates++;
            if (consecutiveDuplicates >= SMART_STOP_THRESHOLD) {
              logger.info(
                `Smart stop: ${consecutiveDuplicates} consecutive duplicates, stopping early`,
                { correlationId: corrId },
              );
              break;
            }
            continue;
          }

          consecutiveDuplicates = 0;
          newProperties.push(prop);
        } catch (err: any) {
          logger.warn(`Existence check failed: ${prop.external_id}: ${err.message}`, { correlationId: corrId });
        }
      }

      // Считаем сколько детальных нужно (все новые объекты с fetchDetails)
      if (parser.fetchDetails) {
        detailsNeeded = newProperties.length;
        if (req.documentId) {
          // Сбрасываем fetched перед новым циклом (needed устанавливаем ниже)
          await resetDetailsCounters(req.documentId).catch(() => {});
          await updateSourceStats(req.documentId, {
            total_details_needed: detailsNeeded,
          }).catch(() => {});
        }
        logger.info(`Details needed: ${detailsNeeded} new objects for ${req.source}`, { correlationId: corrId });
      }

      // Фаза 2b: обработка новых объектов (fetchDetails + createProperty)
      for (const prop of newProperties) {
        try {
          // Фаза 2.5: загрузка детальной страницы (если парсер поддерживает)
          if (parser.fetchDetails) {
            try {
              const details = await parser.fetchDetails(prop.url);
              if (details && Object.keys(details).length > 0) {
                Object.assign(prop, details);
                detailsFetched++;
                logger.info(`Details fetched: ${prop.external_id}`, { correlationId: corrId });
                // Обновление fetched для UI (каждый fetchDetails)
                if (req.documentId) {
                  updateSourceStats(req.documentId, {
                    total_details_fetched: 1,
                  }).catch(() => {});
                }
              }
            } catch (err: any) {
              logger.warn(`fetchDetails failed for ${prop.url}: ${err.message}`, { correlationId: corrId });
              // Продолжаем с базовыми данными из списка
            }
            // Антибан: пауза между детальными страницами (2-5 сек)
            await randomDelay(2000, 5000);
          }

          const result = await createProperty({
            source: req.source,
            external_id: prop.external_id,
            url: prop.url,
            title: prop.title,
            address: prop.address,
            city: prop.city,
            area_sqm: prop.area_sqm,
            price: prop.price,
            minimum_price: prop.minimum_price,
            price_per_sqm: prop.price_per_sqm,
            property_type: prop.property_type,
            auction_type: prop.auction_type,
            published_at_source: prop.published_at,
            description: prop.description,
            contacts: prop.contacts,
            latitude: prop.latitude,
            longitude: prop.longitude,
          });
          if (result) created++;
          else filtered++;
        } catch (err: any) {
          logger.warn(`Failed: ${prop.external_id}: ${err.message}`, { correlationId: corrId });
        }
      }
    } catch (err: any) {
      errorMsg = err.message;
      logger.error(`Parse failed: ${err.message}`, { correlationId: corrId });
      if (req.documentId) {
        await updateSourceStats(req.documentId, {
          last_parse_status: 'error',
          last_parse_error: err.message,
          last_parsed_at: new Date().toISOString(),
        }).catch(() => {});
      }
      throw err;
    } finally {
      await logCron({
        name: `parse-${req.source}`,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        items_processed: created,
        error: errorMsg,
      }).catch(() => {});
    }

    if (req.documentId) {
      await updateSourceStats(req.documentId, {
        last_parse_status: 'success',
        last_parse_error: undefined,
        last_parsed_at: new Date().toISOString(),
        total_found: total,
        total_created: created,
        parse_count: 1,
      }).catch((err: any) => {
        logger.warn(`Stats update failed: ${err.message}`, { correlationId: corrId });
      });
    }

    logger.info(
      `Done: ${created} created, ${filtered} filtered, ${total} total, ${detailsFetched} details fetched (depth=${depth})`,
      { correlationId: corrId },
    );
    return { created, filtered, total, detailsFetched };
  };
}
