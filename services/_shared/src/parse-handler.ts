/**
 * Generic parse handler — используется всеми парсерами.
 *
 * ДВУХФАЗНАЯ АРХИТЕКТУРА:
 *  Фаза 1 (scan):  парсинг списков + дедуп + предфильтр → сохраняет результат в файл
 *  Фаза 2 (details): чтение файла + fetchDetails + createProperty
 *
 * Pipeline управляет синхронизацией фаз:
 *   Phase 1: enqueue scan для ВСЕХ источников → ждём завершения ВСЕХ
 *   Phase 2: enqueue details для ВСЕХ источников → ждём завершения ВСЕХ
 *
 * Если phase не указан — выполняет обе фазы последовательно (backward compat).
 */

import type { Job } from '@aklab/sqlite-queue';
import { writeFileSync, readFileSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { SourceParser, ParseResult } from './types';
import { propertyExists, createProperty, preFilterProperty, logCron, updateSourceStats, resetSourceDetailsCounters } from './strapi-client';
import type { ParseRules } from './strapi-client';
import { randomDelay } from './anti-ban';
import { logger } from './logger';
import { detectCity } from './city-detect';

export interface ParseRequest {
  source: string;
  sourceId?: number;
  documentId?: string;
  correlationId?: string;
  depth?: number;
  rules?: ParseRules;
  /** Если указан — выполняет только одну фазу. undefined = обе (backward compat). */
  phase?: 'scan' | 'details';
}

/** Порог последовательных дубликатов для smart stop. */
const SMART_STOP_THRESHOLD = 10;

/** Директория для промежуточных результатов Phase 1. */
const SCAN_DIR = join(tmpdir(), 'aklab-scan');

/** Путь к файлу с результатами сканирования. */
function getScanFilePath(source: string, correlationId: string): string {
  return join(SCAN_DIR, `${source}-${correlationId}.json`);
}

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
    let total = 0, created = 0, filtered = 0, preFiltered = 0, detailsFetched = 0, detailsNeeded = 0;
    let errorMsg: string | undefined;

    const phase: string | undefined = req.phase; // undefined = обе фазы

    try {
      // ═══════════════════════════════════════════════════════════════
      // ФАЗА 1: СКАНИРОВАНИЕ
      // Парсинг списков + дедупликация + предфильтр
      // Результат: файл с отфильтрованным списком объектов
      // ═══════════════════════════════════════════════════════════════
      if (phase !== 'details') {
        // Сброс счётчиков перед новым запуском
        if (req.documentId) {
          console.log(`[parse-handler:${req.source}] SCAN: resetting counters`);
          await resetSourceDetailsCounters(req.documentId);
        }

        // Парсинг списков (без загрузки деталей)
        const properties = await parser.parse(depth);
        total = properties.length;
        console.log(`[parse-handler:${req.source}] SCAN: parsed ${total} items (depth=${depth})`);

        // Дедупликация + предфильтр — собираем только новые и проходящие фильтры
        const newProperties: typeof properties = [];
        let consecutiveDuplicates = 0;

        for (const prop of properties) {
          // Depth limit
          if (newProperties.length >= depth) break;

          try {
            // Проверка дубликата в Strapi
            if (await propertyExists(req.source, prop.external_id)) {
              consecutiveDuplicates++;
              if (consecutiveDuplicates === 1 || consecutiveDuplicates >= SMART_STOP_THRESHOLD) {
                console.log(`[parse-handler:${req.source}] DUP #${consecutiveDuplicates}: ${prop.external_id}`);
              }
              if (consecutiveDuplicates >= SMART_STOP_THRESHOLD) {
                console.log(`[parse-handler:${req.source}] SMART STOP: ${consecutiveDuplicates} consecutive duplicates`);
                break;
              }
              continue;
            }
            consecutiveDuplicates = 0;

            // Предфильтр: city, stop words, commercial type, price, area
            const preResult = preFilterProperty(prop, req.rules);
            if (!preResult.pass) {
              preFiltered++;
              if (preFiltered <= 10 || preFiltered % 50 === 0) {
                console.log(`[parse-handler:${req.source}] PRE-FILTER #${preFiltered}: ${prop.external_id} — ${preResult.reason}`);
              }
              continue;
            }

            newProperties.push(prop);
          } catch (err: any) {
            logger.warn(`Existence check failed: ${prop.external_id}: ${err.message}`, { correlationId: corrId });
          }
        }

        detailsNeeded = parser.fetchDetails ? newProperties.length : 0;
        console.log(`[parse-handler:${req.source}] SCAN DONE: total=${total} new=${newProperties.length} preFiltered=${preFiltered} detailsNeeded=${detailsNeeded}`);

        // Сохраняем отфильтрованный список для Phase 2
        try {
          mkdirSync(SCAN_DIR, { recursive: true });
          const scanFilePath = getScanFilePath(req.source, corrId);
          writeFileSync(scanFilePath, JSON.stringify(newProperties), 'utf-8');
          console.log(`[parse-handler:${req.source}] SCAN: saved to ${scanFilePath}`);
        } catch (err: any) {
          logger.error(`Failed to save scan results: ${err.message}`, { correlationId: corrId });
        }

        // Обновляем статистику источника (Phase 1 результат)
        if (req.documentId) {
          await updateSourceStats(req.documentId, {
            total_found: total,
            total_details_needed: detailsNeeded,
          }).catch(() => {});
        }

        // Если это ТОЛЬКО scan — возвращаем результат
        if (phase === 'scan') {
          // ВАЖНО: устанавливаем success, иначе pipeline не считает источник завершённым
          if (req.documentId) {
            await updateSourceStats(req.documentId, {
              last_parse_status: 'success',
              last_parse_error: undefined,
              last_parsed_at: new Date().toISOString(),
              total_found: total,
              total_details_needed: detailsNeeded,
            }).catch(() => {});
          }
          await logCron({
            name: `scan-${req.source}`,
            started_at: startedAt,
            finished_at: new Date().toISOString(),
            items_processed: newProperties.length,
          }).catch(() => {});
          console.log(`[parse-handler:${req.source}] SCAN RETURN: total=${total} new=${newProperties.length} detailsNeeded=${detailsNeeded}`);
          return { created: 0, filtered: preFiltered, total, detailsFetched: 0 };
        }
      }

      // ═══════════════════════════════════════════════════════════════
      // ФАЗА 2: ДЕТАЛЬНАЯ ЗАГРУЗКА
      // Чтение отфильтрованного списка + fetchDetails + createProperty
      // ═══════════════════════════════════════════════════════════════
      if (phase !== 'scan') {
        const scanFilePath = getScanFilePath(req.source, corrId);

        // Читаем результаты Phase 1
        let newProperties: any[];
        if (!existsSync(scanFilePath)) {
          console.log(`[parse-handler:${req.source}] DETAILS: no scan file, nothing to process`);
          newProperties = [];
        } else {
          newProperties = JSON.parse(readFileSync(scanFilePath, 'utf-8'));
          // Удаляем файл после чтения
          try { unlinkSync(scanFilePath); } catch {}
        }

        detailsNeeded = parser.fetchDetails ? newProperties.length : 0;
        console.log(`[parse-handler:${req.source}] DETAILS: ${newProperties.length} properties, ${detailsNeeded} need detail fetching`);

        // Один браузер + контекст на всю Phase 2 — вместо запуска на каждый объект
        let sharedBrowser: any = undefined;
        let sharedContext: any = undefined;
        if (parser.fetchDetails && newProperties.length > 0) {
          try {
            const { chromium } = await import('playwright');
            const { createStealthContext } = await import('./anti-ban');
            sharedBrowser = await chromium.launch({
              headless: true,
              args: ['--no-sandbox', '--disable-setuid-sandbox'],
            });
            sharedContext = await createStealthContext(sharedBrowser);
            console.log(`[parse-handler:${req.source}] Shared browser+context launched for ${newProperties.length} detail pages`);
          } catch (err: any) {
            logger.warn(`Failed to launch shared browser: ${err.message}. Falling back to per-request browsers.`, { correlationId: corrId });
          }
        }

        try {
          // Обрабатываем каждый объект: fetchDetails → createProperty
          for (const prop of newProperties) {
            try {
              // Загрузка детальной страницы (если парсер поддерживает)
              if (parser.fetchDetails) {
                try {
                  const details = await parser.fetchDetails(prop.url, sharedContext);
                  if (details && Object.keys(details).length > 0) {
                    // Мерждим только определённые значения — undefined не перезаписывает Phase 1 данные
                    for (const [key, value] of Object.entries(details)) {
                      if (value !== undefined && value !== null) {
                        (prop as any)[key] = value;
                      }
                    }
                    // Пересчитываем город ТОЛЬКО если он ещё не определён (other).
                    // Не перезаписываем правильно определённый город (torgi-gov regionCode, alfalot region).
                    if (prop.city === 'other' && details.address) {
                      prop.city = detectCity(details.address + ' ' + (prop.title || ''));
                    }
                    // Fallback: если город всё ещё "other", ищем во всём доступном тексте
                    if (prop.city === 'other') {
                      const searchText = [prop.title, prop.address].filter(Boolean).join(' ');
                      prop.city = detectCity(searchText);
                    }
                    detailsFetched++;
                    console.log(`[parse-handler:${req.source}] DETAIL ${detailsFetched}/${detailsNeeded}: ${prop.external_id}`);
                    // Промежуточное обновление для UI
                    if (req.documentId) {
                      updateSourceStats(req.documentId, {
                        total_details_fetched: detailsFetched,
                      }).catch(() => {});
                    }
                  }
                } catch (err: any) {
                  logger.warn(`fetchDetails failed for ${prop.url}: ${err.message}`, { correlationId: corrId });
                }
                // Антибан: пауза между детальными страницами (2-5 сек)
                await randomDelay(2000, 5000);
              }

              // Создание объекта в Strapi
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
                rules: req.rules,
              });
              if (result) created++;
              else {
                filtered++;
                if (filtered <= 5 || filtered % 50 === 0) {
                  console.log(`[parse-handler:${req.source}] FILTERED #${filtered}: ${prop.external_id}`);
                }
              }
            } catch (err: any) {
              logger.warn(`Failed: ${prop.external_id}: ${err.message}`, { correlationId: corrId });
            }
          }
        } finally {
          // ВАЖНО: закрываем browser в finally — гарантия освобождения памяти
          // даже при неожиданном исключении в цикле
          if (sharedBrowser) {
            try { await sharedBrowser.close(); } catch {}
            console.log(`[parse-handler:${req.source}] Shared browser closed`);
          }
        }

        console.log(`[parse-handler:${req.source}] DETAILS DONE: created=${created} filtered=${filtered} details=${detailsFetched}/${detailsNeeded}`);
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

    // Финальное обновление статистики источника
    if (req.documentId) {
      try {
        console.log(`[parse-handler:${req.source}] FINAL: total=${total} created=${created} filtered=${filtered} preFiltered=${preFiltered} details=${detailsFetched}/${detailsNeeded}`);
        await updateSourceStats(req.documentId, {
          last_parse_status: 'success',
          last_parse_error: undefined,
          last_parsed_at: new Date().toISOString(),
          total_created: created,
          parse_count: 1,
          total_details_fetched: detailsFetched,
          total_details_needed: detailsNeeded,
        });
      } catch (err: any) {
        logger.warn(`Stats update failed: ${err.message}`, { correlationId: corrId });
      }
    }

    console.log(`[parse-handler:${req.source}] DONE: created=${created} filtered=${filtered} preFiltered=${preFiltered} total=${total} details=${detailsFetched}/${detailsNeeded}`);
    return { created, filtered, total, detailsFetched };
  };
}
