/**
 * Unit tests for createParseHandler() — parse-handler.ts
 * Mocks strapi-client and logger; tests the orchestration logic.
 */
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
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
  isSourceNormalWorkAllowed: vi.fn().mockResolvedValue(true),
}));

vi.mock('../src/anti-ban', () => ({
  randomDelay: vi.fn().mockResolvedValue(undefined),
}));

import { createParseHandler } from '../src/parse-handler';
import { propertyExists, createProperty, preFilterProperty, logCron, updateSourceStats, resetSourceDetailsCounters, finishParserRunSourceStage, markParserRunSourceStageRunning, isSourceNormalWorkAllowed } from '../src/strapi-client';
import { randomDelay } from '../src/anti-ban';
import type { Job } from '@aklab/sqlite-queue';
import type { SourceParser } from '../src/types';
import { createUserFilterSnapshot, type UserFilterSnapshot } from '@aklab/parse-rules';
import { getLocationUnresolvedManifestPath, getScanArtifactPath } from '../src/scan-artifact';
import { createParserExtractionDiagnostics } from '../src/parser-diagnostics';
import { ParserSourceError } from '../src/parser-error';

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
    property_location: {
      address: 'г. Москва, ул. Промышленная, 1',
      region: 'Москва',
      region_code: '77',
      status: 'confirmed_address',
      source_kind: 'api_field',
      source_path: 'lot.estateAddress',
    },
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
    property_location: {
      address: 'г. Москва, ул. Центральная, 5',
      region: 'Москва',
      region_code: '77',
      status: 'confirmed_address',
      source_kind: 'api_field',
      source_path: 'lot.estateAddress',
    },
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
    vi.mocked(isSourceNormalWorkAllowed).mockResolvedValue(true);
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

    expect(result).toEqual({ created: 2, filtered: 0, total: 2, detailsFetched: 0, detailsNeeded: 0, locationUnresolved: 0 });
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
      detail_supported: false,
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
        property_block_found: 0,
        location_label_found: 0,
        location_confirmed_address: 0,
        location_confirmed_region_only: 0,
        location_missing: 0,
        location_unresolved: 0,
        schema_mismatch: 0,
      },
    });
  });

  test('aggregates bounded extraction diagnostics into details telemetry without Property leakage', async () => {
    (propertyExists as any).mockResolvedValue(false);
    (createProperty as any).mockResolvedValue({ id: 1 });
    const parser: SourceParser = {
      name: 'diagnostic-parser',
      parse: vi.fn().mockResolvedValue([{
        ...defaultProps[0],
        external_id: 'diagnostic-property',
        property_location: {
          status: 'missing', source_kind: 'dom_field', source_path: 'listing.property_location',
        },
      }]),
      fetchDetails: vi.fn().mockResolvedValue({
        property_location: {
          region: 'Ярославская область', status: 'confirmed_region_only',
          source_kind: 'dom_field', source_path: 'details.field.region',
        },
        parser_diagnostics: createParserExtractionDiagnostics({
          adapterVersion: 'test-adapter.v1',
          propertyBlockFound: true,
          locationLabelId: 'property.location.region',
          semanticSignals: ['property.block', 'property.location.region'],
        }),
      }),
    };
    const snapshot = makeSnapshot([makeProfile({ profileId: 711, regions: ['other'], propertyTypes: ['warehouse'] })]);
    const runId = `diagnostics-${Date.now()}`;
    const handler = createParseHandler(parser);

    await handler(makeJob({
      source: 'diagnostic-source', correlationId: runId, phase: 'scan',
      telemetryIdentityKey: 'run-diagnostic:diagnostic-source:scan', filterSnapshot: snapshot,
    }));
    await handler(makeJob({
      source: 'diagnostic-source', correlationId: runId, phase: 'details',
      telemetryIdentityKey: 'run-diagnostic:diagnostic-source:details', filterSnapshot: snapshot,
    }));

    expect(finishParserRunSourceStage).toHaveBeenCalledWith(
      'run-diagnostic:diagnostic-source:details',
      expect.objectContaining({
        diagnostics_schema_version: 1,
        semantic_fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
        counters: expect.objectContaining({
          details_attempted: 1, details_ok: 1, property_block_found: 1,
          location_label_found: 1, location_confirmed_address: 0,
          location_confirmed_region_only: 1, location_missing: 0,
          location_unresolved: 0, schema_mismatch: 0,
        }),
      }),
    );
    expect(createProperty).toHaveBeenCalledWith(
      expect.not.objectContaining({ parser_diagnostics: expect.anything() }),
    );
  });

  test('skips already existing properties', async () => {
    (propertyExists as any).mockResolvedValue(true); // all exist

    const parser = makeParser(defaultProps);
    const handler = createParseHandler(parser);

    const result = await handler(makeJob({ source: 'tender', documentId: 'doc-src-1' }));

    expect(result).toEqual({ created: 0, filtered: 0, total: 2, detailsFetched: 0, detailsNeeded: 0, locationUnresolved: 0 });
    expect(createProperty).not.toHaveBeenCalled();
  });

  test('counts filtered properties (createProperty returns null)', async () => {
    (propertyExists as any).mockResolvedValue(false);
    (createProperty as any).mockResolvedValueOnce({ id: 1 }).mockResolvedValueOnce(null);

    const parser = makeParser(defaultProps);
    const handler = createParseHandler(parser);

    const result = await handler(makeJob({ source: 'tender', documentId: 'doc-src-1' }));

    expect(result).toEqual({ created: 1, filtered: 1, total: 2, detailsFetched: 0, detailsNeeded: 0, locationUnresolved: 0 });
  });

  test('logs error and re-throws when parser.parse() fails', async () => {
    const parser: SourceParser = {
      name: 'failing-parser',
      parse: vi.fn().mockRejectedValue(new Error('Parse engine crashed')),
    };

    const handler = createParseHandler(parser);

    await expect(
      handler(makeJob({ source: 'tender', documentId: 'doc-src-1' }))
    ).rejects.toThrow('parser.transient');
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
      last_parse_error: 'parser.transient',
    }));
  });

  test('persists an explicit blocking class but never raw adapter error text', async () => {
    const error = new ParserSourceError('anti_bot');
    (error as any).message = 'secret token and credential-bearing URL';
    const parser: SourceParser = {
      name: 'blocked-parser',
      parse: vi.fn().mockRejectedValue(error),
    };
    const handler = createParseHandler(parser);

    await expect(handler(makeJob({
      source: 'tender',
      documentId: 'doc-src-1',
      telemetryIdentityKey: 'run-1:tender:scan',
      filterSnapshot: makeSnapshot([makeProfile()]),
    }))).rejects.toMatchObject({
      message: 'parser.anti_bot',
      parser_error_class: 'anti_bot',
      permanent: true,
    });

    expect(updateSourceStats).toHaveBeenCalledWith('doc-src-1', expect.objectContaining({
      last_parse_error: 'parser.anti_bot',
    }));
    expect(finishParserRunSourceStage).toHaveBeenCalledWith(
      'run-1:tender:scan',
      expect.objectContaining({
        status: 'failed',
        error_class: 'anti_bot',
        error_message: 'parser.anti_bot',
      }),
    );
    expect(JSON.stringify((updateSourceStats as any).mock.calls)).not.toContain('secret token');
    expect(JSON.stringify((finishParserRunSourceStage as any).mock.calls)).not.toContain('secret token');
  });

  test('rechecks live source quarantine in the worker before parser side effects', async () => {
    vi.mocked(isSourceNormalWorkAllowed).mockResolvedValue(false);
    const parser = makeParser(defaultProps);
    const handler = createParseHandler(parser);

    await expect(handler(makeJob({
      source: 'tender',
      documentId: 'doc-src-1',
      telemetryIdentityKey: 'run-1:tender:scan',
      filterSnapshot: makeSnapshot([makeProfile()]),
    }))).rejects.toThrow('parser.blocked');

    expect(isSourceNormalWorkAllowed).toHaveBeenCalledWith('doc-src-1');
    expect(parser.parse).not.toHaveBeenCalled();
    expect(resetSourceDetailsCounters).not.toHaveBeenCalled();
    expect(finishParserRunSourceStage).toHaveBeenCalledWith(
      'run-1:tender:scan',
      expect.objectContaining({
        status: 'failed',
        error_class: 'blocked',
        error_message: 'parser.blocked',
      }),
    );
  });

  test('rechecks live source quarantine after counter reset immediately before scan adapter work', async () => {
    vi.mocked(isSourceNormalWorkAllowed)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const parser = makeParser(defaultProps);
    const handler = createParseHandler(parser);

    await expect(handler(makeJob({
      source: 'tender',
      documentId: 'doc-src-1',
      telemetryIdentityKey: 'run-1:tender:scan',
      filterSnapshot: makeSnapshot([makeProfile()]),
    }))).rejects.toThrow('parser.blocked');

    expect(resetSourceDetailsCounters).toHaveBeenCalledWith('doc-src-1');
    expect(isSourceNormalWorkAllowed).toHaveBeenCalledTimes(2);
    expect(parser.parse).not.toHaveBeenCalled();
  });

  test('rechecks live source quarantine again before detail adapter work', async () => {
    const correlationId = `detail-quarantine-${Date.now()}`;
    const parser = makeParser([defaultProps[0]]);
    parser.fetchDetails = vi.fn().mockResolvedValue({});
    const handler = createParseHandler(parser);
    vi.mocked(propertyExists).mockResolvedValue(false);

    await handler(makeJob({
      source: 'tender', documentId: 'doc-src-1', correlationId, phase: 'scan',
    }));

    vi.mocked(isSourceNormalWorkAllowed).mockReset()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    try {
      await expect(handler(makeJob({
        source: 'tender', documentId: 'doc-src-1', correlationId, phase: 'details',
      }))).rejects.toThrow('parser.blocked');

      expect(parser.fetchDetails).not.toHaveBeenCalled();
      expect(createProperty).not.toHaveBeenCalled();
    } finally {
      vi.mocked(isSourceNormalWorkAllowed).mockReset().mockResolvedValue(true);
    }
  });

  test('does not swallow a persistence-time quarantine race in a legacy no-snapshot job', async () => {
    vi.mocked(propertyExists).mockResolvedValue(false);
    vi.mocked(createProperty).mockResolvedValue({ id: 1 } as any);
    vi.mocked(isSourceNormalWorkAllowed)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const handler = createParseHandler(makeParser([defaultProps[0]]));

    await expect(handler(makeJob({
      source: 'manual-source',
      documentId: 'doc-manual-source',
      correlationId: `manual-quarantine-${Date.now()}`,
    }))).rejects.toMatchObject({
      message: 'parser.blocked',
      parser_error_class: 'blocked',
      permanent: true,
    });

    expect(createProperty).not.toHaveBeenCalled();
    expect(updateSourceStats).toHaveBeenCalledWith(
      'doc-manual-source',
      expect.objectContaining({
        last_parse_status: 'error',
        last_parse_error: 'parser.blocked',
      }),
    );
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
      error: 'parser.transient',
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
    }))).rejects.toThrow('parser.permanent');
  });

  test('rejects a legacy array artifact instead of silently processing it', async () => {
    const source = 'legacy-artifact-source';
    const correlationId = `legacy-artifact-${Date.now()}`;
    const scanDir = join(tmpdir(), 'aklab-scan');
    mkdirSync(scanDir, { recursive: true });
    writeFileSync(join(scanDir, `${source}-${correlationId}.json`), JSON.stringify(defaultProps));

    const handler = createParseHandler(makeParser([]));
    await expect(handler(makeJob({ source, documentId: 'doc-src-1', correlationId, phase: 'details' })))
      .rejects.toThrow('parser.permanent');
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

    expect(result).toEqual({ created: 0, filtered: 0, total: 0, detailsFetched: 0, detailsNeeded: 0, locationUnresolved: 0 });
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
    }))).rejects.toThrow('parser.permanent');

    expect(parser.parse).not.toHaveBeenCalled();
    expect(propertyExists).not.toHaveBeenCalled();
  });

  test('uses OR of complete immutable profiles once across scan and details', async () => {
    (propertyExists as any).mockResolvedValue(false);
    (createProperty as any).mockResolvedValue({ id: 1 });

    const properties = [
      { ...defaultProps[1], external_id: 'or-moscow-office', city: 'moscow', property_type: 'office', price: 10_000_000 },
      {
        ...defaultProps[0], external_id: 'or-mo-warehouse', city: 'mo', property_type: 'warehouse', price: 60_000_000,
        property_location: { ...defaultProps[0].property_location, region: 'Московская область', region_code: '50' },
      },
      {
        ...defaultProps[0], external_id: 'or-crossed-fields', city: 'moscow', property_type: 'warehouse', price: 60_000_000,
        property_location: { ...defaultProps[0].property_location, region: 'Москва', region_code: '77' },
      },
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
      .rejects.toThrow('parser.permanent');

    expect(parser.fetchDetails).not.toHaveBeenCalled();
    expect(createProperty).not.toHaveBeenCalled();
    expect(existsSync(getScanArtifactPath('mismatch-source', runId))).toBe(true);
  });

  test('terminally fails source telemetry when the pipeline job snapshot itself is invalid', async () => {
    const parser = makeParser(defaultProps);
    const snapshot = makeSnapshot([makeProfile({ profileId: 451 })]);
    const invalidSnapshot = { ...snapshot, hash: 'f'.repeat(64) };
    const handler = createParseHandler(parser);

    await expect(handler(makeJob({
      source: 'invalid-snapshot-source',
      documentId: 'doc-invalid-snapshot',
      telemetryIdentityKey: 'run-invalid:invalid-snapshot-source:scan',
      filterSnapshot: invalidSnapshot,
    }))).rejects.toThrow('parser.permanent');

    expect(markParserRunSourceStageRunning).not.toHaveBeenCalled();
    expect(parser.parse).not.toHaveBeenCalled();
    expect(finishParserRunSourceStage).toHaveBeenCalledWith(
      'run-invalid:invalid-snapshot-source:scan',
      expect.objectContaining({ status: 'failed' }),
    );
  });

  test('empty snapshot is a successful no-op without parser or property calls', async () => {
    const parser = makeParser(defaultProps);
    const snapshot = makeSnapshot([]);
    const handler = createParseHandler(parser);
    (logCron as any).mockRejectedValueOnce(new Error('best-effort cron log unavailable'));

    const result = await handler(makeJob({
      source: 'empty-snapshot-source',
      documentId: 'doc-empty',
      telemetryIdentityKey: 'run-empty:empty-snapshot-source:scan',
      filterSnapshot: snapshot,
    }));

    expect(result).toEqual({ created: 0, filtered: 0, total: 0, detailsFetched: 0, detailsNeeded: 0, locationUnresolved: 0 });
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
    }))).rejects.toThrow('parser.transient');
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

  test('degrades snapshot details for one untyped fetch failure and continues the remaining artifact', async () => {
    (propertyExists as any).mockResolvedValue(false);
    (createProperty as any).mockResolvedValue({ id: 1 });
    const parser = makeParser(defaultProps);
    parser.fetchDetails = vi.fn()
      .mockRejectedValueOnce(new Error('temporary item detail outage'))
      .mockResolvedValueOnce({ description: 'verified detail payload' });
    const snapshot = makeSnapshot([makeProfile({ propertyTypes: ['office', 'warehouse'] })]);
    const handler = createParseHandler(parser);
    const runId = `degraded-${Date.now()}`;

    await handler(makeJob({ source: 'degraded-source', correlationId: runId, phase: 'scan', filterSnapshot: snapshot }));
    const result = await handler(makeJob({
      source: 'degraded-source',
      documentId: 'doc-degraded',
      correlationId: runId,
      phase: 'details',
      telemetryIdentityKey: 'run-degraded:degraded-source:details',
      filterSnapshot: snapshot,
    }));

    expect(result).toEqual({
      created: 1,
      filtered: 0,
      total: 2,
      detailsFetched: 1,
      detailsNeeded: 2,
      locationUnresolved: 0,
    });
    expect(parser.fetchDetails).toHaveBeenCalledTimes(2);
    expect(createProperty).toHaveBeenCalledTimes(1);
    expect(createProperty).toHaveBeenCalledWith(expect.objectContaining({ external_id: 'ext-2' }));
    expect(finishParserRunSourceStage).toHaveBeenCalledWith(
      'run-degraded:degraded-source:details',
      expect.objectContaining({
        status: 'degraded',
        error_class: 'transient',
        error_message: 'parser.transient',
        counters: expect.objectContaining({
          details_attempted: 2,
          details_ok: 1,
          created: 1,
          skipped: 1,
          failed: 1,
        }),
      }),
    );
    expect(existsSync(getScanArtifactPath('degraded-source', runId))).toBe(false);
  });

  test('fails and retains the snapshot artifact when every detail request fails', async () => {
    (propertyExists as any).mockResolvedValue(false);
    const parser = makeParser(defaultProps);
    parser.fetchDetails = vi.fn().mockRejectedValue(new Error('source-wide detail outage'));
    const snapshot = makeSnapshot([makeProfile({ propertyTypes: ['office', 'warehouse'] })]);
    const handler = createParseHandler(parser);
    const runId = `all-details-failed-${Date.now()}`;

    await handler(makeJob({ source: 'all-details-failed-source', correlationId: runId, phase: 'scan', filterSnapshot: snapshot }));
    await expect(handler(makeJob({
      source: 'all-details-failed-source',
      documentId: 'doc-all-details-failed',
      correlationId: runId,
      phase: 'details',
      telemetryIdentityKey: 'run-failed:all-details-failed-source:details',
      filterSnapshot: snapshot,
    }))).rejects.toThrow('parser.transient');

    expect(parser.fetchDetails).toHaveBeenCalledTimes(2);
    expect(createProperty).not.toHaveBeenCalled();
    expect(finishParserRunSourceStage).toHaveBeenCalledWith(
      'run-failed:all-details-failed-source:details',
      expect.objectContaining({
        status: 'failed',
        error_class: 'transient',
        error_message: 'parser.transient',
        counters: expect.objectContaining({
          details_attempted: 2,
          details_ok: 0,
          created: 0,
          skipped: 2,
          failed: 2,
        }),
      }),
    );
    expect(existsSync(getScanArtifactPath('all-details-failed-source', runId))).toBe(true);
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

  test('uses only typed property geography and keeps a Moscow party out of a Bashkortostan property', async () => {
    (propertyExists as any).mockResolvedValue(false);
    (createProperty as any).mockResolvedValue({ id: 1 });
    const parser: SourceParser = {
      name: 'typed-location-parser',
      parse: vi.fn().mockResolvedValue([{
        ...defaultProps[0],
        external_id: 'typed-location',
        title: 'Москва в заголовке',
        address: 'Москва из legacy address',
        city: 'moscow',
        latitude: 55.7,
        longitude: 37.6,
        property_location: {
          region: 'Республика Башкортостан',
          region_code: '02',
          latitude: 54.7,
          longitude: 55.9,
          status: 'confirmed_region_only',
          source_kind: 'api_field',
          source_path: 'lot.region',
        },
        parties: [{
          name: 'ПАО Сбербанк',
          roles: ['pledgee'],
          addresses: [{ kind: 'legal', value: 'г. Москва, ул. Тверская, 1' }],
          source_path: 'lot.pledgee',
          source_kind: 'bounded_text',
          confidence: 'explicit_text',
        }],
      }]),
      fetchDetails: vi.fn().mockResolvedValue({
        address: 'Москва из legacy detail address',
        city: 'moscow',
        latitude: 55.8,
        longitude: 37.5,
        description: 'Москва в произвольном описании',
        parties: [{
          name: 'ПАО Сбербанк',
          roles: ['secured_creditor'],
          addresses: [{ kind: 'postal', value: 'г. Москва, ул. Вавилова, 19' }],
          source_path: 'detail.creditor',
          source_kind: 'dom_field',
          confidence: 'structured',
        }],
      }),
    };

    const handler = createParseHandler(parser);
    await handler(makeJob({ source: 'typed-location-source', documentId: 'doc-typed' }));

    expect(createProperty).toHaveBeenCalledWith(expect.objectContaining({
      address: '',
      city: 'other',
      latitude: 54.7,
      longitude: 55.9,
      property_location: expect.objectContaining({
        region: 'Республика Башкортостан',
        status: 'confirmed_region_only',
      }),
      parties: [expect.objectContaining({
        name: 'ПАО Сбербанк',
        roles: ['pledgee', 'secured_creditor'],
        addresses: [
          { kind: 'legal', value: 'г. Москва, ул. Тверская, 1' },
          { kind: 'postal', value: 'г. Москва, ул. Вавилова, 19' },
        ],
      })],
    }));
  });

  test('post-detail snapshot filtering uses the derived typed city, not legacy detail text', async () => {
    (propertyExists as any).mockResolvedValue(false);
    (createProperty as any).mockResolvedValue({ id: 1 });
    const parser: SourceParser = {
      name: 'typed-snapshot-parser',
      parse: vi.fn().mockResolvedValue([{
        ...defaultProps[0],
        external_id: 'typed-snapshot',
        property_location: {
          region: 'Республика Башкортостан',
          status: 'confirmed_region_only',
          source_kind: 'api_field',
          source_path: 'lot.region',
        },
      }]),
      fetchDetails: vi.fn().mockResolvedValue({
        address: 'г. Москва, ул. Площадная, 1',
        city: 'moscow',
        description: 'Москва в шаблонном тексте',
      }),
    };
    const snapshot = makeSnapshot([makeProfile({
      regions: ['other'],
      propertyTypes: ['warehouse'],
    })]);
    const handler = createParseHandler(parser);
    const runId = `typed-snapshot-${Date.now()}`;

    const scan = await handler(makeJob({
      source: 'typed-snapshot-source',
      correlationId: runId,
      phase: 'scan',
      filterSnapshot: snapshot,
    }));
    expect(scan).toMatchObject({ total: 1, filtered: 0, detailsNeeded: 1 });

    await handler(makeJob({
      source: 'typed-snapshot-source',
      correlationId: runId,
      phase: 'details',
      filterSnapshot: snapshot,
    }));

    expect(createProperty).toHaveBeenCalledWith(expect.objectContaining({ city: 'other', address: '' }));
  });

  test('upgrades a region-only scan location only from a valid typed detail location', async () => {
    (propertyExists as any).mockResolvedValue(false);
    (createProperty as any).mockResolvedValue({ id: 1 });
    const parser: SourceParser = {
      name: 'typed-merge-parser',
      parse: vi.fn().mockResolvedValue([{
        ...defaultProps[0],
        external_id: 'typed-merge',
        property_location: {
          region: 'Республика Башкортостан',
          status: 'confirmed_region_only',
          source_kind: 'api_field',
          source_path: 'lot.region',
        },
      }]),
      fetchDetails: vi.fn().mockResolvedValue({
        property_location: {
          address: 'г. Уфа, ул. Ленина, 1',
          status: 'confirmed_address',
          source_kind: 'dom_field',
          source_path: '.lot-address',
        },
        address: 'Москва из legacy detail address',
        city: 'moscow',
      }),
    };
    const handler = createParseHandler(parser);
    const runId = `typed-merge-${Date.now()}`;

    await handler(makeJob({ source: 'typed-merge-source', correlationId: runId, phase: 'scan' }));
    await handler(makeJob({ source: 'typed-merge-source', correlationId: runId, phase: 'details' }));

    expect(createProperty).toHaveBeenCalledWith(expect.objectContaining({
      address: 'г. Уфа, ул. Ленина, 1',
      city: 'other',
      property_location: expect.objectContaining({
        address: 'г. Уфа, ул. Ленина, 1',
        status: 'confirmed_address',
      }),
    }));
  });

  test('does not persist a real-estate candidate whose successful details leave location missing', async () => {
    (propertyExists as any).mockResolvedValue(false);
    (createProperty as any).mockResolvedValue({ id: 1 });
    const parser: SourceParser = {
      name: 'missing-detail-parser',
      parse: vi.fn().mockResolvedValue([{
        ...defaultProps[0],
        external_id: 'missing-after-detail',
        address: 'legacy Moscow must be cleared',
        city: 'moscow',
        property_location: {
          status: 'missing',
          source_kind: 'dom_field',
          source_path: 'listing.property_location',
        },
      }]),
      fetchDetails: vi.fn().mockResolvedValue({
        description: 'bounded property details without a location',
        property_location: {
          status: 'missing',
          source_kind: 'dom_field',
          source_path: 'details.field.location',
        },
      }),
    };

    const runId = `missing-after-detail-${Date.now()}`;
    const result = await createParseHandler(parser)(makeJob({
      source: 'missing-after-detail-source',
      correlationId: runId,
    }));

    expect(result).toMatchObject({ created: 0, locationUnresolved: 1 });
    expect(createProperty).not.toHaveBeenCalled();
    const manifestPath = getLocationUnresolvedManifestPath('missing-after-detail-source', runId);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    expect(manifest.items).toEqual([{
      external_id: 'missing-after-detail',
      source_path: 'details.field.location',
      status: 'missing',
    }]);
    expect(JSON.stringify(manifest)).not.toMatch(/legacy Moscow|bounded property details|address|party/i);
    unlinkSync(manifestPath);
  });

  test.each([
    [
      'confirmed_region_only',
      {
        region: 'Ярославская область',
        status: 'confirmed_region_only',
        source_kind: 'dom_field',
        source_path: 'details.field.region',
      },
    ],
    [
      'confirmed_address',
      {
        address: 'Ярославская область, г. Ярославль, ул. Свободы, д. 1',
        status: 'confirmed_address',
        source_kind: 'dom_field',
        source_path: 'details.field.address',
      },
    ],
  ])('persists a candidate whose successful details produce %s', async (_status, detailLocation) => {
    (propertyExists as any).mockResolvedValue(false);
    (createProperty as any).mockResolvedValue({ id: 1 });
    const parser: SourceParser = {
      name: 'confirmed-detail-parser',
      parse: vi.fn().mockResolvedValue([{
        ...defaultProps[0],
        external_id: `confirmed-${_status}`,
        property_location: {
          status: 'missing',
          source_kind: 'dom_field',
          source_path: 'listing.property_location',
        },
      }]),
      fetchDetails: vi.fn().mockResolvedValue({ property_location: detailLocation }),
    };

    const result = await createParseHandler(parser)(makeJob({
      source: `confirmed-${_status}-source`,
      correlationId: `confirmed-${_status}-${Date.now()}`,
    }));

    expect(result).toMatchObject({ created: 1, locationUnresolved: 0 });
    expect(createProperty).toHaveBeenCalledWith(expect.objectContaining({
      property_location: expect.objectContaining({ status: _status }),
    }));
  });

  test('does not let a party address rescue an unresolved property location', async () => {
    (propertyExists as any).mockResolvedValue(false);
    (createProperty as any).mockResolvedValue({ id: 1 });
    const parser: SourceParser = {
      name: 'party-only-detail-parser',
      parse: vi.fn().mockResolvedValue([{
        ...defaultProps[0],
        external_id: 'party-only-location',
        property_location: {
          status: 'missing',
          source_kind: 'dom_field',
          source_path: 'listing.property_location',
        },
      }]),
      fetchDetails: vi.fn().mockResolvedValue({
        property_location: {
          status: 'missing',
          source_kind: 'dom_field',
          source_path: 'details.field.location',
        },
        parties: [{
          name: 'Тестовый банк',
          roles: ['pledgee'],
          addresses: [{ kind: 'postal', value: 'г. Москва, ул. Вавилова, д. 19' }],
          source_path: 'details.party.pledgee',
          source_kind: 'dom_field',
          confidence: 'structured',
        }],
      }),
    };

    const result = await createParseHandler(parser)(makeJob({
      source: 'party-only-location-source',
      correlationId: `party-only-location-${Date.now()}`,
    }));

    expect(result).toMatchObject({ created: 0, locationUnresolved: 1 });
    expect(createProperty).not.toHaveBeenCalled();
  });

  test('treats a rejected detail request as an item failure rather than unresolved or persistence', async () => {
    (propertyExists as any).mockResolvedValue(false);
    (createProperty as any).mockResolvedValue({ id: 1 });
    const parser: SourceParser = {
      name: 'failed-detail-parser',
      parse: vi.fn().mockResolvedValue([{ ...defaultProps[0], external_id: 'failed-detail' }]),
      fetchDetails: vi.fn().mockRejectedValue(new Error('detail timeout')),
    };

    const result = await createParseHandler(parser)(makeJob({
      source: 'failed-detail-source',
      correlationId: `failed-detail-${Date.now()}`,
    }));

    expect(result).toMatchObject({ created: 0, locationUnresolved: 0 });
    expect(createProperty).not.toHaveBeenCalled();
  });

  test('fails closed for an invalid typed location before persistence', async () => {
    (propertyExists as any).mockResolvedValue(false);
    const parser = makeParser([{
      ...defaultProps[0],
      external_id: 'invalid-typed-location',
      property_location: {
        status: 'confirmed_address',
        source_kind: 'api_field',
        source_path: 'lot.address',
      },
    }]);

    await expect(createParseHandler(parser)(makeJob({
      source: 'invalid-typed-location-source',
      documentId: 'doc-invalid-location',
    }))).rejects.toThrow('parser.permanent');

    expect(propertyExists).not.toHaveBeenCalled();
    expect(createProperty).not.toHaveBeenCalled();
  });

  test('rejects parser output without typed property location before side effects', async () => {
    const parser = makeParser([{
      ...defaultProps[0],
      external_id: 'without-location',
      title: 'Москва в title',
      address: 'Москва из legacy address',
      city: 'moscow',
      property_location: undefined,
    }]);

    await expect(createParseHandler(parser)(makeJob({
      source: 'without-location-source',
    }))).rejects.toThrow('parser.permanent');

    expect(propertyExists).not.toHaveBeenCalled();
    expect(createProperty).not.toHaveBeenCalled();
  });
});
