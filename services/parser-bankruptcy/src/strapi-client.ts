/**
 * Strapi REST client для parser-bankruptcy.
 * Использует native fetch (нет axios).
 */

import { config } from './config';
import { logger } from './utils/logger';

interface StrapiResponse<T> {
  data: T;
  meta?: any;
}

interface StrapiProperty {
  id: number;
  documentId: string;
  source: string;
  external_id: string;
  url: string;
  title: string;
  address: string;
  city: string;
  area_sqm: number | null;
  price: number | null;
  price_per_sqm: number | null;
  property_type: string;
  auction_type: string;
  status: string;
  is_undervalued: boolean | null;
  published_at: string | null;
  description: string | null;
  contacts: string | null;
}

const BASE = `${config.strapi.url}/api`;
const HEADERS = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${config.strapi.apiToken}`,
};

/**
 * Проверить, существует ли Property с данным source + external_id.
 */
export async function propertyExists(source: string, externalId: string): Promise<boolean> {
  try {
    const url = `${BASE}/properties?filters[source][$eq]=${source}&filters[external_id][$eq]=${externalId}&pagination[limit]=1`;
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) return false;
    const data = (await res.json()) as StrapiResponse<any[]>;
    return (data.data?.length ?? 0) > 0;
  } catch (err: any) {
    logger.warn(`propertyExists check failed: ${err.message}`);
    return false; // fail-open: при ошибке проверки — не блокируем вставку
  }
}

/**
 * Создать Property в Strapi.
 */
export async function createProperty(props: {
  source: string;
  external_id: string;
  url: string;
  title: string;
  address: string;
  city: string;
  area_sqm?: number;
  price?: number;
  price_per_sqm?: number;
  property_type: string;
  auction_type: string;
  published_at?: string;
  description?: string;
  contacts?: string;
}): Promise<StrapiProperty> {
  const res = await fetch(`${BASE}/properties`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ data: props }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`createProperty failed (${res.status}): ${body}`);
  }
  const data = (await res.json()) as StrapiResponse<StrapiProperty>;
  return data.data;
}

/**
 * Записать CronLog.
 */
export async function logCron(entry: {
  name: string;
  started_at: string;
  finished_at: string;
  items_processed: number;
  error?: string;
}): Promise<void> {
  try {
    await fetch(`${BASE}/cron-logs`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ data: entry }),
    });
  } catch (err: any) {
    logger.warn(`logCron failed: ${err.message}`);
  }
}
