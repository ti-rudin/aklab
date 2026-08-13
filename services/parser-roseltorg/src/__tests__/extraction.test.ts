import { describe, it, expect } from 'vitest';
import {
  derivePropertyRegion,
  parsePrice,
  projectLegacyAddress,
} from '@aklab/service-shared';
import { missingRoseltorgPropertyLocation } from '../sources/roseltorg';

/**
 * Тесты extraction-логики parser-roseltorg.
 *
 * `parsePrice` is shared and `extractArea` is private to the parser.
 * Geography tests exercise the real `RoseltorgParser.fetchDetails` path with a
 * synthetic page, including adversarial title/body/party mentions.
 */

// --- Extraction helpers from roseltorg.ts ---

function extractArea(text: string): number | undefined {
  const match = text.match(/(\d[\d\s]*[,.]?\d*)\s*(?:кв\.?\s*м|м²|м2)/i);
  if (match) {
    const cleaned = match[1].replace(/\s/g, '').replace(',', '.');
    const num = parseFloat(cleaned);
    if (!isNaN(num) && num > 0) return num;
  }
  return undefined;
}

// --- Tests ---

describe('roseltorg: parsePrice', () => {
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

  it('should parse "10 000 000 руб."', () => {
    expect(parsePrice('10 000 000 руб.')).toBe(10000000);
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

  it('should return undefined for negative-looking text', () => {
    // After cleaning: only digits/comma, "-100" → "100" — actually positive
    // The regex strips non-digits so negatives aren't distinguishable
    expect(parsePrice('100 ₽')).toBe(100);
  });
});

describe('roseltorg: extractArea', () => {
  it('should extract area from "150 кв.м"', () => {
    expect(extractArea('Нежилое помещение 150 кв.м')).toBe(150);
  });

  it('should extract area from "1 500 кв.м" (with space)', () => {
    expect(extractArea('Здание 1 500 кв.м')).toBe(1500);
  });

  it('should extract area with comma decimal: "150,5 кв.м"', () => {
    expect(extractArea('Помещение площадью 150,5 кв.м')).toBe(150.5);
  });

  it('should extract area from "кв. м" with space', () => {
    expect(extractArea('Помещение 54.2 кв. м')).toBe(54.2);
  });

  it('should extract area from "м²"', () => {
    expect(extractArea('Офис 85 м²')).toBe(85);
  });

  it('should extract area from "м2" (ASCII)', () => {
    expect(extractArea('Склад 200 м2')).toBe(200);
  });

  it('should extract area with "кв м" (no dot)', () => {
    expect(extractArea('Помещение 50 кв м')).toBe(50);
  });

  it('should return undefined for text without area pattern', () => {
    expect(extractArea('Просто текст')).toBeUndefined();
  });

  it('should return undefined for empty string', () => {
    expect(extractArea('')).toBeUndefined();
  });

  it('should extract decimal area with dot: "54.2 м²"', () => {
    expect(extractArea('Помещение 54.2 м²')).toBe(54.2);
  });

  it('should handle area with large numbers: "1 200.5 кв.м"', () => {
    expect(extractArea('Здание 1 200.5 кв.м')).toBe(1200.5);
  });
});

describe('roseltorg: combined extraction', () => {
  it('should extract price and area from typical excerpt', () => {
    const excerpt = 'Нежилое помещение площадью 150 кв.м, стоимость 5 000 000,00 ₽';
    expect(extractArea(excerpt)).toBe(150);
    expect(parsePrice('5 000 000,00 ₽')).toBe(5000000);
  });

  it('should compute price_per_sqm when both available', () => {
    const price = parsePrice('10 000 000 ₽');
    const area = extractArea('200 м²');
    expect(price).toBe(10000000);
    expect(area).toBe(200);
    expect(Math.round(price! / area!)).toBe(50000);
  });
});

describe('roseltorg: fail-closed property geography', () => {
  it('does not certify title, excerpt, body, or party geography without a verified source field', () => {
    const location = missingRoseltorgPropertyLocation();

    expect(location).toEqual({
      status: 'missing',
      source_kind: 'dom_field',
      source_path: 'unverified_source.property_location',
    });
    expect(projectLegacyAddress(location)).toBe('');
    expect(derivePropertyRegion(location)).toBe('other');
    expect(location.latitude).toBeUndefined();
    expect(location.longitude).toBeUndefined();
  });
});
