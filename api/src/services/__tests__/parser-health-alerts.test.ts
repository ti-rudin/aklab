import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { recordParserSourceHealth } from '../parser-health-alerts';
import type { ParserSourceHealthClassification, ParserSourceHealthCounters } from '../parser-source-health';

const counters: ParserSourceHealthCounters = {
  details_attempted: 20,
  details_ok: 20,
  property_block_found: 20,
  location_label_found: 20,
  location_confirmed_address: 10,
  location_confirmed_region_only: 5,
  location_missing: 5,
  location_unresolved: 5,
  schema_mismatch: 0,
};

function classification(status: ParserSourceHealthClassification['status'], reason_code: any): ParserSourceHealthClassification {
  return { status, reason_code, schema_fingerprint: 'a'.repeat(64) };
}

function harness(source: Record<string, unknown> = {}) {
  const currentSource = { id: 1, slug: 'm-ets', parser_health_status: 'healthy', parser_health_degraded_streak: 0, ...source };
  const update = vi.fn().mockResolvedValue({});
  const findOne = vi.fn().mockResolvedValue(currentSource);
  const send = vi.fn().mockResolvedValue({});
  const strapi = {
    db: { query: vi.fn().mockReturnValue({ findOne, update }) },
    plugin: vi.fn().mockReturnValue({ service: vi.fn().mockReturnValue({ send }) }),
    log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
  } as any;
  return {
    strapi, findOne, update, send,
    source: currentSource,
  };
}

describe('parser health alerts', () => {
  beforeEach(() => {
    process.env.PARSER_ALERT_EMAIL = 'ops@example.test';
    process.env.PARSER_ALERT_COOLDOWN_HOURS = '24';
  });
  afterEach(() => {
    delete process.env.PARSER_ALERT_EMAIL;
    delete process.env.PARSER_ALERT_COOLDOWN_HOURS;
  });

  it('sends an immediate safe alert for schema_changed and persists the dedupe key', async () => {
    const h = harness();
    const result = await recordParserSourceHealth(h.strapi, {
      source: h.source,
      classification: classification('schema_changed', 'schema_changed.property_block_missing'),
      runId: 'run-1', stage: 'details', counters, now: new Date('2026-08-14T10:00:00.000Z'),
    });

    expect(result).toMatchObject({ alert: 'sent', event: 'schema_changed' });
    expect(h.send).toHaveBeenCalledWith(expect.objectContaining({
      to: 'ops@example.test',
      text: expect.stringContaining('reason=schema_changed.property_block_missing'),
    }));
    const body = h.send.mock.calls[0][0].text as string;
    expect(body).not.toMatch(/@|cookie|token|authorization|https?:\/\//i);
    expect(h.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ last_health_alert_key: expect.stringMatching(/^[a-f0-9]{64}$/) }),
    }));
  });

  it('waits for the second consecutive degraded run', async () => {
    const first = harness({ parser_health_degraded_streak: 0 });
    await expect(recordParserSourceHealth(first.strapi, {
      source: first.source,
      classification: classification('degraded', 'degraded.details_ok_ratio_drop'),
      runId: 'run-1', stage: 'details', counters,
    })).resolves.toMatchObject({ alert: 'not_due' });
    expect(first.send).not.toHaveBeenCalled();

    const second = harness({ parser_health_status: 'degraded', parser_health_degraded_streak: 1 });
    await expect(recordParserSourceHealth(second.strapi, {
      source: second.source,
      classification: classification('degraded', 'degraded.details_ok_ratio_drop'),
      runId: 'run-2', stage: 'details', counters,
    })).resolves.toMatchObject({ alert: 'sent', event: 'degraded' });
  });

  it('suppresses an unchanged dedupe key inside cooldown', async () => {
    const first = harness();
    await recordParserSourceHealth(first.strapi, {
      source: first.source,
      classification: classification('blocked', 'blocked.typed_error'),
      runId: 'run-1', stage: 'canary', counters, now: new Date('2026-08-14T10:00:00.000Z'),
    });
    const persisted = first.update.mock.calls.at(-1)![0].data;
    const repeat = harness({
      parser_health_status: 'blocked',
      last_health_alert_at: persisted.last_health_alert_at,
      last_health_alert_key: persisted.last_health_alert_key,
    });

    await expect(recordParserSourceHealth(repeat.strapi, {
      source: repeat.source,
      classification: classification('blocked', 'blocked.typed_error'),
      runId: 'run-2', stage: 'canary', counters, now: new Date('2026-08-14T11:00:00.000Z'),
    })).resolves.toMatchObject({ alert: 'suppressed', event: 'blocked' });
    expect(repeat.send).not.toHaveBeenCalled();
  });

  it('sends exactly one recovery after an alerted non-quarantined degraded state', async () => {
    const h = harness({
      parser_health_status: 'degraded',
      last_health_alert_at: '2026-08-14T10:00:00.000Z',
      last_health_alert_key: 'b'.repeat(64),
    });
    await expect(recordParserSourceHealth(h.strapi, {
      source: h.source,
      classification: classification('healthy', 'healthy.within_baseline'),
      runId: 'run-3', stage: 'details', counters, now: new Date('2026-08-14T12:00:00.000Z'),
    })).resolves.toMatchObject({ alert: 'sent', event: 'recovered' });
    expect(h.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        parser_health_status: 'healthy',
      }),
    }));
    expect(h.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ last_health_recovered_at: '2026-08-14T12:00:00.000Z' }),
    }));
  });

  it('does not promote a persisted degraded source from a healthy canary', async () => {
    const h = harness({
      parser_health_status: 'degraded',
      parser_health_degraded_streak: 2,
      last_health_alert_at: '2026-08-14T10:00:00.000Z',
      last_health_alert_key: 'b'.repeat(64),
    });

    await expect(recordParserSourceHealth(h.strapi, {
      source: h.source,
      classification: classification('healthy', 'healthy.within_baseline'),
      runId: 'canary-1', stage: 'canary', counters,
      now: new Date('2026-08-14T12:00:00.000Z'),
    })).resolves.toMatchObject({ alert: 'not_due', applied: true, persistedStatus: 'degraded' });

    expect(h.send).not.toHaveBeenCalled();
    expect(h.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ parser_health_status: 'degraded' }),
    }));
  });

  it.each([
    {
      previousStatus: 'degraded' as const,
      previousStreak: 2,
      previousFingerprint: 'd'.repeat(64),
      previousReason: 'degraded.details_ok_ratio_drop',
    },
    {
      previousStatus: 'blocked' as const,
      previousStreak: 7,
      previousFingerprint: 'b'.repeat(64),
      previousReason: 'blocked.typed_error',
    },
  ])('preserves authoritative health metadata while a healthy canary is held against $previousStatus', async ({
    previousStatus, previousStreak, previousFingerprint, previousReason,
  }) => {
    const h = harness({
      parser_health_status: previousStatus,
      parser_health_degraded_streak: previousStreak,
      last_schema_fingerprint: previousFingerprint,
      last_health_reason: previousReason,
      last_health_alert_at: '2026-08-14T10:00:00.000Z',
      last_health_alert_key: 'b'.repeat(64),
    });

    await expect(recordParserSourceHealth(h.strapi, {
      source: h.source,
      classification: classification('healthy', 'healthy.within_baseline'),
      runId: 'held-canary', stage: 'canary', counters,
      now: new Date('2026-08-14T12:00:00.000Z'),
    })).resolves.toMatchObject({ alert: 'not_due', applied: true, persistedStatus: previousStatus });

    const sourceUpdate = h.update.mock.calls[0][0].data;
    expect(sourceUpdate).toMatchObject({
      parser_health_status: previousStatus,
      last_health_checked_at: '2026-08-14T12:00:00.000Z',
      parser_health_degraded_streak: previousStreak,
    });
    expect(sourceUpdate).not.toHaveProperty('last_schema_fingerprint');
    expect(sourceUpdate).not.toHaveProperty('last_health_reason');
    expect(h.source.last_schema_fingerprint).toBe(previousFingerprint);
    expect(h.source.last_health_reason).toBe(previousReason);
    expect(h.send).not.toHaveBeenCalled();
  });

  it.each([
    ['schema_changed', 'canary'], ['blocked', 'canary'], ['unknown_legacy_state', 'canary'], [null, 'canary'],
    ['schema_changed', 'details'], ['blocked', 'details'], ['unknown_legacy_state', 'details'], [null, 'details'],
  ] as const)('does not auto-release %s quarantine from %s health recording', async (parser_health_status, stage) => {
    const h = harness({
      parser_health_status,
      last_health_alert_at: '2026-08-14T10:00:00.000Z',
      last_health_alert_key: 'b'.repeat(64),
    });
    const expectedStatus = parser_health_status === 'schema_changed' ? 'schema_changed' : 'blocked';

    await expect(recordParserSourceHealth(h.strapi, {
      source: h.source,
      classification: classification('healthy', 'healthy.within_baseline'),
      runId: 'held-1', stage, counters, now: new Date('2026-08-14T12:00:00.000Z'),
    })).resolves.toMatchObject({ alert: 'not_due', applied: true, persistedStatus: expectedStatus });

    expect(h.send).not.toHaveBeenCalled();
    expect(h.update).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        parser_health_status: parser_health_status === null ? { $null: true } : parser_health_status,
      }),
      data: expect.objectContaining({ parser_health_status: expectedStatus }),
    }));
    expect(h.update.mock.calls[0][0].data).not.toHaveProperty('last_health_recovered_at');
  });

  it('uses fresh persisted hard state instead of stale caller state', async () => {
    const h = harness({
      parser_health_status: 'blocked',
      last_health_alert_at: '2026-08-14T10:00:00.000Z',
    });
    const staleSource = { ...h.source, parser_health_status: 'healthy' };

    await expect(recordParserSourceHealth(h.strapi, {
      source: staleSource,
      classification: classification('healthy', 'healthy.within_baseline'),
      runId: 'stale-canary', stage: 'canary', counters,
    })).resolves.toMatchObject({ alert: 'not_due' });

    expect(h.send).not.toHaveBeenCalled();
    expect(h.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 1, parser_health_status: 'blocked' },
      data: expect.objectContaining({ parser_health_status: 'blocked' }),
    }));
  });

  it('does not alert or write after losing the health-state CAS', async () => {
    const h = harness({ parser_health_status: 'degraded', parser_health_degraded_streak: 1 });
    h.update.mockResolvedValueOnce(null);

    await expect(recordParserSourceHealth(h.strapi, {
      source: h.source,
      classification: classification('degraded', 'degraded.details_ok_ratio_drop'),
      runId: 'race-loser', stage: 'details', counters,
    })).resolves.toMatchObject({ alert: 'not_due', applied: false });

    expect(h.send).not.toHaveBeenCalled();
    expect(h.update).toHaveBeenCalledTimes(1);
  });

  it('logs SMTP failure safely and does not throw or mark the alert as sent', async () => {
    const h = harness();
    h.send.mockRejectedValue(new Error('SMTP response with secret body'));
    await expect(recordParserSourceHealth(h.strapi, {
      source: h.source,
      classification: classification('blocked', 'blocked.typed_error'),
      runId: 'run-4', stage: 'canary', counters,
    })).resolves.toMatchObject({ alert: 'send_failed', event: 'blocked' });
    expect(h.strapi.log.error).toHaveBeenCalledWith('[parser-health] Operational alert delivery failed');
    expect(h.update.mock.calls[0][0].data).not.toHaveProperty('last_health_alert_at');
  });
});
