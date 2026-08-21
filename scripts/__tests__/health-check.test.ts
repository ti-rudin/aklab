import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let healthCheck: any;

beforeAll(() => {
  vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200 }));
  healthCheck = require('../health-check.js');
});

afterAll(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('health-check service request contract', () => {
  it('checks Vite preview through /index.html with Accept text/html', () => {
    const app = healthCheck.buildServiceList({
      core: [{ slug: 'app', port: 5174 }],
      parsers: [],
      workers: [],
    }).find((service: any) => service.name === 'app (preview)');

    expect(app).toMatchObject({
      url: 'http://localhost:5174/index.html',
      accept: 'text/html',
    });
  });

  it('keeps API and worker health requests JSON', () => {
    const services = healthCheck.buildServiceList({
      core: [
        { slug: 'api', port: 1338 },
        { slug: 'app', port: 5174 },
      ],
      parsers: [{ slug: 'parser-one', port: 1345 }],
      workers: [{ slug: 'worker-one', port: 1356 }],
    });

    expect(services.find((service: any) => service.name === 'api (Strapi)')).toMatchObject({
      accept: 'application/json',
    });
    expect(services.find((service: any) => service.name === 'parser-one')).toMatchObject({
      accept: 'application/json',
    });
    expect(services.find((service: any) => service.name === 'worker-one')).toMatchObject({
      accept: 'application/json',
    });
  });

  it('passes each service Accept header to its health request', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockClear();

    await expect(healthCheck.checkService({
      name: 'app (preview)', url: 'http://localhost:5174/index.html', accept: 'text/html', critical: true,
    })).resolves.toMatchObject({ ok: true, status: 200 });

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:5174/index.html', expect.objectContaining({
      headers: { Accept: 'text/html' },
    }));
  });
});
