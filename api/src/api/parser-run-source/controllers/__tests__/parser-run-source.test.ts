import { describe, expect, it, vi } from 'vitest';

vi.mock('@strapi/strapi', () => ({
  factories: {
    createCoreController: vi.fn((_uid: string, factory: any) => factory),
  },
}));

import controllerFactory from '../parser-run-source';
import parserRunSourceRoutes from '../../routes/parser-run-source';

const VALID_COUNTERS = {
  listed: 10,
  eligible: 4,
  existing: 3,
  pre_filtered: 3,
  details_attempted: 0,
  details_ok: 0,
  created: 0,
  skipped: 0,
  failed: 0,
};

function makeCtx(data: unknown) {
  return {
    params: { identityKey: 'run-1:fabrikant:scan' },
    request: { body: { data } },
    status: 200,
    body: undefined as any,
  };
}

function makeStrapi(row: any) {
  const query = {
    findOne: vi.fn().mockResolvedValue(row),
    update: vi.fn().mockResolvedValue({ ...row, status: 'success' }),
  };
  return { db: { query: vi.fn().mockReturnValue(query) }, query };
}

describe('parser-run-source terminal alias', () => {
  it('marks a queued stage running only for its owning queue job', async () => {
    const strapi = makeStrapi({ id: 7, identity_key: 'run-1:fabrikant:scan', job_id: 41, status: 'queued' });
    const actions = (controllerFactory as any)({ strapi });
    const ctx = makeCtx({ job_id: 41 });

    await actions.markRunningInternal(ctx);

    expect(strapi.query.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { status: 'running', started_at: expect.any(String) },
    });
  });

  it('writes only a valid terminal snapshot for the owning queue job', async () => {
    const strapi = makeStrapi({ id: 7, identity_key: 'run-1:fabrikant:scan', job_id: 41, status: 'running' });
    const actions = (controllerFactory as any)({ strapi });
    const ctx = makeCtx({ job_id: 41, status: 'success', counters: VALID_COUNTERS });

    await actions.finishInternal(ctx);

    expect(strapi.query.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: expect.objectContaining({ status: 'success', ...VALID_COUNTERS, finished_at: expect.any(String) }),
    });
    expect(ctx.status).toBe(200);
  });

  it('rejects negative counters and protected fields before a database write', async () => {
    const strapi = makeStrapi({ id: 7, identity_key: 'run-1:fabrikant:scan', job_id: 41, status: 'running' });
    const actions = (controllerFactory as any)({ strapi });
    const ctx = makeCtx({
      job_id: 41,
      status: 'success',
      counters: { ...VALID_COUNTERS, created: -1 },
      source: 9,
    });

    await actions.finishInternal(ctx);

    expect(ctx.status).toBe(400);
    expect(strapi.query.findOne).not.toHaveBeenCalled();
    expect(strapi.query.update).not.toHaveBeenCalled();
  });

  it('does not overwrite a terminal snapshot with conflicting data', async () => {
    const existing = { id: 7, identity_key: 'run-1:fabrikant:scan', job_id: 41, status: 'success', ...VALID_COUNTERS };
    const strapi = makeStrapi(existing);
    const actions = (controllerFactory as any)({ strapi });
    const ctx = makeCtx({ job_id: 41, status: 'failed', counters: { ...VALID_COUNTERS, failed: 1 } });

    await actions.finishInternal(ctx);

    expect(ctx.status).toBe(409);
    expect(strapi.query.update).not.toHaveBeenCalled();
  });

  it('exposes only service-token protected stage aliases', () => {
    expect(parserRunSourceRoutes.routes).toContainEqual({
      method: 'PUT',
      path: '/internal/parser-run-sources/:identityKey/running',
      handler: 'api::parser-run-source.parser-run-source.markRunningInternal',
      config: { auth: false, policies: ['global::service-token'] },
    });
    expect(parserRunSourceRoutes.routes).toContainEqual({
      method: 'PUT',
      path: '/internal/parser-run-sources/:identityKey/terminal',
      handler: 'api::parser-run-source.parser-run-source.finishInternal',
      config: { auth: false, policies: ['global::service-token'] },
    });
  });
});
