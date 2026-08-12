import { describe, expect, it } from 'vitest';
import { parsePrice } from '../src/price';

describe('parsePrice', () => {
  it('preserves dot-decimal metadata without inflating the price', () => {
    expect(parsePrice('615150.00')).toBe(615150);
  });

  it('preserves the real Sberbank-AST dot-decimal amount', () => {
    expect(parsePrice('3796542.4')).toBe(3796542.4);
  });

  it('parses comma-decimal prices with spaces', () => {
    expect(parsePrice('1 500 000,00 RUB')).toBe(1500000);
  });

  it('parses Russian dot-thousands and comma-decimal format', () => {
    expect(parsePrice('1.500.000,00 ₽')).toBe(1500000);
  });

  it('parses dot-thousands format without a decimal suffix', () => {
    expect(parsePrice('1.500.000 ₽')).toBe(1500000);
  });

  it('returns undefined for absent or non-positive prices', () => {
    expect(parsePrice('')).toBeUndefined();
    expect(parsePrice('цена не указана')).toBeUndefined();
    expect(parsePrice('0 ₽')).toBeUndefined();
  });
});
