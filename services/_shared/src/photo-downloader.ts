/**
 * Photo downloader for property listings.
 * Downloads photos from source URLs to local storage.
 * Saves to api/data/photos/{documentId}/ directory.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from './logger';

/**
 * Download photos for a property.
 * Returns array of relative paths (for serving via static middleware).
 */
export async function downloadPropertyPhotos(
  documentId: string,
  photoUrls: string[],
  basePath?: string
): Promise<string[]> {
  const photosDir = basePath || path.join(process.cwd(), 'data', 'photos', documentId);
  await fs.mkdir(photosDir, { recursive: true });

  const downloaded: string[] = [];
  for (let i = 0; i < photoUrls.length; i++) {
    try {
      const url = photoUrls[i];
      const res = await fetch(url);
      if (!res.ok) continue;

      const contentType = res.headers.get('content-type') || '';
      let ext = '.jpg';
      if (contentType.includes('png')) ext = '.png';
      else if (contentType.includes('webp')) ext = '.webp';

      const filename = `${i}${ext}`;
      const buffer = Buffer.from(await res.arrayBuffer());
      await fs.writeFile(path.join(photosDir, filename), buffer);
      downloaded.push(`/photos/${documentId}/${filename}`);
    } catch (err: any) {
      logger.warn(`Failed to download photo ${i}: ${err.message}`);
    }
  }

  return downloaded;
}
