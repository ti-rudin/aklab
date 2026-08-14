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
  property_block_found: 0,
  location_label_found: 0,
  location_confirmed_address: 0,
  location_confirmed_region_only: 0,
  location_missing: 0,
  location_unresolved: 0,
  schema_mismatch: 0,
};

function makeCtx(data: unknown) {
  const terminalData = data && typeof data === 'object' && 'status' in data
    ? { detail_supported: true, ...data }
    : data;
  return {
    params: { identityKey: 'run-1:fabrikant:scan' },
    request: { body: { data: terminalData } },
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

  it('persists a bounded diagnostics fingerprint with an exact valid terminal snapshot', async () => {
    const strapi = makeStrapi({ id: 7, identity_key: 'run-1:fabrikant:details', job_id: 41, status: 'running' });
    const actions = (controllerFactory as any)({ strapi });
    const counters = {
      ...VALID_COUNTERS,
      details_attempted: 2,
      details_ok: 2,
      property_block_found: 2,
      location_label_found: 1,
      location_confirmed_address: 1,
      location_missing: 1,
      location_unresolved: 1,
    };
    const ctx = makeCtx({
      job_id: 41,
      status: 'degraded',
      counters,
      diagnostics_schema_version: 1,
      semantic_fingerprint: 'a'.repeat(64),
    });

    await actions.finishInternal(ctx);

    expect(strapi.query.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: expect.objectContaining({
        status: 'degraded',
        ...counters,
        diagnostics_schema_version: 1,
        semantic_fingerprint: 'a'.repeat(64),
      }),
    });
  });

  it.each(['anti_bot', 'http_block'])('accepts and persists the %s terminal error class', async (error_class) => {
    const strapi = makeStrapi({ id: 7, identity_key: 'run-1:fabrikant:details', job_id: 41, status: 'running' });
    const actions = (controllerFactory as any)({ strapi });
    const ctx = makeCtx({
      job_id: 41,
      status: 'blocked',
      counters: VALID_COUNTERS,
      error_class,
      error_message: `parser.${error_class}`,
    });

    await actions.finishInternal(ctx);

    expect(ctx.status).toBe(200);
    expect(strapi.query.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ error_class, error_message: `parser.${error_class}` }),
    }));
  });

  it('rejects raw terminal error text before a database write', async () => {
    const strapi = makeStrapi({ id: 7, identity_key: 'run-1:fabrikant:details', job_id: 41, status: 'running' });
    const actions = (controllerFactory as any)({ strapi });
    const ctx = makeCtx({
      job_id: 41,
      status: 'failed',
      counters: VALID_COUNTERS,
      error_class: 'transient',
      error_message: 'raw adapter failure contains sensitive payload marker',
    });

    await actions.finishInternal(ctx);

    expect(ctx.status).toBe(400);
    expect(strapi.query.findOne).not.toHaveBeenCalled();
    expect(strapi.query.update).not.toHaveBeenCalled();
  });

  it.each([
    [{ ...VALID_COUNTERS, details_ok: 1, location_confirmed_address: 1, location_missing: 1 }],
    [{ ...VALID_COUNTERS, details_ok: 1, location_missing: 1, location_unresolved: 2 }],
    [{ ...VALID_COUNTERS, details_ok: 1, property_block_found: 2 }],
  ])('rejects internally inconsistent extraction counters', async (counters) => {
    const strapi = makeStrapi({ id: 7, identity_key: 'run-1:fabrikant:details', job_id: 41, status: 'running' });
    const actions = (controllerFactory as any)({ strapi });
    const ctx = makeCtx({ job_id: 41, status: 'degraded', counters });

    await actions.finishInternal(ctx);

    expect(ctx.status).toBe(400);
    expect(strapi.query.findOne).not.toHaveBeenCalled();
  });

  it.each([
    [{ diagnostics_schema_version: 1 }],
    [{ semantic_fingerprint: 'a'.repeat(64) }],
    [{ diagnostics_schema_version: 2, semantic_fingerprint: 'a'.repeat(64) }],
    [{ diagnostics_schema_version: 1, semantic_fingerprint: 'raw address text' }],
  ])('rejects an incomplete or unsafe diagnostics envelope', async (diagnostics) => {
    const strapi = makeStrapi({ id: 7, identity_key: 'run-1:fabrikant:details', job_id: 41, status: 'running' });
    const actions = (controllerFactory as any)({ strapi });
    const ctx = makeCtx({ job_id: 41, status: 'degraded', counters: VALID_COUNTERS, ...diagnostics });

    await actions.finishInternal(ctx);

    expect(ctx.status).toBe(400);
    expect(strapi.query.findOne).not.toHaveBeenCalled();
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
