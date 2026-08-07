import { describe, expect, it, vi } from 'vitest';
import { createUserFilterSnapshot, type UserParseProfile } from '@aklab/parse-rules';

vi.mock('@strapi/strapi', () => ({
  factories: {
    createCoreController: vi.fn((_uid: string, factory: any) => factory),
  },
}));

import controllerFactory from '../digest-projection';
import digestProjectionRoutes from '../../routes/digest-projection';

const profile: UserParseProfile = {
  userId: 7,
  profileId: 12,
  version: 3,
  regions: ['moscow'],
  propertyTypes: ['office'],
  priceFrom: null,
  priceTo: null,
  areaFrom: null,
  areaTo: null,
  stopWords: [],
};
const snapshot = createUserFilterSnapshot({
  schemaVersion: 1,
  scope: 'single',
  createdAt: '2026-08-07T12:00:00.000Z',
  windowEndAt: '2026-08-07T12:00:00.000Z',
  profiles: [profile],
});

function makeStrapi(overrides: {
  run?: unknown;
  threshold?: unknown;
  raw?: ReturnType<typeof vi.fn>;
} = {}) {
  const parserRunQuery = { findOne: vi.fn().mockResolvedValue(overrides.run === undefined ? {
    run_id: 'run-1',
    status: 'running',
    filter_snapshot: snapshot,
    filter_snapshot_hash: snapshot.hash,
    filter_snapshot_schema_version: 1,
    profile_scope: 'single',
  } : overrides.run) };
  const settingQuery = { findOne: vi.fn().mockResolvedValue({ threshold_percent: overrides.threshold === undefined ? 25 : overrides.threshold }) };
  const raw = overrides.raw || vi.fn()
    .mockResolvedValueOnce({ rows: [{ total: '0' }] })
    .mockResolvedValueOnce({ rows: [] });
  const queries: Record<string, unknown> = {
    'api::parser-run.parser-run': parserRunQuery,
    'api::setting.setting': settingQuery,
    'plugin::users-permissions.user': { findOne: vi.fn().mockResolvedValue({ blocked: false, confirmed: true }) },
    'api::user-profile.user-profile': { findOne: vi.fn().mockResolvedValue({ digest_enabled: true, digest_email: 'user@example.test' }) },
  };
  const strapi = {
    db: {
      query: vi.fn((uid: string) => queries[uid]),
      connection: { raw },
    },
  };
  return { strapi, parserRunQuery, settingQuery, raw };
}

function makeCtx(data: unknown) {
  return {
    request: { body: { data } },
    status: 200,
    body: undefined as unknown,
  };
}

describe('digest projection controller', () => {
  it('rejects unknown and nested extra fields before any Query Engine or raw SQL call', async () => {
    const fixture = makeStrapi();
    const actions = (controllerFactory as any)({ strapi: fixture.strapi });

    const ctx = makeCtx({
      runId: 'run-1',
      userId: 7,
      snapshotHash: snapshot.hash,
      page: 1,
      pageSize: 20,
      extra: true,
    });
    await actions.properties(ctx);

    expect(ctx.status).toBe(400);
    expect(ctx.body).toEqual({ error: 'Invalid digest projection request' });
    expect(fixture.parserRunQuery.findOne).not.toHaveBeenCalled();
    expect(fixture.raw).not.toHaveBeenCalled();
  });

  it('returns exact standard data envelope for properties and never adds internal fields', async () => {
    const fixture = makeStrapi();
    const actions = (controllerFactory as any)({ strapi: fixture.strapi });
    const ctx = makeCtx({ runId: 'run-1', userId: 7, snapshotHash: snapshot.hash, page: 1, pageSize: 20 });

    await actions.properties(ctx);

    expect(ctx.status).toBe(200);
    expect(ctx.body).toEqual({
      data: [],
      meta: { page: 1, pageSize: 20, total: 0, totalPages: 0, threshold: 25, windowEndAt: '2026-08-07T12:00:00.000Z' },
    });
  });

  it('maps safe membership and conflict outcomes without echoing identifiers or service errors', async () => {
    const notFoundFixture = makeStrapi({ run: null });
    const notFoundActions = (controllerFactory as any)({ strapi: notFoundFixture.strapi });
    const notFoundCtx = makeCtx({ runId: 'run-1', userId: 7, snapshotHash: snapshot.hash });
    await notFoundActions.delivery(notFoundCtx);
    expect(notFoundCtx.status).toBe(404);
    expect(notFoundCtx.body).toEqual({ error: 'Digest projection not found' });
    expect(JSON.stringify(notFoundCtx.body)).not.toContain('run-1');
    expect(JSON.stringify(notFoundCtx.body)).not.toContain(snapshot.hash);

    const conflictFixture = makeStrapi();
    const conflictActions = (controllerFactory as any)({ strapi: conflictFixture.strapi });
    const conflictCtx = makeCtx({ runId: 'run-1', userId: 7, snapshotHash: 'f'.repeat(64) });
    await conflictActions.delivery(conflictCtx);
    expect(conflictCtx.status).toBe(409);
    expect(conflictCtx.body).toEqual({ error: 'Digest projection conflict' });
    expect(JSON.stringify(conflictCtx.body)).not.toContain('f'.repeat(64));

    const malformedFixture = makeStrapi({ threshold: Number.NaN });
    const malformedActions = (controllerFactory as any)({ strapi: malformedFixture.strapi });
    const malformedCtx = makeCtx({ runId: 'run-1', userId: 7, snapshotHash: snapshot.hash, page: 1, pageSize: 20 });
    await malformedActions.properties(malformedCtx);
    expect(malformedCtx.status).toBe(500);
    expect(malformedCtx.body).toEqual({ error: 'Internal server error' });
    expect(JSON.stringify(malformedCtx.body)).not.toContain('DIGEST_PROJECTION');
  });

  it('maps delivery skip/enabled results without exposing current email for skipped delivery', async () => {
    const fixture = makeStrapi();
    const actions = (controllerFactory as any)({ strapi: fixture.strapi });
    const ctx = makeCtx({ runId: 'run-1', userId: 7, snapshotHash: snapshot.hash });

    await actions.delivery(ctx);

    expect(ctx.status).toBe(200);
    expect(ctx.body).toEqual({ data: { enabled: true, email: 'user@example.test' } });
  });

  it('publishes exactly two service-token internal routes and no CRUD/public/JWT route', () => {
    expect(digestProjectionRoutes.routes).toEqual([
      {
        method: 'POST',
        path: '/internal/digest/properties',
        handler: 'api::digest-projection.digest-projection.properties',
        config: { auth: false, policies: ['global::service-token'] },
      },
      {
        method: 'POST',
        path: '/internal/digest/delivery',
        handler: 'api::digest-projection.digest-projection.delivery',
        config: { auth: false, policies: ['global::service-token'] },
      },
    ]);
  });
});
