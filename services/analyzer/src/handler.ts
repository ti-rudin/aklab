import { PermanentError } from '@aklab/sqlite-queue';
import type { Job, WorkerContext } from '@aklab/sqlite-queue';
import { fetchProperty, findActiveMarketReference, fetchSetting, updateProperty, logCron } from '@aklab/service-shared';
import { logger } from './utils/logger';

// In-memory кэш для MarketReference (очищается в начале каждого batch-запуска)
const mrCache = new Map<string, any>();

export function clearMrCache() {
  mrCache.clear();
}

function getCacheKey(city: string, propertyType: string) {
  return `${city}:${propertyType}`;
}

function throwIfCancellationRequested(workerContext?: WorkerContext): void {
  if (workerContext?.isCancellationRequested() || workerContext?.isLeaseValid?.() === false) {
    throw new PermanentError('Analyze job cancelled or lease lost before the next side effect');
  }
}

async function findCachedMarketReference(city: string, propertyType: string) {
  const key = getCacheKey(city, propertyType);
  if (mrCache.has(key)) return mrCache.get(key);

  const mr = await findActiveMarketReference(city, propertyType);
  mrCache.set(key, mr);
  return mr;
}

export interface AnalyzeRequest {
  documentId: string;
  threshold?: number; // override from frontend filters
  correlationId?: string;
}

// workerContext is optional for direct/manual legacy invocations.
export async function handleAnalyzeJob(job: Job, workerContext?: WorkerContext): Promise<{ analyzed: boolean; undervalued: boolean }> {
  const req = job.data as AnalyzeRequest;
  const corrId = req.correlationId || job.correlation_id || `analyze-${Date.now()}`;
  const startedAt = new Date().toISOString();

  logger.info(`Analyzing documentId=${req.documentId}`, { correlationId: corrId });

  try {
    throwIfCancellationRequested(workerContext);
    const property = await fetchProperty(req.documentId);
    throwIfCancellationRequested(workerContext);
    if (!property) {
      logger.warn(`Property ${req.documentId} not found`, { correlationId: corrId });
      return { analyzed: false, undervalued: false };
    }

    throwIfCancellationRequested(workerContext);
    const ref = await findCachedMarketReference(property.city, property.property_type);
    throwIfCancellationRequested(workerContext);
    if (!ref) {
      logger.info(`No active MarketReference for ${property.city}/${property.property_type}`, { correlationId: corrId });
      // Помечаем как проанализированный (без эталона — не недооценён)
      throwIfCancellationRequested(workerContext);
      await updateProperty(property.documentId, {
        is_undervalued: false,
        deviation_percent: 0,
        manual_price_per_sqm: null,
      });
      throwIfCancellationRequested(workerContext);
      return { analyzed: true, undervalued: false };
    }

    // Use threshold from job data (frontend filter) or from settings
    let threshold: number = req.threshold || 0;
    if (!threshold) {
      throwIfCancellationRequested(workerContext);
      const setting = await fetchSetting();
      throwIfCancellationRequested(workerContext);
      threshold = setting?.threshold_percent || 20;
    }

    const refPrice = Number(ref.price_per_sqm);
    const actualPrice = Number(property.price_per_sqm);

    if (!actualPrice || !refPrice) {
      logger.warn(`Missing price data: actual=${actualPrice}, ref=${refPrice}`, { correlationId: corrId });
      // Помечаем как проанализированный (нет данных — не недооценён)
      throwIfCancellationRequested(workerContext);
      await updateProperty(property.documentId, {
        is_undervalued: false,
        deviation_percent: 0,
        manual_price_per_sqm: null,
      });
      throwIfCancellationRequested(workerContext);
      return { analyzed: true, undervalued: false };
    }

    const deviation = ((refPrice - actualPrice) / refPrice) * 100;
    // deviation > 0 = объект ДЕШЕВЛЕ рынка (недооценён)
    // deviation < 0 = объект ДОРОЖЕ рынка (переоценён)
    const isUndervalued = deviation > 0 && deviation >= threshold;
    const roundedDeviation = Math.round(deviation * 10) / 10;

    throwIfCancellationRequested(workerContext);
    await updateProperty(property.documentId, {
      is_undervalued: isUndervalued,
      // Всегда сохраняем реальную deviation (не 0!) — нужна для focus scoring
      deviation_percent: roundedDeviation,
      manual_price_per_sqm: isUndervalued ? refPrice : null,
    });
    throwIfCancellationRequested(workerContext);

    logger.info(`Property ${property.documentId}: deviation=${deviation.toFixed(1)}%, threshold=${threshold}%, undervalued=${isUndervalued}`, { correlationId: corrId });

    throwIfCancellationRequested(workerContext);
    await logCron({
      name: 'analyze-property',
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      items_processed: 1,
    }).catch(() => {});
    throwIfCancellationRequested(workerContext);

    return { analyzed: true, undervalued: isUndervalued };
  } catch (err: any) {
    logger.error(`Analyze failed for property ${req.documentId}: ${err.message}`, { correlationId: corrId });
    throw err;
  }
}
