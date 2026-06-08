import { config } from './config';
import { logger } from './utils/logger';

const BASE = `${config.strapi.url}/api`;
const HEADERS = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${config.strapi.apiToken}`,
};

export async function fetchProperty(id: number): Promise<any> {
  const res = await fetch(`${BASE}/properties/${id}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`fetchProperty failed (${res.status})`);
  const data = (await res.json()) as any;
  return data.data;
}

export async function findActiveMarketReference(city: string, propertyType: string): Promise<any | null> {
  const url = `${BASE}/market-references?filters[city][$eq]=${city}&filters[property_type][$eq]=${propertyType}&filters[is_active][$eq]=true&sort=effective_from:desc&pagination[limit]=1`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) return null;
  const data = (await res.json()) as any;
  return data.data?.[0] || null;
}

export async function fetchSetting(): Promise<any> {
  const res = await fetch(`${BASE}/setting`, { headers: HEADERS });
  if (!res.ok) return null;
  const data = (await res.json()) as any;
  return data.data;
}

export async function updateProperty(documentId: string, fields: Record<string, any>): Promise<void> {
  const res = await fetch(`${BASE}/properties/${documentId}`, {
    method: 'PUT',
    headers: HEADERS,
    body: JSON.stringify({ data: fields }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`updateProperty failed (${res.status}): ${body}`);
  }
}

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
