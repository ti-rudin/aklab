import { classifyPropertyType, normalizeStructuredLocation, parsePrice } from '@aklab/service-shared';
import type { ParsedProperty, PropertyLocation } from '@aklab/service-shared';
import { createParserExtractionDiagnostics } from '@aklab/service-shared';
import { load, type Cheerio, type CheerioAPI } from 'cheerio';
import {
  buildLotViewUrl,
  extractLotIdFromUrl,
  extractProcedureIdFromUrl,
} from './fabrikant-url';

export const PROPERTY_LOCATION_CONTAINER = '.panel-group-element-lot_delivery_place';
export const PROPERTY_LOCATION_ADDRESS_FIELD = '.form-group-element-lot_delivery_place-address';
export const PROPERTY_LOCATION_REGION_FIELD = '.form-group-element-lot_delivery_place-region';
export const PROPERTY_LOCATION_OKATO_FIELD = '.form-group-element-lot_delivery_place-okato';
export const PROPERTY_LOCATION_ADDRESS = `${PROPERTY_LOCATION_CONTAINER} ${PROPERTY_LOCATION_ADDRESS_FIELD}`;
export const PROPERTY_LOCATION_REGION = `${PROPERTY_LOCATION_CONTAINER} ${PROPERTY_LOCATION_REGION_FIELD}`;
export const PROPERTY_LOCATION_OKATO = `${PROPERTY_LOCATION_CONTAINER} ${PROPERTY_LOCATION_OKATO_FIELD}`;
export const LOT_PRICE_CONTAINER = '.panel-group-element-lot_price';

export const PROPERTY_KEYWORDS = [
  'нежилое', 'нежилого', 'нежилых', 'помещение', 'помещения',
  'офис', 'склад', 'здание', 'здания', 'сооружение',
  'коммерческ', 'торгов', 'магазин', 'административн',
  'доля нежилого',
];

export const EXCLUDE_KEYWORDS = [
  'жилой', 'жилого', 'жилые', 'жилых', 'жилую', 'жилая',
  'лпх', 'ижс', 'личное подсобное хозяйство',
  'дачный', 'дачного', 'дачные', 'дачных',
  'земельный участок', 'земельного участка', 'земельные участки',
  'гараж', 'паркинг',
  'транспортн', 'автомобил', 'легков', 'грузов',
  'автобус', 'прицеп', 'мотоцикл',
  'volkswagen', 'toyota', 'ford', 'bmw', 'mercedes',
  'оборудовани', 'станок', 'прибор', 'инвентар',
];

export type PropertyLocationFields = {
  address?: string;
  region?: string;
  region_code?: string;
  propertyBlockFound?: boolean;
  multiLotUnscoped?: boolean;
};

export interface FabrikantProcedureLot {
  lotId: string;
  title: string;
  subject?: string;
  priceText?: string;
  hasDeliveryPlace: boolean;
}

export interface FabrikantLotDetails {
  description?: string;
  contacts?: string;
  price?: number;
  locationFields: PropertyLocationFields;
}

function cleanLocationField(value: string | undefined): string | undefined {
  const trimmed = value?.replace(/\s+/g, ' ').trim();
  return trimmed || undefined;
}

export function propertyLocationFromFields(fields: PropertyLocationFields): PropertyLocation {
  const address = cleanLocationField(fields.address);
  const region = cleanLocationField(fields.region);
  const regionCode = cleanLocationField(fields.region_code);

  if (address) {
    return normalizeStructuredLocation({
      address,
      ...(region ? { region } : {}),
      ...(regionCode ? { region_code: regionCode } : {}),
      status: 'confirmed_address',
      source_kind: 'dom_field',
      source_path: PROPERTY_LOCATION_ADDRESS,
    });
  }

  if (region || regionCode) {
    return normalizeStructuredLocation({
      ...(region ? { region } : {}),
      ...(regionCode ? { region_code: regionCode } : {}),
      status: 'confirmed_region_only',
      source_kind: 'dom_field',
      source_path: region ? PROPERTY_LOCATION_REGION : PROPERTY_LOCATION_OKATO,
    });
  }

  return normalizeStructuredLocation({
    status: 'missing',
    source_kind: 'dom_field',
    source_path: PROPERTY_LOCATION_CONTAINER,
  });
}

export function createFabrikantParserDiagnostics(fields: PropertyLocationFields) {
  const location = propertyLocationFromFields(fields);
  const locationLabelId = location.status === 'confirmed_address'
    ? 'property.location.address'
    : location.status === 'confirmed_region_only'
      ? 'property.location.region'
      : undefined;
  const propertyBlockFound = fields.propertyBlockFound === true;
  const schemaMismatch = fields.multiLotUnscoped
    ? 'location_label_missing' as const
    : !locationLabelId && propertyBlockFound
      ? 'location_label_missing' as const
      : undefined;

  return createParserExtractionDiagnostics({
    adapterVersion: 'fabrikant.v2',
    propertyBlockFound,
    ...(locationLabelId ? { locationLabelId } : {}),
    ...(schemaMismatch ? { schemaMismatch } : {}),
    semanticSignals: [
      ...(propertyBlockFound ? ['property.block'] : []),
      ...(fields.multiLotUnscoped ? ['property.multi_lot.unscoped'] : []),
      ...(fields.address ? ['property.location.address'] : []),
      ...(fields.region ? ['property.location.region'] : []),
      ...(fields.region_code ? ['property.location.region_code'] : []),
    ],
  });
}

function findLotRoot($: CheerioAPI, lotId: string): Cheerio<any> | null {
  const anchor = $(`#lot-${lotId}`);
  if (anchor.length === 0) return null;
  const lotRoot = anchor.closest('.panel-default');
  return lotRoot.length > 0 ? lotRoot : anchor.parent();
}

function readLocationFieldsFromContainer(container: Cheerio<any>): PropertyLocationFields {
  return {
    propertyBlockFound: container.length > 0,
    address: container.find(PROPERTY_LOCATION_ADDRESS_FIELD).first().text(),
    region: container.find(PROPERTY_LOCATION_REGION_FIELD).first().text(),
    region_code: container.find(PROPERTY_LOCATION_OKATO_FIELD).first().text(),
  };
}

/** Extract geography only from the semantically separate current-lot DOM fields. */
export function extractPropertyLocationFromHtml(html: string, lotId?: string): PropertyLocation {
  const $ = load(html);
  const allContainers = $(PROPERTY_LOCATION_CONTAINER);

  if (allContainers.length > 1 && !lotId) {
    return propertyLocationFromFields({
      propertyBlockFound: true,
      multiLotUnscoped: true,
    });
  }

  if (lotId) {
    const lotRoot = findLotRoot($, lotId);
    if (!lotRoot) {
      return propertyLocationFromFields({ propertyBlockFound: allContainers.length > 0 });
    }
    const container = lotRoot.find(PROPERTY_LOCATION_CONTAINER).first();
    return propertyLocationFromFields(readLocationFieldsFromContainer(container));
  }

  return propertyLocationFromFields(readLocationFieldsFromContainer(allContainers.first()));
}

function extractLotTitleFromRoot($: CheerioAPI, lotRoot: Cheerio<any>): string {
  const heading = lotRoot.find('h3, h4, .lot_head, [class*="lot_head"]').first().text().replace(/\s+/g, ' ').trim();
  if (heading.includes('Лот')) return heading;

  const text = lotRoot.text().replace(/\s+/g, ' ').trim();
  const match = text.match(/Лот\s*№\s*\d+\.\s*[^-]+?(?=\s*-\s*(?:Прием|Предмет|Категория|Начальн|Место)|$)/i);
  if (match) return match[0].trim();
  return text.slice(0, 200);
}

function extractLotSubjectFromRoot($: CheerioAPI, lotRoot: Cheerio<any>): string | undefined {
  const subjectEl = lotRoot.find('[class*="lot_subject"], [class*="lot-subject"]').first();
  if (subjectEl.length > 0) {
    const value = subjectEl.text().replace(/\s+/g, ' ').trim();
    return value || undefined;
  }

  const text = lotRoot.text();
  const match = text.match(/Предмет\s+договора\s*[\n\r:]+\s*(.+?)(?:\n\s*(?:Категор|Начальн|Место|Срок|$))/s);
  return match?.[1]?.replace(/\s+/g, ' ').trim().slice(0, 2000) || undefined;
}

function extractLotPriceTextFromRoot($: CheerioAPI, lotRoot: Cheerio<any>): string | undefined {
  const priceEl = lotRoot.find(`${LOT_PRICE_CONTAINER}, [class*="lot_price"]`).first();
  const text = priceEl.text().replace(/\s+/g, ' ').trim();
  return text || undefined;
}

export function extractProcedureLotsFromHtml(html: string): FabrikantProcedureLot[] {
  const $ = load(html);
  const lots: FabrikantProcedureLot[] = [];

  $('.lot-anchor[id^="lot-"]').each((_, el) => {
    const lotId = $(el).attr('id')?.replace(/^lot-/, '') ?? '';
    if (!lotId) return;

    const lotRoot = $(el).closest('.panel-default');
    if (lotRoot.length === 0) return;

    lots.push({
      lotId,
      title: extractLotTitleFromRoot($, lotRoot),
      subject: extractLotSubjectFromRoot($, lotRoot),
      priceText: extractLotPriceTextFromRoot($, lotRoot),
      hasDeliveryPlace: lotRoot.find(PROPERTY_LOCATION_CONTAINER).length > 0,
    });
  });

  return lots;
}

export function isFabrikantLotEligible(title: string, subject: string, hasDeliveryPlace: boolean): boolean {
  const text = `${title} ${subject}`.toLowerCase();
  if (EXCLUDE_KEYWORDS.some(keyword => text.includes(keyword))) return false;
  if (hasDeliveryPlace) return true;
  return PROPERTY_KEYWORDS.some(keyword => text.includes(keyword));
}

export function extractArea(title: string): number | undefined {
  let match = title.match(/(\d[\d\s]*[,.]?\d*)\s*кв\.?\s*м/i);
  if (match) {
    const n = parseFloat(match[1].replace(/\s/g, '').replace(',', '.'));
    if (!isNaN(n) && n > 0) return n;
  }
  match = title.match(/площад[ьь]ю\s+(\d[\d\s]*[,.]?\d*)/i);
  if (match) {
    const n = parseFloat(match[1].replace(/\s/g, '').replace(',', '.'));
    if (!isNaN(n) && n > 0) return n;
  }
  match = title.match(/пл\.\s*(\d[\d\s]*[,.]?\d*)/);
  if (match) {
    const n = parseFloat(match[1].replace(/\s/g, '').replace(',', '.'));
    if (!isNaN(n) && n > 0) return n;
  }
  return undefined;
}

export function buildParsedPropertyFromLot(
  lot: FabrikantProcedureLot,
  procedureId: string,
  baseUrl: string,
  publishedAt?: string,
): ParsedProperty {
  const combinedText = `${lot.title} ${lot.subject ?? ''}`;
  const price = parsePrice(lot.priceText ?? '');
  const area = extractArea(combinedText);
  const title = lot.title || lot.subject || `Лот ${lot.lotId}`;

  return {
    external_id: `fabrikant-${lot.lotId}`,
    url: buildLotViewUrl(procedureId, lot.lotId, baseUrl),
    title,
    address: '',
    city: 'other',
    property_location: normalizeStructuredLocation({
      status: 'missing',
      source_kind: 'dom_field',
      source_path: PROPERTY_LOCATION_CONTAINER,
    }),
    area_sqm: area,
    price,
    price_per_sqm: price && area ? Math.round(price / area) : undefined,
    property_type: classifyPropertyType(title),
    auction_type: 'bankruptcy',
    description: lot.subject && lot.subject.length > 20 ? lot.subject : undefined,
    published_at: publishedAt,
  };
}

function extractOrganizerContacts(html: string): string | undefined {
  const root = load(html);
  const organizerSection = root('[class*="organizer"], .procedure-info, .procedure-header').first();
  const scopedText = organizerSection.length > 0
    ? organizerSection.text()
    : root('body').text();

  const contactParts: string[] = [];
  const orgMatch = scopedText.match(/Информация\s+об\s+организаторе\s*\n?\s*(.+?)(?:\n\s*\n|\n\s*Дата)/s);
  if (orgMatch) {
    const orgName = orgMatch[1].trim().split('\n')[0].trim();
    if (orgName.length > 2 && orgName.length < 200) contactParts.push(`Организатор: ${orgName}`);
  }

  const phoneMatch = scopedText.match(/(?:тел(?:ефон)?|phone)[:\s.]+([+\d\s()-]{7,20})/i);
  if (phoneMatch) contactParts.push(`Тел: ${phoneMatch[1].trim()}`);

  const emailMatch = scopedText.match(/(?:email|e-mail|почт[аы])[:\s]+([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
  if (emailMatch) contactParts.push(`Email: ${emailMatch[1].trim()}`);

  return contactParts.length > 0 ? contactParts.join(', ') : undefined;
}

/** Pure HTML extraction for lot-scoped details (used in tests and fetchDetails fallback). */
export function extractLotDetailsFromHtml(html: string, urlOrLotId?: string): FabrikantLotDetails {
  const lotId = urlOrLotId?.includes('/')
    ? extractLotIdFromUrl(urlOrLotId)
    : urlOrLotId;

  const $ = load(html);
  const allContainers = $(PROPERTY_LOCATION_CONTAINER);
  const multiLotUnscoped = allContainers.length > 1 && !lotId;

  let description: string | undefined;
  let priceText: string | undefined;
  let locationFields: PropertyLocationFields;

  if (lotId) {
    const lotRoot = findLotRoot($, lotId);
    if (lotRoot) {
      description = extractLotSubjectFromRoot($, lotRoot) ?? extractLotTitleFromRoot($, lotRoot);
      priceText = extractLotPriceTextFromRoot($, lotRoot);
      locationFields = readLocationFieldsFromContainer(lotRoot.find(PROPERTY_LOCATION_CONTAINER).first());
    } else {
      locationFields = { propertyBlockFound: allContainers.length > 0 };
    }
  } else {
    locationFields = multiLotUnscoped
      ? { propertyBlockFound: true, multiLotUnscoped: true }
      : readLocationFieldsFromContainer(allContainers.first());
  }

  return {
    description: description && description.length > 20 ? description.slice(0, 2000) : undefined,
    contacts: extractOrganizerContacts(html),
    price: parsePrice(priceText ?? ''),
    locationFields,
  };
}

export function resolveLotIdForUrl(url: string): string | undefined {
  return extractLotIdFromUrl(url);
}

export function resolveProcedureIdForUrl(url: string): string | undefined {
  return extractProcedureIdFromUrl(url);
}
