import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const { JSDOM } = require('jsdom') as { JSDOM: new (html: string) => { window: { document: Document } } };
import {
  derivePropertyRegion,
  parsePrice,
  projectLegacyAddress,
} from '@aklab/service-shared';
import {
  AlfalotParser,
  extractAlfalotPropertyLocationFields,
  extractAlfalotPropertyLocation,
} from '../sources/alfalot';

function fixture(name: string): Document {
  return new JSDOM(readFileSync(join(__dirname, 'fixtures', name), 'utf8')).window.document;
}

describe('alfalot: detail failure contract', () => {
  it('rethrows an unhydrated property block and closes the page', async () => {
    const failure = new Error('property block timeout');
    const page = { goto: vi.fn(), waitForFunction: vi.fn().mockRejectedValue(failure), close: vi.fn() };
    await expect(new AlfalotParser().fetchDetails('https://example.test/lot', { newPage: async () => page } as any))
      .rejects.toBe(failure);
    expect(page.close).toHaveBeenCalledOnce();
  });
});

/**
 * Тесты extraction-логики parser-alfalot.
 *
 * Источник: services/parser-alfalot/src/sources/alfalot.ts
 * Сайт: ecosystem.alfalot.ru
 *
 * Тестируем:
 * - parsePrice (парсинг цены из текста)
 * - area extraction (title + badge fallback)
 * - card HTML extraction simulation
 */

// --- Extraction helpers from alfalot.ts ---

function extractAreaFromTitle(title: string): number | undefined {
  const match = title.match(/(\d[\d\s]*[,.]?\d*)\s*(?:кв\.?\s*м|м²|м2)/i);
  if (match) {
    const num = parseFloat(match[1].replace(/\s/g, '').replace(',', '.'));
    if (!isNaN(num) && num > 0) return num;
  }
  return undefined;
}

function extractAreaFromBadge(badgeValue: string): number | undefined {
  if (!badgeValue) return undefined;
  const num = parseFloat(badgeValue.replace(',', '.'));
  return !isNaN(num) && num > 0 ? num : undefined;
}

/**
 * Combined area extraction: title-first, badge fallback
 * Replicates the logic from alfalot.ts lines 108-114
 */
function extractArea(title: string, badgeArea: string): number | undefined {
  const fromTitle = extractAreaFromTitle(title);
  if (fromTitle && fromTitle > 0) return fromTitle;
  return extractAreaFromBadge(badgeArea);
}

// --- Tests ---

describe('alfalot: typed property location extraction', () => {
  it('reads only hydrated property fields from a representative fixture', () => {
    const fields = extractAlfalotPropertyLocationFields(fixture('property-location.html'));
    const location = extractAlfalotPropertyLocation(fields);

    expect(fields.detailAddress).toContain('ул. Машкова');
    expect(fields.propertyDescription).toContain('г. Прохладный');
    expect(JSON.stringify(fields)).not.toContain('Казань');
    expect(location.address).toContain('ул. Машкова');
  });

  it('ignores organizer address when hydrated property fields contain no address', () => {
    const fields = extractAlfalotPropertyLocationFields(fixture('organizer-address-adversarial.html'));

    expect(JSON.stringify(fields)).not.toContain('Вавилова');
    expect(extractAlfalotPropertyLocation(fields).status).toBe('missing');
  });

  it('keeps the separate card region field region-only', () => {
    const location = extractAlfalotPropertyLocation({
      cardRegion: 'Московская область',
    });

    expect(location).toEqual({
      region: 'Московская область',
      status: 'confirmed_region_only',
      source_kind: 'dom_field',
      source_path: '.card-info > p',
    });
    expect(projectLegacyAddress(location)).toBe('');
    expect(derivePropertyRegion(location)).toBe('mo');
  });

  it('uses the separate detail property address field as a confirmed address', () => {
    const location = extractAlfalotPropertyLocation({
      detailAddress: 'Российская Федерация, г. Москва, ул. Машкова, д. 10',
    });

    expect(location).toEqual({
      address: 'Российская Федерация, г. Москва, ул. Машкова, д. 10',
      status: 'confirmed_address',
      source_kind: 'dom_field',
      source_path: '.location-block > p.address',
    });
    expect(projectLegacyAddress(location)).toBe(location.address);
    expect(derivePropertyRegion(location)).toBe('moscow');
  });

  it('uses an explicit address in the bounded lot Description when the location block is empty', () => {
    const location = extractAlfalotPropertyLocation({
      propertyDescription: 'Нежилое здание, кадастровый номер 07:10:0000000:25500. Адрес: КБР, г. Прохладный, ул. Степана Разина, д. 1. Ознакомиться с имуществом можно по телефону.',
    });

    expect(location).toEqual({
      address: 'КБР, г. Прохладный, ул. Степана Разина, д. 1',
      status: 'confirmed_address',
      source_kind: 'dom_field',
      source_path: '.tab-content[data-page="lot-info"].field.Описание.address',
    });
  });

  it('fails closed when only description, title, and organizer geography are available', () => {
    const location = extractAlfalotPropertyLocation({});

    expect(location).toEqual({
      status: 'missing',
      source_kind: 'dom_field',
      source_path: '.location-block > p.address',
    });
    expect(projectLegacyAddress(location)).toBe('');
    expect(derivePropertyRegion(location)).toBe('other');
  });
});

describe('alfalot: parsePrice', () => {
  it('should parse "1 500 000 ₽"', () => {
    expect(parsePrice('1 500 000 ₽')).toBe(1500000);
  });

  it('should parse "648 000,00 RUB"', () => {
    expect(parsePrice('648 000,00 RUB')).toBe(648000);
  });

  it('should parse plain "500000"', () => {
    expect(parsePrice('500000')).toBe(500000);
  });

  it('should parse price with decimal comma "1 234 567,89"', () => {
    expect(parsePrice('1 234 567,89')).toBe(1234567.89);
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
});

describe('alfalot: extractAreaFromTitle', () => {
  it('should extract "Сооружение 21 кв.м"', () => {
    expect(extractAreaFromTitle('Сооружение 21 кв.м')).toBe(21);
  });

  it('should extract "Помещение 112.00 м²"', () => {
    expect(extractAreaFromTitle('Помещение 112.00 м²')).toBe(112);
  });

  it('should extract area with comma "85,3 кв м"', () => {
    expect(extractAreaFromTitle('Офис 85,3 кв м')).toBe(85.3);
  });

  it('should extract "Здание 1 500 м2"', () => {
    expect(extractAreaFromTitle('Здание 1 500 м2')).toBe(1500);
  });

  it('should return undefined for title without area', () => {
    expect(extractAreaFromTitle('Нежилое помещение')).toBeUndefined();
  });
});

describe('alfalot: extractAreaFromBadge', () => {
  it('should parse badge value "112.00"', () => {
    expect(extractAreaFromBadge('112.00')).toBe(112);
  });

  it('should parse badge value "85,3"', () => {
    expect(extractAreaFromBadge('85,3')).toBe(85.3);
  });

  it('should return undefined for empty string', () => {
    expect(extractAreaFromBadge('')).toBeUndefined();
  });

  it('should return undefined for non-numeric', () => {
    expect(extractAreaFromBadge('нет данных')).toBeUndefined();
  });
});

describe('alfalot: extractArea (combined)', () => {
  it('should prefer title area over badge area', () => {
    expect(extractArea('Сооружение 21 кв.м', '112.00')).toBe(21);
  });

  it('should fallback to badge when title has no area', () => {
    expect(extractArea('Нежилое помещение', '112.00')).toBe(112);
  });

  it('should return undefined when both are empty', () => {
    expect(extractArea('Нежилое помещение', '')).toBeUndefined();
  });

  it('should use badge when title area is zero or invalid', () => {
    expect(extractArea('Помещение 0 кв.м', '50.5')).toBe(50.5);
  });
});

describe('alfalot: card extraction simulation', () => {
  /**
   * Simulates the page.evaluate() logic from alfalot.ts that extracts
   * data from .lot-card elements on ecosystem.alfalot.ru
   */

  interface AlfalotCardData {
    lot_id: string;
    title: string;
    link: string;
    price_text: string;
    region: string;
    area: string;
    object_type: string;
    lot_number: string;
  }

  function extractFromCardHtml(html: string): AlfalotCardData | null {
    // Title + link
    const titleMatch = html.match(/card-info[^>]*>.*?<a[^>]*class="[^"]*font-bold[^"]*"[^>]*href="([^"]*)"[^>]*>([^<]+)</s);
    const link = titleMatch?.[1] || '';
    const title = titleMatch?.[2]?.trim() || '';
    const lotIdMatch = link.match(/\/(\d+)$/);
    const lotId = lotIdMatch?.[1] || '';
    if (!lotId || !title) return null;

    // Price
    const priceMatch = html.match(/start-price[^>]*>.*?price-value[^>]*>([^<]+)</s);
    const priceText = priceMatch?.[1]?.trim() || '';

    // Region
    const regionMatch = html.match(/card-info[^>]*>.*?<p[^>]*>([^<]+)</s);
    const region = regionMatch?.[1]?.trim() || '';

    // Lot number
    const lotNumMatch = html.match(/bargain-data[^>]*>.*?<span[^>]*>([^<]+)</s);
    const lotNumber = lotNumMatch?.[1]?.trim() || '';

    // Badges: title="Площадь: 112.00", "Тип объекта: ..."
    const badges = [...html.matchAll(/whitespace-nowrap[^>]*title="([^"]+)"/g)].map(m => m[1]);
    let area = '';
    let objectType = '';
    for (const badge of badges) {
      if (badge.startsWith('Площадь:')) area = badge.replace('Площадь:', '').trim();
      if (badge.startsWith('Тип объекта:')) objectType = badge.replace('Тип объекта:', '').trim();
    }

    return { lot_id: lotId, title, link, price_text: priceText, region, area, object_type: objectType, lot_number: lotNumber };
  }

  it('should extract full card data from HTML', () => {
    const html = `
      <div class="lot-card">
        <div class="card-info">
          <a class="font-bold" href="/showcase/lot/12345">Сооружение 21 кв.м</a>
          <p>г. Москва, ул. Ленина</p>
        </div>
        <div class="start-price">
          <span class="price-value">1 500 000 ₽</span>
        </div>
        <div class="bargain-data">
          <span>LOT-001</span>
        </div>
        <div class="extensions">
          <span class="whitespace-nowrap" title="Площадь: 112.00"></span>
          <span class="whitespace-nowrap" title="Тип объекта: Сооружение"></span>
        </div>
      </div>
    `;
    const result = extractFromCardHtml(html);
    expect(result).not.toBeNull();
    expect(result!.lot_id).toBe('12345');
    expect(result!.title).toBe('Сооружение 21 кв.м');
    expect(result!.price_text).toBe('1 500 000 ₽');
    expect(result!.region).toBe('г. Москва, ул. Ленина');
    expect(result!.area).toBe('112.00');
    expect(result!.object_type).toBe('Сооружение');
    expect(result!.lot_number).toBe('LOT-001');
  });

  it('should extract area from title over badge', () => {
    const title = 'Сооружение 21 кв.м';
    const badgeArea = '112.00';
    // Title has "21 кв.м", badge has "112.00"
    // alfalot.ts logic: title-first
    expect(extractArea(title, badgeArea)).toBe(21);
  });

  it('should return null for card without lot ID', () => {
    const html = `
      <div class="lot-card">
        <div class="card-info">
          <a class="font-bold" href="/showcase/lot">Title</a>
        </div>
      </div>
    `;
    expect(extractFromCardHtml(html)).toBeNull();
  });

  it('should return null for card without title', () => {
    const html = `
      <div class="lot-card">
        <div class="card-info">
          <a class="font-bold" href="/showcase/lot/12345"></a>
        </div>
      </div>
    `;
    expect(extractFromCardHtml(html)).toBeNull();
  });

  it('should handle missing price gracefully', () => {
    const html = `
      <div class="lot-card">
        <div class="card-info">
          <a class="font-bold" href="/showcase/lot/99999">Склад</a>
          <p>МО</p>
        </div>
        <div class="bargain-data"><span>N-1</span></div>
      </div>
    `;
    const result = extractFromCardHtml(html);
    expect(result).not.toBeNull();
    expect(result!.price_text).toBe('');
    expect(result!.area).toBe('');
  });
});
