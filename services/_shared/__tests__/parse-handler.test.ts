/**
 * Unit tests for createParseHandler() — parse-handler.ts
 * Mocks strapi-client and logger; tests the orchestration logic.
 */
import { describe, test, expect, beforeEach, vi } from 'vitest';

// ── Set required env vars before config module loads ──
process.env.STRAPI_URL = 'http://localhost:1338';
process.env.STRAPI_API_TOKEN='***';
process.env.SERVICE_NAME = 'test-service';
process.env.NODE_ENV = 'test';

// ── Mock dependencies ──
vi.mock('../src/config', () => ({
  config: {
    strapi: { url: 'http://localhost:1338', apiToken: 'test-token' },
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

// Mock strapi-client functions
vi.mock('../src/strapi-client', () => ({
  propertyExists: vi.fn(),
  createProperty: vi.fn(),
  logCron: vi.fn().mockResolvedValue(undefined),
  updateSourceStats: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/anti-ban', () => ({
  randomDelay: vi.fn().mockResolvedValue(undefined),
}));

import { createParseHandler } from '../src/parse-handler';
import { propertyExists, createProperty, logCron, updateSourceStats } from '../src/strapi-client';
import { randomDelay } from '../src/anti-ban';
import type { Job } from '@aklab/sqlite-queue';
import type { SourceParser } from '../src/types';

// Helpers
function makeJob(data: any, correlationId?: string): Job {
  return {
    id: 1,
    queue: 'parse-test',
    status: 'active',
    data,
    result: null,
    error: null,
    attempts: 1,
    max_attempts: 3,
    correlation_id: correlationId ?? null,
    created_at: Date.now(),
    started_at: Date.now(),
    completed_at: null,
    scheduled_at: null,
    priority: 0,
  };
}

function makeParser(properties: any[]): SourceParser {
  return {
    name: 'test-parser',
    parse: vi.fn().mockResolvedValue(properties),
  };
}

const defaultProps = [
  {
    external_id: 'ext-1',
    url: 'https://example.com/1',
    title: 'Склад',
    address: 'addr 1',
    city: 'moscow',
    area_sqm: 500,
    price: 10_000_000,
    price_per_sqm: 20_000,
    property_type: 'warehouse',
    auction_type: 'bankruptcy',
  },
  {
    external_id: 'ext-2',
    url: 'https://example.com/2',
    title: 'Офис',
    address: 'addr 2',
    city: 'moscow',
    area_sqm: 100,
    price: 5_000_000,
    price_per_sqm: 50_000,
    property_type: 'office',
    auction_type: 'bankruptcy',
  },
];

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('createParseHandler()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('returns a function', () => {
    const handler = createParseHandler(makeParser([]));
    expect(typeof handler).toBe('function');
  });

  test('processes all properties, creates new ones', async () => {
    (propertyExists as any).mockResolvedValue(false);
    (createProperty as any).mockResolvedValue({ id: 1 });

    const parser = makeParser(defaultProps);
    const handler = createParseHandler(parser);

    const job = makeJob({ source: 'tender', documentId: 'doc-src-1' });
    const result = await handler(job);

    expect(result).toEqual({ created: 2, filtered: 0, total: 2 });
    expect(parser.parse).toHaveBeenCalledTimes(1);
    expect(propertyExists).toHaveBeenCalledTimes(2);
    expect(createProperty).toHaveBeenCalledTimes(2);
  });

  test('skips already existing properties', async () => {
    (propertyExists as any).mockResolvedValue(true); // all exist

    const parser = makeParser(defaultProps);
    const handler = createParseHandler(parser);

    const result = await handler(makeJob({ source: 'tender', documentId: 'doc-src-1' }));

    expect(result).toEqual({ created: 0, filtered: 0, total: 2 });
    expect(createProperty).not.toHaveBeenCalled();
  });

  test('counts filtered properties (createProperty returns null)', async () => {
    (propertyExists as any).mockResolvedValue(false);
    (createProperty as any).mockResolvedValueOnce({ id: 1 }).mockResolvedValueOnce(null);

    const parser = makeParser(defaultProps);
    const handler = createParseHandler(parser);

    const result = await handler(makeJob({ source: 'tender', documentId: 'doc-src-1' }));

    expect(result).toEqual({ created: 1, filtered: 1, total: 2 });
  });

  test('logs error and re-throws when parser.parse() fails', async () => {
    const parser: SourceParser = {
      name: 'failing-parser',
      parse: vi.fn().mockRejectedValue(new Error('Parse engine crashed')),
    };

    const handler = createParseHandler(parser);

    await expect(
      handler(makeJob({ source: 'tender', documentId: 'doc-src-1' }))
    ).rejects.toThrow('Parse engine crashed');
  });

  test('updates source stats with error status when parse fails', async () => {
    const parser: SourceParser = {
      name: 'failing-parser',
      parse: vi.fn().mockRejectedValue(new Error('timeout')),
    };

    const handler = createParseHandler(parser);

    try {
      await handler(makeJob({ source: 'tender', documentId: 'doc-src-1' }));
    } catch { /* expected */ }

    expect(updateSourceStats).toHaveBeenCalledWith('doc-src-1', expect.objectContaining({
      last_parse_status: 'error',
      last_parse_error: 'timeout',
    }));
  });

  test('does not crash when individual property creation fails (catches per-item)', async () => {
    (propertyExists as any).mockResolvedValue(false);
    (createProperty as any)
      .mockResolvedValueOnce({ id: 1 }) // first succeeds
      .mockRejectedValueOnce(new Error('Strapi 500')); // second fails

    const parser = makeParser(defaultProps);
    const handler = createParseHandler(parser);

    const result = await handler(makeJob({ source: 'tender', documentId: 'doc-src-1' }));

    // The handler should NOT throw — individual errors are caught
    expect(result.total).toBe(2);
    expect(result.created).toBe(1); // only first succeeded
  });

  test('always calls logCron in finally block', async () => {
    (propertyExists as any).mockResolvedValue(true);

    const handler = createParseHandler(makeParser(defaultProps));
    await handler(makeJob({ source: 'tender', documentId: 'doc-src-1' }));

    expect(logCron).toHaveBeenCalledTimes(1);
    expect(logCron).toHaveBeenCalledWith(expect.objectContaining({
      name: 'parse-tender',
      items_processed: 0, // 0 created when all are skipped
    }));
  });

  test('calls logCron even when parse fails', async () => {
    const parser: SourceParser = {
      name: 'fail',
      parse: vi.fn().mockRejectedValue(new Error('boom')),
    };
    const handler = createParseHandler(parser);

    try {
      await handler(makeJob({ source: 'tender', documentId: 'doc-src-1' }));
    } catch { /* expected */ }

    expect(logCron).toHaveBeenCalledTimes(1);
    expect(logCron).toHaveBeenCalledWith(expect.objectContaining({
      error: 'boom',
    }));
  });

  test('calls updateSourceStats with success data on success', async () => {
    (propertyExists as any).mockResolvedValue(false);
    (createProperty as any).mockResolvedValue({ id: 1 });

    const handler = createParseHandler(makeParser(defaultProps));
    await handler(makeJob({ source: 'tender', documentId: 'doc-src-1' }));

    expect(updateSourceStats).toHaveBeenCalledWith('doc-src-1', expect.objectContaining({
      last_parse_status: 'success',
      total_found: 2,
      total_created: 2,
      parse_count: 1,
    }));
  });

  test('uses correlationId from job.data if provided', async () => {
    (propertyExists as any).mockResolvedValue(true);

    const handler = createParseHandler(makeParser([]));
    const job = makeJob(
      { source: 'tender', documentId: 'doc-src-1', correlationId: 'custom-corr-id' },
      'custom-corr-id'
    );

    await handler(job);

    // Logger should have been called with the correlationId (we can't easily check
    // exact calls since logger is fully mocked, but this ensures no crash)
    expect(logCron).toHaveBeenCalled();
  });

  test('generates correlationId fallback when not provided', async () => {
    (propertyExists as any).mockResolvedValue(true);

    const handler = createParseHandler(makeParser([]));
    const job = makeJob({ source: 'tender', documentId: 'doc-src-1' });
    // correlation_id on job is null, correlationId in data is also undefined
    job.correlation_id = null;

    // Should not crash
    await expect(handler(job)).resolves.toBeDefined();
  });

  test('handles empty parse results', async () => {
    const parser = makeParser([]);
    const handler = createParseHandler(parser);

    const result = await handler(makeJob({ source: 'tender', documentId: 'doc-src-1' }));

    expect(result).toEqual({ created: 0, filtered: 0, total: 0 });
    expect(propertyExists).not.toHaveBeenCalled();
    expect(createProperty).not.toHaveBeenCalled();
    expect(updateSourceStats).toHaveBeenCalledWith('doc-src-1', expect.objectContaining({
      total_found: 0,
      total_created: 0,
    }));
  });

  test('does not call updateSourceStats when documentId is missing', async () => {
    (propertyExists as any).mockResolvedValue(true);

    const handler = createParseHandler(makeParser(defaultProps));
    await handler(makeJob({ source: 'tender' })); // no documentId

    // updateSourceStats should NOT be called (only logCron)
    expect(updateSourceStats).not.toHaveBeenCalled();
    expect(logCron).toHaveBeenCalled();
  });
});
