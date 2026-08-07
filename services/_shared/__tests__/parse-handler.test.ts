/**
 * Unit tests for createParseHandler() — parse-handler.ts
 * Mocks strapi-client and logger; tests the orchestration logic.
 */
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

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
  preFilterProperty: vi.fn().mockReturnValue({ pass: true }),
  logCron: vi.fn().mockResolvedValue(undefined),
  updateSourceStats: vi.fn().mockResolvedValue(undefined),
  resetSourceDetailsCounters: vi.fn().mockResolvedValue(undefined),
  finishParserRunSourceStage: vi.fn().mockResolvedValue(undefined),
  markParserRunSourceStageRunning: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/anti-ban', () => ({
  randomDelay: vi.fn().mockResolvedValue(undefined),
}));

import { createParseHandler } from '../src/parse-handler';
import { propertyExists, createProperty, preFilterProperty, logCron, updateSourceStats, finishParserRunSourceStage, markParserRunSourceStageRunning } from '../src/strapi-client';
import { randomDelay } from '../src/anti-ban';
import type { Job } from '@aklab/sqlite-queue';
import type { SourceParser } from '../src/types';
import { createUserFilterSnapshot, type UserFilterSnapshot } from '@aklab/parse-rules';
import { getScanArtifactPath } from '../src/scan-artifact';

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

function makeSnapshot(profiles: UserFilterSnapshot['profiles'], scope: 'all' | 'single' = 'all'): UserFilterSnapshot {
  return createUserFilterSnapshot({
    schemaVersion: 1,
    scope,
    createdAt: '2026-08-07T10:00:00.000Z',
    windowEndAt: '2026-08-07T11:00:00.000Z',
    profiles,
  });
}

function makeProfile(overrides: Record<string, unknown> = {}) {
  return {
    userId: 1,
    profileId: 11,
    version: 1,
    regions: ['moscow' as const],
    propertyTypes: ['office' as const],
    priceFrom: null,
    priceTo: null,
    areaFrom: null,
    areaTo: null,
    stopWords: [],
    ...overrides,
  };
}

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

    expect(result).toEqual({ created: 2, filtered: 0, total: 2, detailsFetched: 0, detailsNeeded: 0 });
    expect(parser.parse).toHaveBeenCalledTimes(1);
    expect(propertyExists).toHaveBeenCalledTimes(2);
    expect(createProperty).toHaveBeenCalledTimes(2);
  });

  test('writes an exact terminal telemetry snapshot when the pipeline provides an identity', async () => {
    (propertyExists as any).mockResolvedValue(false);
    (createProperty as any).mockResolvedValue({ id: 1 });

    await createParseHandler(makeParser(defaultProps))(makeJob({
      source: 'tender',
      documentId: 'doc-src-1',
      telemetryIdentityKey: 'run-1:tender:scan',
      filterSnapshot: makeSnapshot([makeProfile({ propertyTypes: ['office', 'warehouse'] })]),
    }));

    expect(markParserRunSourceStageRunning).toHaveBeenCalledWith('run-1:tender:scan', 1);
    expect(finishParserRunSourceStage).toHaveBeenCalledWith('run-1:tender:scan', {
      job_id: 1,
      status: 'success',
      counters: {
        listed: 2,
        eligible: 2,
        existing: 0,
        pre_filtered: 0,
        details_attempted: 0,
        details_ok: 0,
        created: 2,
        skipped: 0,
        failed: 0,
      },
    });
  });

  test('skips already existing properties', async () => {
    (propertyExists as any).mockResolvedValue(true); // all exist

    const parser = makeParser(defaultProps);
    const handler = createParseHandler(parser);

    const result = await handler(makeJob({ source: 'tender', documentId: 'doc-src-1' }));

    expect(result).toEqual({ created: 0, filtered: 0, total: 2, detailsFetched: 0, detailsNeeded: 0 });
    expect(createProperty).not.toHaveBeenCalled();
  });

  test('counts filtered properties (createProperty returns null)', async () => {
    (propertyExists as any).mockResolvedValue(false);
    (createProperty as any).mockResolvedValueOnce({ id: 1 }).mockResolvedValueOnce(null);

    const parser = makeParser(defaultProps);
    const handler = createParseHandler(parser);

    const result = await handler(makeJob({ source: 'tender', documentId: 'doc-src-1' }));

    expect(result).toEqual({ created: 1, filtered: 1, total: 2, detailsFetched: 0, detailsNeeded: 0 });
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

  test('fails details phase when its scan artifact is missing', async () => {
    const parser = makeParser([]);
    const handler = createParseHandler(parser);

    await expect(handler(makeJob({
      source: 'missing-artifact-source',
      documentId: 'doc-src-1',
      correlationId: `missing-artifact-${Date.now()}`,
      phase: 'details',
    }))).rejects.toThrow('Scan artifact is missing');
  });

  test('rejects a legacy array artifact instead of silently processing it', async () => {
    const source = 'legacy-artifact-source';
    const correlationId = `legacy-artifact-${Date.now()}`;
    const scanDir = join(tmpdir(), 'aklab-scan');
    mkdirSync(scanDir, { recursive: true });
    writeFileSync(join(scanDir, `${source}-${correlationId}.json`), JSON.stringify(defaultProps));

    const handler = createParseHandler(makeParser([]));
    await expect(handler(makeJob({ source, documentId: 'doc-src-1', correlationId, phase: 'details' })))
      .rejects.toThrow('Scan artifact manifest is invalid');
  });

  test('calls updateSourceStats with success data on success', async () => {
    (propertyExists as any).mockResolvedValue(false);
    (createProperty as any).mockResolvedValue({ id: 1 });

    const handler = createParseHandler(makeParser(defaultProps));
    await handler(makeJob({ source: 'tender', documentId: 'doc-src-1' }));

    expect(updateSourceStats).toHaveBeenCalledWith('doc-src-1', expect.objectContaining({
      total_found: 2,
      total_details_needed: 0,
    }));
    expect(updateSourceStats).toHaveBeenCalledWith('doc-src-1', expect.objectContaining({
      last_parse_status: 'success',
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

    expect(result).toEqual({ created: 0, filtered: 0, total: 0, detailsFetched: 0, detailsNeeded: 0 });
    expect(propertyExists).not.toHaveBeenCalled();
    expect(createProperty).not.toHaveBeenCalled();
    expect(updateSourceStats).toHaveBeenCalledWith('doc-src-1', expect.objectContaining({
      total_found: 0,
      total_details_needed: 0,
    }));
    expect(updateSourceStats).toHaveBeenCalledWith('doc-src-1', expect.objectContaining({
      last_parse_status: 'success',
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

  test('requires a valid snapshot for pipeline-owned jobs', async () => {
    const parser = makeParser(defaultProps);
    const handler = createParseHandler(parser);

    await expect(handler(makeJob({
      source: 'pipeline-snapshot-required',
      telemetryIdentityKey: 'run-required:pipeline-snapshot-required:scan',
    }))).rejects.toThrow('Parse job filter snapshot is required');

    expect(parser.parse).not.toHaveBeenCalled();
    expect(propertyExists).not.toHaveBeenCalled();
  });

  test('uses OR of complete immutable profiles once across scan and details', async () => {
    (propertyExists as any).mockResolvedValue(false);
    (createProperty as any).mockResolvedValue({ id: 1 });

    const properties = [
      { ...defaultProps[1], external_id: 'or-moscow-office', city: 'moscow', property_type: 'office', price: 10_000_000 },
      { ...defaultProps[0], external_id: 'or-mo-warehouse', city: 'mo', property_type: 'warehouse', price: 60_000_000 },
      { ...defaultProps[0], external_id: 'or-crossed-fields', city: 'moscow', property_type: 'warehouse', price: 60_000_000 },
    ];
    const parser: SourceParser = {
      name: 'or-parser',
      parse: vi.fn().mockResolvedValue(properties),
      fetchDetails: vi.fn().mockResolvedValue({}),
    };
    const snapshot = makeSnapshot([
      makeProfile({ userId: 1, profileId: 101, regions: ['moscow'], propertyTypes: ['office'], priceTo: 20_000_000 }),
      makeProfile({ userId: 2, profileId: 202, regions: ['mo'], propertyTypes: ['warehouse'], priceFrom: 50_000_000 }),
    ]);
    const handler = createParseHandler(parser);
    const runId = `or-run-${Date.now()}`;

    const scan = await handler(makeJob({
      source: 'or-source',
      documentId: 'doc-or',
      correlationId: runId,
      phase: 'scan',
      telemetryIdentityKey: 'run-or:or-source:scan',
      filterSnapshot: snapshot,
    }));

    expect(scan).toMatchObject({ total: 3, filtered: 1, detailsNeeded: 2 });
    expect(parser.parse).toHaveBeenCalledTimes(1);
    expect(preFilterProperty).toHaveBeenCalledTimes(3);
    expect((preFilterProperty as any).mock.calls.every((call: any[]) => call[1] === undefined)).toBe(true);

    const details = await handler(makeJob({
      source: 'or-source',
      documentId: 'doc-or',
      correlationId: runId,
      phase: 'details',
      telemetryIdentityKey: 'run-or:or-source:details',
      filterSnapshot: snapshot,
    }));

    expect(details).toMatchObject({ total: 3, created: 2, filtered: 0, detailsFetched: 0, detailsNeeded: 2 });
    expect(parser.fetchDetails).toHaveBeenCalledTimes(2);
    expect(createProperty).toHaveBeenCalledTimes(2);
    expect((createProperty as any).mock.calls.every((call: any[]) => call[0].rules === undefined)).toBe(true);
    expect(existsSync(getScanArtifactPath('or-source', runId))).toBe(false);
  });

  test('creates a candidate only once when it matches two profiles', async () => {
    (propertyExists as any).mockResolvedValue(false);
    (createProperty as any).mockResolvedValue({ id: 1 });

    const parser = makeParser([{ ...defaultProps[1], external_id: 'matches-both' }]);
    const snapshot = makeSnapshot([
      makeProfile({ userId: 1, profileId: 301 }),
      makeProfile({ userId: 2, profileId: 302 }),
    ]);
    const handler = createParseHandler(parser);
    const runId = `or-both-${Date.now()}`;

    await handler(makeJob({ source: 'or-both-source', correlationId: runId, phase: 'scan', filterSnapshot: snapshot }));
    await handler(makeJob({ source: 'or-both-source', correlationId: runId, phase: 'details', filterSnapshot: snapshot }));

    expect(createProperty).toHaveBeenCalledTimes(1);
  });

  test('fails closed on a job snapshot hash mismatch before details side effects', async () => {
    (propertyExists as any).mockResolvedValue(false);
    const parser: SourceParser = {
      name: 'mismatch-parser',
      parse: vi.fn().mockResolvedValue([defaultProps[0]]),
      fetchDetails: vi.fn().mockResolvedValue({ description: 'must not fetch' }),
    };
    const first = makeSnapshot([makeProfile({ profileId: 401 })]);
    const second = makeSnapshot([makeProfile({ profileId: 402, regions: ['mo'], propertyTypes: ['warehouse'] })]);
    const handler = createParseHandler(parser);
    const runId = `mismatch-${Date.now()}`;

    await handler(makeJob({ source: 'mismatch-source', correlationId: runId, phase: 'scan', filterSnapshot: first }));
    await expect(handler(makeJob({ source: 'mismatch-source', correlationId: runId, phase: 'details', filterSnapshot: second })))
      .rejects.toThrow('Scan artifact metadata is invalid');

    expect(parser.fetchDetails).not.toHaveBeenCalled();
    expect(createProperty).not.toHaveBeenCalled();
    expect(existsSync(getScanArtifactPath('mismatch-source', runId))).toBe(true);
  });

  test('empty snapshot is a successful no-op without parser or property calls', async () => {
    const parser = makeParser(defaultProps);
    const snapshot = makeSnapshot([]);
    const handler = createParseHandler(parser);

    const result = await handler(makeJob({
      source: 'empty-snapshot-source',
      documentId: 'doc-empty',
      telemetryIdentityKey: 'run-empty:empty-snapshot-source:scan',
      filterSnapshot: snapshot,
    }));

    expect(result).toEqual({ created: 0, filtered: 0, total: 0, detailsFetched: 0, detailsNeeded: 0 });
    expect(parser.parse).not.toHaveBeenCalled();
    expect(propertyExists).not.toHaveBeenCalled();
    expect(preFilterProperty).not.toHaveBeenCalled();
    expect(createProperty).not.toHaveBeenCalled();
    expect(finishParserRunSourceStage).toHaveBeenCalledWith('run-empty:empty-snapshot-source:scan', expect.objectContaining({
      status: 'success_empty',
    }));
  });

  test('preserves the artifact after a snapshot details failure and cleans it only after retry succeeds', async () => {
    (propertyExists as any).mockResolvedValue(false);
    (createProperty as any).mockRejectedValueOnce(new Error('injected create failure')).mockResolvedValue({ id: 1 });
    const parser = makeParser([{ ...defaultProps[0], external_id: 'retryable' }]);
    const snapshot = makeSnapshot([makeProfile({ profileId: 501, propertyTypes: ['warehouse'] })]);
    const handler = createParseHandler(parser);
    const runId = `retry-${Date.now()}`;

    await handler(makeJob({ source: 'retry-source', correlationId: runId, phase: 'scan', filterSnapshot: snapshot }));
    await expect(handler(makeJob({
      source: 'retry-source',
      correlationId: runId,
      phase: 'details',
      telemetryIdentityKey: 'run-retry:retry-source:details',
      filterSnapshot: snapshot,
    }))).rejects.toThrow('injected create failure');
    expect(existsSync(getScanArtifactPath('retry-source', runId))).toBe(true);

    await handler(makeJob({
      source: 'retry-source',
      correlationId: runId,
      phase: 'details',
      telemetryIdentityKey: 'run-retry:retry-source:details',
      filterSnapshot: snapshot,
    }));
    expect(existsSync(getScanArtifactPath('retry-source', runId))).toBe(false);
  });

  test('preserves the artifact when terminal source telemetry fails', async () => {
    (propertyExists as any).mockResolvedValue(false);
    (createProperty as any).mockResolvedValue({ id: 1 });
    const parser = makeParser([{ ...defaultProps[0], external_id: 'telemetry-retry' }]);
    const snapshot = makeSnapshot([makeProfile({ profileId: 601, propertyTypes: ['warehouse'] })]);
    const handler = createParseHandler(parser);
    const runId = `telemetry-${Date.now()}`;

    await handler(makeJob({ source: 'telemetry-source', correlationId: runId, phase: 'scan', filterSnapshot: snapshot }));
    (updateSourceStats as any).mockRejectedValueOnce(new Error('injected telemetry failure'));

    await expect(handler(makeJob({
      source: 'telemetry-source',
      documentId: 'doc-telemetry',
      correlationId: runId,
      phase: 'details',
      filterSnapshot: snapshot,
    }))).rejects.toThrow('injected telemetry failure');
    expect(existsSync(getScanArtifactPath('telemetry-source', runId))).toBe(true);
  });
});
