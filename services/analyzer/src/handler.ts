import type { Job } from '@aklab/sqlite-queue';
import { fetchProperty, findActiveMarketReference, fetchSetting, updateProperty, logCron, downloadPropertyPhotos } from '@aklab/service-shared';
import { logger } from './utils/logger';

export interface AnalyzeRequest {
  documentId: string;
  correlationId?: string;
}

export async function handleAnalyzeJob(job: Job): Promise<{ analyzed: boolean; undervalued: boolean }> {
  const req = job.data as AnalyzeRequest;
  const corrId = req.correlationId || job.correlation_id || `analyze-${Date.now()}`;
  const startedAt = new Date().toISOString();

  logger.info(`Analyzing documentId=${req.documentId}`, { correlationId: corrId });

  try {
    const property = await fetchProperty(req.documentId);
    if (!property) {
      logger.warn(`Property ${req.documentId} not found`, { correlationId: corrId });
      return { analyzed: false, undervalued: false };
    }

    const ref = await findActiveMarketReference(property.city, property.property_type);
    if (!ref) {
      logger.info(`No active MarketReference for ${property.city}/${property.property_type}`, { correlationId: corrId });
      return { analyzed: false, undervalued: false };
    }

    const setting = await fetchSetting();
    const threshold = setting?.threshold_percent || 20;
    const refPrice = Number(ref.price_per_sqm);
    const actualPrice = Number(property.price_per_sqm);

    if (!actualPrice || !refPrice) {
      logger.warn(`Missing price data: actual=${actualPrice}, ref=${refPrice}`, { correlationId: corrId });
      return { analyzed: false, undervalued: false };
    }

    const deviation = ((refPrice - actualPrice) / refPrice) * 100;
    const isUndervalued = deviation >= threshold;

    await updateProperty(property.documentId, {
      is_undervalued: isUndervalued,
      deviation_percent: isUndervalued ? Math.round(deviation * 10) / 10 : 0,
      manual_price_per_sqm: isUndervalued ? refPrice : null,
    });

    // Download photos for undervalued properties if not already done
    if (isUndervalued && property.photo_urls && Array.isArray(property.photo_urls) && property.photo_urls.length > 0 && !property.photos_downloaded) {
      try {
        logger.info(`Downloading photos for undervalued property ${property.documentId}`, { correlationId: corrId });
        const downloadedPaths = await downloadPropertyPhotos(property.documentId, property.photo_urls);
        if (downloadedPaths.length > 0) {
          await updateProperty(property.documentId, {
            photos: downloadedPaths,
            photos_downloaded: true,
          });
          logger.info(`Downloaded ${downloadedPaths.length} photos for ${property.documentId}`, { correlationId: corrId });
        }
      } catch (err: any) {
        logger.warn(`Photo download failed for ${property.documentId}: ${err.message}`, { correlationId: corrId });
      }
    }

    logger.info(`Property ${property.documentId}: deviation=${deviation.toFixed(1)}%, undervalued=${isUndervalued}`, { correlationId: corrId });

    await logCron({
      name: 'analyze-property',
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      items_processed: 1,
    }).catch(() => {});

    return { analyzed: true, undervalued: isUndervalued };
  } catch (err: any) {
    logger.error(`Analyze failed for property ${req.documentId}: ${err.message}`, { correlationId: corrId });
    throw err;
  }
}
