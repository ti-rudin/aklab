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
    if (!res.ok) {
      logger.warn(`propertyExists: API returned ${res.status}, fail-closed (skip)`);
      return true; // fail-closed: при ошибке API считаем что существует
    }
    const data = (await res.json()) as StrapiResponse<any[]>;
    return (data.data?.length ?? 0) > 0;
  } catch (err: any) {
    logger.warn(`propertyExists check failed: ${err.message}`);
    return true; // fail-closed: при ошибке считаем что существует (пропускаем, не дублируем)
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

  // Если парсер уже классифицировал как коммерческий тип — доверяем парсеру
  const COMMERCIAL_TYPES = ['office', 'warehouse', 'retail', 'production', 'free_purpose', 'apartment', 'land'];
  if (COMMERCIAL_TYPES.includes(props.property_type)) {
    return true;
  }

  const title = props.title.toLowerCase();

  // Ключевые слова, по которым объект точно НЕ коммерческий
  const nonCommercialPatterns = [
    // Жильё (кроме квартир — они разрешены)
    'жилой', 'жилого', 'жилых', 'жилом',
    'комната', 'комнаты', 'комнат',
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

  // Земельные участки — теперь разрешены (тип land)
  // if (title.includes('земельн') && !title.includes('нежилое')) {
  //   return false;
  // }

  // 'доля в праве' — обычно не коммерческая недвижимость
  if (title.includes('доля в праве')) {
    return false;
  }

  return true;
}

/**
 * Создать Property в Strapi.
 * Фильтрует: некоммерческие объекты + объекты без данных для расчёта цены за м².
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
  minimum_price?: number;
  price_per_sqm?: number;
  property_type: string;
  auction_type: string;
  published_at_source?: string;
  description?: string;
  contacts?: string;
  photo_urls?: string[];
  latitude?: number;
  longitude?: number;
}): Promise<any> {
  if (!isCommercialProperty(props)) {
    logger.warn(`Skipping non-commercial: "${props.title}" [${props.property_type}/${props.auction_type}] source=${props.source}`);
    return null;
  }

  // Авто-расчёт price_per_sqm если есть price и area (до API-вызовов)
  if (!props.price_per_sqm && props.price && props.area_sqm && props.area_sqm > 0) {
    props.price_per_sqm = Math.round(props.price / props.area_sqm);
  }

  // Фильтр: без цены за м² объект не нужен (до API-вызовов)
  if (!props.price_per_sqm || props.price_per_sqm <= 0) {
    logger.warn(`Skipping no-price-data: "${props.title}" price=${props.price} area=${props.area_sqm} source=${props.source}`);
    return null;
  }

  // Дедупликация — вторая линия защиты (первая в parse-handler)
  if (await propertyExists(props.source, props.external_id)) {
    logger.warn(`Skipping duplicate: "${props.title}" source=${props.source} ext=${props.external_id}`);
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
  total_details_fetched?: number;
  total_details_needed?: number;
  parse_count?: number;
}): Promise<void> {
  const updateData: any = {};

  if (data.last_parse_status) updateData.last_parse_status = data.last_parse_status;
  if (data.last_parse_error !== undefined) updateData.last_parse_error = data.last_parse_error;
  if (data.last_parsed_at) updateData.last_parsed_at = data.last_parsed_at;

  const hasFetchDelta = data.total_details_fetched !== undefined && data.total_details_fetched !== null;
  const hasNeededVal = data.total_details_needed !== undefined && data.total_details_needed !== null;

  if (data.parse_count || data.total_found || data.total_created || hasFetchDelta || hasNeededVal) {
    try {
      const res = await fetch(`${BASE}/sources/${documentId}`, { headers: HEADERS });
      if (res.ok) {
        const json = (await res.json()) as StrapiResponse<any>;
        const current = json.data;
        if (data.parse_count) updateData.parse_count = (current?.parse_count || 0) + data.parse_count;
        if (data.total_found) updateData.total_found = (current?.total_found || 0) + data.total_found;
        if (data.total_created) updateData.total_created = (current?.total_created || 0) + data.total_created;
        // total_details_fetched: прямой SET (текущее значение, не инкремент)
        if (hasFetchDelta) updateData.total_details_fetched = data.total_details_fetched;
        // total_details_needed: прямой SET (точное кол-во после existence check)
        if (hasNeededVal) updateData.total_details_needed = data.total_details_needed;
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

/** Сбросить ВСЕ счётчики перед новым запуском парсинга. */
export async function resetSourceDetailsCounters(documentId: string): Promise<void> {
  try {
    const putRes = await fetch(`${BASE}/sources/${documentId}`, {
      method: 'PUT',
      headers: HEADERS,
      body: JSON.stringify({ data: {
        total_found: 0,
        total_created: 0,
        total_details_fetched: 0,
        total_details_needed: 0,
        last_parse_status: null,
        last_parse_error: null,
      } }),
    });
    if (!putRes.ok) {
      logger.warn(`resetSourceDetailsCounters failed (${putRes.status})`);
    }
  } catch (err: any) {
    logger.warn(`resetSourceDetailsCounters error: ${err.message}`);
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

/**
 * Получить Property по documentId (для analyzer).
 */
export async function fetchProperty(documentId: string): Promise<any> {
  const res = await fetch(`${BASE}/properties/${documentId}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`fetchProperty failed (${res.status})`);
  const data = (await res.json()) as StrapiResponse<any>;
  return data.data;
}

/**
 * Найти активный MarketReference по city + property_type (для analyzer).
 */
export async function findActiveMarketReference(city: string, propertyType: string): Promise<any | null> {
  const url = `${BASE}/market-references?filters[city][$eq]=${city}&filters[property_type][$eq]=${propertyType}&filters[is_active][$eq]=true&sort=effective_from:desc&pagination[limit]=1`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) return null;
  const data = (await res.json()) as StrapiResponse<any[]>;
  return data.data?.[0] || null;
}

/**
 * Получить singleton Setting (для analyzer/digest).
 */
export async function fetchSetting(): Promise<any> {
  const res = await fetch(`${BASE}/setting`, { headers: HEADERS });
  if (!res.ok) return null;
  const data = (await res.json()) as StrapiResponse<any>;
  return data.data;
}

/**
 * Обновить Property по documentId (для analyzer).
 */
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
