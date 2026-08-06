import { describe, expect, it } from 'vitest';
import {
  PropertyType,
  Region,
  canonicalizeSnapshot,
  createUserFilterSnapshot,
  hashSnapshot,
  matchesProfile,
  matchesSnapshot,
  normalizeUserParseProfile,
  type UserParseProfile,
  type UserFilterSnapshot,
  type UserFilterSnapshotInput,
} from '../src';

const profile = (overrides: Partial<UserParseProfile> = {}): UserParseProfile => ({
  userId: 1,
  profileId: 11,
  version: 1,
  regions: ['moscow'],
  propertyTypes: ['office'],
  priceFrom: null,
  priceTo: 20_000_000,
  areaFrom: null,
  areaTo: null,
  stopWords: [],
  ...overrides,
});

const snapshot = (...profiles: UserParseProfile[]) => createUserFilterSnapshot({
  schemaVersion: 1,
  scope: 'all',
  createdAt: '2026-08-07T10:00:00.000Z',
  windowEndAt: '2026-08-07T11:00:00.000Z',
  profiles,
});

describe('pure user filter snapshot contract', () => {
  it('normalizes string arrays without mutating input and strips non-contract fields', () => {
    const input = profile({
      regions: [' MO ', 'moscow', 'MO'],
      propertyTypes: [' OFFICE ', 'office', 'other'],
      stopWords: [' Земля ', 'земля', '  Участок'],
    }) as UserParseProfile & Record<string, unknown>;
    input.email = 'private@example.test';
    input.username = 'private-user';
    const original = JSON.parse(JSON.stringify(input));

    const normalized = normalizeUserParseProfile(input);

    expect(normalized).toEqual({
      userId: 1,
      profileId: 11,
      version: 1,
      regions: ['mo', 'moscow'],
      propertyTypes: ['office', 'other'],
      priceFrom: null,
      priceTo: 20_000_000,
      areaFrom: null,
      areaTo: null,
      stopWords: ['земля', 'участок'],
    });
    expect(input).toEqual(original);
    expect(normalized).not.toHaveProperty('email');
    expect(normalized).not.toHaveProperty('username');
  });

  it('canonicalizes object keys and profile order and computes a deterministic SHA-256 hash', () => {
    const first = snapshot(
      profile({ userId: 2, profileId: 20, version: 2, regions: ['mo'], propertyTypes: ['warehouse'] }),
      profile({ userId: 1, profileId: 11, version: 1, regions: ['moscow'], propertyTypes: ['office'], stopWords: ['x', 'a', 'x'] }),
    );
    const second = createUserFilterSnapshot({
      profiles: [
        { ...profile({ userId: 1, profileId: 11, version: 1 }), stopWords: ['x', 'a', 'x'] },
        { ...profile({ userId: 2, profileId: 20, version: 2, regions: ['MO'], propertyTypes: ['WAREHOUSE'] }) },
      ].reverse(),
      createdAt: '2026-08-07T10:00:00.000Z',
      windowEndAt: '2026-08-07T11:00:00.000Z',
      scope: 'all',
      schemaVersion: 1,
    });

    expect(first.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSnapshot(first)).toBe(first.hash);
    expect(hashSnapshot(first)).toBe(hashSnapshot(second));
    expect(canonicalizeSnapshot(first)).toBe(canonicalizeSnapshot(second));
    expect(canonicalizeSnapshot(first)).not.toContain('email');
    expect(canonicalizeSnapshot(first)).not.toContain('username');
    expect(canonicalizeSnapshot(first)).not.toContain('arbitrary');
    expect(canonicalizeSnapshot(first).indexOf('"createdAt"')).toBeLessThan(canonicalizeSnapshot(first).indexOf('"profiles"'));
  });

  it('requires valid ISO datetimes, includes windowEndAt in the canonical payload, and matches a known hash vector', () => {
    const input: UserFilterSnapshotInput & Record<string, unknown> = {
      schemaVersion: 1,
      scope: 'single',
      createdAt: '2026-08-07T10:00:00.000Z',
      windowEndAt: '2026-08-07T11:00:00.000Z',
      profiles: [profile()],
      privateToken: 'must-not-be-hashed',
    };
    const original = JSON.parse(JSON.stringify(input));
    const known = createUserFilterSnapshot(input);
    const changedWindow = createUserFilterSnapshot({
      ...input,
      windowEndAt: '2026-08-07T12:00:00.000Z',
    });

    expect(known.hash).toBe('b4219fd5248494b6bbb47c2b0929595d349a0fb561b94095418599b002bb02de');
    expect(changedWindow.hash).not.toBe(known.hash);
    expect(canonicalizeSnapshot(known)).toContain('"windowEndAt":"2026-08-07T11:00:00.000Z"');
    expect(canonicalizeSnapshot(known)).not.toContain('privateToken');
    expect(input).toEqual(original);
    expect(known).not.toHaveProperty('privateToken');

    expect(() => createUserFilterSnapshot({ ...input, createdAt: '2026-08-07' })).toThrow();
    expect(() => createUserFilterSnapshot({ ...input, windowEndAt: 'not-a-datetime' })).toThrow();
  });

  it('requires positive safe IDs, positive versions, non-negative finite bounds, and non-inverted ranges', () => {
    expect(() => normalizeUserParseProfile(profile({ userId: 0 }))).toThrow();
    expect(() => normalizeUserParseProfile(profile({ userId: -1 }))).toThrow();
    expect(() => normalizeUserParseProfile(profile({ userId: Number.MAX_SAFE_INTEGER + 1 }))).toThrow();
    expect(() => normalizeUserParseProfile(profile({ profileId: 0 }))).toThrow();
    expect(() => normalizeUserParseProfile(profile({ profileId: 1.5 }))).toThrow();
    expect(() => normalizeUserParseProfile(profile({ version: 0 }))).toThrow();
    expect(() => normalizeUserParseProfile(profile({ priceFrom: -1 }))).toThrow();
    expect(() => normalizeUserParseProfile(profile({ priceTo: Number.NaN }))).toThrow();
    expect(() => normalizeUserParseProfile(profile({ areaFrom: -1 }))).toThrow();
    expect(() => normalizeUserParseProfile(profile({ areaTo: Number.POSITIVE_INFINITY }))).toThrow();
    expect(() => normalizeUserParseProfile(profile({ priceFrom: 2, priceTo: 1 }))).toThrow();
    expect(() => normalizeUserParseProfile(profile({ areaFrom: 2, areaTo: 1 }))).toThrow();
  });

  it('rejects duplicate profile identities and enforces scope cardinality', () => {
    expect(() => snapshot(
      profile({ userId: 1, profileId: 11 }),
      profile({ userId: 1, profileId: 12 }),
    )).toThrow();
    expect(() => snapshot(
      profile({ userId: 1, profileId: 11 }),
      profile({ userId: 2, profileId: 11 }),
    )).toThrow();
    expect(() => createUserFilterSnapshot({
      schemaVersion: 1,
      scope: 'single',
      createdAt: '2026-08-07T10:00:00.000Z',
      windowEndAt: '2026-08-07T11:00:00.000Z',
      profiles: [],
    })).toThrow();
    expect(() => createUserFilterSnapshot({
      schemaVersion: 1,
      scope: 'single',
      createdAt: '2026-08-07T10:00:00.000Z',
      windowEndAt: '2026-08-07T11:00:00.000Z',
      profiles: [profile(), profile({ userId: 2, profileId: 12 })],
    })).toThrow();
    expect(snapshot()).toMatchObject({ scope: 'all', profiles: [] });
  });

  it('matches whole profiles with AND semantics and profiles with OR semantics', () => {
    const moscowOfficeUpTo20 = profile({
      userId: 1,
      profileId: 1,
      regions: ['moscow'],
      propertyTypes: ['office'],
      priceFrom: null,
      priceTo: 20_000_000,
    });
    const moWarehouseFrom50 = profile({
      userId: 2,
      profileId: 2,
      regions: ['mo'],
      propertyTypes: ['warehouse'],
      priceFrom: 50_000_000,
      priceTo: null,
    });
    const all = snapshot(moscowOfficeUpTo20, moWarehouseFrom50);

    expect(matchesSnapshot(all, { city: 'moscow', property_type: 'warehouse', price: 60_000_000 }, 'details')).toBe(false);
    expect(matchesSnapshot(all, { city: 'moscow', property_type: 'office', price: 20_000_000 }, 'details')).toBe(true);
    expect(matchesSnapshot(all, { city: 'mo', property_type: 'warehouse', price: 50_000_000 }, 'details')).toBe(true);
  });

  it('returns one boolean when one candidate matches two profiles', () => {
    const duplicatedScope = snapshot(
      profile({ profileId: 1 }),
      profile({ profileId: 2, userId: 2 }),
    );

    const result = matchesSnapshot(duplicatedScope, {
      city: 'moscow',
      property_type: 'office',
      price: 10_000_000,
    }, 'details');

    expect(result).toBe(true);
    expect(typeof result).toBe('boolean');
  });

  it('fails closed for empty region or property type arrays and empty snapshots', () => {
    const candidate = { city: 'moscow', property_type: 'office', price: 10 };

    expect(matchesProfile(profile({ regions: [] }), candidate, 'details')).toBe(false);
    expect(matchesProfile(profile({ propertyTypes: [] }), candidate, 'details')).toBe(false);
    expect(matchesSnapshot(snapshot(), candidate, 'details')).toBe(false);
  });

  it('keeps scan permissive for unavailable numeric/enum fields but rejects known mismatches', () => {
    const scanProfile = profile({
      regions: ['moscow'],
      propertyTypes: ['office'],
      priceFrom: 1_000,
      priceTo: 2_000,
      areaFrom: 10,
      areaTo: 20,
    });

    expect(matchesProfile(scanProfile, { title: 'Office listing' }, 'scan')).toBe(true);
    expect(matchesProfile(scanProfile, { title: 'Office listing' }, 'details')).toBe(true);
    expect(matchesProfile(scanProfile, { city: 'mo', property_type: 'office' }, 'scan')).toBe(false);
    expect(matchesProfile(scanProfile, { city: 'moscow', property_type: 'warehouse' }, 'scan')).toBe(false);
    expect(matchesProfile(scanProfile, { city: 'moscow', property_type: 'office', price: 2_001 }, 'scan')).toBe(false);
    expect(matchesProfile(scanProfile, { city: 'moscow', property_type: 'office', price: '2_000' }, 'details')).toBe(false);
    expect(matchesProfile(scanProfile, { city: null, property_type: 'office', price: 1_000, area_sqm: 10 }, 'details')).toBe(false);
    expect(matchesProfile(profile({ priceFrom: null, priceTo: null }), { city: 'moscow', property_type: 'office', price: 'unknown' }, 'details')).toBe(false);
    expect(matchesProfile(profile({ priceFrom: null, priceTo: null }), { city: 'moscow', property_type: 'office', price: -1 }, 'details')).toBe(false);
  });

  it('checks stop words in all available scan and details text', () => {
    const stopProfile = profile({ stopWords: ['земельный участок'] });
    const withoutStopWord = { city: 'moscow', property_type: 'office', price: 10 };

    expect(matchesProfile(stopProfile, { ...withoutStopWord, title: 'Офис' }, 'scan')).toBe(true);
    expect(matchesProfile(stopProfile, withoutStopWord, 'details')).toBe(true);
    expect(matchesProfile(stopProfile, { ...withoutStopWord, title: null }, 'details')).toBe(false);
    expect(matchesProfile(profile(), { city: 'moscow', property_type: 'office', title: null }, 'details')).toBe(false);
    expect(matchesProfile(stopProfile, { ...withoutStopWord, title: 'Продажа' , description: 'ЗЕМЕЛЬНЫЙ УЧАСТОК' }, 'scan')).toBe(false);
    expect(matchesProfile(stopProfile, { ...withoutStopWord, title: 'Офис', address: 'Москва', description: 'ЗЕМЕЛЬНЫЙ УЧАСТОК' }, 'details')).toBe(false);
  });

  it('requires constrained numeric and enum fields in details and includes range boundaries', () => {
    const constrained = profile({
      priceFrom: 1_000,
      priceTo: 2_000,
      areaFrom: 10,
      areaTo: 20,
    });

    expect(matchesProfile(constrained, { city: 'moscow', property_type: 'office' }, 'details')).toBe(true);
    expect(matchesProfile(constrained, { city: 'moscow', property_type: 'office', price: 1_000, area_sqm: 10 }, 'details')).toBe(true);
    expect(matchesProfile(constrained, { city: 'moscow', property_type: 'office', price: 2_000, area_sqm: 20 }, 'details')).toBe(true);
    expect(matchesProfile(constrained, { city: 'moscow', property_type: 'office', price: 2_001, area_sqm: 20 }, 'details')).toBe(false);
  });

  it('fails closed when snapshot integrity is missing, malformed, or mismatched', () => {
    const valid = snapshot(profile());
    const candidate = { city: 'moscow', property_type: 'office', price: 10_000_000 };
    const missingHash = { ...valid } as Partial<UserFilterSnapshot>;
    delete missingHash.hash;

    expect(matchesSnapshot(missingHash as UserFilterSnapshot, candidate, 'details')).toBe(false);
    expect(matchesSnapshot({ ...valid, hash: 'abc' }, candidate, 'details')).toBe(false);
    expect(matchesSnapshot({ ...valid, hash: '0'.repeat(64) }, candidate, 'details')).toBe(false);
    expect(matchesSnapshot({ ...valid, hash: valid.hash.toUpperCase() }, candidate, 'details')).toBe(true);
    expect(matchesSnapshot({ ...valid, hash: 'f'.repeat(63) }, candidate, 'details')).toBe(false);
  });

  it('exports only the runtime enum values required by the parser contract', () => {
    expect(Object.values(Region)).toEqual(['moscow', 'mo', 'other']);
    expect(Object.values(PropertyType)).toEqual([
      'office',
      'warehouse',
      'retail',
      'production',
      'free_purpose',
      'apartment',
      'land',
      'other',
    ]);
  });
});
