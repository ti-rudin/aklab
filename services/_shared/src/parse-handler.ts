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

import { PermanentError } from '@aklab/sqlite-queue';
import type { Job, WorkerContext } from '@aklab/sqlite-queue';
import { writeFileSync, readFileSync, unlinkSync, existsSync, mkdirSync, renameSync } from 'fs';
import { createHash, randomUUID } from 'crypto';
import { tmpdir } from 'os';
import { join } from 'path';
import type { SourceParser, ParseResult } from './types';
import { propertyExists, createProperty, preFilterProperty, logCron, updateSourceStats, resetSourceDetailsCounters, markParserRunSourceStageRunning, finishParserRunSourceStage } from './strapi-client';
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
  /** Identity of the server-created telemetry row; only present for pipeline-owned jobs. */
  telemetryIdentityKey?: string;
}

/** Порог последовательных дубликатов для smart stop. */
const SMART_STOP_THRESHOLD = 10;

/** Директория для промежуточных результатов Phase 1. */
const SCAN_DIR = join(tmpdir(), 'aklab-scan');

/** Путь к файлу с результатами сканирования. */
function getScanFilePath(source: string, correlationId: string): string {
  return join(SCAN_DIR, `${source}-${correlationId}.json`);
}

const SCAN_ARTIFACT_SCHEMA_VERSION = 1;

interface ScanArtifact {
  schemaVersion: number;
  runId: string;
  source: string;
  counters: {
    listed: number;
    eligible: number;
    existing: number;
    preFiltered: number;
    detailsNeeded: number;
  };
  checksum: string;
  items: unknown[];
}

function checksumItems(items: unknown[]): string {
  return createHash('sha256').update(JSON.stringify(items)).digest('hex');
}

function writeScanArtifact(source: string, runId: string, counters: ScanArtifact['counters'], items: unknown[]): void {
  mkdirSync(SCAN_DIR, { recursive: true });
  const artifact: ScanArtifact = {
    schemaVersion: SCAN_ARTIFACT_SCHEMA_VERSION,
    runId,
    source,
    counters,
    checksum: checksumItems(items),
    items,
  };
  const target = getScanFilePath(source, runId);
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(artifact), 'utf-8');
    renameSync(temporary, target);
  } catch (error) {
    try { unlinkSync(temporary); } catch {}
    throw error;
  }
}

function readScanArtifact(source: string, runId: string): ScanArtifact {
  const scanFilePath = getScanFilePath(source, runId);
  if (!existsSync(scanFilePath)) {
    throw new PermanentError(`Scan artifact is missing for ${source} (${runId})`);
  }

  let artifact: unknown;
  try {
    artifact = JSON.parse(readFileSync(scanFilePath, 'utf-8'));
  } catch (error: any) {
    throw new PermanentError(`Scan artifact manifest is invalid for ${source}: ${error.message}`);
  }

  const candidate = artifact as Partial<ScanArtifact>;
  if (
    !candidate ||
    candidate.schemaVersion !== SCAN_ARTIFACT_SCHEMA_VERSION ||
    candidate.runId !== runId ||
    candidate.source !== source ||
    !Array.isArray(candidate.items) ||
    typeof candidate.checksum !== 'string' ||
    checksumItems(candidate.items) !== candidate.checksum
  ) {
    throw new PermanentError(`Scan artifact manifest is invalid for ${source} (${runId})`);
  }

  try { unlinkSync(scanFilePath); } catch {}
  return candidate as ScanArtifact;
}

function throwIfCancellationRequested(workerContext?: WorkerContext): void {
  if (workerContext?.isCancellationRequested() || workerContext?.isLeaseValid?.() === false) {
    throw new PermanentError('Parse job cancelled or lease lost before the next side effect');
  }
}

function isCancellationError(error: any): boolean {
  return error instanceof PermanentError && error.message.includes('cancelled');
}

/**
 * Создаёт generic handler для парсера.
 * Каждый парсер передаёт свой экземпляр SourceParser.
 */
export function createParseHandler(parser: SourceParser) {
  // workerContext is optional for direct/manual legacy invocations of parser handlers.
  return async function handleParseJob(job: Job, workerContext?: WorkerContext): Promise<ParseResult> {
    const req = job.data as ParseRequest;
    const corrId = req.correlationId || job.correlation_id || `parse-${Date.now()}`;
    const depth = req.depth ?? 20;
    const startedAt = new Date().toISOString();
    let total = 0, created = 0, filtered = 0, preFiltered = 0, detailsFetched = 0, detailsNeeded = 0;
    let existing = 0, detailsAttempted = 0, detailsOk = 0, skipped = 0, itemFailures = 0;
    let telemetrySent = false;
    const finishTelemetry = async (status: 'success' | 'success_empty' | 'failed' | 'cancelled', errorMessage?: string) => {
      if (!req.telemetryIdentityKey || telemetrySent) return;
      await finishParserRunSourceStage(req.telemetryIdentityKey, {
        job_id: job.id,
        status,
        counters: {
          listed: total,
          eligible: Math.max(0, total - existing - preFiltered),
          existing,
          pre_filtered: preFiltered,
          details_attempted: detailsAttempted,
          details_ok: detailsOk,
          created,
          skipped,
          failed: itemFailures,
        },
        ...(errorMessage ? { error_message: errorMessage.slice(0, 1_000) } : {}),
      });
      telemetrySent = true;
    };
    let errorMsg: string | undefined;
    let cancelled = false;

    const phase: string | undefined = req.phase; // undefined = обе фазы

    try {
      if (req.telemetryIdentityKey) {
        await markParserRunSourceStageRunning(req.telemetryIdentityKey, job.id);
      }
      throwIfCancellationRequested(workerContext);
      // ═══════════════════════════════════════════════════════════════
      // ФАЗА 1: СКАНИРОВАНИЕ
      // Парсинг списков + дедупликация + предфильтр
      // Результат: файл с отфильтрованным списком объектов
      // ═══════════════════════════════════════════════════════════════
      if (phase !== 'details') {
        // Сброс счётчиков перед новым запуском
        if (req.documentId) {
          throwIfCancellationRequested(workerContext);
          console.log(`[parse-handler:${req.source}] SCAN: resetting counters`);
          await resetSourceDetailsCounters(req.documentId);
          throwIfCancellationRequested(workerContext);
        }

        // Парсинг списков (без загрузки деталей)
        throwIfCancellationRequested(workerContext);
        const properties = await parser.parse(depth);
        throwIfCancellationRequested(workerContext);
        total = properties.length;
        console.log(`[parse-handler:${req.source}] SCAN: parsed ${total} items (depth=${depth})`);

        // Дедупликация + предфильтр — собираем только новые и проходящие фильтры
        const newProperties: typeof properties = [];
        let consecutiveDuplicates = 0;

        for (const prop of properties) {
          throwIfCancellationRequested(workerContext);
          // Depth limit
          if (newProperties.length >= depth) break;

          try {
            // Проверка дубликата в Strapi
            throwIfCancellationRequested(workerContext);
            if (await propertyExists(req.source, prop.external_id)) {
              throwIfCancellationRequested(workerContext);
              existing++;
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
            throwIfCancellationRequested(workerContext);
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
            if (isCancellationError(err)) throw err;
            logger.warn(`Existence check failed: ${prop.external_id}: ${err.message}`, { correlationId: corrId });
          }
        }

        detailsNeeded = parser.fetchDetails ? newProperties.length : 0;
        console.log(`[parse-handler:${req.source}] SCAN DONE: total=${total} new=${newProperties.length} preFiltered=${preFiltered} detailsNeeded=${detailsNeeded}`);

        // Сохраняем отфильтрованный список для Phase 2 как атомарный manifest.
        try {
          throwIfCancellationRequested(workerContext);
          writeScanArtifact(req.source, corrId, {
            listed: total,
            eligible: newProperties.length,
            existing,
            preFiltered,
            detailsNeeded,
          }, newProperties);
          console.log(`[parse-handler:${req.source}] SCAN: artifact saved for ${corrId}`);
        } catch (err: any) {
          if (isCancellationError(err)) throw err;
          logger.error(`Failed to save scan results: ${err.message}`, { correlationId: corrId });
          throw new PermanentError(`Failed to write scan artifact for ${req.source}: ${err.message}`);
        }

        // Обновляем статистику источника (Phase 1 результат)
        if (req.documentId) {
          throwIfCancellationRequested(workerContext);
          await updateSourceStats(req.documentId, {
            total_found: total,
            total_details_needed: detailsNeeded,
          }).catch(() => {});
          throwIfCancellationRequested(workerContext);
        }

        // Если это ТОЛЬКО scan — возвращаем результат
        if (phase === 'scan') {
          // ВАЖНО: устанавливаем success, иначе pipeline не считает источник завершённым
          if (req.documentId) {
            throwIfCancellationRequested(workerContext);
            // Counters were written once above; this update is status-only.
            await updateSourceStats(req.documentId, {
              last_parse_status: 'success',
              last_parse_error: undefined,
              last_parsed_at: new Date().toISOString(),
            }).catch(() => {});
            throwIfCancellationRequested(workerContext);
          }
          throwIfCancellationRequested(workerContext);
          await logCron({
            name: `scan-${req.source}`,
            started_at: startedAt,
            finished_at: new Date().toISOString(),
            items_processed: newProperties.length,
          }).catch(() => {});
          console.log(`[parse-handler:${req.source}] SCAN RETURN: total=${total} new=${newProperties.length} detailsNeeded=${detailsNeeded}`);
          await finishTelemetry(total === 0 ? 'success_empty' : 'success');
          return { created: 0, filtered: preFiltered, total, detailsFetched: 0, detailsNeeded };
        }
      }

      // ═══════════════════════════════════════════════════════════════
      // ФАЗА 2: ДЕТАЛЬНАЯ ЗАГРУЗКА
      // Чтение отфильтрованного списка + fetchDetails + createProperty
      // ═══════════════════════════════════════════════════════════════
      if (phase !== 'scan') {
        throwIfCancellationRequested(workerContext);
        const artifact = readScanArtifact(req.source, corrId);
        const newProperties = artifact.items as any[];
        total = artifact.counters.listed;
        existing = artifact.counters.existing;
        preFiltered = artifact.counters.preFiltered;
        detailsNeeded = artifact.counters.detailsNeeded;
        throwIfCancellationRequested(workerContext);

        detailsNeeded = parser.fetchDetails ? newProperties.length : 0;
        console.log(`[parse-handler:${req.source}] DETAILS: ${newProperties.length} properties, ${detailsNeeded} need detail fetching`);

        // Один браузер + контекст на всю Phase 2 — вместо запуска на каждый объект
        let sharedBrowser: any = undefined;
        let sharedContext: any = undefined;
        if (parser.fetchDetails && newProperties.length > 0) {
          try {
            throwIfCancellationRequested(workerContext);
            const { chromium } = await import('playwright');
            const { createStealthContext } = await import('./anti-ban');
            sharedBrowser = await chromium.launch({
              headless: true,
              args: ['--no-sandbox', '--disable-setuid-sandbox'],
            });
            sharedContext = await createStealthContext(sharedBrowser);
            throwIfCancellationRequested(workerContext);
            console.log(`[parse-handler:${req.source}] Shared browser+context launched for ${newProperties.length} detail pages`);
          } catch (err: any) {
            if (isCancellationError(err)) {
              if (sharedContext) {
                try { await sharedContext.close(); } catch {}
              }
              if (sharedBrowser) {
                try { await sharedBrowser.close(); } catch {}
              }
              throw err;
            }
            logger.warn(`Failed to launch shared browser: ${err.message}. Falling back to per-request browsers.`, { correlationId: corrId });
          }
        }

        try {
          // Обрабатываем каждый объект: fetchDetails → createProperty
          for (const prop of newProperties) {
            throwIfCancellationRequested(workerContext);
            try {
              // Загрузка детальной страницы (если парсер поддерживает)
              if (parser.fetchDetails) {
                try {
                  detailsAttempted++;
                  throwIfCancellationRequested(workerContext);
                  const details = await parser.fetchDetails(prop.url, sharedContext);
                  detailsOk++;
                  throwIfCancellationRequested(workerContext);
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
                      throwIfCancellationRequested(workerContext);
                      updateSourceStats(req.documentId, {
                        total_details_fetched: detailsFetched,
                      }).catch(() => {});
                    }
                  }
                } catch (err: any) {
                  if (isCancellationError(err)) throw err;
                  logger.warn(`fetchDetails failed for ${prop.url}: ${err.message}`, { correlationId: corrId });
                }
                // Антибан: пауза между детальными страницами (2-5 сек)
                throwIfCancellationRequested(workerContext);
                await randomDelay(2000, 5000);
                throwIfCancellationRequested(workerContext);
              }

              // Создание объекта в Strapi
              throwIfCancellationRequested(workerContext);
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
              throwIfCancellationRequested(workerContext);
              if (result) created++;
              else {
                filtered++;
                skipped++;
                if (filtered <= 5 || filtered % 50 === 0) {
                  console.log(`[parse-handler:${req.source}] FILTERED #${filtered}: ${prop.external_id}`);
                }
              }
            } catch (err: any) {
              if (isCancellationError(err)) throw err;
              itemFailures++;
              logger.warn(`Failed: ${prop.external_id}: ${err.message}`, { correlationId: corrId });
            }
          }
        } finally {
          // ВАЖНО: закрываем browser в finally — гарантия освобождения памяти
          // even if a detail request or cancellation path throws.
          if (sharedContext) {
            try { await sharedContext.close(); } catch {}
          }
          if (sharedBrowser) {
            try { await sharedBrowser.close(); } catch {}
            console.log(`[parse-handler:${req.source}] Shared browser closed`);
          }
        }

        console.log(`[parse-handler:${req.source}] DETAILS DONE: created=${created} filtered=${filtered} details=${detailsFetched}/${detailsNeeded}`);
      }

    } catch (err: any) {
      cancelled = isCancellationError(err);
      errorMsg = err.message;
      if (!cancelled) logger.error(`Parse failed: ${err.message}`, { correlationId: corrId });
      if (req.documentId && !cancelled) {
        await updateSourceStats(req.documentId, {
          last_parse_status: 'error',
          last_parse_error: err.message,
          last_parsed_at: new Date().toISOString(),
        }).catch(() => {});
      }
      try {
        await finishTelemetry(cancelled ? 'cancelled' : 'failed', err.message);
      } catch (telemetryError: any) {
        logger.warn(`Telemetry terminal update failed: ${telemetryError.message}`, { correlationId: corrId });
      }
      throw err;
    } finally {
      // Cancellation is a cooperative queue outcome, not a late cron-side effect.
      if (!cancelled) {
        await logCron({
          name: `parse-${req.source}`,
          started_at: startedAt,
          finished_at: new Date().toISOString(),
          items_processed: created,
          error: errorMsg,
        }).catch(() => {});
      }
    }

    // Финальное обновление статистики источника
    if (req.documentId) {
      try {
        throwIfCancellationRequested(workerContext);
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
        throwIfCancellationRequested(workerContext);
      } catch (err: any) {
        if (isCancellationError(err)) throw err;
        logger.warn(`Stats update failed: ${err.message}`, { correlationId: corrId });
      }
    }

    console.log(`[parse-handler:${req.source}] DONE: created=${created} filtered=${filtered} preFiltered=${preFiltered} total=${total} details=${detailsFetched}/${detailsNeeded}`);
    await finishTelemetry(total === 0 ? 'success_empty' : 'success');
    return { created, filtered, total, detailsFetched, detailsNeeded };
  };
}
