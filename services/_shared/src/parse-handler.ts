import { PermanentError } from '@aklab/sqlite-queue';
import type { Job, WorkerContext } from '@aklab/sqlite-queue';
import type { SourceParser, ParseResult } from './types';
import { propertyExists, createProperty, preFilterProperty, logCron, updateSourceStats, resetSourceDetailsCounters, markParserRunSourceStageRunning, finishParserRunSourceStage } from './strapi-client';
import type { ParseRules, UserFilterSnapshot } from '@aklab/parse-rules';
import { normalizeUserFilterSnapshot, snapshotMatchesCandidate } from '@aklab/parse-rules';
import { randomDelay } from './anti-ban';
import { logger } from './logger';
import { extractAuctionEndAt } from './auction-date';
import {
  dedupeParties,
  derivePropertyRegion,
  mergePropertyLocation,
  normalizeStructuredLocation,
  projectLegacyAddress,
} from './property-location';
import {
  cleanupScanArtifact,
  LEGACY_FILTER_SNAPSHOT_HASH,
  readScanArtifact,
  writeScanArtifact,
} from './scan-artifact';

export interface ParseRequest {
  source: string;
  sourceId?: number;
  documentId?: string;
  correlationId?: string;
  depth?: number;
  /** Legacy direct-invocation rules. Pipeline-owned jobs must use filterSnapshot. */
  rules?: ParseRules;
  filterSnapshot?: UserFilterSnapshot;
  /** Если указан — выполняет только одну фазу. undefined = обе (backward compat). */
  phase?: 'scan' | 'details';
  /** Identity of the server-created telemetry row; only present for pipeline-owned jobs. */
  telemetryIdentityKey?: string;
}

/** Порог последовательных дубликатов для smart stop. */
const SMART_STOP_THRESHOLD = 10;

interface FilterContext {
  snapshot?: UserFilterSnapshot;
  hash: string;
  scope: 'all' | 'single';
  profileCount: number;
  usesSnapshot: boolean;
}

function getFilterContext(req: ParseRequest): FilterContext {
  if (req.telemetryIdentityKey !== undefined && !req.filterSnapshot) {
    throw new PermanentError('Parse job filter snapshot is required');
  }
  if (!req.filterSnapshot) {
    return {
      hash: LEGACY_FILTER_SNAPSHOT_HASH,
      scope: 'all',
      profileCount: 0,
      usesSnapshot: false,
    };
  }

  let normalized: UserFilterSnapshot;
  try {
    normalized = normalizeUserFilterSnapshot(req.filterSnapshot);
  } catch {
    throw new PermanentError('Parse job filter snapshot is invalid');
  }
  if (typeof req.filterSnapshot.hash !== 'string' || req.filterSnapshot.hash !== normalized.hash) {
    throw new PermanentError('Parse job filter snapshot hash mismatch');
  }
  return {
    snapshot: normalized,
    hash: normalized.hash,
    scope: normalized.scope,
    profileCount: normalized.profiles.length,
    usesSnapshot: true,
  };
}

function throwIfCancellationRequested(workerContext?: WorkerContext): void {
  if (workerContext?.isCancellationRequested() || workerContext?.isLeaseValid?.() === false) {
    throw new PermanentError('Parse job cancelled or lease lost before the next side effect');
  }
}

function isCancellationError(error: any): boolean {
  return error instanceof PermanentError && error.message.includes('cancelled');
}

function isInvalidPropertyLocationError(error: unknown): boolean {
  return error instanceof TypeError && error.message.startsWith('Invalid property location:');
}

/**
 * Canonicalize the only trusted geography boundary. Legacy properties remain
 * processable during the compatibility wave, but their legacy address/city
 * and coordinates are deliberately discarded instead of being certified.
 */
function canonicalizeProperty(prop: any): void {
  if (prop.property_location !== undefined) {
    const location = normalizeStructuredLocation(prop.property_location as any);
    prop.property_location = location;
    prop.address = projectLegacyAddress(location);
    prop.city = derivePropertyRegion(location);
    prop.latitude = location.latitude;
    prop.longitude = location.longitude;
  } else {
    prop.address = '';
    prop.city = 'other';
    prop.latitude = undefined;
    prop.longitude = undefined;
  }

  if (prop.parties !== undefined) {
    prop.parties = dedupeParties(prop.parties);
  }
}

function canonicalizeParsedProperties(properties: any[]): void {
  for (const prop of properties) canonicalizeProperty(prop);
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
    let filterContext: FilterContext | undefined;
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
      // Snapshot validation belongs to the terminal source-telemetry boundary:
      // a malformed pipeline job must fail closed and close its source stage.
      filterContext = getFilterContext(req);
      if (req.telemetryIdentityKey) {
        await markParserRunSourceStageRunning(req.telemetryIdentityKey, job.id);
      }
      throwIfCancellationRequested(workerContext);

      // Empty all-user snapshots are an intentional successful no-op. Do not
      // reset source counters, invoke parser.parse(), or touch Property APIs.
      if (filterContext.usesSnapshot && filterContext.profileCount === 0) {
        await finishTelemetry('success_empty');
        return { created: 0, filtered: 0, total: 0, detailsFetched: 0, detailsNeeded: 0 };
      }
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
        // Validate and canonicalize before existence checks or artifact writes.
        // A malformed typed contract must never reach property persistence.
        canonicalizeParsedProperties(properties as any[]);
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

            // Snapshot jobs apply only the technical global hard filter here.
            // User city/price/area/stop-word rules are evaluated by the canonical OR matcher.
            const preResult = preFilterProperty(prop, filterContext.usesSnapshot ? undefined : req.rules);
            if (!preResult.pass) {
              preFiltered++;
              if (preFiltered <= 10 || preFiltered % 50 === 0) {
                console.log(`[parse-handler:${req.source}] PRE-FILTER #${preFiltered}: ${prop.external_id} — ${preResult.reason}`);
              }
              continue;
            }
            if (filterContext.usesSnapshot && !snapshotMatchesCandidate(prop as any, filterContext.snapshot!, { phase: 'scan' })) {
              preFiltered++;
              if (preFiltered <= 10 || preFiltered % 50 === 0) {
                console.log(`[parse-handler:${req.source}] SNAPSHOT FILTER #${preFiltered}: ${prop.external_id}`);
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
          writeScanArtifact({
            source: req.source,
            runId: corrId,
            counters: {
              listed: total,
              eligible: newProperties.length,
              existing,
              preFiltered,
              detailsNeeded,
            },
            items: newProperties,
            filterSnapshotHash: filterContext.hash,
            scope: filterContext.scope,
            profileCount: filterContext.profileCount,
          });
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
        let artifact;
        try {
          artifact = readScanArtifact(req.source, corrId, {
            filterSnapshotHash: filterContext.hash,
            scope: filterContext.scope,
            profileCount: filterContext.profileCount,
          });
        } catch (err: any) {
          throw new PermanentError(err instanceof Error ? err.message : 'Scan artifact manifest is invalid');
        }
        const newProperties = artifact.items as any[];
        // Artifacts are a persistence boundary. Re-apply the typed contract
        // before detail fetching and snapshot filtering so legacy artifacts
        // cannot reintroduce arbitrary-text geography on retry.
        canonicalizeParsedProperties(newProperties);
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
                    if (details.property_location !== undefined) {
                      const detailLocation = normalizeStructuredLocation(details.property_location as any);
                      const location = prop.property_location
                        ? mergePropertyLocation(prop.property_location, detailLocation)
                        : detailLocation;
                      prop.property_location = location;
                      prop.address = projectLegacyAddress(location);
                      prop.city = derivePropertyRegion(location);
                      prop.latitude = location.latitude;
                      prop.longitude = location.longitude;
                    }

                    // Geography fields without a typed location are never
                    // allowed to replace the canonical scan/detail location.
                    for (const [key, value] of Object.entries(details)) {
                      if (key === 'property_location' || key === 'address' || key === 'city'
                        || key === 'latitude' || key === 'longitude' || key === 'parties') continue;
                      if (value !== undefined && value !== null) {
                        (prop as any)[key] = value;
                      }
                    }
                    if (details.parties !== undefined) {
                      prop.parties = dedupeParties([...(prop.parties ?? []), ...details.parties]);
                    }
                    detailsFetched++;
                    console.log(`[parse-handler:${req.source}] DETAIL ${detailsFetched}/${detailsNeeded}: ${prop.external_id}`);
                    // Промежуточное обновление для UI
                    if (req.documentId) {
                      throwIfCancellationRequested(workerContext);
                      const progressUpdate = updateSourceStats(req.documentId, {
                        total_details_fetched: detailsFetched,
                      });
                      if (filterContext.usesSnapshot) await progressUpdate;
                      else progressUpdate.catch(() => {});
                    }
                  }
                } catch (err: any) {
                  if (isCancellationError(err)) throw err;
                  if (isInvalidPropertyLocationError(err)) throw err;
                  if (filterContext.usesSnapshot) throw err;
                  logger.warn(`fetchDetails failed for ${prop.url}: ${err.message}`, { correlationId: corrId });
                }
                // Антибан: пауза между детальными страницами (2-5 сек)
                throwIfCancellationRequested(workerContext);
                await randomDelay(2000, 5000);
                throwIfCancellationRequested(workerContext);
              }

              if (filterContext.usesSnapshot && !snapshotMatchesCandidate(prop, filterContext.snapshot!, { phase: 'details' })) {
                filtered++;
                skipped++;
                if (filtered <= 5 || filtered % 50 === 0) {
                  console.log(`[parse-handler:${req.source}] SNAPSHOT FILTER #${filtered}: ${prop.external_id}`);
                }
                continue;
              }

              // Sources expose auction deadlines under different labels. Keep
              // the raw description for users, but persist a canonical UTC
              // expiry when an unambiguous deadline is available.
              prop.auction_end_at ??= extractAuctionEndAt(`${prop.description || ''}\n${prop.title || ''}`);

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
                auction_end_at: prop.auction_end_at,
                price_per_sqm: prop.price_per_sqm,
                property_type: prop.property_type,
                auction_type: prop.auction_type,
                published_at_source: prop.published_at,
                description: prop.description,
                contacts: prop.contacts,
                latitude: prop.latitude,
                longitude: prop.longitude,
                ...(prop.property_location !== undefined ? { property_location: prop.property_location } : {}),
                ...(prop.parties !== undefined ? { parties: prop.parties } : {}),
                rules: filterContext.usesSnapshot ? undefined : req.rules,
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
              if (isInvalidPropertyLocationError(err)) throw err;
              if (filterContext.usesSnapshot) throw err;
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
        try {
          await logCron({
            name: `parse-${req.source}`,
            started_at: startedAt,
            finished_at: new Date().toISOString(),
            items_processed: created,
            error: errorMsg,
          });
        } catch (cronError: any) {
          logger.warn(`Cron log failed: ${cronError.message}`, { correlationId: corrId });
        }
      }
    }

    // Финальное обновление статистики источника. Не проглатываем ошибку:
    // artifact должен остаться для retry до подтверждённого terminal update.
    if (req.documentId) {
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
    }

    console.log(`[parse-handler:${req.source}] DONE: created=${created} filtered=${filtered} preFiltered=${preFiltered} total=${total} details=${detailsFetched}/${detailsNeeded}`);
    await finishTelemetry(total === 0 ? 'success_empty' : 'success');
    if (phase !== 'scan') {
      // The only destructive artifact operation is immediately before a
      // successful return, after details and both terminal telemetry paths.
      cleanupScanArtifact(req.source, corrId);
    }
    return { created, filtered, total, detailsFetched, detailsNeeded };
  };
}
