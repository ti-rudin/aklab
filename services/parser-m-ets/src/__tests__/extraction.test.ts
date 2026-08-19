import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const { JSDOM } = require('jsdom') as { JSDOM: new (html: string) => { window: { document: Document } } };
import { derivePropertyRegion, parsePrice, projectLegacyAddress } from '@aklab/service-shared';
import {
  extractMetsPropertyLocationFields,
  extractMetsPropertyLocation,
  extractLotIdFromMetsUrl,
  MetsParser,
  missingMetsPropertyLocation,
} from '../sources/m-ets';

function fixture(name: string): Document {
  return new JSDOM(readFileSync(join(__dirname, 'fixtures', name), 'utf8')).window.document;
}

describe('m-ets: detail failure contract', () => {
  it('rethrows an unhydrated property block and closes the page', async () => {
    const failure = new Error('property block timeout');
    const page = { goto: vi.fn(), waitForFunction: vi.fn().mockRejectedValue(failure), close: vi.fn() };
    await expect(new MetsParser().fetchDetails('https://example.test/lot', { newPage: async () => page } as any))
      .rejects.toBe(failure);
    expect(page.close).toHaveBeenCalledOnce();
  });
});

const playwrightHarness = vi.hoisted(() => {
  const page = {
    goto: vi.fn(async () => undefined),
    waitForTimeout: vi.fn(async () => undefined),
    evaluate: vi.fn(),
  };
  const context = {
    newPage: vi.fn(async () => page),
  };
  const browser = {
    newContext: vi.fn(async () => context),
    close: vi.fn(async () => undefined),
  };
  return { page, context, browser };
});

vi.mock('playwright', () => ({
  chromium: {
    launch: vi.fn(async () => playwrightHarness.browser),
  },
}));

/**
 * Тесты extraction-логики parser-m-ets.
 *
 * Функции parsePrice и extractArea — приватные модулю.
 * Для тестирования воспроизводим их логику как standalone-функции.
 * Источник: services/parser-m-ets/src/sources/m-ets.ts
 */

// --- Extraction helpers from m-ets.ts ---

function extractArea(text: string): number | undefined {
  if (!text) return undefined;
  const match = text.match(/(\d[\d\s]*[,.]?\d*)\s*(?:кв\.?\s*м|м²|м2)/i);
  if (match) {
    const cleaned = match[1].replace(/\s/g, '').replace(',', '.');
    const num = parseFloat(cleaned);
    if (!isNaN(num) && num > 0) return num;
  }
  return undefined;
}

// --- Tests ---

describe('m-ets: parsePrice', () => {
  it('should parse "1 500 000,00 ₽"', () => {
    expect(parsePrice('1 500 000,00 ₽')).toBe(1500000);
  });

  it('should parse "648 000,00 RUB"', () => {
    expect(parsePrice('648 000,00 RUB')).toBe(648000);
  });

  it('should parse plain number "500000"', () => {
    expect(parsePrice('500000')).toBe(500000);
  });

  it('parses the M-ETS price meta value without multiplying it by 100', () => {
    expect(parsePrice('615150.00')).toBe(615150);
  });

  it('should parse price with comma decimal "1 234 567,89"', () => {
    expect(parsePrice('1 234 567,89')).toBe(1234567.89);
  });

  it('should parse "Начальная цена: 2 500 000 ₽"', () => {
    expect(parsePrice('Начальная цена: 2 500 000 ₽')).toBe(2500000);
  });

  it('should return undefined for empty string', () => {
    expect(parsePrice('')).toBeUndefined();
  });

  it('should return undefined for text without numbers', () => {
    expect(parsePrice('цена не указана')).toBeUndefined();
  });

  it('should return undefined for zero price', () => {
    expect(parsePrice('0 ₽')).toBeUndefined();
  });

  it('should parse decimal price "100,50" (comma decimal)', () => {
    expect(parsePrice('100,50 ₽')).toBe(100.5);
  });
});

describe('m-ets: extractArea', () => {
  it('should extract area from "54.2 кв.м"', () => {
    expect(extractArea('Нежилое помещение 54.2 кв.м')).toBe(54.2);
  });

  it('should extract area from "70,7 кв.м" (comma decimal)', () => {
    expect(extractArea('Помещение 70,7 кв.м')).toBe(70.7);
  });

  it('should extract area from "54,2 кв. м" (space between кв and м)', () => {
    expect(extractArea('Помещение 54,2 кв. м')).toBe(54.2);
  });

  it('should extract area from "13.3 м²"', () => {
    expect(extractArea('Склад 13.3 м²')).toBe(13.3);
  });

  it('should extract area from "м2" (ASCII)', () => {
    expect(extractArea('Офис 200 м2')).toBe(200);
  });

  it('should extract area with thousands separator: "1 200 кв.м"', () => {
    expect(extractArea('Здание 1 200 кв.м')).toBe(1200);
  });

  it('should extract area from "кв м" without dots', () => {
    expect(extractArea('Помещение 50 кв м')).toBe(50);
  });

  it('should return undefined for text without area pattern', () => {
    expect(extractArea('Просто текст')).toBeUndefined();
  });

  it('should return undefined for empty string', () => {
    expect(extractArea('')).toBeUndefined();
  });

  it('should return undefined for null-ish input', () => {
    // extractArea in m-ets checks for falsy at the top
    expect(extractArea('')).toBeUndefined();
  });
});

describe('m-ets: combined price + area extraction', () => {
  it('should extract both from typical lot description', () => {
    const text = 'Нежилое помещение 70,7 кв.м, расположено по адресу: г. Москва';
    expect(extractArea(text)).toBe(70.7);
    expect(parsePrice('2 500 000,00 ₽')).toBe(2500000);
  });

  it('should compute price_per_sqm when both available', () => {
    const price = parsePrice('5 000 000 ₽');
    const area = extractArea('100 кв.м');
    expect(price).toBe(5000000);
    expect(area).toBe(100);
    expect(Math.round(price! / area!)).toBe(50000);
  });

  it('should handle minimum price extraction', () => {
    const minPrice = parsePrice('1 000 000,00 ₽');
    expect(minPrice).toBe(1000000);
  });
});

describe('m-ets: fail-closed detail geography', () => {
  it('extracts location inputs only from the current-property block fixture', () => {
    const fields = extractMetsPropertyLocationFields(fixture('property-location.html'));

    expect(fields).toEqual({
      propertyBlockFound: true,
      propertyDescription: 'Помещение. Адрес (местоположение): Россия, Волгоградская область, город Волгоград, улица 51-й Гвардейской, дом 46. Имеются ограничения.',
      propertyRegion: 'Волгоградская область',
    });
    expect(extractMetsPropertyLocation(fields).address).toContain('Волгоград');
    expect(extractMetsPropertyLocation(fields).address).not.toContain('Вавилова');
  });

  it('does not read a pledgee postal address when property geography is absent', () => {
    const fields = extractMetsPropertyLocationFields(fixture('pledgee-address-adversarial.html'));

    expect(fields.propertyRegion).toBeUndefined();
    expect(extractMetsPropertyLocation(fields).status).toBe('missing');
    expect(JSON.stringify(fields)).not.toContain('Вавилова');
  });

  it('uses the bounded current-property description and ignores a pledgee address', () => {
    const location = extractMetsPropertyLocation({
      propertyDescription: 'Помещение. Адрес (местоположение): Россия, Волгоградская область, город Волгоград, улица 51-й Гвардейской, дом 46. Имеются ограничения. Залогодержатель находится по адресу: г. Москва, ул. Вавилова, д. 19.',
      propertyRegion: 'Волгоградская область',
    });

    expect(location).toEqual({
      address: 'Россия, Волгоградская область, город Волгоград, улица 51-й Гвардейской, дом 46',
      region: 'Волгоградская область',
      status: 'confirmed_address',
      source_kind: 'dom_field',
      source_path: 'details.field.Сведения об имуществе.address',
    });
  });

  it('falls back to the explicit property region and ignores a pledgee address', () => {
    const location = extractMetsPropertyLocation({
      propertyDescription: 'Здание коровника, кадастровый номер 34:20:070003:276. Залогодержатель находится по адресу: г. Москва, ул. Вавилова, д. 19.',
      propertyRegion: 'Волгоградская область',
    });

    expect(location).toEqual({
      region: 'Волгоградская область',
      status: 'confirmed_region_only',
      source_kind: 'dom_field',
      source_path: 'details.field.Регион местонахождения имущества',
    });
    expect(projectLegacyAddress(location)).toBe('');
  });

  it('does not certify mixed description, party address, or global map data', () => {
    const location = missingMetsPropertyLocation('detail.property_location');

    expect(location).toEqual({
      status: 'missing',
      source_kind: 'dom_field',
      source_path: 'detail.property_location',
    });
    expect(projectLegacyAddress(location)).toBe('');
    expect(derivePropertyRegion(location)).toBe('other');
    expect(location.latitude).toBeUndefined();
    expect(location.longitude).toBeUndefined();
  });
});

describe('m-ets: multi-lot trade extraction', () => {
  it('fails closed without lot scope when multiple info-type_1 blocks exist', () => {
    const fields = extractMetsPropertyLocationFields(fixture('multi-lot-trade.html'));
    expect(fields.multiLotUnscoped).toBe(true);
    expect(extractMetsPropertyLocation(fields).status).toBe('missing');
  });

  it('returns Bryansk geography for scoped lot 1002', () => {
    const fields = extractMetsPropertyLocationFields(fixture('multi-lot-trade.html'), '1002');
    const location = extractMetsPropertyLocation(fields);
    expect(location.region).toBe('Брянская область');
    expect(fields.propertyDescription).toContain('Клинцы');
    expect(JSON.stringify(location)).not.toContain('Рязанский');
  });

  it('returns Moscow geography for scoped lot 1001', () => {
    const fields = extractMetsPropertyLocationFields(fixture('multi-lot-trade.html'), '1001');
    const location = extractMetsPropertyLocation(fields);
    expect(location.region).toBe('Москва');
    expect(fields.propertyDescription).toContain('Москва');
  });

  it('selects current lot via itemscope meta price without explicit lotId (live DOM shape)', () => {
    const fields = extractMetsPropertyLocationFields(fixture('multi-lot-trade-live.html'));
    const location = extractMetsPropertyLocation(fields);
    expect(location.region).toBe('Москва');
    expect(fields.propertyDescription).toContain('Рязанский');
    expect(JSON.stringify(location)).not.toContain('Клинцы');
  });

  it('selects lot 2 via itemscope meta price on canonical /228875-2 page', () => {
    const fields = extractMetsPropertyLocationFields(fixture('multi-lot-trade-live-lot2.html'));
    const location = extractMetsPropertyLocation(fields);
    expect(location.region).toBe('Брянская область');
    expect(fields.propertyDescription).toContain('Клинцы');
  });

  it('parses trade slug from canonical m-ets URLs', () => {
    expect(extractLotIdFromMetsUrl('https://m-ets.ru/228875-2')).toBe('228875-2');
    expect(extractLotIdFromMetsUrl('https://m-ets.ru/lot/268741965')).toBe('268741965');
  });
});

describe('m-ets: URL construction', () => {
  /**
   * URL logic from m-ets.ts:
   * const fullLink = href.startsWith('http') ? href
   *   : href.startsWith('/') ? `${BASE_URL}${href}`
   *   : `${BASE_URL}/${href}`;
   */
  const BASE_URL = 'https://m-ets.ru';

  function buildUrl(href: string): string {
    return href.startsWith('http')
      ? href
      : href.startsWith('/')
        ? `${BASE_URL}${href}`
        : `${BASE_URL}/${href}`;
  }

  it('should keep absolute URL as-is', () => {
    expect(buildUrl('https://m-ets.ru/lot/123')).toBe('https://m-ets.ru/lot/123');
  });

  it('should prepend BASE_URL to relative URL starting with /', () => {
    expect(buildUrl('/lot/456')).toBe('https://m-ets.ru/lot/456');
  });

  it('should prepend BASE_URL with / for bare path', () => {
    expect(buildUrl('lot/789')).toBe('https://m-ets.ru/lot/789');
  });
});

describe('m-ets: external_id construction', () => {
  function buildExternalId(lot_id: number | undefined, href: string, title: string): string {
    return lot_id
      ? `m-ets-${lot_id}`
      : `m-ets-${href.split('/').pop() || title.slice(0, 30)}`;
  }

  it('should use lot_id when available', () => {
    expect(buildExternalId(12345, '/lot/12345', 'Title')).toBe('m-ets-12345');
  });

  it('should fallback to href slug when lot_id missing', () => {
    expect(buildExternalId(undefined, '/lot/abc-123', 'Title')).toBe('m-ets-abc-123');
  });

  it('should fallback to title when href is empty', () => {
    expect(buildExternalId(undefined, '', 'Some Long Title Here')).toBe('m-ets-Some Long Title Here');
  });
});

describe('m-ets: adversarial listing geography', () => {
  it('fails closed when Bashkortostan property location is absent and a Moscow pledgee leaks through party text', () => {
    const propertyLocation = extractMetsPropertyLocation({
      propertyDescription: 'Залогодержатель: ПАО Сбербанк, г. Москва, ул. Вавилова, д. 19',
    });

    expect(propertyLocation).toEqual({
      status: 'missing',
      source_kind: 'dom_field',
      source_path: 'details.field.Регион местонахождения имущества',
    });
    expect(projectLegacyAddress(propertyLocation)).toBe('');
    expect(derivePropertyRegion(propertyLocation)).toBe('other');
    expect(propertyLocation.latitude).toBeUndefined();
    expect(propertyLocation.longitude).toBeUndefined();
  });
});
