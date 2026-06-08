import { config } from './config';
import { logger } from './utils/logger';

const BASE = `${config.strapi.url}/api`;
const HEADERS = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${config.strapi.apiToken}`,
};

export async function fetchUndervaluedProperties(): Promise<any[]> {
  const since = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
  const url = `${BASE}/properties?filters[is_undervalued][$eq]=true&filters[status][$ne]=rejected&filters[createdAt][$gte]=${since}&sort=deviation_percent:desc&pagination[limit]=50`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) return [];
  const data = (await res.json()) as any;
  return data.data || [];
}

export async function fetchSetting(): Promise<any> {
  const res = await fetch(`${BASE}/setting`, { headers: HEADERS });
  if (!res.ok) return null;
  const data = (await res.json()) as any;
  return data.data;
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
