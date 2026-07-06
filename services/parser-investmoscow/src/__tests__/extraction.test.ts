import { describe, it, expect } from 'vitest';

/**
 * Тесты extraction-логики parser-investmoscow.
 *
 * Функции resolveNuxtRef, extractTendersFromNuxtPayload и toProperty — приватные модулю.
 * Для тестирования воспроизводим их логику как standalone-функции.
 * Источник: services/parser-investmoscow/src/sources/investmoscow.ts
 */

// --- Replicated extraction functions from investmoscow.ts ---

function resolveNuxtRef(data: unknown[], idx: number, depth = 0): unknown {
  if (depth > 10) return idx;
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

const TENDER_KEYS = ['startPrice', 'objectArea', 'address'];

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

  for (let i = 0; i < data.length; i++) {
    const item = data[i];
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;

    const objKeys = Object.keys(item as Record<string, unknown>);
    const isTender = TENDER_KEYS.every(k => objKeys.includes(k));
    if (!isTender) continue;

    const resolved = resolveNuxtRef(data, i) as Record<string, unknown>;
    if (resolved && typeof resolved === 'object' && resolved.id) {
      tenders.push(resolved);
    }
  }

  return tenders;
}

interface ParsedProperty {
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
  latitude?: number;
  longitude?: number;
  photo_urls?: string[];
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
  const coords = Array.isArray(tender.coords) && tender.coords.length >= 2
    && typeof tender.coords[0] === 'number' ? tender.coords as number[] : undefined;

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
    url: url.startsWith('http') ? url : `https://investmoscow.ru${url}`,
    title: titleText.slice(0, 300),
    address: address ? `${region}${district ? ', ' + district : ''}, ${address}` : '',
    city: 'moscow',
    area_sqm: area,
    price,
    price_per_sqm: pricePerSqm ?? (price && area ? Math.round(price / area) : undefined),
    property_type: titleText, // simplified — real uses classifyPropertyType
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

// --- Tests ---

describe('investmoscow: resolveNuxtRef', () => {
  it('should resolve simple string value by index', () => {
    const data = ['hello', 'world'];
    expect(resolveNuxtRef(data, 0)).toBe('hello');
    expect(resolveNuxtRef(data, 1)).toBe('world');
  });

  it('should resolve numeric value by index', () => {
    const data = [42, 100];
    expect(resolveNuxtRef(data, 0)).toBe(42);
  });

  it('should resolve nested object references', () => {
    // data[1] = { name: 2 } → data[2] = 'Moscow'
    const data = ['unused', { name: 2 }, 'Moscow'];
    const result = resolveNuxtRef(data, 1) as Record<string, unknown>;
    expect(result.name).toBe('Moscow');
  });

  it('should resolve array references', () => {
    // data[0] = [1, 2], data[1] = 'a', data[2] = 'b'
    const data = [[1, 2], 'a', 'b'];
    const result = resolveNuxtRef(data, 0) as unknown[];
    expect(result).toEqual(['a', 'b']);
  });

  it('should handle out-of-bounds index gracefully', () => {
    const data = ['hello'];
    expect(resolveNuxtRef(data, 5)).toBe(5);
    expect(resolveNuxtRef(data, -1)).toBe(-1);
  });

  it('should handle null/undefined values', () => {
    const data = [null, undefined];
    expect(resolveNuxtRef(data, 0)).toBeNull();
    expect(resolveNuxtRef(data, 1)).toBeUndefined();
  });

  it('should prevent infinite recursion with depth limit', () => {
    // Create circular reference: data[0] = { ref: 0 }
    const data: unknown[] = [];
    data.push({ ref: 0 });
    // depth > 10 → returns the raw index (the idx itself, 0)
    const result = resolveNuxtRef(data, 0, 11);
    expect(result).toBe(0);
  });

  it('should return non-number idx as-is', () => {
    const data = ['hello'];
    expect(resolveNuxtRef(data, 'abc' as any)).toBe('abc');
  });

  it('should return boolean values directly', () => {
    const data = [true, false];
    expect(resolveNuxtRef(data, 0)).toBe(true);
    expect(resolveNuxtRef(data, 1)).toBe(false);
  });
});

describe('investmoscow: extractTendersFromNuxtPayload', () => {
  it('should return empty array when no __NUXT_DATA__ found', () => {
    expect(extractTendersFromNuxtPayload('<html><body>no data</body></html>')).toEqual([]);
  });

  it('should return empty array for invalid JSON', () => {
    const html = '<script id="__NUXT_DATA__">not json!</script>';
    expect(extractTendersFromNuxtPayload(html)).toEqual([]);
  });

  it('should return empty array for non-array JSON', () => {
    const html = '<script id="__NUXT_DATA__">{"key": "value"}</script>';
    expect(extractTendersFromNuxtPayload(html)).toEqual([]);
  });

  it('should extract tender from direct Nuxt payload', () => {
    const payload = [
      'some ref',
      {
        id: 42,
        name: 'Нежилое помещение',
        startPrice: 5000000,
        objectArea: 120.5,
        address: 'г. Москва, ул. Ленина, д. 10',
        url: '/tenders/42',
      },
    ];
    const html = `<script id="__NUXT_DATA__">${JSON.stringify(payload)}</script>`;
    const tenders = extractTendersFromNuxtPayload(html);
    expect(tenders).toHaveLength(1);
    expect(tenders[0].id).toBe(42);
    expect(tenders[0].startPrice).toBe(5000000);
    expect(tenders[0].objectArea).toBe(120.5);
  });

  it('should extract tender with Nuxt ref resolution', () => {
    // data[1] = { id: 0, name: 2, startPrice: 3, objectArea: 4, address: 5, url: 6 }
    // data[0] = 100 (id value)
    // data[2] = 'Торг №1'
    // data[3] = 1000000
    // data[4] = 50
    // data[5] = 'Москва'
    // data[6] = '/tenders/100'
    const payload = [
      100,                    // 0: id value
      {                       // 1: tender object
        id: 0, name: 2, startPrice: 3, objectArea: 4, address: 5, url: 6,
      },
      'Торг №1',              // 2: name value
      1000000,                // 3: price value
      50,                     // 4: area value
      'Москва, ул. Пушкина', // 5: address value
      '/tenders/100',         // 6: url value
    ];
    const html = `<script id="__NUXT_DATA__">${JSON.stringify(payload)}</script>`;
    const tenders = extractTendersFromNuxtPayload(html);
    expect(tenders).toHaveLength(1);
    expect(tenders[0].id).toBe(100);
    expect(tenders[0].name).toBe('Торг №1');
    expect(tenders[0].startPrice).toBe(1000000);
    expect(tenders[0].objectArea).toBe(50);
    expect(tenders[0].address).toBe('Москва, ул. Пушкина');
  });

  it('should skip objects missing tender keys', () => {
    const payload = [
      { id: 1, name: 'no price or area' },
      {
        id: 2, name: 'Full tender',
        startPrice: 100, objectArea: 50, address: 'addr',
      },
    ];
    const html = `<script id="__NUXT_DATA__">${JSON.stringify(payload)}</script>`;
    const tenders = extractTendersFromNuxtPayload(html);
    expect(tenders).toHaveLength(1);
    expect(tenders[0].id).toBe(2);
  });

  it('should skip tender if resolved id is falsy', () => {
    const payload = [
      { id: null, startPrice: 100, objectArea: 50, address: 'addr' },
    ];
    const html = `<script id="__NUXT_DATA__">${JSON.stringify(payload)}</script>`;
    const tenders = extractTendersFromNuxtPayload(html);
    expect(tenders).toHaveLength(0);
  });

  it('should extract multiple tenders', () => {
    const payload = [
      { id: 1, name: 'T1', startPrice: 100, objectArea: 10, address: 'A1' },
      'ref',
      { id: 2, name: 'T2', startPrice: 200, objectArea: 20, address: 'A2' },
    ];
    const html = `<script id="__NUXT_DATA__">${JSON.stringify(payload)}</script>`;
    const tenders = extractTendersFromNuxtPayload(html);
    expect(tenders).toHaveLength(2);
  });
});

describe('investmoscow: toProperty', () => {
  it('should extract price and area from tender', () => {
    const tender = {
      id: 42,
      name: 'Офисное помещение',
      startPrice: 5000000,
      objectArea: 120.5,
      address: 'ул. Тверская, д. 1',
      url: '/tenders/42',
      regionName: 'ЦАО',
      districtName: 'Тверской',
    };
    const prop = toProperty(tender, 'Продажа нежилых помещений');
    expect(prop.price).toBe(5000000);
    expect(prop.area_sqm).toBe(120.5);
    expect(prop.external_id).toBe('investmoscow-42');
    expect(prop.city).toBe('moscow');
    expect(prop.auction_type).toBe('marketplace');
  });

  it('should compute price_per_sqm from price/area', () => {
    const tender = {
      id: 1,
      startPrice: 1000000,
      objectArea: 100,
      address: 'addr',
    };
    const prop = toProperty(tender, 'cat');
    expect(prop.price_per_sqm).toBe(10000);
  });

  it('should use pricePerSquare if provided', () => {
    const tender = {
      id: 1,
      startPrice: 1000000,
      objectArea: 100,
      pricePerSquare: 12000,
      address: 'addr',
    };
    const prop = toProperty(tender, 'cat');
    expect(prop.price_per_sqm).toBe(12000);
  });

  it('should prepend base URL to relative url', () => {
    const tender = { id: 1, url: '/tenders/1', address: 'addr' };
    const prop = toProperty(tender, 'cat');
    expect(prop.url).toBe('https://investmoscow.ru/tenders/1');
  });

  it('should keep absolute url as-is', () => {
    const tender = { id: 1, url: 'https://example.com/tender', address: 'addr' };
    const prop = toProperty(tender, 'cat');
    expect(prop.url).toBe('https://example.com/tender');
  });

  it('should fallback to shortAddress/objectAddress when address missing', () => {
    const tender1 = { id: 1, shortAddress: 'short addr' };
    const prop1 = toProperty(tender1, 'cat');
    expect(prop1.address).toContain('short addr');

    const tender2 = { id: 2, objectAddress: 'obj addr' };
    const prop2 = toProperty(tender2, 'cat');
    expect(prop2.address).toContain('obj addr');
  });

  it('should include coordinates when present', () => {
    const tender = { id: 1, coords: [55.7558, 37.6173], address: 'addr' };
    const prop = toProperty(tender, 'cat');
    expect(prop.latitude).toBe(55.7558);
    expect(prop.longitude).toBe(37.6173);
  });

  it('should ignore invalid coords', () => {
    const tender = { id: 1, coords: 'invalid', address: 'addr' };
    const prop = toProperty(tender, 'cat');
    expect(prop.latitude).toBeUndefined();
    expect(prop.longitude).toBeUndefined();
  });

  it('should extract photo_urls from attachedPics', () => {
    const tender = {
      id: 1,
      address: 'addr',
      attachedPics: ['https://img1.jpg', 'https://img2.jpg', 'https://img3.jpg'],
    };
    const prop = toProperty(tender, 'cat');
    expect(prop.photo_urls).toEqual(['https://img1.jpg', 'https://img2.jpg', 'https://img3.jpg']);
  });

  it('should limit photo_urls to 5', () => {
    const tender = {
      id: 1,
      address: 'addr',
      attachedPics: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
    };
    const prop = toProperty(tender, 'cat');
    expect(prop.photo_urls).toHaveLength(5);
  });

  it('should extract published_at from updateDate', () => {
    const tender = { id: 1, address: 'addr', updateDate: '2024-06-15T10:30:00' };
    const prop = toProperty(tender, 'cat');
    expect(prop.published_at).toBe('2024-06-15');
  });

  it('should build description from category and dates', () => {
    const tender = {
      id: 1,
      address: 'addr',
      objectTypeName: 'Офис',
      regionName: 'Москва',
      requestStartDate: '2024-01-01',
      requestEndDate: '2024-02-01',
    };
    const prop = toProperty(tender, 'Продажа');
    expect(prop.description).toContain('Тип: Офис');
    expect(prop.description).toContain('Округ: Москва');
    expect(prop.description).toContain('Категория: Продажа');
  });

  it('should handle missing price and area (undefined)', () => {
    const tender = { id: 1, name: 'No data', address: 'addr' };
    const prop = toProperty(tender, 'cat');
    expect(prop.price).toBeUndefined();
    expect(prop.area_sqm).toBeUndefined();
    expect(prop.price_per_sqm).toBeUndefined();
  });

  it('should truncate title to 300 chars', () => {
    const tender = { id: 1, name: 'A'.repeat(500), address: 'addr' };
    const prop = toProperty(tender, 'cat');
    expect(prop.title.length).toBeLessThanOrEqual(300);
  });
});
