/**
 * torgi.gov.ru — ГИС Торги, реестр лотов.
 *
 * Публичный JSON API:
 *   GET /new/api/public/lotcards/search?lotStatus=PUBLISHED,APPLICATIONS_SUBMISSION&size=N
 *
 * Фильтрация по региону — в коде (API параметр subjectRFCode не работает).
 * Регион = 77 (Москва), 50 (МО).
 */

import {
  classifyPropertyType,
  createParserExtractionDiagnostics,
  derivePropertyRegion,
  normalizeStructuredLocation,
  parseAuctionEndAt,
  parserHttpError,
  projectLegacyAddress,
  safeParserErrorCode,
} from '@aklab/service-shared';
import type { ParserDetailResult, PropertyLocation, SourceParser, ParsedProperty } from '@aklab/service-shared';
import { logger, randomDelay } from '@aklab/service-shared';

const API_URL = 'https://torgi.gov.ru/new/api/public/lotcards/search';
const PUBLIC_LOT_URL = 'https://torgi.gov.ru/new/public/lots/lot';
const MAX_PAGES = 30; // API отдаёт 10 на страницу (size игнорирует), 30 стр = 300 items
const ITEMS_PER_PAGE = 10;
const REQUEST_MAX_ATTEMPTS = 3;
const REQUEST_BASE_DELAY_MS = 1_000;
const REQUEST_TIMEOUT_MS = 30_000;

const MONITORED_REGION_CODES = new Set(['77', '50', '69']);

type FetchImplementation = (url: string, init?: RequestInit) => Promise<Response>;
type Sleep = (ms: number) => Promise<void>;

const sleepDefault: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isTransientHttpStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export async function fetchTorgiResponseWithRetry(
  url: string,
  fetchImpl: FetchImplementation = fetch,
  sleep: Sleep = sleepDefault,
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= REQUEST_MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetchImpl(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!isTransientHttpStatus(response.status) || attempt === REQUEST_MAX_ATTEMPTS) {
        return response;
      }
      logger.warn(`[torgi-gov] transient HTTP ${response.status}; retry ${attempt}/${REQUEST_MAX_ATTEMPTS}`);
      await response.body?.cancel().catch(() => {});
    } catch (error) {
      lastError = error;
      if (attempt === REQUEST_MAX_ATTEMPTS) throw error;
      logger.warn(`[torgi-gov] transient request failure (${safeParserErrorCode(error)}); retry ${attempt}/${REQUEST_MAX_ATTEMPTS}`);
    }

    await sleep(REQUEST_BASE_DELAY_MS * attempt);
  }

  throw lastError instanceof Error ? lastError : new Error('Torgi request failed');
}

export function isMonitoredTorgiRegion(regionCode: string): boolean {
  return MONITORED_REGION_CODES.has(regionCode);
}

export function buildTorgiLotUrl(lotId: string): string {
  return `${PUBLIC_LOT_URL}/${lotId}`;
}

export function extractTorgiLotId(url: string): string | undefined {
  return url.match(/\/lots\/lot\/(\d+_\d+)(?:[/?#]|$)/)?.[1];
}

/** `biddEndTime` is the explicit application deadline returned by the detail API. */
export function extractTorgiAuctionEndAt(data: { biddEndTime?: unknown; [key: string]: unknown }): string | undefined {
  return typeof data.biddEndTime === 'string' ? parseAuctionEndAt(data.biddEndTime) : undefined;
}

function structuredText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function structuredCoordinate(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : undefined;
  }
  return undefined;
}

/**
 * Extract property geography from the current lot's named API fields only.
 *
 * `lotDescription`, `lotName`, organizer fields and `subjectName` are never
 * treated as a full address. `subjectRFCode`/`subjectName` are used only for
 * confirmed region-only provenance when no lot address field is present.
 */
export function extractTorgiPropertyLocation(item: Record<string, unknown>): PropertyLocation {
  const estateAddress = structuredText(item.estateAddress);
  const lotAddress = structuredText(item.lotAddress);
  const address = estateAddress ?? lotAddress;
  const addressPath = estateAddress ? 'lot.estateAddress' : 'lot.lotAddress';
  const regionCode = structuredText(item.subjectRFCode);
  const region = structuredText(item.subjectName);
  const point = item.point && typeof item.point === 'object'
    ? item.point as Record<string, unknown>
    : undefined;
  const latitude = structuredCoordinate(point?.lat);
  const longitude = structuredCoordinate(point?.lon);
  const coordinates = latitude !== undefined && longitude !== undefined
    ? { latitude, longitude }
    : {};

  if (address) {
    return normalizeStructuredLocation({
      address,
      ...(region ? { region } : {}),
      ...(regionCode ? { region_code: regionCode } : {}),
      ...coordinates,
      status: 'confirmed_address',
      source_kind: 'api_field',
      source_path: addressPath,
    });
  }

  if (region || regionCode || Object.keys(coordinates).length > 0) {
    return normalizeStructuredLocation({
      ...(region ? { region } : {}),
      ...(regionCode ? { region_code: regionCode } : {}),
      ...coordinates,
      status: 'confirmed_region_only',
      source_kind: 'api_field',
      source_path: regionCode ? 'lot.subjectRFCode' : region ? 'lot.subjectName' : 'lot.point',
    });
  }

  return normalizeStructuredLocation({
    status: 'missing',
    source_kind: 'api_field',
    source_path: 'lot.estateAddress|lot.lotAddress',
  });
}

export function createTorgiParserDiagnostics(
  item: Record<string, unknown>,
  propertyLocation: PropertyLocation,
) {
  const knownSignals = [
    ['lotDescription', 'property.description'],
    ['lotName', 'property.name'],
    ['estateAddress', 'property.location.address'],
    ['lotAddress', 'property.location.address'],
    ['subjectRFCode', 'property.location.region'],
    ['biddEndTime', 'property.auction_end'],
  ] as const;
  const semanticSignals = knownSignals
    .filter(([key]) => Object.prototype.hasOwnProperty.call(item, key))
    .map(([, signal]) => signal);
  const propertyBlockFound = semanticSignals.length > 0;
  const locationLabelId = propertyLocation.status === 'confirmed_address'
    ? 'property.location.address'
    : propertyLocation.status === 'confirmed_region_only'
      ? 'property.location.region'
      : undefined;
  return createParserExtractionDiagnostics({
    adapterVersion: 'torgi-gov.v1',
    propertyBlockFound,
    ...(locationLabelId ? { locationLabelId } : {}),
    ...(!locationLabelId && propertyBlockFound ? { schemaMismatch: 'location_label_missing' as const } : {}),
    semanticSignals,
  });
}

export class TorgiGovParser implements SourceParser {
  name = 'torgi-gov';

  async parse(depth?: number): Promise<ParsedProperty[]> {
    logger.info('[torgi-gov] Starting parse...');
    const allProperties: ParsedProperty[] = [];

    const searchQueries = [
      'нежилое помещение',
      'нежилое здание',
      'офисное помещение',
      'торговое помещение',
      'складское помещение',
    ];

    for (const query of searchQueries) {
      try {
        const properties = await this.searchQuery(query, depth);
        allProperties.push(...properties);
      } catch (err: any) {
        logger.warn(`[torgi-gov] Search failed: ${safeParserErrorCode(err)}`);
        throw err;
      }
      // Пауза между поисковыми запросами (3-6 сек)
      await randomDelay(3000, 6000);
    }

    const seen = new Set<string>();
    const unique = allProperties.filter(p => {
      if (seen.has(p.external_id)) return false;
      seen.add(p.external_id);
      return true;
    });

    logger.info(`[torgi-gov] Total: ${unique.length} unique properties`);
    return unique;
  }

  async fetchDetails(url: string): Promise<ParserDetailResult> {
    // torgi.gov.ru — Angular SPA, HTML пустой. Используем JSON API.
    // URL: https://torgi.gov.ru/new/public/lots/lot/{noticeNumber}_{lotNumber}
    // API: GET https://torgi.gov.ru/new/api/public/lotcards/{noticeNumber}_{lotNumber}

    try {
      const lotId = extractTorgiLotId(url);
      if (!lotId) {
        throw new Error('Invalid Torgi lot identifier');
      }

      const apiUrl = `https://torgi.gov.ru/new/api/public/lotcards/${lotId}`;

      logger.info(`[torgi-gov] fetchDetails via JSON API: ${apiUrl}`);

      const response = await fetchTorgiResponseWithRetry(apiUrl);

      if (!response.ok) {
        throw parserHttpError(response.status);
      }

      const data = await response.json() as any;

      // Описание
      const description = data.lotDescription || data.lotName || undefined;

      const property_location = extractTorgiPropertyLocation(data);

      // Контакты: организатор торгов
      const contacts = data.depositRecipientName || undefined;
      const auction_end_at = extractTorgiAuctionEndAt(data);

      return {
        description,
        contacts,
        property_location,
        parser_diagnostics: createTorgiParserDiagnostics(data, property_location),
        address: projectLegacyAddress(property_location),
        city: derivePropertyRegion(property_location),
        latitude: property_location.latitude,
        longitude: property_location.longitude,
        auction_end_at,
      };
    } catch (err: any) {
      logger.warn(`[torgi-gov] fetchDetails failed (${safeParserErrorCode(err)})`);
      throw err;
    }
  }

  private async searchQuery(query: string, depth?: number): Promise<ParsedProperty[]> {
    const results: ParsedProperty[] = [];
    const maxPages = depth ? Math.ceil(depth / ITEMS_PER_PAGE) : MAX_PAGES;
    let consecutiveOld = 0; // счётчик страниц без свежих объектов

    for (let page = 0; page < maxPages; page++) {
      const params = new URLSearchParams({
        lotStatus: 'PUBLISHED,APPLICATIONS_SUBMISSION',
        text: query,
        size: '10', // API всегда отдаёт 10, параметр формальный
        sort: 'firstVersionPublicationDate,desc',
        withFacets: 'false',
        page: String(page),
      });

      const url = `${API_URL}?${params}`;
      logger.info(`[torgi-gov] Fetching: ${query} (page ${page})`);

      // Пауза между запросами (имитация человека, 2-5 сек)
      if (page > 0) {
        await randomDelay(2000, 5000);
      }

      const response = await fetchTorgiResponseWithRetry(url);

      if (!response.ok) {
        throw parserHttpError(response.status);
      }

      const data = await response.json() as any;
      const items = data?.content || [];

      if (!items.length) break;

      let pageNewCount = 0;

      for (const item of items) {
        const regionCode = String(item.subjectRFCode || '');
        if (!isMonitoredTorgiRegion(regionCode)) continue;

        const catCode = String(item.category?.code || '');
        if (catCode === '301' || catCode === '307') continue;

        const lotName = item.lotName || '';
        const description = item.lotDescription || lotName;
        const fullText = `${lotName} ${description}`.toLowerCase();

        const isProperty = ['нежилое', 'помещение', 'здание', 'сооружение',
          'офис', 'склад', 'магазин', 'торгов', 'гараж', 'коммерческ',
          'административн', 'производствен'].some(kw => fullText.includes(kw));
        if (!isProperty) continue;

        // API v2: priceMin/priceMax на верхнем уровне (не в priceInfo)
        const price = item.priceMin || item.priceMax || item.priceInfo?.startPrice || item.priceInfo?.currentPrice;

        let area: number | undefined;
        const chars = item.characteristics || [];
        for (const ch of chars) {
          if (ch.code === 'totalAreaRealty' || ch.code === 'SquareZU' || ch.code === 'Square' || ch.code === 'TotalArea') {
            const val = parseFloat(String(ch.characteristicValue));
            if (!isNaN(val) && val > 0) area = val;
          }
        }

        if (!area) {
          const areaMatch = lotName.match(/(\d[\d\s]*[,.]?\d*)\s*кв\.?\s*м/i);
          if (areaMatch) {
            const cleaned = areaMatch[1].replace(/\s/g, '').replace(',', '.');
            const num = parseFloat(cleaned);
            if (!isNaN(num) && num > 0) area = num;
          }
        }

        const lotId = item.id || `${item.noticeNumber}_${item.lotNumber}`;
        const propertyLocation = extractTorgiPropertyLocation(item);
        results.push({
          external_id: `torgi-gov-${lotId}`,
          url: buildTorgiLotUrl(lotId),
          title: lotName || description.substring(0, 200),
          address: projectLegacyAddress(propertyLocation),
          city: derivePropertyRegion(propertyLocation),
          property_location: propertyLocation,
          area_sqm: area,
          price: typeof price === 'number' ? price : undefined,
          price_per_sqm: price && area ? Math.round(price / area) : undefined,
          property_type: classifyPropertyType(fullText),
          auction_type: item.biddType?.name?.includes('продаж') ? 'marketplace' : 'privatization',
          description: description.length > 20 ? description.slice(0, 1000) : undefined,
          published_at: item.createDate || undefined,
        });
        pageNewCount++;
      }

      // Ранний выход: если 10 страниц подряд без свежих объектов — дальше только старые
      if (pageNewCount === 0) {
        consecutiveOld++;
        if (consecutiveOld >= 10) {
          logger.info(`[torgi-gov] 10 consecutive pages with no recent items — stopping`);
          break;
        }
      } else {
        consecutiveOld = 0;
      }

      if (page >= data.totalPages - 1) break;
      if (items.length < 10) {
        logger.info(`[torgi-gov] Page ${page}: only ${items.length} items (less than 10) — last page`);
        break;
      }
    }

    logger.info(`[torgi-gov] Query "${query}": ${results.length} properties`);
    return results;
  }
}
