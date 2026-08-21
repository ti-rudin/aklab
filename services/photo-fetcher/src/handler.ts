/**
 * Photo fetch handler — downloads photos from detail pages for undervalued properties.
 *
 * Flow:
 * 1. Receive { documentId, url, source } from queue
 * 2. Launch Playwright, navigate to detail page
 * 3. Extract photos using source-specific extractor
 * 4. Download photos to the configured private root ({root}/{documentId}/)
 * 5. Update property in Strapi with photos + photos_downloaded: true
 */

import type { Browser } from 'playwright';
import { PermanentError } from '@aklab/sqlite-queue';
import type { Job } from '@aklab/sqlite-queue';
import * as fs from 'fs/promises';
import { fetchProperty, updateProperty, logCron } from '@aklab/service-shared';
import { config } from './config';
import { resolvePhotoDirectory, resolvePhotoPath } from './photo-storage';
import { logger } from './utils/logger';
import { fetchPhotoWithRetry } from './photo-download';
import { getExtractor, type ExtractedPhoto } from './sources/extractors';
import { extractTorgiPhotos } from './sources/torgi-gov';
import {
  assertAllowedDetailUrl,
  fetchPublicImage,
  installDetailNavigationGuard,
  readValidatedImage,
} from './ssrf';

export interface PhotoFetchRequest {
  documentId: string;
  url: string;
  source: string;
  correlationId?: string;
  origin?: 'user';
  stage?: 'photo_fetch';
  runId?: never;
}

function validatePhotoProvenance(value: unknown): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PermanentError('Invalid photo provenance');
  }
  const req = value as Record<string, unknown>;
  const hasProvenance = ['origin', 'stage', 'runId'].some(key => Object.prototype.hasOwnProperty.call(req, key));
  if (!hasProvenance) return;
  if (
    req.origin !== 'user'
    || req.stage !== 'photo_fetch'
    || Object.prototype.hasOwnProperty.call(req, 'runId')
  ) {
    throw new PermanentError('Invalid photo provenance');
  }
}

const MAX_PHOTOS = 20;
const PAGE_TIMEOUT = 45000;

export async function handlePhotoFetchJob(job: Job): Promise<{ fetched: boolean; count: number }> {
  validatePhotoProvenance(job.data);
  const req = job.data as PhotoFetchRequest;
  const corrId = req.correlationId || job.correlation_id || `photo-${Date.now()}`;
  const startedAt = new Date().toISOString();

  logger.info(`Fetching photos for ${req.documentId} (${req.source})`, { correlationId: corrId });

  // Check if already downloaded
  const property = await fetchProperty(req.documentId).catch(() => null);
  if (!property) {
    logger.warn(`Property ${req.documentId} not found`, { correlationId: corrId });
    return { fetched: false, count: 0 };
  }
  if (property.photos_downloaded) {
    logger.info(`Photos already downloaded for ${req.documentId}`, { correlationId: corrId });
    return { fetched: false, count: 0 };
  }

  let browser: Browser | undefined;

  try {
    // The request payload can originate from a Property record. Validate it
    // before either the source API or Chromium sees it.
    const detailUrl = await assertAllowedDetailUrl(req.url, req.source);
    let photos: ExtractedPhoto[];

    if (req.source === 'torgi-gov') {
      // Chromium does not use NODE_EXTRA_CA_CERTS and rejects the Russian CA
      // chain. The official lot API exposes stable file IDs, so use it directly
      // and let Node verify TLS with the configured Russian CA bundle.
      logger.info(`Loading Torgi lot media API for ${detailUrl}`, { correlationId: corrId });
      photos = await extractTorgiPhotos(detailUrl);
    } else {
      const { chromium } = await import('playwright');
      browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        locale: 'ru-RU',
        // Route interception does not reliably govern Service Worker egress.
        serviceWorkers: 'block',
      });
      const page = await context.newPage();
      await installDetailNavigationGuard(page, req.source);

      logger.info(`Loading ${detailUrl}`, { correlationId: corrId });
      await page.goto(detailUrl.toString(), { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT });
      await page.waitForTimeout(3000);

      const extractor = getExtractor(req.source);
      photos = await extractor(page);
    }
    logger.info(`Found ${photos.length} photos on detail page`, { correlationId: corrId });

    if (photos.length === 0) {
      // Mark as downloaded even if no photos found (avoid retries)
      await updateProperty(req.documentId, { photos_downloaded: true });
      logger.info(`No photos found for ${req.documentId} — marked as downloaded`, { correlationId: corrId });
      return { fetched: false, count: 0 };
    }

    // Both API reader and worker writer use <root>/<documentId>/<filename>.
    const storageEnv = { PRIVATE_PHOTO_ROOT: config.photoStorage.root };
    const photosDir = resolvePhotoDirectory(req.documentId, storageEnv);
    await fs.mkdir(photosDir, { recursive: true });

    const downloaded: string[] = [];
    const toDownload = photos.slice(0, MAX_PHOTOS);

    for (let i = 0; i < toDownload.length; i++) {
      try {
        const photo = toDownload[i];
        const res = await fetchPhotoWithRetry(photo.url, fetchPublicImage);
        if (!res.ok) {
          logger.warn(`Photo ${i} fetch failed (${res.status}): ${photo.url}`, { correlationId: corrId });
          continue;
        }

        const { buffer, extension } = await readValidatedImage(res);
        const filename = `${i}${extension}`;
        await fs.writeFile(resolvePhotoPath(req.documentId, filename, storageEnv), buffer);
        downloaded.push(`/photos/${req.documentId}/${filename}`);
      } catch (err: any) {
        logger.warn(`Photo ${i} download error: ${err.message}`, { correlationId: corrId });
      }
    }

    // Update property
    if (downloaded.length > 0) {
      await updateProperty(req.documentId, {
        photos: downloaded,
        photos_downloaded: true,
      });
      logger.info(`Saved ${downloaded.length} photos for ${req.documentId}`, { correlationId: corrId });
    } else {
      // A page with no extracted images is a confirmed empty result; download
      // failures are not. Keep the property retryable and remove the empty
      // directory rather than permanently recording a false success. Throw so
      // sqlite-queue performs its configured retries.
      await fs.rm(photosDir, { recursive: true, force: true }).catch(() => {});
      throw new Error(`All photo downloads failed for ${req.documentId}`);
    }

    await logCron({
      name: `photo-fetch-${req.source}`,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      items_processed: downloaded.length,
    }).catch(() => {});

    return { fetched: downloaded.length > 0, count: downloaded.length };
  } catch (err: any) {
    logger.error(`Photo fetch failed for ${req.documentId}: ${err.message}`, { correlationId: corrId });
    await logCron({
      name: `photo-fetch-${req.source}`,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      items_processed: 0,
      error: err.message,
    }).catch(() => {});
    throw err;
  } finally {
    await browser?.close();
  }
}
