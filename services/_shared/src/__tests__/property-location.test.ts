import { describe, expect, it } from 'vitest';
import {
  dedupeParties,
  derivePropertyRegion,
  extractAddressFromBoundedPropertyText,
  mergePropertyLocation,
  normalizeStructuredLocation,
  projectLegacyAddress,
} from '../property-location';
import type { PropertyLocation, PropertyParty } from '../types';

describe('property location contract', () => {
  describe('bounded current-property address extraction', () => {
    it.each([
      [
        'объект недвижимости. Адрес (местоположение): Россия, Волгоградская область, город Волгоград, улица 51-й Гвардейской, дом 46. Имеются ограничения.',
        'Россия, Волгоградская область, город Волгоград, улица 51-й Гвардейской, дом 46',
      ],
      [
        'Квартира расположена по адресу: Московская область, г. Лобня, ул. Центральная, д. 1, кв. 3, кадастровый номер 50:41:0040110:1076.',
        'Московская область, г. Лобня, ул. Центральная, д. 1, кв. 3',
      ],
      [
        'Земельный участок. Место нахождения: Красноярский край, р-н Уярский, с. Восточное, ул. Зеленая, д. 20, площадь 3200 кв. м.',
        'Красноярский край, р-н Уярский, с. Восточное, ул. Зеленая, д. 20',
      ],
      [
        'Местоположение установлено относительно ориентира. Почтовый адрес ориентира: Республика Мордовия, Лямбирский район, с. Владимировка, ул. Дачная, 33. Площадь: 1031 кв.м.',
        'Республика Мордовия, Лямбирский район, с. Владимировка, ул. Дачная, 33',
      ],
      [
        'Объект недвижимости находится по адресу: Тверская область, г. Тверь, ул. Советская, д. 1',
        'Тверская область, г. Тверь, ул. Советская, д. 1',
      ],
      [
        'Адресу: Тверская область, г. Тверь, ул. Советская, д. 1',
        'Тверская область, г. Тверь, ул. Советская, д. 1',
      ],
    ])('extracts an explicit address from a semantically bounded property field', (text, expected) => {
      expect(extractAddressFromBoundedPropertyText(text)).toBe(expected);
    });

    it('does not accept contact labels or arbitrary unlabelled geography', () => {
      expect(extractAddressFromBoundedPropertyText(
        'Организатор: Банк. Почтовый адрес: г. Москва, ул. Вавилова, д. 19',
      )).toBeUndefined();
      expect(extractAddressFromBoundedPropertyText(
        'Квартира. Залогодержатель находится по адресу: г. Москва, ул. Вавилова, д. 19',
      )).toBeUndefined();
      expect(extractAddressFromBoundedPropertyText(
        'Квартира, Московская область, г. Лобня, ул. Центральная, д. 1',
      )).toBeUndefined();
      expect(extractAddressFromBoundedPropertyText(
        'Должник: Тестовое общество. Адрес: г. Москва, ул. Вавилова, д. 19',
      )).toBeUndefined();
      expect(extractAddressFromBoundedPropertyText('Адрес: https://example.test/lot/1')).toBeUndefined();
      expect(extractAddressFromBoundedPropertyText('Адрес: test@example.test')).toBeUndefined();
    });

    it('stops before the next explicit party label', () => {
      for (const text of [
        'Адрес: г. Тверь, ул. Советская, д. 1. Организатор: Тестовое общество, г. Москва',
        'Адрес: г. Тверь, ул. Советская, д. 1. Почтовый адрес организатора: г. Москва, ул. Вавилова, д. 19',
        'Адрес: г. Тверь, ул. Советская, д. 1. Адрес залогодержателя: г. Москва, ул. Вавилова, д. 19',
        'Адрес: г. Тверь, ул. Советская, д. 1. Залогодержатель находится по адресу: г. Москва, ул. Вавилова, д. 19',
      ]) {
        const address = extractAddressFromBoundedPropertyText(text);
        expect(address).toBe('г. Тверь, ул. Советская, д. 1');
        expect(address).not.toContain('Москва');
      }
    });
  });

  it('rejects the removed legacy-unverified status', () => {
    expect(() => normalizeStructuredLocation({
      status: 'legacy_unverified',
      source_kind: 'api_field',
      source_path: 'legacy.address',
    } as never)).toThrow('Invalid property location: status is required');
  });

  it('rejects a full address under the region-only status', () => {
    expect(() => normalizeStructuredLocation({
      status: 'confirmed_region_only',
      address: 'г. Москва, ул. Тверская, 1',
      region: 'Москва',
      source_kind: 'api_field',
      source_path: 'lot.region',
    })).toThrow('confirmed_region_only cannot contain address');
  });

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

  it('derives Moscow Oblast from a confirmed structured address without a duplicate region field', () => {
    expect(derivePropertyRegion({
      address: 'Московская область, г. Подольск, ул. Ленина, 1',
      status: 'confirmed_address',
      source_kind: 'api_field',
      source_path: 'place.fields[name="Адрес"]',
    })).toBe('mo');
  });

  it('upgrades a region-only scan without mixing fields from different provenance', () => {
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

    expect(mergePropertyLocation(scan, details)).toEqual(details);
  });

  it('does not let an older scan region override a contradictory confirmed detail address', () => {
    const merged = mergePropertyLocation({
      region: 'Тверская область',
      status: 'confirmed_region_only',
      source_kind: 'api_field',
      source_path: 'scan.region',
    }, {
      address: 'г. Москва, ул. Вавилова, 19',
      status: 'confirmed_address',
      source_kind: 'dom_field',
      source_path: 'detail.address',
    });

    expect(merged).toEqual({
      address: 'г. Москва, ул. Вавилова, 19',
      status: 'confirmed_address',
      source_kind: 'dom_field',
      source_path: 'detail.address',
    });
    expect(derivePropertyRegion(merged)).toBe('moscow');
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
