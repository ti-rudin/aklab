import { describe, expect, it } from 'vitest';
import { parseAuctionEndAt } from '../src/auction-date';

describe('parseAuctionEndAt', () => {
  it('parses an M-ETS deadline expressed in Moscow time into canonical UTC', () => {
    expect(parseAuctionEndAt('27.10.2026 12:00')).toBe('2026-10-27T09:00:00.000Z');
  });

  it('accepts a date-only deadline as the end of the Moscow day', () => {
    expect(parseAuctionEndAt('27.10.2026')).toBe('2026-10-27T20:59:59.000Z');
  });

  it('parses a timezone-less ISO auction date emitted by marketplace payloads', () => {
    expect(parseAuctionEndAt('2026-10-27')).toBe('2026-10-27T20:59:59.000Z');
  });

  it('preserves an explicit UTC deadline from an upstream API instead of treating it as Moscow time', () => {
    expect(parseAuctionEndAt('2026-08-21T08:00:00Z')).toBe('2026-08-21T08:00:00.000Z');
  });

  it('preserves an explicit offset deadline from an upstream API', () => {
    expect(parseAuctionEndAt('2026-08-13T12:00:00.0000000Z')).toBe('2026-08-13T12:00:00.000Z');
  });

  it('rejects impossible, ambiguous, and empty values instead of guessing', () => {
    expect(parseAuctionEndAt('31.02.2026 12:00')).toBeUndefined();
    expect(parseAuctionEndAt('27/10/2026')).toBeUndefined();
    expect(parseAuctionEndAt('')).toBeUndefined();
  });
});
