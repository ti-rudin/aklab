import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@strapi/strapi', () => ({
  factories: {
    createCoreController: vi.fn((_uid: string, factory: any) => factory),
  },
}));

import sourceControllerFactory from '../source';

function makeStrapi(source: any) {
  return {
    db: {
      query: vi.fn().mockReturnValue({
        findOne: vi.fn().mockResolvedValue(source),
      }),
    },
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
