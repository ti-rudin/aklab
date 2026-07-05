/**
 * Unit tests for strapi-client.ts
 * Mocks global fetch — never hits a real Strapi API.
 */
import { describe, test, expect, beforeEach, vi } from 'vitest';

// ── Set required env vars before config module loads ──
process.env.STRAPI_URL = 'http://localhost:1338';
process.env.STRAPI_API_TOKEN = 'test-token-123';
process.env.SERVICE_NAME = 'test-service';
process.env.NODE_ENV = 'test';

// ── Mock config and logger so they don't call process.exit or create transports ──
vi.mock('../src/config', () => ({
  config: {
    strapi: {
      url: 'http://localhost:1338',
      apiToken: 'test-token-123',
    },
    serviceName: 'test-service',
    logging: { level: 'error' },
  },
}));

vi.mock('../src/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  propertyExists,
  createProperty,
  updateSourceStats,
  logCron,
  fetchProperty,
  findActiveMarketReference,
  fetchSetting,
  updateProperty,
} from '../src/strapi-client';

const BASE = 'http://localhost:1338/api';

// Helper to build mock Response objects
function mockJsonResponse(data: any, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  } as Response;
}

// ─── propertyExists ─────────────────────────────────────────────────────────

describe('propertyExists()', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test('returns true when property is found', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockJsonResponse({ data: [{ id: 1 }] })
    );

    const result = await propertyExists('tender', 'ext-123');

    expect(result).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain('source][$eq]=tender');
    expect(url).toContain('external_id][$eq]=ext-123');
  });

  test('returns false when no property is found', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockJsonResponse({ data: [] })
    );

    const result = await propertyExists('tender', 'nonexistent');
    expect(result).toBe(false);
  });

  test('returns true (fail-closed) when fetch returns non-OK status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockJsonResponse({ error: 'unauthorized' }, 401)
    );

    const result = await propertyExists('tender', 'ext-1');
    expect(result).toBe(true); // fail-closed: non-OK → skip
  });

  test('returns true (fail-closed) when fetch throws', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));

    const result = await propertyExists('tender', 'ext-1');
    expect(result).toBe(true); // fail-closed
  });
});

// ─── createProperty ─────────────────────────────────────────────────────────

describe('createProperty()', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test('creates a property via POST and returns data', async () => {
    const created = { id: 42, documentId: 'doc-42' };
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockJsonResponse({ data: [] }))  // propertyExists → not found
      .mockResolvedValueOnce(mockJsonResponse({ data: created }));  // POST → created

    const result = await createProperty({
      source: 'tender',
      external_id: 'ext-1',
      url: 'https://example.com/1',
      title: 'Склад на юге Москвы',
      address: 'ул. Промышленная, 1',
      city: 'moscow',
      area_sqm: 500,
      price: 10_000_000,
      price_per_sqm: 20_000,
      property_type: 'warehouse',
      auction_type: 'bankruptcy',
    });

    expect(result).toEqual(created);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);

    const [url, opts] = (globalThis.fetch as any).mock.calls[1];
    expect(url).toBe(`${BASE}/properties`);
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body).data.source).toBe('tender');
  });

  test('auto-calculates price_per_sqm when missing', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockJsonResponse({ data: [] }))  // propertyExists → not found
      .mockResolvedValueOnce(mockJsonResponse({ data: { id: 1 } }));  // POST → created

    await createProperty({
      source: 'tender',
      external_id: 'ext-2',
      url: 'https://example.com/2',
      title: 'Офис в центре',
      address: 'ул. Центральная, 5',
      city: 'moscow',
      area_sqm: 100,
      price: 5_000_000,
      property_type: 'office',
      auction_type: 'bankruptcy',
    });

    const body = JSON.parse((globalThis.fetch as any).mock.calls[1][1].body);
    expect(body.data.price_per_sqm).toBe(50_000); // 5_000_000 / 100
  });

  test('skips non-commercial properties (returns null)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const result = await createProperty({
      source: 'tender',
      external_id: 'ext-3',
      url: 'https://example.com/3',
      title: 'Жилой дом с участком ИЖС',
      address: 'ул. Дачная, 1',
      city: 'mo',
      property_type: 'other',
      auction_type: 'bankruptcy',
    });

    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('skips properties without price_per_sqm (no price or area)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const result = await createProperty({
      source: 'tender',
      external_id: 'ext-4',
      url: 'https://example.com/4',
      title: 'Склад без цены',
      address: 'ул. Складская, 2',
      city: 'moscow',
      property_type: 'warehouse',
      auction_type: 'bankruptcy',
    });

    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('throws on non-OK response', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockJsonResponse({ data: [] }))  // propertyExists → not found
      .mockResolvedValueOnce(mockJsonResponse({ error: 'Validation error' }, 400));  // POST → 400

    await expect(
      createProperty({
        source: 'tender',
        external_id: 'ext-5',
        url: 'https://example.com/5',
        title: 'Склад',
        address: 'addr',
        city: 'moscow',
        price: 1000,
        area_sqm: 10,
        price_per_sqm: 100,
        property_type: 'warehouse',
        auction_type: 'bankruptcy',
      })
    ).rejects.toThrow('createProperty failed (400)');
  });

  test('passes through marketplace properties without commercial filter', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockJsonResponse({ data: [] }))  // propertyExists → not found
      .mockResolvedValueOnce(mockJsonResponse({ data: { id: 1 } }));  // POST → created

    const result = await createProperty({
      source: 'market',
      external_id: 'ext-6',
      url: 'https://example.com/6',
      title: 'Легковой автомобиль Toyota',
      address: 'addr',
      city: 'moscow',
      price: 500_000,
      area_sqm: 10,
      price_per_sqm: 50_000,
      property_type: 'other',
      auction_type: 'marketplace',
    });

    // marketplace auction_type bypasses commercial filter
    expect(result).toEqual({ id: 1 });
  });

  test('skips duplicate property (already exists)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      mockJsonResponse({ data: [{ id: 99 }] })  // propertyExists → found
    );

    const result = await createProperty({
      source: 'tender',
      external_id: 'ext-dup',
      url: 'https://example.com/dup',
      title: 'Дубликат',
      address: 'addr',
      city: 'moscow',
      price: 1000,
      area_sqm: 10,
      price_per_sqm: 100,
      property_type: 'warehouse',
      auction_type: 'bankruptcy',
    });

    expect(result).toBeNull();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1); // only propertyExists, no POST
  });
});

// ─── updateSourceStats ──────────────────────────────────────────────────────

describe('updateSourceStats()', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test('sends PUT with status fields directly', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockJsonResponse({ data: {} })
    );

    await updateSourceStats('doc-abc', {
      last_parse_status: 'success',
      last_parsed_at: '2025-01-01T00:00:00Z',
    });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1); // only PUT
    const [url, opts] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toBe(`${BASE}/sources/doc-abc`);
    expect(opts.method).toBe('PUT');

    const body = JSON.parse(opts.body).data;
    expect(body.last_parse_status).toBe('success');
    expect(body.last_parsed_at).toBe('2025-01-01T00:00:00Z');
  });

  test('increments counters by fetching current source first', async () => {
    // First call: GET current source
    // Second call: PUT updated source
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockJsonResponse({
        data: { parse_count: 5, total_found: 100, total_created: 20 },
      }))
      .mockResolvedValueOnce(mockJsonResponse({ data: {} }));

    await updateSourceStats('doc-abc', {
      parse_count: 1,
      total_found: 10,
      total_created: 3,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);

    // Verify GET call
    const getUrl = fetchSpy.mock.calls[0][0] as string;
    expect(getUrl).toBe(`${BASE}/sources/doc-abc`);

    // Verify PUT body has incremented values
    const putBody = JSON.parse(fetchSpy.mock.calls[1][1].body as string).data;
    expect(putBody.parse_count).toBe(6);    // 5 + 1
    expect(putBody.total_found).toBe(110);  // 100 + 10
    expect(putBody.total_created).toBe(23); // 20 + 3
  });

  test('handles GET failure gracefully (still sends PUT)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce(mockJsonResponse({ data: {} }));

    await updateSourceStats('doc-abc', {
      parse_count: 1,
      total_found: 5,
    });

    // PUT should still be sent even though GET failed
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const putBody = JSON.parse(fetchSpy.mock.calls[1][1].body as string).data;
    // Counters should not be set (GET failed, so no increment)
    expect(putBody.parse_count).toBeUndefined();
    expect(putBody.total_found).toBeUndefined();
  });

  test('warns on PUT failure but does not throw', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockJsonResponse({ error: 'not found' }, 404)
    );

    // Should not throw
    await expect(
      updateSourceStats('doc-missing', { last_parse_status: 'error' })
    ).resolves.toBeUndefined();
  });
});

// ─── logCron ────────────────────────────────────────────────────────────────

describe('logCron()', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test('sends POST to cron-logs endpoint', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockJsonResponse({ data: { id: 1 } })
    );

    await logCron({
      name: 'parse-tender',
      started_at: '2025-01-01T00:00:00Z',
      finished_at: '2025-01-01T00:01:00Z',
      items_processed: 42,
    });

    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toBe(`${BASE}/cron-logs`);
    expect(opts.method).toBe('POST');

    const body = JSON.parse(opts.body).data;
    expect(body.name).toBe('parse-tender');
    expect(body.items_processed).toBe(42);
  });

  test('catches fetch errors silently', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('down'));

    await expect(logCron({
      name: 'test',
      started_at: '2025-01-01',
      finished_at: '2025-01-01',
      items_processed: 0,
    })).resolves.toBeUndefined();
  });
});

// ─── fetchProperty ──────────────────────────────────────────────────────────

describe('fetchProperty()', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test('returns property data by documentId', async () => {
    const prop = { id: 1, documentId: 'doc-1', title: 'Test' };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockJsonResponse({ data: prop })
    );

    const result = await fetchProperty('doc-1');
    expect(result).toEqual(prop);
    expect((globalThis.fetch as any).mock.calls[0][0]).toBe(`${BASE}/properties/doc-1`);
  });

  test('throws on non-OK response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockJsonResponse({ error: 'Not found' }, 404)
    );

    await expect(fetchProperty('doc-missing')).rejects.toThrow('fetchProperty failed (404)');
  });
});

// ─── findActiveMarketReference ───────────────────────────────────────────────

describe('findActiveMarketReference()', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test('returns the first matching reference', async () => {
    const ref = { id: 5, city: 'moscow', property_type: 'office' };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockJsonResponse({ data: [ref] })
    );

    const result = await findActiveMarketReference('moscow', 'office');
    expect(result).toEqual(ref);

    const url = (globalThis.fetch as any).mock.calls[0][0] as string;
    expect(url).toContain('city][$eq]=moscow');
    expect(url).toContain('property_type][$eq]=office');
    expect(url).toContain('is_active][$eq]=true');
  });

  test('returns null when no match', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockJsonResponse({ data: [] })
    );

    const result = await findActiveMarketReference('unknown', 'other');
    expect(result).toBeNull();
  });

  test('returns null on fetch error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockJsonResponse({ error: 'err' }, 500)
    );

    const result = await findActiveMarketReference('moscow', 'office');
    expect(result).toBeNull();
  });
});

// ─── fetchSetting ───────────────────────────────────────────────────────────

describe('fetchSetting()', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test('returns singleton setting', async () => {
    const setting = { id: 1, digest_enabled: true };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockJsonResponse({ data: setting })
    );

    const result = await fetchSetting();
    expect(result).toEqual(setting);
    expect((globalThis.fetch as any).mock.calls[0][0]).toBe(`${BASE}/setting`);
  });

  test('returns null on non-OK response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockJsonResponse({ error: 'not found' }, 404)
    );

    const result = await fetchSetting();
    expect(result).toBeNull();
  });
});

// ─── updateProperty ─────────────────────────────────────────────────────────

describe('updateProperty()', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test('sends PUT with fields to property endpoint', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockJsonResponse({ data: {} })
    );

    await updateProperty('doc-1', { is_undervalued: true, deviation_percent: -15 });

    const [url, opts] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toBe(`${BASE}/properties/doc-1`);
    expect(opts.method).toBe('PUT');

    const body = JSON.parse(opts.body).data;
    expect(body.is_undervalued).toBe(true);
    expect(body.deviation_percent).toBe(-15);
  });

  test('throws on non-OK response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockJsonResponse({ error: 'Validation error' }, 422)
    );

    await expect(
      updateProperty('doc-1', { bad_field: true })
    ).rejects.toThrow('updateProperty failed (422)');
  });
});
