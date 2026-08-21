import { describe, it, expect, vi } from 'vitest';
import { errors as playwrightErrors } from 'playwright';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const { JSDOM } = require('jsdom') as { JSDOM: new (html: string) => { window: { document: Document } } };
import {
  derivePropertyRegion,
  parsePrice,
  projectLegacyAddress,
} from '@aklab/service-shared';
import {
  AggregatorBankrotParser,
  extractAggregatorPropertyLocationFields,
  normalizeAggregatorPropertyLocation,
} from '../sources/aggregator-bankrot';

function fixture(name: string): Document {
  return new JSDOM(readFileSync(join(__dirname, 'fixtures', name), 'utf8')).window.document;
}

describe('aggregator-bankrot: detail failure contract', () => {
  it('rethrows an unhydrated property block and closes the page', async () => {
    const failure = new Error('property block timeout');
    const page = { goto: vi.fn(), waitForFunction: vi.fn().mockRejectedValue(failure), close: vi.fn() };
    await expect(new AggregatorBankrotParser().fetchDetails('https://example.test/lot', { newPage: async () => page } as any))
      .rejects.toBe(failure);
    expect(page.close).toHaveBeenCalledOnce();
  });

  it('classifies a hydrated property block without location labels as typed missing', async () => {
    const page = {
      goto: vi.fn(),
      waitForFunction: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new playwrightErrors.TimeoutError('location labels timeout')),
      evaluate: vi.fn()
        .mockResolvedValueOnce(extractAggregatorPropertyLocationFields(fixture('info-without-location.html')))
        .mockResolvedValueOnce({ description: 'bounded property details' }),
      close: vi.fn(),
    };

    const result = await new AggregatorBankrotParser().fetchDetails(
      'https://example.test/lot',
      { newPage: async () => page } as any,
    );

    expect(result.property_location).toEqual({
      status: 'missing',
      source_kind: 'dom_field',
      source_path: '#info',
    });
    expect(result.parser_diagnostics).toMatchObject({
      property_block_found: true,
      schema_mismatch: 'location_label_missing',
    });
    expect(result.address).toBe('');
    expect(result.city).toBe('other');
    expect(page.waitForFunction).toHaveBeenCalledTimes(2);
    expect(page.close).toHaveBeenCalledOnce();
  });

  it('rethrows non-timeout errors from the location-label wait', async () => {
    const failure = new Error('label evaluation failed');
    const page = {
      goto: vi.fn(),
      waitForFunction: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(failure),
      close: vi.fn(),
    };

    await expect(new AggregatorBankrotParser().fetchDetails(
      'https://example.test/lot',
      { newPage: async () => page } as any,
    )).rejects.toBe(failure);
    expect(page.close).toHaveBeenCalledOnce();
  });
});

/**
 * Тесты extraction-логики parser-aggregator-bankrot.
 *
 * Источник: services/parser-aggregator-bankrot/src/sources/aggregator-bankrot.ts
 * Сайт: xn----etbpba5admdlad.xn--p1ai
 *
 * Тестируем:
 * - parsePrice (парсинг цены из текста)
 * - extractArea (площадь из title/excerpt)
 * - typed property_location extraction from the current-property field only
 * - car brand filtering
 */

// --- Extraction helpers from aggregator-bankrot.ts ---

function extractArea(text: string): number | undefined {
  // "Общая площадь: 274.4 м²" or "Общая площадь: 274,4 м²"
  const match = text.match(/(?:общая\s+)?площад[ьи]?\s*:?\s*(\d[\d\s]*[,.]?\d*)\s*(?:кв\.?\s*м|м²|м2)/i);
  if (match) {
    const cleaned = match[1].replace(/\s/g, '').replace(',', '.');
    const num = parseFloat(cleaned);
    if (!isNaN(num) && num > 0) return num;
  }
  // Fallback: "9484 кв.м" without "площадь"
  const fallback = text.match(/(\d[\d\s]*[,.]?\d*)\s*(?:кв\.?\s*м|м²|м2)/i);
  if (fallback) {
    const cleaned = fallback[1].replace(/\s/g, '').replace(',', '.');
    const num = parseFloat(cleaned);
    if (!isNaN(num) && num > 0) return num;
  }
  // Сотки: "9 сот." → 900 м²
  const sotka = text.match(/(\d[\d\s]*[,.]?\d*)\s*(?:сот\.?|соток|сотки|сотка)/i);
  if (sotka) {
    const cleaned = sotka[1].replace(/\s/g, '').replace(',', '.');
    const num = parseFloat(cleaned) * 100;
    if (!isNaN(num) && num > 0) return num;
  }
  return undefined;
}

// Car brands filter from aggregator-bankrot.ts
const CAR_BRANDS = [
  'ваз', 'lada', 'vaz', 'toyota', 'ford', 'bmw', 'mercedes', 'hyundai',
  'kia', 'nissan', 'renault', 'mazda', 'skoda', 'chevrolet', 'jac',
];

const TITLE_EXCLUDE_PATTERNS = [
  'л.с.', 'л.с,', 'л.с ', 'лошадин',
  'объем двигател', 'объём двигател', 'vin:', 'vin ',
];

function isNonRealty(title: string): boolean {
  const lower = title.toLowerCase();
  return CAR_BRANDS.some(brand => lower.includes(brand)) ||
    TITLE_EXCLUDE_PATTERNS.some(pat => lower.includes(pat));
}

// --- Tests ---

describe('aggregator-bankrot: parsePrice', () => {
  it('should parse "1 500 000 ₽"', () => {
    expect(parsePrice('1 500 000 ₽')).toBe(1500000);
  });

  it('should parse "648 000,00 RUB"', () => {
    expect(parsePrice('648 000,00 RUB')).toBe(648000);
  });

  it('should parse plain number "500000"', () => {
    expect(parsePrice('500000')).toBe(500000);
  });

  it('should return undefined for empty string', () => {
    expect(parsePrice('')).toBeUndefined();
  });

  it('should return undefined for zero', () => {
    expect(parsePrice('0')).toBeUndefined();
  });

  it('should return undefined for text without numbers', () => {
    expect(parsePrice('цена не указана')).toBeUndefined();
  });
});

describe('aggregator-bankrot: extractArea', () => {
  it('should extract "Общая площадь: 274.4 м²"', () => {
    expect(extractArea('Общая площадь: 274.4 м²')).toBe(274.4);
  });

  it('should extract "Общая площадь: 274,4 м²" (comma)', () => {
    expect(extractArea('Общая площадь: 274,4 м²')).toBe(274.4);
  });

  it('should extract "площадь: 100 кв.м"', () => {
    expect(extractArea('площадь: 100 кв.м')).toBe(100);
  });

  it('should extract fallback "9484 кв.м" without word "площадь"', () => {
    expect(extractArea('Здание 9484 кв.м')).toBe(9484);
  });

  it('should extract "150 м²" (without "площадь")', () => {
    expect(extractArea('Помещение 150 м²')).toBe(150);
  });

  it('should extract from title with "м2" suffix', () => {
    expect(extractArea('Склад 200 м2')).toBe(200);
  });

  it('should convert сотки to м²: "9 сот." → 900', () => {
    expect(extractArea('Участок 9 сот.')).toBe(900);
  });

  it('should convert "15 соток" to 1500 м²', () => {
    expect(extractArea('Земельный участок 15 соток')).toBe(1500);
  });

  it('should return undefined for text without area', () => {
    expect(extractArea('Нежилое помещение')).toBeUndefined();
  });
});

describe('aggregator-bankrot: typed property location', () => {
  it('reads allowlisted #info fields from a representative property fixture only', () => {
    const fields = extractAggregatorPropertyLocationFields(fixture('property-location.html'));
    const location = normalizeAggregatorPropertyLocation(fields);

    expect(fields).toEqual({
      propertyBlockFound: true,
      region: 'Самарская область',
      propertyText: 'Жилой дом расположен по адресу: Самарская область, г. Кинель, массив Горный, СДТ Вагонник, участок 95. Кадастровый номер 63:03:0211006:640.',
    });
    expect(location.status).toBe('confirmed_address');
    expect(location.address).toContain('г. Кинель');
    expect(JSON.stringify(fields)).not.toContain('Арбат');
  });

  it('keeps a representative region-only fixture region-only despite organizer geography', () => {
    const fields = extractAggregatorPropertyLocationFields(fixture('region-only.html'));
    const location = normalizeAggregatorPropertyLocation(fields);

    expect(location.status).toBe('confirmed_region_only');
    expect(location.region).toBe('Кемеровская область');
    expect(JSON.stringify(fields)).not.toContain('Москва');
  });

  function extractLocation(fields: { address?: string; region?: string; propertyText?: string; unrelatedLabel?: string } = {}) {
    const specs = [
      ['Адрес местонахождения:', fields.unrelatedLabel ? undefined : fields.address],
      ['Регион:', fields.region],
      ['Общая информация:', fields.propertyText],
      [fields.unrelatedLabel ?? '', fields.unrelatedLabel ? fields.address : undefined],
    ].filter((entry): entry is [string, string] => Boolean(entry[0]) && entry[1] !== undefined);
    const rows = specs.map(([rowLabel, value]) => ({
      textContent: `${rowLabel} ${value}`,
      querySelector(selector: string) {
        if (selector === 'span.text-grey') return { textContent: rowLabel, querySelector: () => null };
        if (selector === 'span.js-share-search') return { textContent: value, querySelector: () => null };
        return null;
      },
    }));
    return normalizeAggregatorPropertyLocation(
      extractAggregatorPropertyLocationFields({
        querySelectorAll: () => rows,
      }),
    );
  }

  it('uses the explicitly labelled current-property field and ignores title, description, and party geography', () => {
    const location = extractLocation({ address: 'Тверская область, г. Тверь, ул. Ленина, д. 10' });

    expect(location).toEqual({
      address: 'Тверская область, г. Тверь, ул. Ленина, д. 10',
      status: 'confirmed_address',
      source_kind: 'dom_field',
      source_path: '#info.field.Адрес местонахождения',
    });
    expect(derivePropertyRegion(location)).toBe('tver');
    expect(projectLegacyAddress(location)).toBe(location.address);
  });

  it('returns missing when only title, excerpt, description, party text, or body text mentions a location', () => {
    const location = extractLocation();

    expect(location).toEqual({
      status: 'missing',
      source_kind: 'dom_field',
      source_path: '#info',
    });
    expect(projectLegacyAddress(location)).toBe('');
    expect(derivePropertyRegion(location)).toBe('other');
    expect(location.latitude).toBeUndefined();
    expect(location.longitude).toBeUndefined();
  });

  it('does not treat mixed text in the info container as a property field', () => {
    const location = extractLocation({
      address: 'г. Москва, ул. Арбат, д. 1',
      unrelatedLabel: 'Организатор:',
    });

    expect(location.status).toBe('missing');
    expect(projectLegacyAddress(location)).toBe('');
    expect(derivePropertyRegion(location)).toBe('other');
  });

  it('requires the semantic property address value to be non-empty', () => {
    const location = extractLocation({ address: ' ' });

    expect(location.status).toBe('missing');
    expect(projectLegacyAddress(location)).toBe('');
  });

  it('uses the live Region and General information fields of the current lot', () => {
    const location = extractLocation({
      region: 'Самарская область',
      propertyText: 'Жилой дом расположен по адресу: Самарская область, г. Кинель, массив Горный, СДТ Вагонник, участок 95. Кадастровый номер 63:03:0211006:640',
    });

    expect(location).toEqual({
      address: 'Самарская область, г. Кинель, массив Горный, СДТ Вагонник, участок 95',
      region: 'Самарская область',
      status: 'confirmed_address',
      source_kind: 'dom_field',
      source_path: '#info.field.Общая информация.address',
    });
  });

  it('falls back to the explicit current-property Region field', () => {
    const location = extractLocation({
      region: 'Кемеровская область',
      propertyText: 'Здание 814 кв.м. и земельный участок 2128 кв.м.',
    });

    expect(location).toEqual({
      region: 'Кемеровская область',
      status: 'confirmed_region_only',
      source_kind: 'dom_field',
      source_path: '#info.field.Регион',
    });
  });
});

describe('aggregator-bankrot: car/non-realty filtering', () => {
  it('should detect Toyota as non-realty', () => {
    expect(isNonRealty('Toyota Camry 2020')).toBe(true);
  });

  it('should detect BMW as non-realty', () => {
    expect(isNonRealty('BMW X5 3.0 л.с.')).toBe(true);
  });

  it('should detect VIN pattern as non-realty', () => {
    expect(isNonRealty('vin: JTDKN3DU5A0123456')).toBe(true);
  });

  it('should detect "лошадин" as non-realty', () => {
    expect(isNonRealty('250 лошадиных сил')).toBe(true);
  });

  it('should NOT flag legitimate property titles', () => {
    expect(isNonRealty('Нежилое помещение 150 кв.м')).toBe(false);
    expect(isNonRealty('Офисное помещение')).toBe(false);
    expect(isNonRealty('Склад')).toBe(false);
  });
});

describe('aggregator-bankrot: card extraction simulation', () => {
  /**
   * Simulates extraction from HTML card structure:
   * li.search-page-cards__item > article.card
   *   .card-meta__item b.text-primary → lot_id
   *   h3.card__title a → title, link
   *   .card__bids[data-current-bid][data-start-bid] → price
   *   .card__excerpt a → excerpt
   */

  interface CardData {
    lot_id: string;
    title: string;
    price_text: string;
    excerpt: string;
  }

  function parseCardFromHtml(html: string): CardData | null {
    const idMatch = html.match(/text-primary[^>]*>([^<]+)</);
    const lotId = idMatch?.[1]?.trim() || '';
    if (!lotId) return null;

    const titleMatch = html.match(/card__title[^>]*>.*?<a[^>]*>([^<]+)</s);
    const title = titleMatch?.[1]?.trim() || '';

    const currentBidMatch = html.match(/data-current-bid="([^"]+)"/);
    const startBidMatch = html.match(/data-start-bid="([^"]+)"/);
    const priceDisplayMatch = html.match(/bid__value[^>]*>([^<]+)</);
    const priceText = currentBidMatch?.[1] || startBidMatch?.[1] || priceDisplayMatch?.[1]?.trim() || '';

    const excerptMatch = html.match(/card__excerpt[^>]*>.*?<a[^>]*>([^<]+)</s);
    const excerpt = excerptMatch?.[1]?.trim() || '';

    return { lot_id: lotId, title, price_text: priceText, excerpt };
  }

  it('should extract card data from HTML', () => {
    const html = `
      <li class="search-page-cards__item">
        <article class="card">
          <div class="card-meta__item"><b class="text-primary">12345</b></div>
          <h3 class="card__title"><a href="/lot/12345">Нежилое помещение, г. Москва</a></h3>
          <div class="card__bids" data-current-bid="1500000" data-start-bid="1000000">
            <span class="bid__value">1 500 000 ₽</span>
          </div>
          <div class="card__excerpt"><a>Адрес: ул. Ленина, д. 10</a></div>
        </article>
      </li>
    `;
    const result = parseCardFromHtml(html);
    expect(result).not.toBeNull();
    expect(result!.lot_id).toBe('12345');
    expect(result!.title).toContain('Нежилое помещение');
    expect(result!.price_text).toBe('1500000');
    expect(result!.excerpt).toContain('ул. Ленина');
  });

  it('should prefer currentBid over startBid', () => {
    const html = `
      <article class="card">
        <b class="text-primary">999</b>
        <h3 class="card__title"><a>Склад</a></h3>
        <div class="card__bids" data-current-bid="2000000" data-start-bid="1000000">
        </div>
      </article>
    `;
    const result = parseCardFromHtml(html);
    expect(result!.price_text).toBe('2000000');
  });

  it('should return null for card without lot ID', () => {
    const html = `<article class="card"><div class="card-meta__item"><b class="text-primary"></b></div></article>`;
    expect(parseCardFromHtml(html)).toBeNull();
  });
});
