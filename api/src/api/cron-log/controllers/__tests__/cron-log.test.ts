import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@strapi/strapi', () => ({
  factories: {
    createCoreController: vi.fn((_uid: string, factory: any) => factory),
  },
}));

import cronLogControllerFactory from '../cron-log';
import cronLogRoutes from '../../routes/cron-log';

function makeStrapi() {
  const query = { create: vi.fn() };
  return {
    db: { query: vi.fn().mockReturnValue(query) },
    _query: query,
  };
}

function makeCtx(data: unknown): any {
  return { request: { body: { data } }, body: undefined, status: 200 };
}

describe('cron-log internalCreate', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates an allowlisted cron log through the database service', async () => {
    const strapi = makeStrapi();
    const data = { name: 'pipeline', started_at: '2026-07-16T08:00:00Z', items_processed: 4 };
    strapi._query.create.mockResolvedValue({ documentId: 'log-doc', ...data });
    const actions = (cronLogControllerFactory as any)({ strapi });
    const ctx = makeCtx(data);

    await actions.internalCreate(ctx);

    expect(strapi.db.query).toHaveBeenCalledWith('api::cron-log.cron-log');
    expect(strapi._query.create).toHaveBeenCalledWith({ data });
    expect(ctx.status).toBe(201);
    expect(ctx.body).toEqual({ data: { documentId: 'log-doc', ...data } });
  });

  it('rejects empty and unknown cron-log fields before creating', async () => {
    const strapi = makeStrapi();
    const actions = (cronLogControllerFactory as any)({ strapi });

    const emptyCtx = makeCtx({});
    await actions.internalCreate(emptyCtx);
    expect(emptyCtx.status).toBe(400);

    const unknownCtx = makeCtx({ name: 'pipeline', status: 'forged' });
    await actions.internalCreate(unknownCtx);
    expect(unknownCtx.status).toBe(400);
    expect(strapi._query.create).not.toHaveBeenCalled();
  });
});

describe('cron-log internal route', () => {
  it('uses the service-token policy for the dedicated cron-log alias', () => {
    expect(cronLogRoutes.routes).toContainEqual({
      method: 'POST',
      path: '/internal/cron-logs',
      handler: 'cron-log.internalCreate',
      config: { auth: false, policies: ['global::service-token'] },
    });
  });
});
