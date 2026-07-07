import { describe, it, expect } from 'vitest';

/**
 * Тесты extraction-логики parser-invest-mosreg.
 *
 * Функции getField, extractArea, extractPrice, toProperty — приватные модулю.
 * Для тестирования воспроизводим их логику как standalone-функции.
 * Источник: services/parser-invest-mosreg/src/sources/invest-mosreg.ts
 */

// --- Types ---

interface MapPlace {
  id: string;
  uid: string;
  name: string;
  cadastralNumber?: string;
  center?: [number, number]; // [lat, lon]
  fields: Array<{ id: number; name: string; value?: string; type?: number }>;
}

interface ParsedProperty {
  external_id: string;
  url: string;
  title: string;
  address: string;
  city: string;
  area_sqm?: number;
  price?: number;
  price_per_sqm?: number;
  property_type: string;
  auction_type: string;
  description?: string;
  contacts?: string;
  latitude?: number;
  longitude?: number;
}

// --- Replicated extraction functions from invest-mosreg.ts ---

const BASE_URL = 'https://invest.mosreg.ru';

function getField(place: MapPlace, fieldName: string): string {
  const f = place.fields.find(
    (x) => x.name?.toLowerCase().includes(fieldName.toLowerCase()),
  );
  return (f?.value ?? '').toString().trim();
}

function extractArea(place: MapPlace): number | undefined {
  // Пробуем поля «Площадь»
  for (const f of place.fields) {
    if (/площадь/i.test(f.name) && f.value) {
      const num = parseFloat(String(f.value).replace(',', '.'));
      if (!isNaN(num) && num > 0) return num;
    }
  }
  // Из текста названия
  const match = place.name.match(/(\d[\d\s]*[,.]?\d*)\s*(?:кв\.?\s*м|м²|м2)/i);
  if (match) {
    const num = parseFloat(match[1].replace(/\s/g, '').replace(',', '.'));
    if (!isNaN(num) && num > 0) return num;
  }
  return undefined;
}

function extractPrice(place: MapPlace): number | undefined {
  // Кадастровая стоимость — API возвращает в млн. руб.
  for (const f of place.fields) {
    if (/кадастровая стоимость/i.test(f.name) && f.value) {
      const raw = String(f.value);
      const num = parseFloat(raw.replace(',', '.'));
      if (!isNaN(num) && num > 0) {
        // Если значение < 1000 — скорее всего млн. руб., конвертируем
        return num < 1000 ? Math.round(num * 1_000_000) : num;
      }
    }
  }
  return undefined;
}

function toProperty(place: MapPlace, menuName: string): ParsedProperty {
  const address = getField(place, 'адрес');
  const municipality = getField(place, 'муниципальное образование');
  const useType = getField(place, 'ври') || getField(place, 'вид разрешенного');
  const area = extractArea(place);
  const price = extractPrice(place);

  return {
    external_id: `invest-mosreg-${place.uid || place.id}`,
    url: `${BASE_URL}/investor/map`,
    title: place.name.slice(0, 300),
    address: address || municipality || '',
    city: 'mo',
    area_sqm: area,
    price,
    price_per_sqm: price && area ? Math.round(price / area) : undefined,
    property_type: 'commercial',
    auction_type: 'marketplace',
    latitude: place.center?.[0],
    longitude: place.center?.[1],
  };
}

// --- Tests ---

describe('invest-mosreg: getField', () => {
  const place: MapPlace = {
    id: '1',
    uid: 'uid-1',
    name: 'Тестовый объект',
    fields: [
      { id: 1, name: 'Адрес объекта', value: 'г. Москва, ул. Пушкина, д. 1' },
      { id: 2, name: 'Муниципальное образование', value: 'Подольский район' },
      { id: 3, name: 'ВРИ', value: 'Коммерческое использование' },
      { id: 4, name: 'Статус', value: 'Свободен' },
      { id: 5, name: 'ФИО', value: 'Иванов И.И.' },
    ],
  };

  it('should find field by partial case-insensitive name match', () => {
    expect(getField(place, 'адрес')).toBe('г. Москва, ул. Пушкина, д. 1');
  });

  it('should find municipality field', () => {
    expect(getField(place, 'муниципальное')).toBe('Подольский район');
  });

  it('should find ВРИ field', () => {
    expect(getField(place, 'ври')).toBe('Коммерческое использование');
  });

  it('should return empty string for missing field', () => {
    expect(getField(place, 'несуществующее')).toBe('');
  });

  it('should handle field with undefined value', () => {
    const p: MapPlace = {
      id: '2', uid: 'u2', name: 'Test',
      fields: [{ id: 1, name: 'Площадь', value: undefined }],
    };
    expect(getField(p, 'площадь')).toBe('');
  });

  it('should return empty string for place with no fields', () => {
    const p: MapPlace = { id: '3', uid: 'u3', name: 'Test', fields: [] };
    expect(getField(p, 'адрес')).toBe('');
  });
});

describe('invest-mosreg: extractArea', () => {
  it('should extract area from field named "Площадь"', () => {
    const place: MapPlace = {
      id: '1', uid: 'u1', name: 'Объект',
      fields: [{ id: 1, name: 'Площадь объекта', value: '150.5' }],
    };
    expect(extractArea(place)).toBe(150.5);
  });

  it('should extract area with comma decimal from field', () => {
    const place: MapPlace = {
      id: '1', uid: 'u1', name: 'Объект',
      fields: [{ id: 1, name: 'Общая площадь', value: '85,3' }],
    };
    expect(extractArea(place)).toBe(85.3);
  });

  it('should extract area from name text "150 кв.м"', () => {
    const place: MapPlace = {
      id: '1', uid: 'u1', name: 'Помещение 150 кв.м',
      fields: [],
    };
    expect(extractArea(place)).toBe(150);
  });

  it('should extract area from name text "1 500 м²"', () => {
    const place: MapPlace = {
      id: '1', uid: 'u1', name: 'Здание 1 500 м²',
      fields: [],
    };
    expect(extractArea(place)).toBe(1500);
  });

  it('should prefer field over name text', () => {
    const place: MapPlace = {
      id: '1', uid: 'u1', name: 'Помещение 50 кв.м',
      fields: [{ id: 1, name: 'Площадь', value: '200' }],
    };
    expect(extractArea(place)).toBe(200);
  });

  it('should return undefined when no area found', () => {
    const place: MapPlace = {
      id: '1', uid: 'u1', name: 'Склад',
      fields: [{ id: 1, name: 'Статус', value: 'Свободен' }],
    };
    expect(extractArea(place)).toBeUndefined();
  });

  it('should return undefined for empty fields and name without area', () => {
    const place: MapPlace = {
      id: '1', uid: 'u1', name: 'Объект без площади',
      fields: [],
    };
    expect(extractArea(place)).toBeUndefined();
  });

  it('should skip field with empty value and try next', () => {
    const place: MapPlace = {
      id: '1', uid: 'u1', name: 'Помещение 75 м2',
      fields: [
        { id: 1, name: 'Площадь', value: '' },
        { id: 2, name: 'Площадь общая', value: '' },
      ],
    };
    expect(extractArea(place)).toBe(75);
  });

  it('should return undefined for zero-area field', () => {
    const place: MapPlace = {
      id: '1', uid: 'u1', name: 'Объект',
      fields: [{ id: 1, name: 'Площадь', value: '0' }],
    };
    expect(extractArea(place)).toBeUndefined();
  });
});

describe('invest-mosreg: extractPrice', () => {
  it('should extract price from "Кадастровая стоимость" field', () => {
    const place: MapPlace = {
      id: '1', uid: 'u1', name: 'Объект',
      fields: [{ id: 1, name: 'Кадастровая стоимость', value: '5000000' }],
    };
    expect(extractPrice(place)).toBe(5000000);
  });

  it('should extract price with comma decimal', () => {
    const place: MapPlace = {
      id: '1', uid: 'u1', name: 'Объект',
      fields: [{ id: 1, name: 'Кадастровая стоимость', value: '1234567,89' }],
    };
    expect(extractPrice(place)).toBe(1234567.89);
  });

  it('should return undefined when no price field present', () => {
    const place: MapPlace = {
      id: '1', uid: 'u1', name: 'Объект',
      fields: [{ id: 1, name: 'Площадь', value: '100' }],
    };
    expect(extractPrice(place)).toBeUndefined();
  });

  it('should return undefined for empty price field', () => {
    const place: MapPlace = {
      id: '1', uid: 'u1', name: 'Объект',
      fields: [{ id: 1, name: 'Кадастровая стоимость', value: '' }],
    };
    expect(extractPrice(place)).toBeUndefined();
  });

  it('should return undefined for zero price', () => {
    const place: MapPlace = {
      id: '1', uid: 'u1', name: 'Объект',
      fields: [{ id: 1, name: 'Кадастровая стоимость', value: '0' }],
    };
    expect(extractPrice(place)).toBeUndefined();
  });

  it('should return undefined for non-numeric value', () => {
    const place: MapPlace = {
      id: '1', uid: 'u1', name: 'Объект',
      fields: [{ id: 1, name: 'Кадастровая стоимость', value: 'не определена' }],
    };
    expect(extractPrice(place)).toBeUndefined();
  });
});

describe('invest-mosreg: toProperty', () => {
  const fullPlace: MapPlace = {
    id: '42',
    uid: 'uid-42',
    name: 'Земельный участок 1500 м² для коммерческого использования',
    cadastralNumber: '50:20:0010200:35',
    center: [55.7558, 37.6173],
    fields: [
      { id: 1, name: 'Адрес', value: 'Московская обл., г. Подольск, ул. Ленина' },
      { id: 2, name: 'Муниципальное образование', value: 'Подольский район' },
      { id: 3, name: 'Площадь', value: '1500' },
      { id: 4, name: 'Кадастровая стоимость', value: '7500000' },
      { id: 5, name: 'ВРИ', value: 'Коммерческое использование' },
      { id: 6, name: 'Статус', value: 'Свободен' },
      { id: 7, name: 'ФИО', value: 'Петров П.П.' },
    ],
  };

  it('should convert full place to ParsedProperty', () => {
    const prop = toProperty(fullPlace, 'Покупка');
    expect(prop.external_id).toBe('invest-mosreg-uid-42');
    expect(prop.url).toBe('https://invest.mosreg.ru/investor/map');
    expect(prop.title).toContain('Земельный участок');
    expect(prop.address).toBe('Московская обл., г. Подольск, ул. Ленина');
    expect(prop.city).toBe('mo');
    expect(prop.area_sqm).toBe(1500);
    expect(prop.price).toBe(7500000);
    expect(prop.price_per_sqm).toBe(5000);
    expect(prop.auction_type).toBe('marketplace');
    expect(prop.latitude).toBe(55.7558);
    expect(prop.longitude).toBe(37.6173);
  });

  it('should use id when uid is empty', () => {
    const place: MapPlace = { ...fullPlace, uid: '', id: '99' };
    const prop = toProperty(place, 'Аренда');
    expect(prop.external_id).toBe('invest-mosreg-99');
  });

  it('should fall back to municipality when address is empty', () => {
    const place: MapPlace = {
      ...fullPlace,
      fields: [
        { id: 1, name: 'Муниципальное образование', value: 'Серпуховский район' },
      ],
    };
    const prop = toProperty(place, 'Покупка');
    expect(prop.address).toBe('Серпуховский район');
  });

  it('should handle place with no center coordinates', () => {
    const place: MapPlace = { ...fullPlace, center: undefined };
    const prop = toProperty(place, 'Покупка');
    expect(prop.latitude).toBeUndefined();
    expect(prop.longitude).toBeUndefined();
  });

  it('should handle place with minimal fields', () => {
    const place: MapPlace = {
      id: '1', uid: 'u1', name: 'Минимальный объект',
      fields: [],
    };
    const prop = toProperty(place, 'Покупка');
    expect(prop.external_id).toBe('invest-mosreg-u1');
    expect(prop.title).toBe('Минимальный объект');
    expect(prop.address).toBe('');
    expect(prop.area_sqm).toBeUndefined();
    expect(prop.price).toBeUndefined();
    expect(prop.price_per_sqm).toBeUndefined();
  });

  it('should calculate price_per_sqm only when both price and area exist', () => {
    // Only price, no area
    const place1: MapPlace = {
      id: '1', uid: 'u1', name: 'Test',
      fields: [{ id: 1, name: 'Кадастровая стоимость', value: '1000000' }],
    };
    expect(toProperty(place1, 'Покупка').price_per_sqm).toBeUndefined();

    // Only area, no price
    const place2: MapPlace = {
      id: '2', uid: 'u2', name: 'Test',
      fields: [{ id: 1, name: 'Площадь', value: '100' }],
    };
    expect(toProperty(place2, 'Покупка').price_per_sqm).toBeUndefined();
  });

  it('should truncate title to 300 chars', () => {
    const place: MapPlace = {
      id: '1', uid: 'u1', name: 'A'.repeat(500),
      fields: [],
    };
    const prop = toProperty(place, 'Покупка');
    expect(prop.title.length).toBeLessThanOrEqual(300);
  });
});
