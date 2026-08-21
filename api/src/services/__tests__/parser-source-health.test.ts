import { beforeEach, describe, expect, it, vi } from 'vitest';

const recordHealthMock = vi.hoisted(() => vi.fn());
vi.mock('../parser-health-alerts', () => ({ recordParserSourceHealth: recordHealthMock }));
import {
  classifyParserSourceHealth,
  recordParserRunSourceHealth,
  type ParserSourceHealthBaselineSample,
  type ParserSourceHealthCanary,
  type ParserSourceHealthCounters,
  type ParserSourceHealthInput,
} from '../parser-source-health';

const baseCounters = (overrides: Partial<ParserSourceHealthCounters> = {}): ParserSourceHealthCounters => ({
  details_attempted: 100,
  details_ok: 95,
  property_block_found: 95,
  location_label_found: 95,
  location_confirmed_address: 77,
  location_confirmed_region_only: 15,
  location_missing: 3,
  location_unresolved: 2,
  schema_mismatch: 0,
  ...overrides,
});

const input = (overrides: Partial<ParserSourceHealthInput> = {}): ParserSourceHealthInput => ({
  counters: baseCounters(),
  detail_supported: true,
  schema_fingerprint: 'a'.repeat(64),
  ...overrides,
});

const baseline = (
  counters: Partial<ParserSourceHealthCounters> = {},
  schema_fingerprint = 'b'.repeat(64),
): ParserSourceHealthBaselineSample => ({
  counters: baseCounters(counters),
  schema_fingerprint,
});

describe('classifyParserSourceHealth', () => {
  it('keeps a successful listing-only row healthy without detail diagnostics', () => {
    expect(classifyParserSourceHealth(input({
      detail_supported: false,
      counters: baseCounters({
        details_attempted: 0,
        details_ok: 0,
        property_block_found: 0,
        location_label_found: 0,
        location_confirmed_address: 0,
        location_confirmed_region_only: 0,
        location_missing: 0,
        location_unresolved: 2,
        schema_mismatch: 0,
      }),
    }))).toEqual({
      status: 'healthy',
      reason_code: 'healthy.listing_only',
      schema_fingerprint: 'a'.repeat(64),
    });
  });

  it('classifies a normal run as healthy and preserves the current fingerprint', () => {
    expect(classifyParserSourceHealth(input({
      healthy_baseline: [baseline(), baseline(), baseline()],
    }))).toEqual({
      status: 'healthy',
      reason_code: 'healthy.within_baseline',
      schema_fingerprint: 'a'.repeat(64),
    });
  });

  it('immediately classifies a current schema mismatch as schema_changed', () => {
    expect(classifyParserSourceHealth(input({
      counters: baseCounters({ schema_mismatch: 60 }),
    }))).toMatchObject({
      status: 'schema_changed',
      reason_code: 'schema_changed.schema_mismatch_majority',
      schema_fingerprint: 'a'.repeat(64),
    });
  });

  it('immediately classifies a canary with no expected property block as schema_changed', () => {
    const canary: ParserSourceHealthCanary = {
      checked: 2,
      property_block_found: 0,
    };

    expect(classifyParserSourceHealth(input({ canary }))).toEqual({
      status: 'schema_changed',
      reason_code: 'schema_changed.canary_property_block_missing',
      schema_fingerprint: 'a'.repeat(64),
    });
  });

  it('classifies typed anti-bot and rate-limit failures as blocked before quality checks', () => {
    for (const error_class of ['blocked', 'rate_limited', 'anti_bot', 'http_block'] as const) {
      expect(classifyParserSourceHealth(input({ error_class }))).toEqual({
        status: 'blocked',
        reason_code: 'blocked.typed_error',
        schema_fingerprint: 'a'.repeat(64),
      });
    }
  });

  it('degrades zero detail success without falsely diagnosing schema drift', () => {
    expect(classifyParserSourceHealth(input({
      counters: baseCounters({
        details_attempted: 25,
        details_ok: 0,
        property_block_found: 0,
        location_label_found: 0,
        location_confirmed_address: 0,
        location_confirmed_region_only: 0,
        location_missing: 0,
        location_unresolved: 0,
      }),
    }))).toMatchObject({
      status: 'degraded',
      reason_code: 'degraded.zero_detail_success',
    });
  });

  it('applies an absolute detail-success floor at samples of twenty or more', () => {
    expect(classifyParserSourceHealth(input({
      counters: baseCounters({
        details_ok: 79,
        property_block_found: 79,
        location_label_found: 79,
        location_confirmed_address: 70,
        location_confirmed_region_only: 0,
        location_missing: 9,
        location_unresolved: 9,
      }),
    }))).toMatchObject({
      status: 'degraded',
      reason_code: 'degraded.details_ok_ratio_below_floor',
    });
  });

  it('applies an absolute location-missing ceiling at samples of twenty or more', () => {
    expect(classifyParserSourceHealth(input({
      counters: baseCounters({
        details_ok: 100,
        property_block_found: 100,
        location_label_found: 100,
        location_confirmed_address: 49,
        location_confirmed_region_only: 0,
        location_missing: 51,
        location_unresolved: 51,
      }),
    }))).toMatchObject({
      status: 'degraded',
      reason_code: 'degraded.location_missing_ratio_above_ceiling',
    });
  });

  it('degrades when detail success drops by at least 20 percentage points against the healthy median', () => {
    const healthy = [
      baseline({ details_ok: 95 }),
      baseline({ details_ok: 94, property_block_found: 94, location_label_found: 94, location_confirmed_address: 76 }),
      baseline({ details_ok: 96, property_block_found: 95, location_label_found: 95 }),
      baseline({ details_ok: 95 }),
      baseline({ details_ok: 93, property_block_found: 93, location_label_found: 93, location_confirmed_address: 75 }),
    ];

    expect(classifyParserSourceHealth(input({
      healthy_baseline: healthy,
      counters: baseCounters({
        details_ok: 74,
        property_block_found: 74,
        location_label_found: 74,
        location_confirmed_address: 60,
        location_confirmed_region_only: 10,
        location_missing: 4,
        location_unresolved: 2,
      }),
    }))).toMatchObject({
      status: 'degraded',
      reason_code: 'degraded.details_ok_ratio_below_floor',
    });
  });

  it('degrades when missing or unresolved detail rate grows by at least 20 percentage points', () => {
    const healthy = [
      baseline({ location_confirmed_address: 75, location_missing: 5, location_unresolved: 5 }),
      baseline({ location_confirmed_address: 76, location_missing: 4, location_unresolved: 4 }),
      baseline({ location_confirmed_address: 76, location_missing: 4, location_unresolved: 4 }),
      baseline({ location_confirmed_address: 75, location_missing: 5, location_unresolved: 5 }),
      baseline({ location_confirmed_address: 77, location_missing: 3, location_unresolved: 3 }),
    ];

    expect(classifyParserSourceHealth(input({
      healthy_baseline: healthy,
      counters: baseCounters({
        location_confirmed_address: 55,
        location_confirmed_region_only: 10,
        location_missing: 25,
        location_unresolved: 10,
      }),
    }))).toMatchObject({
      status: 'degraded',
      reason_code: 'degraded.location_missing_ratio_above_ceiling',
    });
  });

  it('does not treat small-sample ratio noise as degraded', () => {
    expect(classifyParserSourceHealth(input({
      healthy_baseline: [
        baseline({ details_attempted: 100, details_ok: 100 }),
        baseline({ details_attempted: 100, details_ok: 100 }),
      ],
      counters: baseCounters({
        details_attempted: 19,
        details_ok: 10,
        property_block_found: 10,
        location_label_found: 10,
        location_confirmed_address: 10,
        location_confirmed_region_only: 0,
        location_missing: 0,
        location_unresolved: 0,
      }),
    }))).toEqual({
      status: 'healthy',
      reason_code: 'healthy.within_baseline',
      schema_fingerprint: 'a'.repeat(64),
    });
  });

  it('degrades when the current confirmed count is zero after a non-zero historical baseline', () => {
    expect(classifyParserSourceHealth(input({
      healthy_baseline: [
        baseline({ location_confirmed_address: 10, location_confirmed_region_only: 2 }),
      ],
      counters: baseCounters({
        location_confirmed_address: 0,
        location_confirmed_region_only: 0,
        location_missing: 95,
        location_unresolved: 95,
      }),
    }))).toEqual({
      status: 'degraded',
      reason_code: 'degraded.location_missing_ratio_above_ceiling',
      schema_fingerprint: 'a'.repeat(64),
    });
  });

  it('uses deterministic reason codes and fingerprint semantics for identical inputs', () => {
    const value = input({
      healthy_baseline: [baseline(), baseline()],
      schema_fingerprint: 'c'.repeat(64),
    });

    expect(classifyParserSourceHealth(value)).toEqual(classifyParserSourceHealth(value));
    expect(classifyParserSourceHealth(value)).toEqual({
      status: 'healthy',
      reason_code: 'healthy.within_baseline',
      schema_fingerprint: 'c'.repeat(64),
    });
  });
});

describe('recordParserRunSourceHealth', () => {
  beforeEach(() => {
    recordHealthMock.mockClear();
  });

  it.each(['success', 'success_empty'] as const)('does not write a details-capable %s row with no observations', async (status) => {
    recordHealthMock.mockResolvedValue({ alert: 'not_due', applied: true, persistedStatus: 'healthy' });
    const current = {
      identity_key: `run-no-observation:${status}:details`, source_slug: 'source-a', status,
      detail_supported: true,
      ...baseCounters({
        details_attempted: 0,
        details_ok: 0,
        property_block_found: 0,
        location_label_found: 0,
        location_confirmed_address: 0,
        location_confirmed_region_only: 0,
        location_missing: 0,
        location_unresolved: 0,
        schema_mismatch: 0,
      }),
    };
    const query = {
      findOne: vi.fn().mockResolvedValue(current),
      findMany: vi.fn(),
      update: vi.fn(),
    };
    const strapi = { db: { query: vi.fn().mockReturnValue(query) } } as any;

    await expect(recordParserRunSourceHealth(strapi, {
      runId: 'run-no-observation', source: { id: 7, slug: 'source-a' },
    })).resolves.toBeNull();
    expect(query.findMany).not.toHaveBeenCalled();
    expect(query.update).not.toHaveBeenCalled();
    expect(recordHealthMock).not.toHaveBeenCalled();
  });

  it('rejects malformed persisted counters instead of coercing them to zero', async () => {
    const current = {
      identity_key: 'run-malformed:source-a:details', source_slug: 'source-a', status: 'success',
      detail_supported: true,
      ...baseCounters({ details_attempted: 'not-a-number' as any }),
    };
    const query = {
      findOne: vi.fn().mockResolvedValue(current),
      findMany: vi.fn(),
      update: vi.fn(),
    };
    const strapi = { db: { query: vi.fn().mockReturnValue(query) } } as any;

    await expect(recordParserRunSourceHealth(strapi, {
      runId: 'run-malformed', source: { id: 7, slug: 'source-a' },
    })).rejects.toThrow(/Invalid counters\.details_attempted/);
    expect(query.findMany).not.toHaveBeenCalled();
    expect(recordHealthMock).not.toHaveBeenCalled();
  });

  it('fails closed on an invalid persisted semantic fingerprint', async () => {
    const current = {
      identity_key: 'run-bad-fingerprint:source-a:details', source_slug: 'source-a', status: 'success',
      detail_supported: true, semantic_fingerprint: 'not-a-sha', ...baseCounters(),
    };
    const query = {
      findOne: vi.fn().mockResolvedValue(current),
      findMany: vi.fn(),
      update: vi.fn(),
    };
    const strapi = { db: { query: vi.fn().mockReturnValue(query) } } as any;

    await expect(recordParserRunSourceHealth(strapi, {
      runId: 'run-bad-fingerprint', source: { id: 7, slug: 'source-a' },
    })).rejects.toThrow(/Invalid semantic_fingerprint/);
    expect(query.findMany).not.toHaveBeenCalled();
    expect(recordHealthMock).not.toHaveBeenCalled();
  });

  it('keeps a terminal degraded details row degraded without evidence to recover it', async () => {
    recordHealthMock.mockResolvedValue({ alert: 'not_due', applied: true, persistedStatus: 'degraded' });
    const current = {
      identity_key: 'run-floor:source-a:details', source_slug: 'source-a', status: 'degraded',
      detail_supported: true, semantic_fingerprint: 'a'.repeat(64),
      ...baseCounters({
        details_attempted: 20,
        details_ok: 20,
        property_block_found: 20,
        location_label_found: 20,
        location_confirmed_address: 15,
        location_confirmed_region_only: 3,
        location_missing: 2,
        location_unresolved: 2,
      }),
    };
    const query = {
      findOne: vi.fn().mockResolvedValue(current),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue(current),
    };
    const strapi = { db: { query: vi.fn().mockReturnValue(query) } } as any;

    await expect(recordParserRunSourceHealth(strapi, {
      runId: 'run-floor', source: { id: 7, slug: 'source-a' },
    })).resolves.toMatchObject({
      status: 'degraded',
      reason_code: 'degraded.terminal_status_floor',
    });
    expect(recordHealthMock).toHaveBeenCalledWith(strapi, expect.objectContaining({
      classification: expect.objectContaining({ status: 'degraded', reason_code: 'degraded.terminal_status_floor' }),
    }));
  });

  it('uses only annotated healthy rows as baseline and annotates the current run row', async () => {
    recordHealthMock.mockResolvedValue({ alert: 'not_due', applied: true, persistedStatus: 'healthy' });
    const current = {
      identity_key: 'run-1:source-a:details',
      source_slug: 'source-a',
      status: 'success',
      detail_supported: true,
      semantic_fingerprint: 'a'.repeat(64),
      ...baseCounters(),
    };
    const query = {
      findOne: vi.fn().mockResolvedValue(current),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue(current),
    };
    const strapi = { db: { query: vi.fn().mockReturnValue(query) } } as any;
    const source = { id: 7, slug: 'source-a' };

    await expect(recordParserRunSourceHealth(strapi, { runId: 'run-1', source }))
      .resolves.toMatchObject({ status: 'healthy' });
    expect(query.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        source_slug: 'source-a',
        status: 'success',
        health_status: 'healthy',
        detail_supported: true,
      }),
    }));
    expect(query.update).toHaveBeenCalledWith({
      where: { identity_key: 'run-1:source-a:details', health_status: { $null: true } },
      data: { health_status: 'healthy' },
    });
    expect(recordHealthMock).toHaveBeenCalledTimes(1);
  });

  it('annotates listing-only details rows healthy without querying a detail baseline', async () => {
    recordHealthMock.mockResolvedValue({ alert: 'not_due', applied: true, persistedStatus: 'healthy' });
    const current = {
      identity_key: 'run-2:listing:details', source_slug: 'listing', status: 'success',
      detail_supported: false,
      ...baseCounters({
        details_attempted: 0, details_ok: 0, property_block_found: 0, location_label_found: 0,
        location_confirmed_address: 0, location_confirmed_region_only: 0,
        location_missing: 0, location_unresolved: 1, schema_mismatch: 0,
      }),
    };
    const query = {
      findOne: vi.fn().mockResolvedValue(current),
      findMany: vi.fn(),
      update: vi.fn().mockResolvedValue(current),
    };
    const strapi = { db: { query: vi.fn().mockReturnValue(query) } } as any;

    await expect(recordParserRunSourceHealth(strapi, {
      runId: 'run-2', source: { id: 8, slug: 'listing' },
    })).resolves.toMatchObject({ status: 'healthy', reason_code: 'healthy.listing_only' });
    expect(query.findMany).not.toHaveBeenCalled();
    expect(query.update).toHaveBeenCalledWith({
      where: { identity_key: 'run-2:listing:details', health_status: { $null: true } }, data: { health_status: 'healthy' },
    });
  });

  it('does not annotate the current row when the Source health CAS loses', async () => {
    recordHealthMock.mockResolvedValue({ alert: 'not_due', applied: false });
    const query = {
      findOne: vi.fn().mockResolvedValue({
        identity_key: 'run-race:source-a:details', source_slug: 'source-a', status: 'success',
        detail_supported: true, semantic_fingerprint: 'a'.repeat(64), ...baseCounters(),
      }),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
    };
    const strapi = { db: { query: vi.fn().mockReturnValue(query) } } as any;

    await recordParserRunSourceHealth(strapi, { runId: 'run-race', source: { id: 7, slug: 'source-a' } });

    expect(query.update).not.toHaveBeenCalled();
  });
});
