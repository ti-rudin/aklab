import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ensureUserProfile,
  registerUserLifecycleSubscriber,
} from '../user-lifecycle';

const PROFILE_UID = 'api::user-profile.user-profile';
const USER_UID = 'plugin::users-permissions.user';

function makeStrapi() {
  const profileQuery = {
    findOne: vi.fn(),
  };

  return {
    db: {
      query: vi.fn((uid: string) => {
        if (uid !== PROFILE_UID) throw new Error(`unexpected uid: ${uid}`);
        return profileQuery;
      }),
      lifecycles: {
        subscribe: vi.fn(),
      },
    },
    entityService: {
      create: vi.fn(),
    },
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    profileQuery,
  };
}

describe('ensureUserProfile', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects non-positive, non-integer, and non-numeric user IDs', async () => {
    const strapi = makeStrapi();

    for (const userId of [0, -1, 1.5, NaN, Infinity, '7', null, undefined]) {
      await expect(ensureUserProfile(strapi as any, userId as any)).rejects.toThrow(/positive numeric user ID/i);
    }

    expect(strapi.profileQuery.findOne).not.toHaveBeenCalled();
    expect(strapi.entityService.create).not.toHaveBeenCalled();
  });

  it('returns the existing profile found by scalar user_id without creating another', async () => {
    const strapi = makeStrapi();
    const existing = { id: 12, user_id: 7, digest_enabled: false };
    strapi.profileQuery.findOne.mockResolvedValue(existing);

    await expect(ensureUserProfile(strapi as any, 7)).resolves.toBe(existing);
    expect(strapi.profileQuery.findOne).toHaveBeenCalledWith({ where: { user_id: 7 } });
    expect(strapi.entityService.create).not.toHaveBeenCalled();
  });

  it('creates exactly one profile with safe defaults when none exists', async () => {
    const strapi = makeStrapi();
    const created = { id: 12, user_id: 7 };
    strapi.profileQuery.findOne.mockResolvedValue(null);
    strapi.entityService.create.mockResolvedValue(created);

    await expect(ensureUserProfile(strapi as any, 7)).resolves.toBe(created);
    expect(strapi.entityService.create).toHaveBeenCalledWith(PROFILE_UID, {
      data: {
        user: 7,
        user_id: 7,
        regions: [],
        property_types: [],
        price_from: null,
        price_to: null,
        area_from: null,
        area_to: null,
        stop_words: [],
        digest_email: null,
        digest_enabled: false,
        profile_version: 1,
      },
    });
  });

  it('re-reads and returns the winner after a concurrent unique race', async () => {
    const strapi = makeStrapi();
    const winner = { id: 99, user_id: 7 };
    strapi.profileQuery.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(winner);
    const uniqueError = Object.assign(new Error('UNIQUE constraint failed: user_profiles.user_id'), {
      code: 'SQLITE_CONSTRAINT_UNIQUE',
    });
    strapi.entityService.create.mockRejectedValue(uniqueError);

    await expect(ensureUserProfile(strapi as any, 7)).resolves.toBe(winner);
    expect(strapi.profileQuery.findOne).toHaveBeenCalledTimes(2);
  });

  it('does not swallow a non-race database error', async () => {
    const strapi = makeStrapi();
    strapi.profileQuery.findOne.mockResolvedValue(null);
    const databaseError = new Error('database is locked');
    strapi.entityService.create.mockRejectedValue(databaseError);

    await expect(ensureUserProfile(strapi as any, 7)).rejects.toBe(databaseError);
    expect(strapi.profileQuery.findOne).toHaveBeenCalledTimes(1);
  });
});

describe('user lifecycle subscriber', () => {
  it('registers only the users-permissions user model and is idempotent per Strapi instance', async () => {
    const strapi = makeStrapi();
    registerUserLifecycleSubscriber(strapi as any);
    registerUserLifecycleSubscriber(strapi as any);

    expect(strapi.db.lifecycles.subscribe).toHaveBeenCalledTimes(1);
    const subscriber = strapi.db.lifecycles.subscribe.mock.calls[0][0];
    expect(subscriber.models).toEqual([USER_UID]);
    expect(subscriber).toEqual(expect.objectContaining({
      afterCreate: expect.any(Function),
      beforeDelete: expect.any(Function),
      beforeDeleteMany: expect.any(Function),
    }));
  });

  it('provisions afterCreate from the result ID without retaining or forwarding user PII', async () => {
    const strapi = makeStrapi();
    strapi.profileQuery.findOne.mockResolvedValue(null);
    strapi.entityService.create.mockResolvedValue({ id: 1 });
    registerUserLifecycleSubscriber(strapi as any);
    const subscriber = strapi.db.lifecycles.subscribe.mock.calls[0][0];

    await subscriber.afterCreate({
      result: { id: 7, email: 'secret@example.com', username: 'secret' },
      params: { data: { email: 'secret@example.com', username: 'secret' } },
    });

    expect(strapi.entityService.create).toHaveBeenCalledWith(
      PROFILE_UID,
      expect.objectContaining({
        data: expect.objectContaining({ user: 7, user_id: 7 }),
      }),
    );
    const payload = strapi.entityService.create.mock.calls[0][1].data;
    expect(payload).not.toHaveProperty('email');
    expect(payload).not.toHaveProperty('username');
  });

  it('blocks hard delete for both single-user and bulk lifecycle events', async () => {
    const strapi = makeStrapi();
    registerUserLifecycleSubscriber(strapi as any);
    const subscriber = strapi.db.lifecycles.subscribe.mock.calls[0][0];

    for (const hook of [subscriber.beforeDelete, subscriber.beforeDeleteMany]) {
      await expect(Promise.resolve().then(() => hook({ params: { where: { id: 7 } } }))).rejects.toMatchObject({
        name: 'ApplicationError',
        message: expect.stringMatching(/block|hard delete|удалени/i),
      });
    }
  });
});
