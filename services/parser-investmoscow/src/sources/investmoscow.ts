/**
 * Инвестиционный портал Москвы (investmoscow.ru) — парсер коммерческой недвижимости.
 *
 * Источник: SSR-страницы каталога торгов (Nuxt.js).
 *   GET /tenders/{categoryKey}
 *
 * Данные встроены в HTML в теге <script id="__NUXT_DATA__"> в формате
 * компактного массива с обратными ссылками (Nuxt payload).
 */
import type { SourceParser, ParsedProperty } from '@aklab/service-shared';
import { logger, randomDelay } from '@aklab/service-shared';

const BASE_URL = 'https://investmoscow.ru';

/** Категории торгов с коммерческой недвижимостью. */
const CATEGORIES = [
  { key: 'prodazha-dlya-biznesa-nezhiloe-pomeshchenie', label: 'Продажа нежилых помещений' },
  { key: 'arenda-dlya-biznesa-nezhiloe-pomeshchenie', label: 'Аренда нежилых помещений' },
  { key: 'prodazha-zdanij', label: 'Продажа зданий' },
  { key: 'arenda-zdanij', label: 'Аренда зданий' },
  { key: 'prodazha-dlya-biznesa-akcii-doli', label: 'Продажа акций/долей' },
  { key: 'inaya-nedvizhimost', label: 'Иная недвижимость' },
];

const HEADERS: Record<string, string> = {
  'Accept': 'text/html,application/xhtml+xml',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept-Language': 'ru-RU,ru;q=0.9',
};

function classifyPropertyType(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes('офис') || lower.includes('административн')) return 'office';
  if (lower.includes('склад') || lower.includes('хранилищ')) return 'warehouse';
  if (lower.includes('магазин') || lower.includes('торгов')) return 'retail';
  if (lower.includes('производствен') || lower.includes('промышлен')) return 'production';
  if (lower.includes('нежилое') || lower.includes('помещение') || lower.includes('коммерческ') ||
      lower.includes('гараж') || lower.includes('здани')) return 'free_purpose';
  if (lower.includes('квартир') || lower.includes('апартамен')) return 'apartment';
  return 'other';
}

/* ─── Nuxt payload ─── */

/**
 * Nuxt.js сериализует данные как компактный массив с обратными ссылками.
 * Каждый объект {key: index} ссылается на элемент массива по индексу.
 * Функция «разрешает» такие ссылки в читаемый объект.
 */
function resolveNuxtRef(data: unknown[], idx: number, depth = 0): unknown {
  if (depth > 10) return idx; // защита от зацикливания
  if (typeof idx !== 'number' || idx < 0 || idx >= data.length) return idx;
  const val = data[idx];
  if (val === null || val === undefined) return val;
  if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') return val;

  if (Array.isArray(val)) {
    return val.map((v) => {
      if (typeof v === 'number' && v >= 0 && v < data.length) {
        return resolveNuxtRef(data, v, depth + 1);
      }
      return v;
    });
  }

  if (typeof val === 'object') {
    const resolved: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (typeof v === 'number' && v >= 0 && v < data.length) {
        resolved[k] = resolveNuxtRef(data, v, depth + 1);
      } else {
        resolved[k] = v;
      }
    }
    return resolved;
  }

  return val;
}

/** Извлекает массив сущностей торгов из Nuxt payload по ключу. */
function extractTendersFromNuxtPayload(html: string): Record<string, unknown>[] {
  const match = html.match(/id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) return [];

  let data: unknown[];
  try {
    data = JSON.parse(match[1]);
  } catch {
    return [];
  }

  if (!Array.isArray(data)) return [];

  const tenders: Record<string, unknown>[] = [];

  // Ищем ключи вида "fetchTenders-XXXX" и извлекаем массив entities
  for (let i = 0; i < data.length; i++) {
    const key = data[i];
    if (typeof key !== 'string' || !key.startsWith('fetchTenders-')) continue;

    // Следующий элемент — объект с filteredCount, entities, totalCount
    const meta = data[i + 1];
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) continue;

    const metaObj = meta as Record<string, unknown>;
    const entitiesIdx = metaObj.entities as number;
    if (typeof entitiesIdx !== 'number') continue;

    const entitiesList = data[entitiesIdx];
    if (!Array.isArray(entitiesList)) continue;

    // Каждый элемент entitiesList — это индекс на группу объектов
    for (const groupIdx of entitiesList) {
      if (typeof groupIdx !== 'number') continue;
      const group = resolveNuxtRef(data, groupIdx) as Record<string, unknown>;
      if (!group || typeof group !== 'object') continue;

      // Группа содержит tenders (массив индексов тендеров)
      const tendersList = group.tenders as unknown[];
      if (!Array.isArray(tendersList)) continue;

      for (const tenderRef of tendersList) {
        if (typeof tenderRef === 'number') {
          const tender = resolveNuxtRef(data, tenderRef) as Record<string, unknown>;
          if (tender && typeof tender === 'object' && tender.id) {
            tenders.push(tender);
          }
        } else if (typeof tenderRef === 'object' && tenderRef !== null) {
          tenders.push(tenderRef as Record<string, unknown>);
        }
      }
    }
  }

  return tenders;
}

function toProperty(tender: Record<string, unknown>, categoryLabel: string): ParsedProperty {
  const id = String(tender.id ?? '');
  const name = String(tender.name ?? '');
  const url = String(tender.url ?? '');
  const address = String(tender.address ?? tender.shortAddress ?? tender.objectAddress ?? '');
  const area = typeof tender.objectArea === 'number' ? tender.objectArea : undefined;
  const price = typeof tender.startPrice === 'number' ? tender.startPrice : undefined;
  const pricePerSqm = typeof tender.pricePerSquare === 'number' ? tender.pricePerSquare : undefined;
  const region = String(tender.regionName ?? '');
  const district = String(tender.districtName ?? '');
  const objectType = String(tender.objectTypeName ?? '');
  const coords = tender.coords as number[] | undefined;

  const titleText = name || objectType;
  const description = [
    objectType && `Тип: ${objectType}`,
    region && `Округ: ${region}`,
    district && `Район: ${district}`,
    categoryLabel && `Категория: ${categoryLabel}`,
    tender.requestStartDate && `Начало подачи: ${String(tender.requestStartDate).slice(0, 10)}`,
    tender.requestEndDate && `Конец подачи: ${String(tender.requestEndDate).slice(0, 10)}`,
    tender.tenderDate && `Дата торгов: ${String(tender.tenderDate).slice(0, 10)}`,
  ].filter(Boolean).join('. ');

  return {
    external_id: `investmoscow-${id}`,
    url: url.startsWith('http') ? url : `${BASE_URL}${url}`,
    title: titleText.slice(0, 300),
    address: address ? `${region}${district ? ', ' + district : ''}, ${address}` : '',
    city: 'moscow',
    area_sqm: area,
    price,
    price_per_sqm: pricePerSqm ?? (price && area ? Math.round(price / area) : undefined),
    property_type: classifyPropertyType(`${titleText} ${objectType}`),
    auction_type: 'marketplace',
    published_at: tender.updateDate ? String(tender.updateDate).slice(0, 10) : undefined,
    description: description || undefined,
    latitude: coords?.[0],
    longitude: coords?.[1],
    photo_urls: Array.isArray(tender.attachedPics)
      ? (tender.attachedPics as string[]).slice(0, 5)
      : undefined,
  };
}

/* ─── Основной парсер ─── */

export class InvestmoscowParser implements SourceParser {
  name = 'investmoscow';

  async parse(depth?: number): Promise<ParsedProperty[]> {
    logger.info('[investmoscow] Запуск парсинга через SSR...');
    const allProperties: ParsedProperty[] = [];
    const seen = new Set<string>();

    for (const cat of CATEGORIES) {
      if (depth && allProperties.length >= depth) break;

      try {
        const pageUrl = `${BASE_URL}/tenders/${cat.key}`;
        logger.info(`[investmoscow] Загрузка ${cat.label}: ${pageUrl}`);

        const resp = await fetch(pageUrl, { headers: HEADERS });
        if (!resp.ok) {
          logger.warn(`[investmoscow] HTTP ${resp.status} для ${cat.key}`);
          continue;
        }

        const html = await resp.text();
        const tenders = extractTendersFromNuxtPayload(html);
        logger.info(`[investmoscow] ${cat.label}: найдено ${tenders.length} торгов`);

        for (const tender of tenders) {
          if (depth && allProperties.length >= depth) break;
          const id = String(tender.id ?? '');
          if (seen.has(id)) continue;
          seen.add(id);

          allProperties.push(toProperty(tender, cat.label));
        }

        await randomDelay(500, 1500);
      } catch (err: any) {
        logger.error(`[investmoscow] Ошибка категории ${cat.key}: ${err.message}`);
      }
    }

    logger.info(`[investmoscow] Итого: ${allProperties.length} объектов`);
    return allProperties;
  }
}
