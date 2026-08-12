import { describe, expect, it } from 'vitest';
// CommonJS script intentionally remains dependency-light and independently runnable.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { candidateCorrection, parseArgs, parsePrice, sourcePriceFromHtml } = require('../backfill-decimal-prices');

describe('decimal price backfill contract', () => {
  it('recognizes supported source price formats', () => {
    expect(parsePrice('615150.00')).toBe(615150);
    expect(parsePrice('3 796 542,4 ₽')).toBe(3796542.4);
    expect(parsePrice('1.500.000,00')).toBe(1500000);
  });

  it('extracts M-ETS metadata price', () => {
    expect(sourcePriceFromHtml('m-ets', '<meta itemprop="price" content="615150.00">')).toBe(615150);
  });

  it('extracts Sberbank-AST XML current amount before purchase amount', () => {
    expect(sourcePriceFromHtml('sberbank-ast', '<CurrentAmount>10204.43</CurrentAmount><purchAmount>99999.00</purchAmount>')).toBe(10204.43);
  });

  it('accepts only exact decimal-corruption scale factors', () => {
    expect(candidateCorrection(61515000, 615150)).toBe(true);
    expect(candidateCorrection(37965424, 3796542.4)).toBe(true);
    expect(candidateCorrection(6151500, 615150)).toBe(true);
    expect(candidateCorrection(5000000, 615150)).toBe(false);
  });

  it('requires explicit absolute db path and backup for apply', () => {
    expect(() => parseArgs(['--db=relative.db', '--source=m-ets'])).toThrow(/absolute/);
    expect(() => parseArgs(['--db=/tmp/data.db', '--source=m-ets', '--apply'])).toThrow(/backup/);
    expect(parseArgs(['--db=/tmp/data.db', '--source=m-ets'])).toMatchObject({ apply: false, source: 'm-ets' });
  });
});
