import { describe, expect, it, vi } from 'vitest';

vi.mock('@strapi/strapi', () => ({
  factories: {
    createCoreController: vi.fn((_uid: string, factory: any) => factory),
  },
}));

import controllerFactory from '../user-profile';
import userProfileRoutes from '../../routes/user-profile';

const PROFILE_UID = 'api::user-profile.user-profile';
const scalarFields = [
  'id',
  'user_id',
  'regions',
  'property_types',
  'price_from',
  'price_to',
  'area_from',
  'area_to',
  'stop_words',
  'digest_email',
  'digest_enabled',
  'profile_version',
];

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
  stop_words: ['secret'],
  digest_email: null,
  digest_enabled: false,
  ...overrides,
});

function makeStrapi() {
  const profileQuery = {
    findOne: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    update: vi.fn(),
  };
  const strapi = {
    db: {
      query: vi.fn((uid: string) => {
        if (uid === PROFILE_UID) return profileQuery;
        throw new Error(`unexpected uid: ${uid}`);
      }),
    },
    entityService: {
      update: vi.fn(() => { throw new Error('entityService must not be used'); }),
    },
    profileQuery,
  };
  return strapi;
}

function makeCtx(overrides: Record<string, unknown> = {}) {
  return {
    state: { user: { id: 7 } },
    params: {},
    query: {},
    request: { body: { data: {} } },
    status: 200,
    body: undefined as unknown,
    ...overrides,
  } as any;
}

describe('user profile custom routes', () => {
  it('exposes only protected custom self/admin routes and no generic CRUD route', () => {
    expect(userProfileRoutes.routes).toEqual([
      {
        method: 'GET',
        path: '/me/profile',
        handler: 'user-profile.getMe',
        config: { auth: false, policies: ['global::authenticated-user'] },
      },
      {
        method: 'PUT',
        path: '/me/profile',
        handler: 'user-profile.updateMe',
        config: { auth: false, policies: ['global::authenticated-user'] },
      },
      {
        method: 'GET',
        path: '/admin/user-profiles',
        handler: 'user-profile.listAdmin',
        config: { auth: false, policies: ['global::authenticated-user', 'global::aklab-admin'] },
      },
      {
        method: 'GET',
        path: '/admin/user-profiles/:userId',
        handler: 'user-profile.getAdmin',
        config: { auth: false, policies: ['global::authenticated-user', 'global::aklab-admin'] },
      },
      {
        method: 'PUT',
        path: '/admin/user-profiles/:userId',
        handler: 'user-profile.updateAdmin',
        config: { auth: false, policies: ['global::authenticated-user', 'global::aklab-admin'] },
      },
    ]);
    expect(userProfileRoutes.routes.map((route) => route.path)).not.toContain('/user-profiles');
  });
});

describe('self profile controller', () => {
  it('derives the actor only from an exact numeric ctx.state.user.id and returns an allowlisted DTO', async () => {
    const strapi = makeStrapi();
    const stored = profile({
      user: { id: 7, email: 'relation@example.test' },
      documentId: 'private-document-id',
      createdAt: '2026-08-07T10:00:00.000Z',
      role: { type: 'aklab_admin' },
      email: 'private@example.test',
      username: 'private-user',
    });
    strapi.profileQuery.findOne.mockResolvedValue(stored);
    const actions = (controllerFactory as any)({ strapi });
    const ctx = makeCtx({
      request: { body: { data: { actorId: 99, targetId: 99 } } },
    });

    await actions.getMe(ctx);

    expect(strapi.profileQuery.findOne).toHaveBeenCalledWith({ where: { user_id: 7 } });
    expect(ctx.body).toEqual({
      data: {
        id: 12,
        user_id: 7,
        regions: ['moscow'],
        property_types: ['office'],
        price_from: 100,
        price_to: null,
        area_from: null,
        area_to: 200,
        stop_words: ['secret'],
        digest_email: null,
        digest_enabled: false,
        profile_version: 3,
      },
    });
    expect(JSON.stringify(ctx.body)).not.toContain('private-document-id');
    expect(JSON.stringify(ctx.body)).not.toContain('private@example.test');
    expect(strapi.entityService.update).not.toHaveBeenCalled();
  });

  it('returns 401 and does not query when the policy state actor is absent or not an exact positive number', async () => {
    for (const id of [undefined, null, 0, -1, 1.5, NaN, '7']) {
      const strapi = makeStrapi();
      const actions = (controllerFactory as any)({ strapi });
      const ctx = makeCtx({ state: { user: { id } } });

      await actions.getMe(ctx);

      expect(ctx.status).toBe(401);
      expect(ctx.body).toEqual({ error: 'Unauthorized' });
      expect(strapi.profileQuery.findOne).not.toHaveBeenCalled();
    }
  });

  it('requires one stable data.expectedVersion field and delegates the remaining update to the service', async () => {
    const strapi = makeStrapi();
    strapi.profileQuery.findOne.mockResolvedValue(profile());
    strapi.profileQuery.update.mockResolvedValue(profile({ profile_version: 4, regions: ['mo'] }));
    const actions = (controllerFactory as any)({ strapi });
    const ctx = makeCtx({
      request: { body: { data: { expectedVersion: 3, regions: ['mo'] } } },
    });

    await actions.updateMe(ctx);

    expect(strapi.profileQuery.findOne).toHaveBeenCalledWith({ where: { user_id: 7 } });
    expect(strapi.profileQuery.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 12, profile_version: 3 },
    }));
    expect(ctx.body).toEqual({ data: expect.objectContaining({ user_id: 7, profile_version: 4, regions: ['mo'] }) });

    for (const expectedVersion of [undefined, null, 0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '3']) {
      const invalidStrapi = makeStrapi();
      const invalidActions = (controllerFactory as any)({ strapi: invalidStrapi });
      const invalidCtx = makeCtx({ request: { body: { data: { expectedVersion } } } });
      await invalidActions.updateMe(invalidCtx);
      expect(invalidCtx.status).toBe(400);
      expect(invalidStrapi.profileQuery.findOne).not.toHaveBeenCalled();
    }
  });
});

describe('admin profile controller', () => {
  it('lists scalar profile rows through Query Engine with deterministic pagination and no relation population', async () => {
    const strapi = makeStrapi();
    strapi.profileQuery.count.mockResolvedValue(3);
    strapi.profileQuery.findMany.mockResolvedValue([profile(), profile({ id: 13, user_id: 8 })]);
    const actions = (controllerFactory as any)({ strapi });
    const ctx = makeCtx({ query: { page: '2', pageSize: '2' } });

    await actions.listAdmin(ctx);

    expect(strapi.profileQuery.count).toHaveBeenCalledWith({ where: {} });
    expect(strapi.profileQuery.findMany).toHaveBeenCalledWith({
      select: scalarFields,
      orderBy: [{ user_id: 'asc' }, { id: 'asc' }],
      limit: 2,
      offset: 2,
    });
    expect(ctx.body).toEqual({
      data: [expect.objectContaining({ user_id: 7 }), expect.objectContaining({ user_id: 8 })],
      meta: { pagination: { page: 2, pageSize: 2, pageCount: 2, total: 3 } },
    });
    expect(JSON.stringify(strapi.profileQuery.findMany.mock.calls[0][0])).not.toContain('populate');
  });

  it('uses the route userId as the sole admin target and returns 404 for a missing profile', async () => {
    const strapi = makeStrapi();
    strapi.profileQuery.findOne.mockResolvedValueOnce(null);
    const actions = (controllerFactory as any)({ strapi });
    const ctx = makeCtx({
      params: { userId: '8' },
      request: { body: { data: { targetId: 7 } } },
    });

    await actions.getAdmin(ctx);

    expect(strapi.profileQuery.findOne).toHaveBeenCalledWith({ where: { user_id: 8 } });
    expect(ctx.status).toBe(404);
    expect(ctx.body).toEqual({ error: 'User profile not found' });
  });

  it('updates only the route target and maps a typed version conflict to 409 without raw error details', async () => {
    const strapi = makeStrapi();
    strapi.profileQuery.findOne.mockResolvedValue(profile({ user_id: 8 }));
    strapi.profileQuery.update.mockResolvedValue(null);
    strapi.profileQuery.findOne.mockResolvedValueOnce(profile({ user_id: 8 })).mockResolvedValueOnce(profile({ user_id: 8, profile_version: 4 }));
    const actions = (controllerFactory as any)({ strapi });
    const ctx = makeCtx({
      params: { userId: '8' },
      request: { body: { data: { expectedVersion: 3, regions: ['mo'] } } },
    });

    await actions.updateAdmin(ctx);

    expect(strapi.profileQuery.findOne).toHaveBeenNthCalledWith(1, { where: { user_id: 8 } });
    expect(strapi.profileQuery.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 12, profile_version: 3 },
    }));
    expect(ctx.status).toBe(409);
    expect(ctx.body).toEqual({ error: 'User profile version conflict' });
    expect(JSON.stringify(ctx.body)).not.toContain('email');
  });

  it('rejects malformed route target IDs after the protected route boundary', async () => {
    for (const userId of ['', '0', '-1', '1.5', ' 7 ', 'abc', '9007199254740992']) {
      const strapi = makeStrapi();
      const actions = (controllerFactory as any)({ strapi });
      const ctx = makeCtx({ params: { userId } });

      await actions.getAdmin(ctx);

      expect(ctx.status).toBe(400);
      expect(ctx.body).toEqual({ error: 'Invalid user profile input' });
      expect(strapi.profileQuery.findOne).not.toHaveBeenCalled();
    }
  });
});
