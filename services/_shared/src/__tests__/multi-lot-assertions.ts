import { expect } from 'vitest';
import type { PropertyLocation } from '../types';

/** Assert that geography does not mix region A title tokens with region B address. */
export function assertNoMixedRegionRow(input: {
  title?: string;
  location: PropertyLocation;
  expectedRegionHint?: string;
  forbiddenRegionHint?: string;
}): void {
  const address = input.location.address ?? '';
  const region = input.location.region ?? '';
  const title = input.title ?? '';

  if (input.forbiddenRegionHint) {
    expect(address).not.toContain(input.forbiddenRegionHint);
    expect(region).not.toContain(input.forbiddenRegionHint);
  }

  if (input.expectedRegionHint) {
    const combined = `${address} ${region} ${title}`;
    expect(combined).toContain(input.expectedRegionHint);
  }
}

export function expectMissingLocation(location: PropertyLocation): void {
  expect(location.status).toBe('missing');
  expect(location.address).toBeUndefined();
}
