import { describe, it, expect } from 'vitest';
import {
  derivePropertyRegion,
  parsePrice,
  projectLegacyAddress,
} from '@aklab/service-shared';
import { extractPropertyLocationFromHtml } from '../sources/fabrikant';

/**
 * Тесты extraction-логики parser-fabrikant.
 *
 * Функция extractPropertyLocationFromHtml экспортируется как чистый
 * extraction seam, чтобы fixture тестировал тот же selector contract,
 * который используется detail-page extraction.
 * Источник: services/parser-fabrikant/src/sources/fabrikant.ts
 */

// --- Replicated non-location extraction functions from fabrikant.ts ---

function extractArea(title: string): number | undefined {
  let match = title.match(/(\d[\d\s]*[,.]?\d*)\s*кв\.?\s*м/i);
  if (match) {
    const cleaned = match[1].replace(/\s/g, '').replace(',', '.');
    const num = parseFloat(cleaned);
    if (!isNaN(num) && num > 0) return num;
  }

  match = title.match(/площад[ьь]ю\s+(\d[\d\s]*[,.]?\d*)/i);
  if (match) {
    const cleaned = match[1].replace(/\s/g, '').replace(',', '.');
    const num = parseFloat(cleaned);
    if (!isNaN(num) && num > 0) return num;
  }

  match = title.match(/пл\.\s*(\d[\d\s]*[,.]?\d*)/);
  if (match) {
    const cleaned = match[1].replace(/\s/g, '').replace(',', '.');
    const num = parseFloat(cleaned);
    if (!isNaN(num) && num > 0) return num;
  }

  return undefined;
}

// --- Tests ---

const PROPERTY_LOCATION_FIXTURE = `
  <article>
    <h1>Нежилое помещение, г. Москва, адрес должника: г. Москва, ул. Тверская, д. 1</h1>
    <p>Описание: объект находится в Москве. Организатор: ООО «Площадка», Москва.</p>
    <section class="seller">
      <h2>Продавец</h2>
      <p>Юридический адрес: г. Москва, ул. Арбат, д. 2</p>
    </section>
    <section class="panel-group-element-lot_delivery_place">
      <div class="form-group-element-lot_delivery_place-address">
        Республика Башкортостан, г. Уфа, ул. Ленина, д. 10
      </div>
      <div class="form-group-element-lot_delivery_place-region">Республика Башкортостан</div>
      <div class="form-group-element-lot_delivery_place-okato">80401000000</div>
    </section>
  </article>
`;

describe('fabrikant: typed property location extraction', () => {
  it('uses the current lot delivery-place fields and ignores title/free-text geography', () => {
    const location = extractPropertyLocationFromHtml(PROPERTY_LOCATION_FIXTURE);

    expect(location).toEqual({
      address: 'Республика Башкортостан, г. Уфа, ул. Ленина, д. 10',
      region: 'Республика Башкортостан',
      region_code: '80401000000',
      status: 'confirmed_address',
      source_kind: 'dom_field',
      source_path: '.panel-group-element-lot_delivery_place .form-group-element-lot_delivery_place-address',
    });
    expect(derivePropertyRegion(location)).toBe('other');
    expect(projectLegacyAddress(location)).toBe(location.address);
  });

  it('fails closed when only title, body text, and seller address mention Moscow', () => {
    const html = `
      <article>
        <h1>Склад, г. Москва, ул. Тверская, д. 1</h1>
        <p>Местонахождение объекта: Москва. Организатор: Москва.</p>
        <div class="seller">Юридический адрес: г. Москва, ул. Арбат, д. 2</div>
      </article>
    `;

    const location = extractPropertyLocationFromHtml(html);

    expect(location).toEqual({
      status: 'missing',
      source_kind: 'dom_field',
      source_path: '.panel-group-element-lot_delivery_place',
    });
    expect(projectLegacyAddress(location)).toBe('');
    expect(derivePropertyRegion(location)).toBe('other');
  });

  it('keeps a separate property region when the property address field is absent', () => {
    const html = `
      <section class="panel-group-element-lot_delivery_place">
        <div class="form-group-element-lot_delivery_place-region">Республика Башкортостан</div>
        <div class="form-group-element-lot_delivery_place-okato">80401000000</div>
      </section>
      <p>Организатор: г. Москва, ул. Арбат, д. 2</p>
    `;

    const location = extractPropertyLocationFromHtml(html);

    expect(location).toEqual({
      region: 'Республика Башкортостан',
      region_code: '80401000000',
      status: 'confirmed_region_only',
      source_kind: 'dom_field',
      source_path: '.panel-group-element-lot_delivery_place .form-group-element-lot_delivery_place-region',
    });
    expect(projectLegacyAddress(location)).toBe('');
    expect(derivePropertyRegion(location)).toBe('other');
  });

  it('attributes region-only provenance to OKATO when it is the only structured field', () => {
    const location = extractPropertyLocationFromHtml(`
      <section class="panel-group-element-lot_delivery_place">
        <div class="form-group-element-lot_delivery_place-okato">80401000000</div>
      </section>
    `);

    expect(location).toEqual({
      region_code: '80401000000',
      status: 'confirmed_region_only',
      source_kind: 'dom_field',
      source_path: '.panel-group-element-lot_delivery_place .form-group-element-lot_delivery_place-okato',
    });
  });
});

describe('fabrikant: extractArea', () => {
  it('should extract area from "150 кв.м"', () => {
    expect(extractArea('Нежилое помещение 150 кв.м')).toBe(150);
  });

  it('should extract area from "1 500 кв.м" (with space)', () => {
    expect(extractArea('Здание 1 500 кв.м')).toBe(1500);
  });

  it('should extract area with comma decimal: "150,5 кв.м"', () => {
    expect(extractArea('Помещение площадью 150,5 кв.м')).toBe(150.5);
  });

  it('should extract area from "площадью 274"', () => {
    expect(extractArea('Нежилое помещение площадью 274')).toBe(274);
  });

  it('should extract area from "пл. 85,3"', () => {
    expect(extractArea('Офис пл. 85,3')).toBe(85.3);
  });

  it('should return undefined for text without area', () => {
    expect(extractArea('Склад')).toBeUndefined();
  });

  it('should extract area from "кв м" without dot', () => {
    expect(extractArea('Помещение 50 кв м')).toBe(50);
  });
});

describe('fabrikant: parsePrice', () => {
  it('should parse "648 000,00 RUB"', () => {
    expect(parsePrice('648 000,00 RUB')).toBe(648000);
  });

  it('should parse "1 500 000 ₽"', () => {
    expect(parsePrice('1 500 000 ₽')).toBe(1500000);
  });

  it('should parse "500000" (plain number)', () => {
    expect(parsePrice('500000')).toBe(500000);
  });

  it('should parse price with comma decimal "1 234 567,89 RUB"', () => {
    expect(parsePrice('1 234 567,89 RUB')).toBe(1234567.89);
  });

  it('should return undefined for empty string', () => {
    expect(parsePrice('')).toBeUndefined();
  });

  it('should return undefined for text without numbers', () => {
    expect(parsePrice('цена не указана')).toBeUndefined();
  });
});

describe('fabrikant: HTML card extraction simulation', () => {
  /**
   * Simulate the page.evaluate() logic that extracts data from
   * [data-slot="card"] elements on fabrikant.ru
   */

  interface CardData {
    lot_id: string;
    title: string;
    price_text: string;
    proc_number: string;
  }

  function extractFromCardHtml(html: string): CardData | null {
    // Simulates the DOM extraction logic from fabrikant.ts page.evaluate()
    const lotIdMatch = html.match(/data-id="([^"]+)"/);
    if (!lotIdMatch) return null;
    const lotId = lotIdMatch[1];

    const anchorMatch = html.match(/data-slot="anchor"[^>]*>([^<]+)</);
    const title = anchorMatch?.[1]?.trim() || '';
    if (!title) return null;

    // Extract all text slots
    const textSlots = [...html.matchAll(/data-slot="text"[^>]*>([^<]+)</g)].map(m => m[1].trim());
    let priceText = '';
    let procNumber = '';

    for (const t of textSlots) {
      if (t.includes('RUB') && !priceText) priceText = t;
      if (/^\d+-\d+$/.test(t) && !procNumber) procNumber = t;
    }

    return { lot_id: lotId, title, price_text: priceText, proc_number: procNumber };
  }

  it('should extract lot data from card HTML', () => {
    const html = `
      <div data-slot="card" data-id="12345">
        <a data-slot="anchor">Нежилое помещение по адресу: г. Москва, ул. Ленина, д. 10</a>
        <span data-slot="badge">Активен</span>
        <span data-slot="text">648 000,00 RUB</span>
        <span data-slot="text">2024-01-15</span>
        <span data-slot="text">12345-67890</span>
      </div>
    `;
    const result = extractFromCardHtml(html);
    expect(result).not.toBeNull();
    expect(result!.lot_id).toBe('12345');
    expect(result!.title).toContain('Нежилое помещение');
    expect(result!.price_text).toBe('648 000,00 RUB');
    expect(result!.proc_number).toBe('12345-67890');
  });

  it('should skip card without data-id', () => {
    const html = `<div data-slot="card"><a data-slot="anchor">Title</a></div>`;
    expect(extractFromCardHtml(html)).toBeNull();
  });

  it('should skip card without anchor text', () => {
    const html = `<div data-slot="card" data-id="999"><a data-slot="anchor"></a></div>`;
    expect(extractFromCardHtml(html)).toBeNull();
  });

  it('should handle missing price text gracefully', () => {
    const html = `
      <div data-slot="card" data-id="111">
        <a data-slot="anchor">Складское помещение</a>
        <span data-slot="text">Организатор</span>
      </div>
    `;
    const result = extractFromCardHtml(html);
    expect(result).not.toBeNull();
    expect(result!.price_text).toBe('');
  });
});
