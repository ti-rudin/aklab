import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';
import {
  derivePropertyRegion,
  parsePrice,
  projectLegacyAddress,
} from '@aklab/service-shared';
import {
  buildLotViewUrl,
} from '../sources/fabrikant-url';
import {
  buildParsedPropertyFromLot,
  createFabrikantParserDiagnostics,
  extractArea,
  extractLotDetailsFromHtml,
  extractProcedureLotsFromHtml,
  extractPropertyLocationFromHtml,
  isFabrikantLotEligible,
  propertyLocationFromFields,
} from '../sources/fabrikant';

const MULTI_LOT_FIXTURE = readFileSync(
  join(__dirname, 'fixtures/multi-lot-procedure.html'),
  'utf8',
);

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

  it('fails closed on multi-lot HTML without lot scope (incident guard)', () => {
    const location = extractPropertyLocationFromHtml(MULTI_LOT_FIXTURE);

    expect(location.status).toBe('missing');
    expect(location.address).toBeUndefined();
    expect(projectLegacyAddress(location)).toBe('');
  });

  it('extracts Bryansk only when lot-c is scoped', () => {
    const location = extractPropertyLocationFromHtml(MULTI_LOT_FIXTURE, 'lot-c');

    expect(location).toMatchObject({
      address: 'Брянская область, г. Клинцы, ул. Горького, 31А',
      region: 'Брянская область',
      status: 'confirmed_address',
    });
    expect(location.address).not.toContain('Рязанский');
  });

  it('extracts Moscow Ryazan only for lot-a', () => {
    const location = extractPropertyLocationFromHtml(MULTI_LOT_FIXTURE, 'lot-a');

    expect(location).toMatchObject({
      address: 'г. Москва, Рязанский пр-кт, 24 к.2',
      region: 'Москва',
      status: 'confirmed_address',
    });
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

describe('fabrikant: multi-lot procedure expand', () => {
  const baseUrl = 'https://www.fabrikant.example';
  const procedureId = 'PROC-SANITIZED';

  it('extracts three independent lots from procedure HTML', () => {
    const lots = extractProcedureLotsFromHtml(MULTI_LOT_FIXTURE);
    expect(lots).toHaveLength(3);
    expect(lots.map(lot => lot.lotId)).toEqual(['lot-a', 'lot-b', 'lot-c']);
  });

  it('emits three ParsedProperty candidates with lot-view URLs', () => {
    const lots = extractProcedureLotsFromHtml(MULTI_LOT_FIXTURE);
    const properties = lots
      .filter(lot => isFabrikantLotEligible(lot.title, lot.subject ?? '', lot.hasDeliveryPlace))
      .map(lot => buildParsedPropertyFromLot(lot, procedureId, baseUrl));

    expect(properties).toHaveLength(3);
    expect(properties[0].url).toBe(buildLotViewUrl(procedureId, 'lot-a', baseUrl));
    expect(properties[2].title).toContain('Брянская');
    expect(properties[2].price).toBe(70136153.26);
    expect(properties[0].price).toBe(10000);
    expect(properties[1].price).toBe(10000);
  });

  it('allows OOO-title lots when delivery_place is present', () => {
    const lots = extractProcedureLotsFromHtml(MULTI_LOT_FIXTURE);
    expect(isFabrikantLotEligible(lots[0].title, lots[0].subject ?? '', lots[0].hasDeliveryPlace)).toBe(true);
    expect(isFabrikantLotEligible(lots[1].title, lots[1].subject ?? '', lots[1].hasDeliveryPlace)).toBe(true);
  });
});

describe('fabrikant: lot-scoped fetchDetails extraction', () => {
  const lotViewUrl = 'https://www.fabrikant.example/v2/trades/procedure/lot/view/PROC/lot-c';

  it('returns Bryansk geography and price for lot-c', () => {
    const details = extractLotDetailsFromHtml(MULTI_LOT_FIXTURE, lotViewUrl);
    const location = propertyLocationFromFields(details.locationFields);

    expect(details.price).toBe(70136153.26);
    expect(details.description).toContain('Клинцы');
    expect(location.address).toContain('Клинцы');
    expect(location.address).not.toContain('Рязанский');
  });

  it('fails closed without lotId on multi-lot HTML', () => {
    const details = extractLotDetailsFromHtml(MULTI_LOT_FIXTURE);
    const location = propertyLocationFromFields(details.locationFields);
    expect(location.status).toBe('missing');
    expect(location.address).toBeUndefined();
  });

  it('does not use organizer postal address as property location', () => {
    const details = extractLotDetailsFromHtml(MULTI_LOT_FIXTURE, 'lot-a');
    const location = propertyLocationFromFields(details.locationFields);
    expect(location.address).not.toContain('Казань');
    expect(location.address).toContain('Москва');
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
  interface CardData {
    lot_id: string;
    title: string;
    price_text: string;
    proc_number: string;
  }

  function extractFromCardHtml(html: string): CardData | null {
    const lotIdMatch = html.match(/data-id="([^"]+)"/);
    if (!lotIdMatch) return null;
    const lotId = lotIdMatch[1];

    const anchorMatch = html.match(/data-slot="anchor"[^>]*>([^<]+)</);
    const title = anchorMatch?.[1]?.trim() || '';
    if (!title) return null;

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

describe('fabrikant: parser diagnostics', () => {
  it('fingerprints bounded property signals without raw content', () => {
    const diagnostic = createFabrikantParserDiagnostics({
      propertyBlockFound: true,
      address: 'sensitive raw address',
    });
    expect(diagnostic).toMatchObject({
      schema_version: 1,
      property_block_found: true,
      location_label_id: 'property.location.address',
    });
    expect(diagnostic.semantic_fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(diagnostic)).not.toContain('sensitive');
  });

  it('marks multi-lot unscoped pages as location_label_missing', () => {
    const diagnostic = createFabrikantParserDiagnostics({
      propertyBlockFound: true,
      multiLotUnscoped: true,
    });
    expect(diagnostic).toMatchObject({
      property_block_found: true,
      schema_mismatch: 'location_label_missing',
    });
    expect(diagnostic.location_label_id).toBeUndefined();
  });
});
