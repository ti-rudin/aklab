import { describe, it, expect } from 'vitest';

/**
 * Тесты extraction-логики parser-m-ets.
 *
 * Функции parsePrice и extractArea — приватные модулю.
 * Для тестирования воспроизводим их логику как standalone-функции.
 * Источник: services/parser-m-ets/src/sources/m-ets.ts
 */

// --- Replicated extraction functions from m-ets.ts ---

function parsePrice(text: string): number | undefined {
  if (!text) return undefined;
  const cleaned = text.replace(/[^\d,]/g, '').replace(',', '.');
  const num = parseFloat(cleaned);
  return !isNaN(num) && num > 0 ? num : undefined;
}

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

describe('m-ets: address extraction (inline logic)', () => {
  /**
   * Address extraction logic from m-ets.ts:
   * const addressMatch = description.match(
   *   /(?:адрес(?:у)?:?\s*|расположенн[аыя]?\s+по\s+адресу:\s*|местонахождение:?\s*)([^\n]+)/i,
   * );
   */
  function extractAddress(description: string, fallback: string): string {
    const addressMatch = description.match(
      /(?:адрес(?:у)?:?\s*|расположенн[аыя]?\s+по\s+адресу:\s*|местонахождение:?\s*)([^\n]+)/i,
    );
    return addressMatch ? addressMatch[1].trim() : fallback;
  }

  it('should extract address from "расположено по адресу: ..."', () => {
    const desc = 'Нежилое помещение расположено по адресу: г. Москва, ул. Ленина, д. 10';
    const addr = extractAddress(desc, 'fallback');
    expect(addr).toContain('г. Москва');
    expect(addr).toContain('ул. Ленина');
  });

  it('should extract address from "расположенная по адресу: ..."', () => {
    const desc = 'Нежилое помещение расположенная по адресу: г. Санкт-Петербург, Невский пр-т';
    const addr = extractAddress(desc, 'fallback');
    expect(addr).toContain('Санкт-Петербург');
  });

  it('should extract address from "адрес: ..."', () => {
    const desc = 'Лот. Адрес: г. Казань, ул. Баумана, д. 5';
    const addr = extractAddress(desc, 'fallback');
    expect(addr).toContain('г. Казань');
  });

  it('should extract address from "адресу: ..."', () => {
    const desc = 'По адресу: г. Новосибирск, Красный пр-т, 100';
    const addr = extractAddress(desc, 'fallback');
    expect(addr).toContain('Новосибирск');
  });

  it('should extract address from "местонахождение: ..."', () => {
    const desc = 'Местонахождение: г. Екатеринбург, ул. Малышева, 30';
    const addr = extractAddress(desc, 'fallback');
    expect(addr).toContain('Екатеринбург');
  });

  it('should use fallback when no address pattern found', () => {
    // Must avoid "адрес", "расположенн", "местонахождение"
    const desc = 'Просто описание объекта недвижимости';
    const addr = extractAddress(desc, 'Регион не указан');
    expect(addr).toBe('Регион не указан');
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
