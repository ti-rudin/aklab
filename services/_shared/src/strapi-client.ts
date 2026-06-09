/**
 * Strapi REST client для микросервисов парсинга.
 * Использует native fetch (нет axios).
 */

import { config } from './config';
import { logger } from './logger';

interface StrapiResponse<T> {
  data: T;
  meta?: any;
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
    return false;
  }
}

/**
 * Проверить, является ли объект коммерческой недвижимостью.
 * Фильтрует некоммерческие объекты (земельные участки, жильё, транспорт, оборудование и т.д.)
 */
function isCommercialProperty(props: { title: string; property_type: string; auction_type: string }): boolean {
  // Marketplace — не фильтруем (там свои правила)
  if (props.auction_type !== 'bankruptcy' && props.auction_type !== 'privatization') {
    return true;
  }

  const title = props.title.toLowerCase();

  // Ключевые слова, по которым объект точно НЕ коммерческий
  const nonCommercialPatterns = [
    // Жильё
    'жилой', 'жилого', 'жилых', 'жилом',
    'квартир', 'комната', 'комнаты', 'комнат',
    ' дом,', ' дом ', 'дома,', 'жилой дом',
    'коттедж', 'таунхаус', 'дача', 'ижс',
    // Транспорт (бренды + общие)
    'автомобил', 'легков', 'грузов', 'автобус', 'прицеп', 'мотоцикл',
    'volkswagen', 'toyota', 'ford', 'bmw', 'mercedes', 'hyundai',
    'kia', 'nissan', 'renault', 'geely', 'lexus', 'honda', 'mazda',
    'ваз ', 'lada ', 'лада',
    'vin:', 'vin\t', 'объем двигател', 'л.с.', 'л/с',
    // Оборудование и прочее
    'оборудовани', 'станок', 'прибор', 'инвентар',
    'мебел', 'мебель', 'компьютер', 'сервер', 'принтер',
  ];

  for (const pattern of nonCommercialPatterns) {
    if (title.includes(pattern)) {
      return false;
    }
  }

  // 'земельный участок' — только если рядом нет 'нежилое'
  if (title.includes('земельн') && !title.includes('нежилое')) {
    return false;
  }

  // 'доля в праве' — обычно не коммерческая недвижимость
  if (title.includes('доля в праве')) {
    return false;
  }

  return true;
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
  published_at_source?: string;
  description?: string;
  contacts?: string;
}): Promise<any> {
  if (!isCommercialProperty(props)) {
    logger.warn(`Skipping non-commercial property: "${props.title}" [${props.property_type}/${props.auction_type}] source=${props.source}`);
    return null;
  }

  const res = await fetch(`${BASE}/properties`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ data: props }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`createProperty failed (${res.status}): ${body}`);
  }
  const data = (await res.json()) as StrapiResponse<any>;
  return data.data;
}

/**
 * Обновить статистику Source после парсинга.
 * Strapi 5 REST API использует documentId, а не числовой id.
 */
export async function updateSourceStats(documentId: string, data: {
  last_parse_status?: string;
  last_parse_error?: string;
  last_parsed_at?: string;
  total_found?: number;
  total_created?: number;
  parse_count?: number;
}): Promise<void> {
  const updateData: any = {};

  if (data.last_parse_status) updateData.last_parse_status = data.last_parse_status;
  if (data.last_parse_error !== undefined) updateData.last_parse_error = data.last_parse_error;
  if (data.last_parsed_at) updateData.last_parsed_at = data.last_parsed_at;

  if (data.parse_count || data.total_found || data.total_created) {
    try {
      const res = await fetch(`${BASE}/sources/${documentId}`, { headers: HEADERS });
      if (res.ok) {
        const json = (await res.json()) as StrapiResponse<any>;
        const current = json.data;
        if (data.parse_count) updateData.parse_count = (current?.parse_count || 0) + data.parse_count;
        if (data.total_found) updateData.total_found = (current?.total_found || 0) + data.total_found;
        if (data.total_created) updateData.total_created = (current?.total_created || 0) + data.total_created;
      } else {
        logger.warn(`updateSourceStats GET failed (${res.status}) for documentId=${documentId}`);
      }
    } catch (err: any) {
      logger.warn(`updateSourceStats GET error: ${err.message}`);
    }
  }

  const putRes = await fetch(`${BASE}/sources/${documentId}`, {
    method: 'PUT',
    headers: HEADERS,
    body: JSON.stringify({ data: updateData }),
  });
  if (!putRes.ok) {
    const body = await putRes.text();
    logger.warn(`updateSourceStats PUT failed (${putRes.status}): ${body}`);
  }
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
