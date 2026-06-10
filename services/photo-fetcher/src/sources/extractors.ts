/**
 * Source-specific photo extractors for detail pages.
 * Each source has different HTML structure for displaying photos.
 */

import type { Page } from 'playwright';
import { logger } from '../utils/logger';

export interface ExtractedPhoto {
  url: string;
  alt?: string;
}

/**
 * Generic extractor — tries common patterns.
 * Works for most sites as a fallback.
 */
async function extractGeneric(page: Page): Promise<ExtractedPhoto[]> {
  return page.evaluate(() => {
    const photos: Array<{ url: string; alt?: string }> = [];
    // Try common gallery selectors
    const selectors = [
      '.gallery img', '.photos img', '.images img', '.slider img',
      '.swiper img', '.carousel img', '.lightbox img',
      '[class*="gallery"] img', '[class*="photo"] img', '[class*="image"] img',
      '.detail img', '.lot-detail img', '.property-images img',
    ];
    const seen = new Set<string>();
    for (const sel of selectors) {
      for (const img of Array.from(document.querySelectorAll(sel))) {
        const src = (img as HTMLImageElement).src;
        if (src && !src.includes('data:') && !src.includes('svg') && !src.includes('logo') && !seen.has(src)) {
          seen.add(src);
          photos.push({ url: src, alt: (img as HTMLImageElement).alt });
        }
      }
    }
    // Fallback: all large images on page (width > 200)
    if (photos.length === 0) {
      for (const img of Array.from(document.querySelectorAll('img'))) {
        const el = img as HTMLImageElement;
        if (el.naturalWidth > 200 && el.src && !el.src.includes('data:') && !el.src.includes('logo') && !seen.has(el.src)) {
          seen.add(el.src);
          photos.push({ url: el.src, alt: el.alt });
        }
      }
    }
    return photos;
  });
}

/**
 * aggregator-bankrot (.xn--p1ai) — detail page photo extraction.
 * Photos are in .lot-gallery or similar containers.
 */
async function extractAggregatorBankrot(page: Page): Promise<ExtractedPhoto[]> {
  return page.evaluate(() => {
    const photos: Array<{ url: string; alt?: string }> = [];
    const seen = new Set<string>();

    // Primary: gallery images
    const galleryImgs = document.querySelectorAll('.lot-gallery img, .lot-images img, .gallery img, .swiper img, [class*="gallery"] img');
    for (const img of Array.from(galleryImgs)) {
      const src = (img as HTMLImageElement).src;
      if (src && !src.includes('data:') && !seen.has(src)) {
        seen.add(src);
        photos.push({ url: src, alt: (img as HTMLImageElement).alt });
      }
    }

    // Fallback: all images > 300px in main content area
    if (photos.length < 2) {
      const main = document.querySelector('main, .content, .lot-detail, [class*="detail"]') || document.body;
      for (const img of Array.from(main.querySelectorAll('img'))) {
        const el = img as HTMLImageElement;
        const src = el.src;
        if (src && !src.includes('data:') && !src.includes('svg') && !src.includes('logo') &&
            !src.includes('icon') && !src.includes('thumb') && !seen.has(src) &&
            (el.naturalWidth > 200 || el.width > 200)) {
          seen.add(src);
          photos.push({ url: src, alt: el.alt });
        }
      }
    }

    return photos;
  });
}

/**
 * etprf (sale.etprf.ru) — detail page photo extraction.
 */
async function extractEtprf(page: Page): Promise<ExtractedPhoto[]> {
  return page.evaluate(() => {
    const photos: Array<{ url: string; alt?: string }> = [];
    const seen = new Set<string>();

    // etprf uses .reporttable or detail panels
    const imgs = document.querySelectorAll('.reporttable img, .lot-images img, .gallery img, [class*="photo"] img, [class*="image"] img');
    for (const img of Array.from(imgs)) {
      const src = (img as HTMLImageElement).src;
      if (src && !src.includes('data:') && !src.includes('svg') && !src.includes('logo') && !seen.has(src)) {
        seen.add(src);
        photos.push({ url: src, alt: (img as HTMLImageElement).alt });
      }
    }

    // Fallback
    if (photos.length === 0) {
      for (const img of Array.from(document.querySelectorAll('img'))) {
        const el = img as HTMLImageElement;
        if (el.naturalWidth > 200 && el.src && !el.src.includes('data:') && !el.src.includes('logo') && !seen.has(el.src)) {
          seen.add(el.src);
          photos.push({ url: el.src, alt: el.alt });
        }
      }
    }

    return photos;
  });
}

/**
 * fabrikant.ru — detail page photo extraction.
 */
async function extractFabrikant(page: Page): Promise<ExtractedPhoto[]> {
  return page.evaluate(() => {
    const photos: Array<{ url: string; alt?: string }> = [];
    const seen = new Set<string>();

    // Fabrikant uses data-slot based components
    const imgs = document.querySelectorAll('[data-slot="image"] img, [data-slot="gallery"] img, .gallery img, .swiper img, [class*="slider"] img');
    for (const img of Array.from(imgs)) {
      const src = (img as HTMLImageElement).src;
      if (src && !src.includes('data:') && !src.includes('svg') && !src.includes('logo') && !seen.has(src)) {
        seen.add(src);
        photos.push({ url: src, alt: (img as HTMLImageElement).alt });
      }
    }

    // Fallback: all large images
    if (photos.length === 0) {
      for (const img of Array.from(document.querySelectorAll('img'))) {
        const el = img as HTMLImageElement;
        if (el.naturalWidth > 200 && el.src && !el.src.includes('data:') && !el.src.includes('logo') && !seen.has(el.src)) {
          seen.add(el.src);
          photos.push({ url: el.src, alt: el.alt });
        }
      }
    }

    return photos;
  });
}

/**
 * Get the right extractor for a source.
 */
export function getExtractor(source: string): (page: Page) => Promise<ExtractedPhoto[]> {
  switch (source) {
    case 'aggregator-bankrot':
      return extractAggregatorBankrot;
    case 'etprf':
      return extractEtprf;
    case 'fabrikant':
      return extractFabrikant;
    default:
      return extractGeneric;
  }
}
