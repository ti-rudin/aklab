import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@strapi/strapi', () => ({
  factories: {
    createCoreController: vi.fn((_uid: string, factory: any) => factory),
  },
}));

import sourceControllerFactory from '../source';
import sourceRoutes from '../../routes/source';

function makeStrapi(source: any) {
  const query = {
    findOne: vi.fn().mockResolvedValue(source),
    update: vi.fn(),
  };
  return {
    db: {
      query: vi.fn().mockReturnValue(query),
    },
    _query: query,
  };
}

function makeCtx() {
  return {
    params: { id: 'source-document-id' },
    body: undefined as any,
    status: 200,
    badRequest: vi.fn(function (this: any, message: string) {
      this.status = 400;
      this.body = { error: message };
    }),
    notFound: vi.fn(function (this: any, message: string) {
      this.status = 404;
      this.body = { error: message };
    }),
    internalServerError: vi.fn(function (this: any, message: string) {
      this.status = 500;
      this.body = { error: message };
    }),
  };
}

describe('source healthCheck', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = fetchMock;
  });

  it('proxies only the manifest port for the configured parser', async () => {
    fetchMock.mockResolvedValue({ json: vi.fn().mockResolvedValue({ status: 'ok' }) });
    const actions = (sourceControllerFactory as any)({
      strapi: makeStrapi({ parser: 'fabrikant', health_port: 1345 }),
    });
    const ctx = makeCtx();

    await actions.healthCheck(ctx);

    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:1345/health', expect.any(Object));
    expect(ctx.body).toEqual({ data: { status: 'ok' } });
  });

  it('rejects a mutable health_port before issuing a loopback request', async () => {
    const actions = (sourceControllerFactory as any)({
      strapi: makeStrapi({ parser: 'fabrikant', health_port: 1338 }),
    });
    const ctx = makeCtx();

    await actions.healthCheck(ctx);

    expect(ctx.badRequest).toHaveBeenCalledWith('Unexpected health_port configured for source parser');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('source internalUpdateStats', () => {
  it('updates only parser statistics by documentId', async () => {
    const strapi = makeStrapi({ parser: 'fabrikant', health_port: 1345 });
    strapi._query.update.mockResolvedValue({ documentId: 'source-doc', total_found: 20, last_parse_error: null });
    const actions = (sourceControllerFactory as any)({ strapi });
    const ctx = makeCtx();
    ctx.request = { body: { data: { total_found: 20, last_parse_error: null } } };

    await actions.internalUpdateStats(ctx);

    expect(strapi.db.query).toHaveBeenCalledWith('api::source.source');
    expect(strapi._query.update).toHaveBeenCalledWith({
      where: { documentId: 'source-document-id' },
      data: { total_found: 20, last_parse_error: null },
    });
    expect(ctx.body).toEqual({ data: { documentId: 'source-doc', total_found: 20, last_parse_error: null } });
  });

  it('rejects empty and protected source fields before writing', async () => {
    const strapi = makeStrapi({ parser: 'fabrikant', health_port: 1345 });
    const actions = (sourceControllerFactory as any)({ strapi });
    const emptyCtx = makeCtx();
    emptyCtx.request = { body: { data: {} } };

    await actions.internalUpdateStats(emptyCtx);

    expect(emptyCtx.status).toBe(400);
    expect(strapi._query.update).not.toHaveBeenCalled();

    const protectedFieldCtx = makeCtx();
    protectedFieldCtx.request = { body: { data: { parser: 'fabrikant', health_port: 1345, is_active: false, url: 'https://example.test' } } };
    await actions.internalUpdateStats(protectedFieldCtx);

    expect(protectedFieldCtx.status).toBe(400);
    expect(strapi._query.update).not.toHaveBeenCalled();
  });
});

describe('source internal route', () => {
  it('uses the service-token policy for the dedicated source stats alias', () => {
    expect(sourceRoutes.routes).toContainEqual({
      method: 'PUT',
      path: '/internal/sources/:id/stats',
      handler: 'api::source.source.internalUpdateStats',
      config: { auth: false, policies: ['global::service-token'] },
    });
  });
});
