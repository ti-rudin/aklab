import { load } from 'cheerio';
import type { PropertyLocation } from '@aklab/service-shared';
import {
  extractAddressFromBoundedPropertyText,
  normalizeStructuredLocation,
} from '@aklab/service-shared';

export const PROPERTY_REGION_LABEL = 'Регион местонахождения имущества';
export const LISTING_LOCATION_SOURCE_PATH = 'listing.property_location';
export const DETAIL_PROPERTY_DESCRIPTION_SOURCE_PATH = 'details.field.Сведения об имуществе.address';
export const DETAIL_PROPERTY_REGION_SOURCE_PATH = `details.field.${PROPERTY_REGION_LABEL}`;

const LOT_DELIMITER_LABELS = new Set([
  'Номер лота',
  'Номер лота в извещении',
  'Лот №',
]);

const PROPERTY_SIGNAL_LABELS = new Set([
  'Сведения об имуществе',
  'Краткие сведения об имуществе',
  PROPERTY_REGION_LABEL,
  'Начальная цена продажи',
]);

export interface EtprfPropertyLocationFields {
  [key: string]: unknown;
  propertyBlockFound?: boolean;
  propertyDescription?: string;
  propertyRegion?: string;
  multiLotUnscoped?: boolean;
}

export interface EtprfLotSection {
  lotKey?: string;
  fields: Map<string, string>;
}

function cleanLabel(raw: string): string {
  return raw.replace(/\s+/g, ' ').replace(/:$/, '').trim();
}

function cleanValue(raw: string | undefined): string | undefined {
  const trimmed = raw?.replace(/\s+/g, ' ').trim();
  return trimmed || undefined;
}

function sectionHasPropertySignal(fields: Map<string, string>): boolean {
  for (const label of PROPERTY_SIGNAL_LABELS) {
    if (fields.has(label)) return true;
  }
  return false;
}

/** Split notification HTML into lot-scoped field maps. */
export function parseEtprfLotSections(html: string): EtprfLotSection[] {
  const $ = load(html);
  const sections: EtprfLotSection[] = [];
  let current: EtprfLotSection = { fields: new Map() };

  for (const row of $('.details-table tr').toArray()) {
    const label = cleanLabel($(row).find('.td-label').first().text());
    const value = cleanValue($(row).find('.td-value').first().text());
    if (!label || !value) continue;

    if (LOT_DELIMITER_LABELS.has(label)) {
      if (sectionHasPropertySignal(current.fields) || current.lotKey) {
        sections.push(current);
      }
      current = { lotKey: value, fields: new Map() };
      continue;
    }

    if (label === 'Сведения об имуществе' && current.fields.has('Сведения об имуществе')) {
      sections.push(current);
      current = { lotKey: current.lotKey, fields: new Map() };
    }

    current.fields.set(label, value);
  }

  if (sectionHasPropertySignal(current.fields) || current.lotKey) {
    sections.push(current);
  }

  return sections.filter(section => sectionHasPropertySignal(section.fields) || section.lotKey);
}

export function countEtprfPropertyRegions(sections: EtprfLotSection[]): number {
  const regions = new Set<string>();
  for (const section of sections) {
    const region = section.fields.get(PROPERTY_REGION_LABEL);
    if (region) regions.add(region);
  }
  return regions.size;
}

function normalizeLotKey(value: string | undefined): string | undefined {
  return value?.replace(/\s+/g, ' ').trim().toLowerCase();
}

function sectionMatchesLotId(section: EtprfLotSection, lotId: string): boolean {
  const target = normalizeLotKey(lotId);
  if (!target) return false;
  const candidates = [
    section.lotKey,
    section.fields.get('Номер лота'),
    section.fields.get('Номер лота в извещении'),
    section.fields.get('Лот №'),
  ];
  return candidates.some(candidate => normalizeLotKey(candidate) === target);
}

export function selectEtprfLotSection(sections: EtprfLotSection[], lotId?: string): EtprfLotSection | undefined {
  const propertySections = sections.filter(section => sectionHasPropertySignal(section.fields));
  if (propertySections.length === 0) return undefined;
  if (propertySections.length === 1) return propertySections[0];
  if (!lotId) return undefined;
  return propertySections.find(section => sectionMatchesLotId(section, lotId));
}

export function extractLotIdFromEtprfUrl(url: string): string | undefined {
  const hash = url.match(/#lot-([^/?#]+)/);
  if (hash?.[1]) return hash[1];
  const path = url.match(/\/Notification\/id\/([^/?#]+)/);
  return path?.[1];
}

export function appendEtprfLotScope(url: string, lotId: string): string {
  const base = url.split('#')[0];
  return `${base}#lot-${lotId}`;
}

export function fieldsFromEtprfSection(section: EtprfLotSection): EtprfPropertyLocationFields {
  const propertyDescription = section.fields.get('Сведения об имуществе')
    ?? section.fields.get('Краткие сведения об имуществе');
  const propertyRegion = section.fields.get(PROPERTY_REGION_LABEL);
  return {
    propertyBlockFound: Boolean(propertyDescription || propertyRegion),
    ...(propertyDescription ? { propertyDescription: propertyDescription.slice(0, 2000) } : {}),
    ...(propertyRegion ? { propertyRegion } : {}),
  };
}

/** Exact-label extraction scoped to one lot section when possible. */
export function extractEtprfPropertyLocationFields(html: string, lotId?: string): EtprfPropertyLocationFields {
  const sections = parseEtprfLotSections(html);
  const regionCount = countEtprfPropertyRegions(sections);
  const propertySections = sections.filter(section => sectionHasPropertySignal(section.fields));

  if ((propertySections.length > 1 || regionCount > 1) && !lotId) {
    return { propertyBlockFound: true, multiLotUnscoped: true };
  }

  const selected = selectEtprfLotSection(sections, lotId);
  if (!selected) {
    if (propertySections.length > 1) {
      return { propertyBlockFound: true, multiLotUnscoped: true };
    }
    return { propertyBlockFound: false };
  }

  return fieldsFromEtprfSection(selected);
}

export function getEtprfFieldValue(section: EtprfLotSection | undefined, labelText: string): string | undefined {
  if (!section) return undefined;
  if (section.fields.has(labelText)) return section.fields.get(labelText);
  for (const [label, value] of section.fields.entries()) {
    if (label.includes(labelText)) return value;
  }
  return undefined;
}

export function extractOrganizerContactsFromHtml(html: string): string | undefined {
  const $ = load(html);
  const contactParts: string[] = [];

  for (const row of $('.details-table tr').toArray()) {
    const label = cleanLabel($(row).find('.td-label').first().text());
    const valueCell = $(row).find('.td-value').first();
    const value = cleanValue(valueCell.text());
    if (!label || !value) continue;

    if (label.includes('Организатор торгов')) contactParts.push(value);
    if (label.includes('Номер контактного телефона')) contactParts.push(value);
    if (label.includes('Адрес электронной почты')) {
      const mailto = valueCell.find('a[href^="mailto:"]').attr('href')?.replace('mailto:', '').trim();
      contactParts.push(mailto || value);
    }
  }

  return contactParts.length > 0 ? contactParts.join(', ') : undefined;
}

export function extractEtprfListingLocation(_fields?: {
  subject?: unknown;
  notification?: unknown;
}): PropertyLocation {
  return normalizeStructuredLocation({
    status: 'missing',
    source_kind: 'dom_field',
    source_path: LISTING_LOCATION_SOURCE_PATH,
  });
}

function structuredText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

/** Extract geography only from ETPRF's bounded current-property fields. */
export function extractEtprfPropertyLocation(fields: EtprfPropertyLocationFields): PropertyLocation {
  if (fields.multiLotUnscoped) {
    return normalizeStructuredLocation({
      status: 'missing',
      source_kind: 'dom_field',
      source_path: DETAIL_PROPERTY_REGION_SOURCE_PATH,
    });
  }

  const propertyDescription = structuredText(fields.propertyDescription);
  const region = structuredText(fields.propertyRegion);
  const address = extractAddressFromBoundedPropertyText(propertyDescription);
  if (address) {
    return normalizeStructuredLocation({
      address,
      ...(region ? { region } : {}),
      status: 'confirmed_address',
      source_kind: 'dom_field',
      source_path: DETAIL_PROPERTY_DESCRIPTION_SOURCE_PATH,
    });
  }
  if (region) {
    return normalizeStructuredLocation({
      region,
      status: 'confirmed_region_only',
      source_kind: 'dom_field',
      source_path: DETAIL_PROPERTY_REGION_SOURCE_PATH,
    });
  }

  return normalizeStructuredLocation({
    status: 'missing',
    source_kind: 'dom_field',
    source_path: DETAIL_PROPERTY_REGION_SOURCE_PATH,
  });
}

export function extractEtprfLotDetailsFromHtml(
  html: string,
  lotId?: string,
): {
  locationFields: EtprfPropertyLocationFields;
  description?: string;
  priceText?: string;
  contacts?: string;
} {
  const sections = parseEtprfLotSections(html);
  const locationFields = extractEtprfPropertyLocationFields(html, lotId);
  const selected = selectEtprfLotSection(sections, lotId) ?? (sections.length === 1 ? sections[0] : undefined);
  const description = getEtprfFieldValue(selected, 'Сведения об имуществе')
    ?? getEtprfFieldValue(selected, 'Краткие сведения об имуществе');
  const priceText = getEtprfFieldValue(selected, 'Начальная цена продажи');

  return {
    locationFields,
    description: description?.slice(0, 2000),
    priceText,
    contacts: extractOrganizerContactsFromHtml(html),
  };
}

/** Browser-safe wrapper kept for Playwright evaluate probes. */
export function extractEtprfPropertyLocationFieldsFromDocument(documentLike?: Document): EtprfPropertyLocationFields {
  const html = documentLike?.documentElement?.outerHTML ?? '';
  const lotId = documentLike?.defaultView?.location?.hash?.replace(/^#lot-/, '') || undefined;
  return extractEtprfPropertyLocationFields(html, lotId || undefined);
}
