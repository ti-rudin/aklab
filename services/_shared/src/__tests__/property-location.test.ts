import { describe, expect, it } from 'vitest';
import {
  dedupeParties,
  derivePropertyRegion,
  mergePropertyLocation,
  normalizeStructuredLocation,
  projectLegacyAddress,
} from '../property-location';
import type { PropertyLocation, PropertyParty } from '../types';

describe('property location contract', () => {
  it('projects legacy address only from a confirmed property location', () => {
    const confirmed: PropertyLocation = {
      address: 'г. Тверь, ул. Советская, 1',
      region: 'Тверская область',
      status: 'confirmed_address',
      source_kind: 'api_field',
      source_path: 'lot.estateAddress',
    };
    const regionOnly: PropertyLocation = {
      region: 'Тверская область',
      status: 'confirmed_region_only',
      source_kind: 'api_field',
      source_path: 'lot.subject',
    };

    expect(projectLegacyAddress(confirmed)).toBe('г. Тверь, ул. Советская, 1');
    expect(projectLegacyAddress(regionOnly)).toBe('');
  });

  it('derives geography from the property location even when a party has a Moscow address', () => {
    const location: PropertyLocation = {
      region: 'Республика Башкортостан',
      status: 'confirmed_region_only',
      source_kind: 'dom_field',
      source_path: '.lot-region',
    };
    const party: PropertyParty = {
      name: 'ПАО Сбербанк',
      roles: ['pledgee'],
      addresses: [{ kind: 'legal', value: 'г. Москва, ул. Тверская, 1' }],
      source_path: '.pledgee',
      source_kind: 'bounded_text',
      confidence: 'explicit_text',
    };

    expect(derivePropertyRegion(location)).toBe('other');
    expect(party.addresses?.[0].value).toContain('Москва');
  });

  it('distinguishes Tver city from the rest of Tver Oblast', () => {
    const tverCity: PropertyLocation = {
      address: 'г. Тверь, ул. Советская, 1',
      region: 'Тверская область',
      status: 'confirmed_address',
      source_kind: 'api_field',
      source_path: 'lot.estateAddress',
    };
    const tverOblast: PropertyLocation = {
      address: 'г. Ржев, ул. Ленина, 2',
      region: 'Тверская область',
      status: 'confirmed_address',
      source_kind: 'api_field',
      source_path: 'lot.estateAddress',
    };

    expect(derivePropertyRegion(tverCity)).toBe('tver');
    expect(derivePropertyRegion(tverOblast)).toBe('tver_oblast');
    expect(derivePropertyRegion({
      region: 'Тверская область',
      status: 'confirmed_region_only',
      source_kind: 'api_field',
      source_path: 'lot.region',
    })).toBe('tver_oblast');
  });

  it('upgrades a region-only scan with a confirmed detail address without losing scan geography', () => {
    const scan: PropertyLocation = {
      region: 'Республика Башкортостан',
      latitude: 54.7,
      longitude: 55.9,
      status: 'confirmed_region_only',
      source_kind: 'api_field',
      source_path: 'lot.region',
    };
    const details: PropertyLocation = {
      address: 'г. Уфа, ул. Ленина, 1',
      status: 'confirmed_address',
      source_kind: 'dom_field',
      source_path: '.lot-address',
    };

    expect(mergePropertyLocation(scan, details)).toEqual({
      address: details.address,
      region: scan.region,
      latitude: scan.latitude,
      longitude: scan.longitude,
      status: 'confirmed_address',
      source_kind: details.source_kind,
      source_path: details.source_path,
    });
  });

  it('does not let a missing detail location erase a confirmed scan location', () => {
    const scan: PropertyLocation = {
      address: 'г. Тверь, ул. Советская, 1',
      region: 'Тверская область',
      status: 'confirmed_address',
      source_kind: 'api_field',
      source_path: 'lot.estateAddress',
    };
    const missing: PropertyLocation = {
      status: 'missing',
      source_kind: 'dom_field',
      source_path: '.lot-address',
    };

    expect(mergePropertyLocation(scan, missing)).toEqual(scan);
  });

  it('normalizes structured fields without extracting an address from free text', () => {
    const location = normalizeStructuredLocation({
      address: '  ',
      region: '  Республика Тверьская  ',
      latitude: 56.8587,
      longitude: 35.9118,
      status: 'confirmed_region_only',
      source_kind: 'api_field',
      source_path: 'lot.location',
    });

    expect(location).toEqual({
      region: 'Республика Тверьская',
      latitude: 56.8587,
      longitude: 35.9118,
      status: 'confirmed_region_only',
      source_kind: 'api_field',
      source_path: 'lot.location',
    });
  });

  it('rejects missing provenance and non-finite or out-of-range coordinates', () => {
    expect(() => normalizeStructuredLocation({
      region: 'Тверская область',
      status: 'confirmed_region_only',
      source_kind: 'api_field',
      source_path: '',
    })).toThrow(/source_path is required/);
    expect(() => normalizeStructuredLocation({
      region: 'Тверская область',
      status: 'confirmed_region_only',
      source_kind: 'api_field',
      source_path: 'lot.location',
      latitude: Number.NaN,
      longitude: 35,
    })).toThrow(/latitude/);
    expect(() => normalizeStructuredLocation({
      region: 'Тверская область',
      status: 'confirmed_region_only',
      source_kind: 'api_field',
      source_path: 'lot.location',
      latitude: 56,
      longitude: 181,
    })).toThrow(/longitude/);
  });

  it('rejects false confirmation statuses and incomplete coordinate pairs', () => {
    expect(() => normalizeStructuredLocation({
      status: 'confirmed_address',
      source_kind: 'api_field',
      source_path: 'lot.address',
      address: '  ',
    })).toThrow(/confirmed_address requires address/);
    expect(() => normalizeStructuredLocation({
      status: 'confirmed_region_only',
      source_kind: 'api_field',
      source_path: 'lot.region',
    })).toThrow(/confirmed_region_only requires/);
    expect(() => normalizeStructuredLocation({
      status: 'confirmed_region_only',
      source_kind: 'api_field',
      source_path: 'lot.coordinates',
      latitude: 56.8587,
    })).toThrow(/coordinates must be provided as a pair/);
    expect(() => normalizeStructuredLocation({
      status: 'missing',
      source_kind: 'api_field',
      source_path: 'lot.address',
      address: 'г. Тверь',
    })).toThrow(/missing location cannot contain/);
  });

  it('deduplicates parties by INN, merges roles, and keeps legal/postal addresses distinct', () => {
    const parties: PropertyParty[] = [
      {
        name: 'ПАО Сбербанк',
        inn: ' 7707083893 ',
        roles: ['pledgee'],
        addresses: [{ kind: 'legal', value: 'г. Москва, ул. Вавилова, 19' }],
        source_path: '.pledgee',
        source_kind: 'bounded_text',
        confidence: 'explicit_text',
      },
      {
        name: 'Сбербанк России',
        inn: '7707083893',
        roles: ['secured_creditor'],
        addresses: [{ kind: 'postal', value: 'г. Москва, ул. Вавилова, 19' }],
        source_path: '.creditor',
        source_kind: 'dom_field',
        confidence: 'structured',
      },
    ];

    const result = dedupeParties(parties);

    expect(result).toHaveLength(1);
    expect(result[0].roles).toEqual(['pledgee', 'secured_creditor']);
    expect(result[0].addresses).toEqual([
      { kind: 'legal', value: 'г. Москва, ул. Вавилова, 19' },
      { kind: 'postal', value: 'г. Москва, ул. Вавилова, 19' },
    ]);
  });

  it('uses OGRN when INN is absent and normalized name as the final identity', () => {
    const result = dedupeParties([
      {
        name: 'ООО Ромашка',
        ogrn: '1027700132195',
        roles: ['seller'],
        source_path: 'seller.one',
        source_kind: 'api_field',
        confidence: 'structured',
      },
      {
        name: 'ООО   Ромашка',
        ogrn: '1027700132195',
        roles: ['organizer'],
        source_path: 'seller.two',
        source_kind: 'dom_field',
        confidence: 'structured',
      },
      {
        name: 'АО Берёзка',
        roles: ['customer'],
        source_path: 'customer.one',
        source_kind: 'xml_field',
        confidence: 'structured',
      },
      {
        name: 'ао берёзка',
        roles: ['debtor'],
        source_path: 'customer.two',
        source_kind: 'xml_field',
        confidence: 'structured',
      },
    ]);

    expect(result).toHaveLength(2);
    expect(result[0].roles).toEqual(['seller', 'organizer']);
    expect(result[1].roles).toEqual(['customer', 'debtor']);
  });
});
