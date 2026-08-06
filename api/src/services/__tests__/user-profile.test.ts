import { describe, expect, it, vi } from 'vitest';
import {
  buildAllActiveSnapshot,
  buildSingleUserSnapshot,
  getUserProfile,
  isProfileReady,
  replaceUserProfile,
  UserProfileConflictError,
  UserProfileMalformedError,
  UserProfileNotFoundError,
  UserProfileUnavailableError,
  UserProfileValidationError,
} from '../user-profile';

const PROFILE_UID = 'api::user-profile.user-profile';
const USER_UID = 'plugin::users-permissions.user';

const profile = (overrides: Record<string, unknown> = {}) => ({
  id: 12,
  user_id: 7,
  profile_version: 3,
  regions: ['moscow'],
  property_types: ['office'],
  price_from: '100',
  price_to: null,
  area_from: null,
  area_to: '200',
  stop_words: '["secret", "  SECRET "]',
  digest_email: null,
  digest_enabled: false,
  ...overrides,
});

function makeStrapi() {
  const profileQuery = {
    findOne: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
  };
  const userQuery = {
    findOne: vi.fn(),
    findMany: vi.fn(),
  };
  const db = {
    query: vi.fn((uid: string) => {
      if (uid === PROFILE_UID) return profileQuery;
      if (uid === USER_UID) return userQuery;
      throw new Error(`unexpected uid: ${uid}`);
    }),
  };

  return {
    db,
    entityService: {
      update: vi.fn(() => { throw new Error('entityService must not be used'); }),
    },
    profileQuery,
    userQuery,
  };
}

const now = new Date('2026-08-07T10:00:00.000Z');

const activeUser = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  blocked: false,
  confirmed: true,
  username: `private-${id}`,
  email: `private-${id}@example.test`,
  role: { type: 'authenticated' },
  ...extra,
});

describe('getUserProfile', () => {
  it('looks up only by positive scalar user_id and does not log or expose a relation lookup', async () => {
    const strapi = makeStrapi();
    const stored = profile();
    strapi.profileQuery.findOne.mockResolvedValue(stored);

    await expect(getUserProfile(strapi as any, 7)).resolves.toBe(stored);
    expect(strapi.profileQuery.findOne).toHaveBeenCalledWith({ where: { user_id: 7 } });
    expect(strapi.db.query).toHaveBeenCalledWith(PROFILE_UID);
    expect(strapi).not.toHaveProperty('log');

    await expect(getUserProfile(strapi as any, 0)).rejects.toBeInstanceOf(UserProfileValidationError);
    expect(strapi.profileQuery.findOne).toHaveBeenCalledTimes(1);
  });
});

describe('replaceUserProfile', () => {
  it('allowlists fields, normalizes arrays/ranges, increments exactly once, and leaves input untouched', async () => {
    const strapi = makeStrapi();
    const existing = profile();
    const input = {
      regions: [' MO ', 'moscow', 'MO'],
      property_types: [' OFFICE ', 'office'],
      price_from: '2.5',
      price_to: 10,
      area_from: null,
      area_to: '20',
      stop_words: [' Z ', 'a', 'z'],
      digest_email: '  User@example.test ',
      digest_enabled: true,
    };
    const original = structuredClone(input);
    strapi.profileQuery.findOne.mockResolvedValue(existing);
    strapi.profileQuery.update.mockResolvedValue({ ...existing, profile_version: 4 });

    await expect(replaceUserProfile(strapi as any, 7, input, 3)).resolves.toMatchObject({ profile_version: 4 });
    expect(input).toEqual(original);
    expect(strapi.profileQuery.update).toHaveBeenCalledWith({
      where: { id: 12 },
      data: {
        regions: ['mo', 'moscow'],
        property_types: ['office'],
        price_from: 2.5,
        price_to: 10,
        area_from: null,
        area_to: 20,
        stop_words: ['a', 'z'],
        digest_email: 'User@example.test',
        digest_enabled: true,
        profile_version: 4,
      },
    });
    expect(strapi.entityService.update).not.toHaveBeenCalled();
    expect(JSON.stringify(strapi.profileQuery.update.mock.calls[0][0].data)).not.toContain('user_id');
  });

  it('rejects missing profiles and forbidden identity/actor/target fields before writing', async () => {
    const strapi = makeStrapi();
    strapi.profileQuery.findOne.mockResolvedValue(null);
    await expect(replaceUserProfile(strapi as any, 7, {})).rejects.toBeInstanceOf(UserProfileNotFoundError);
    expect(strapi.profileQuery.update).not.toHaveBeenCalled();

    strapi.profileQuery.findOne.mockResolvedValue(profile());
    for (const forbidden of [
      'id', 'documentId', 'user', 'user_id', 'profile_version',
      'actorId', 'targetId', 'actor_user_id', 'target_user_id', 'targetUserId', 'userId',
    ]) {
      await expect(replaceUserProfile(strapi as any, 7, { [forbidden]: 1 })).rejects
        .toBeInstanceOf(UserProfileValidationError);
    }
    expect(strapi.profileQuery.update).not.toHaveBeenCalled();
  });

  it('throws a typed version conflict before any update', async () => {
    const strapi = makeStrapi();
    strapi.profileQuery.findOne.mockResolvedValue(profile({ profile_version: 9 }));

    await expect(replaceUserProfile(strapi as any, 7, { regions: ['mo'] }, 8))
      .rejects.toMatchObject({
        name: 'UserProfileConflictError',
        code: 'USER_PROFILE_VERSION_CONFLICT',
        expectedVersion: 8,
        actualVersion: 9,
      });
    expect(strapi.profileQuery.update).not.toHaveBeenCalled();
  });

  it('validates exact enums, finite non-negative ordered ranges, email, and digest enablement', async () => {
    const strapi = makeStrapi();
    strapi.profileQuery.findOne.mockResolvedValue(profile());

    const invalidInputs = [
      { regions: ['moscowx'] },
      { property_types: ['shops'] },
      { price_from: -1 },
      { price_to: Number.NaN },
      { area_from: Number.POSITIVE_INFINITY },
      { price_from: 20, price_to: 10 },
      { area_from: 20, area_to: 10 },
      { digest_email: 'not-an-email' },
      { digest_enabled: true, digest_email: null },
      { digest_enabled: true, digest_email: ' ' },
      { digest_enabled: 'true' },
      { unknown: true },
    ];

    for (const input of invalidInputs) {
      await expect(replaceUserProfile(strapi as any, 7, input)).rejects
        .toBeInstanceOf(UserProfileValidationError);
    }
    expect(strapi.profileQuery.update).not.toHaveBeenCalled();
  });
});

describe('profile readiness and snapshots', () => {
  it('parses array and JSON-string storage, normalizes decimals, and fails closed for malformed profiles', () => {
    expect(isProfileReady(profile())).toBe(true);
    expect(isProfileReady(profile({ regions: '["mo"]', property_types: ['warehouse'] }))).toBe(true);
    expect(isProfileReady(profile({ regions: 'not-json' }))).toBe(false);
    expect(isProfileReady(profile({ property_types: '{}' }))).toBe(false);
    expect(isProfileReady(profile({ price_from: 'NaN' }))).toBe(false);
    expect(isProfileReady(profile({ price_from: '-1' }))).toBe(false);
    expect(isProfileReady(profile({ price_from: 2, price_to: 1 }))).toBe(false);
    expect(isProfileReady(profile({ regions: [], property_types: ['office'] }))).toBe(false);
    expect(isProfileReady({ id: 1, user_id: 1, profile_version: 1, regions: ['moscow'] })).toBe(false);
  });

  it('builds an empty all-snapshot when no active users exist', async () => {
    const strapi = makeStrapi();
    strapi.userQuery.findMany.mockResolvedValue([]);

    const snapshot = await buildAllActiveSnapshot(strapi as any, now);
    expect(snapshot).toMatchObject({
      schemaVersion: 1,
      scope: 'all',
      createdAt: now.toISOString(),
      windowEndAt: now.toISOString(),
      profiles: [],
    });
    expect(snapshot.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(strapi.profileQuery.findMany).not.toHaveBeenCalled();
  });

  it('filters blocked/unconfirmed users, excludes not-ready profiles, and emits no PII', async () => {
    const strapi = makeStrapi();
    strapi.userQuery.findMany.mockResolvedValue([
      activeUser(7),
      activeUser(8, { blocked: true }),
      activeUser(9, { confirmed: false }),
      activeUser(10),
    ]);
    strapi.profileQuery.findMany.mockResolvedValue([
      profile({ id: 12, user_id: 7, profile_version: 4, regions: '["MOSCOW"]', property_types: '["OFFICE"]' }),
      profile({ id: 13, user_id: 10, regions: [], property_types: ['office'] }),
    ]);

    const snapshot = await buildAllActiveSnapshot(strapi as any, now);
    expect(strapi.userQuery.findMany).toHaveBeenCalledWith({
      where: { blocked: false, confirmed: { $ne: false } },
      orderBy: { id: 'asc' },
    });
    expect(strapi.profileQuery.findMany).toHaveBeenCalledWith({
      where: { user_id: { $in: [7, 10] } },
      orderBy: { id: 'asc' },
    });
    expect(snapshot.profiles).toEqual([expect.objectContaining({
      userId: 7,
      profileId: 12,
      version: 4,
      regions: ['moscow'],
      propertyTypes: ['office'],
      priceFrom: 100,
      priceTo: null,
      areaFrom: null,
      areaTo: 200,
      stopWords: ['secret'],
    })]);
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain('private-7');
    expect(serialized).not.toContain('private-8');
    expect(serialized).not.toContain('example.test');
    expect(serialized).not.toContain('digest_enabled');
    expect(serialized).not.toContain('username');
    expect(serialized).not.toContain('role');
  });

  it('aborts with an explicit safe typed error instead of omitting a malformed persisted active profile', async () => {
    const strapi = makeStrapi();
    strapi.userQuery.findMany.mockResolvedValue([activeUser(7)]);
    strapi.profileQuery.findMany.mockResolvedValue([profile({ regions: '{bad json' })]);

    await expect(buildAllActiveSnapshot(strapi as any, now)).rejects.toBeInstanceOf(UserProfileMalformedError);
    await expect(buildAllActiveSnapshot(strapi as any, now)).rejects.toMatchObject({
      code: 'USER_PROFILE_MALFORMED',
    });
  });

  it('uses one immutable time window and stable hash for equivalent stored order', async () => {
    const first = makeStrapi();
    first.userQuery.findMany.mockResolvedValue([activeUser(7)]);
    first.profileQuery.findMany.mockResolvedValue([profile({ regions: ['mo', 'moscow'], stop_words: ['z', 'a'] })]);
    const second = makeStrapi();
    second.userQuery.findMany.mockResolvedValue([activeUser(7)]);
    second.profileQuery.findMany.mockResolvedValue([profile({ regions: ['MOSCOW', 'MO'], stop_words: '["a", "z"]' })]);

    const left = await buildAllActiveSnapshot(first as any, now);
    const right = await buildAllActiveSnapshot(second as any, now);
    expect(left.createdAt).toBe(now.toISOString());
    expect(left.windowEndAt).toBe(now.toISOString());
    expect(left.createdAt).toBe(left.windowEndAt);
    expect(left.hash).toBe(right.hash);
  });
});

describe('buildSingleUserSnapshot', () => {
  it('throws a safe typed unavailable error for missing, blocked, or unconfirmed targets', async () => {
    for (const user of [null, activeUser(7, { blocked: true }), activeUser(7, { confirmed: false })]) {
      const strapi = makeStrapi();
      strapi.userQuery.findOne.mockResolvedValue(user);
      await expect(buildSingleUserSnapshot(strapi as any, 7, now)).rejects
        .toBeInstanceOf(UserProfileUnavailableError);
      expect(strapi.profileQuery.findOne).not.toHaveBeenCalled();
    }
  });

  it('returns null for a missing or not-ready valid profile', async () => {
    const missing = makeStrapi();
    missing.userQuery.findOne.mockResolvedValue(activeUser(7));
    missing.profileQuery.findOne.mockResolvedValue(null);
    await expect(buildSingleUserSnapshot(missing as any, 7, now)).resolves.toBeNull();

    const notReady = makeStrapi();
    notReady.userQuery.findOne.mockResolvedValue(activeUser(7));
    notReady.profileQuery.findOne.mockResolvedValue(profile({ regions: [], property_types: ['office'] }));
    await expect(buildSingleUserSnapshot(notReady as any, 7, now)).resolves.toBeNull();
  });

  it('returns exactly one ready profile in single scope without relation IDs or PII', async () => {
    const strapi = makeStrapi();
    strapi.userQuery.findOne.mockResolvedValue(activeUser(7));
    strapi.profileQuery.findOne.mockResolvedValue(profile({
      id: 42,
      user_id: 7,
      user: 999,
      documentId: 'private-document-id',
      regions: '["mo"]',
      property_types: '["warehouse"]',
      profile_version: 5,
    }));

    const snapshot = await buildSingleUserSnapshot(strapi as any, 7, now);
    expect(snapshot).toMatchObject({
      scope: 'single',
      createdAt: now.toISOString(),
      windowEndAt: now.toISOString(),
      profiles: [{ userId: 7, profileId: 42, version: 5, regions: ['mo'], propertyTypes: ['warehouse'] }],
    });
    expect(snapshot?.profiles).toHaveLength(1);
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain('private-document-id');
    expect(serialized).not.toMatch(/email|username|role/);
  });

  it('aborts on malformed target profile rather than treating it as not-ready', async () => {
    const strapi = makeStrapi();
    strapi.userQuery.findOne.mockResolvedValue(activeUser(7));
    strapi.profileQuery.findOne.mockResolvedValue(profile({ property_types: '["office"' }));
    await expect(buildSingleUserSnapshot(strapi as any, 7, now)).rejects
      .toBeInstanceOf(UserProfileMalformedError);
  });
});

void UserProfileConflictError;
void UserProfileUnavailableError;
void UserProfileValidationError;
