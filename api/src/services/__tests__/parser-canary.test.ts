import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockAcquire, mockRelease, mockUpdateState } = vi.hoisted(() => ({
  mockAcquire: vi.fn(),
  mockRelease: vi.fn(),
  mockUpdateState: vi.fn(),
}));

vi.mock('../pipeline/state', async () => {
  const actual = await vi.importActual<any>('../pipeline/state');
  return { ...actual, tryAcquireIdleState: mockAcquire, tryReleaseOwnedState: mockRelease, updateState: mockUpdateState };
});

import { createParserCanaryService } from '../parser-canary';

function strapi(sources = [{ id: 1, slug: 'm-ets', is_active: true }]) {
  return {
    entityService: { findMany: vi.fn().mockResolvedValue(sources) },
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  } as any;
}

function healthy(source: string) {
  return {
    source, checked: 1, listing_ok: true, detail_supported: true, detail_ok: true,
    details_attempted: 1, details_ok: 1, details_failed: 0,
    property_block_found: 1, location_label_found: 1,
    confirmed_address: 1, confirmed_region_only: 0, missing: 0,
    semantic_fingerprint: 'a'.repeat(64), status: 'healthy',
  };
}

describe('parser canary orchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAcquire.mockResolvedValue(true);
    mockRelease.mockResolvedValue(true);
    mockUpdateState.mockResolvedValue(undefined);
  });

  it('fans out one exact read-only probe job per active source and returns safe results', async () => {
    const jobs = [
      { id: 11, status: 'completed', result: healthy('m-ets') },
      { id: 12, status: 'completed', result: healthy('etprf') },
    ];
    const queue = {
      addToQueue: vi.fn()
        .mockReturnValueOnce(jobs[0])
        .mockReturnValueOnce(jobs[1]),
      getJob: vi.fn((id: number) => jobs.find(job => job.id === id)),
      requestCancellation: vi.fn(),
    } as any;
    const service = createParserCanaryService(strapi([
      { id: 1, slug: 'm-ets', is_active: true },
      { id: 2, slug: 'etprf', is_active: true },
    ]), { queue, now: () => 1_700_000_000_000, runId: () => 'canary-test', sleep: vi.fn(), recordHealth: vi.fn() });

    const result = await service.run({ trigger: 'cron', windowKey: '2026-08-14', maxItems: 2, probeTimeoutMs: 5_000 });

    expect(queue.addToQueue).toHaveBeenCalledTimes(2);
    expect(queue.addToQueue).toHaveBeenCalledWith('parse-m-ets', {
      operation: 'probe', origin: 'canary', runId: 'canary-test', stage: 'probe',
      source: 'm-ets', maxItems: 2, timeoutMs: 5_000,
    }, expect.objectContaining({ idempotencyKey: 'canary:2026-08-14:m-ets', maxAttempts: 1 }));
    expect(result).toEqual({ run_id: 'canary-test', skipped: false, results: [healthy('m-ets'), healthy('etprf')] });
    expect(mockRelease).toHaveBeenCalledWith(
      expect.anything(), 'canary-test', expect.objectContaining({ status: 'idle', stage: 'idle' }),
    );
  });

  it('uses a cooperative 120 second default probe budget', async () => {
    const completed = { id: 31, status: 'completed', result: healthy('m-ets') };
    const queue = {
      addToQueue: vi.fn().mockReturnValue(completed),
      getJob: vi.fn().mockReturnValue(completed),
      requestCancellation: vi.fn(),
    } as any;
    const service = createParserCanaryService(strapi(), {
      queue, runId: () => 'canary-default', sleep: vi.fn(), recordHealth: vi.fn(),
    });

    await service.run({ trigger: 'manual', windowKey: 'default-budget' });

    expect(queue.addToQueue).toHaveBeenCalledWith('parse-m-ets', expect.objectContaining({
      origin: 'canary', runId: 'canary-default', stage: 'probe', timeoutMs: 120_000,
    }), expect.anything());
  });

  it('keeps a successful listing-only source healthy without fake detail counters', async () => {
    const listingOnly = {
      source: 'investmoscow', checked: 1, listing_ok: true,
      detail_supported: false, detail_ok: true,
      details_attempted: 0, details_ok: 0, details_failed: 0,
      property_block_found: 0, location_label_found: 0,
      confirmed_address: 1, confirmed_region_only: 0, missing: 0,
      semantic_fingerprint: 'b'.repeat(64), status: 'healthy',
    };
    const completed = { id: 21, status: 'completed', result: listingOnly };
    const queue = {
      addToQueue: vi.fn().mockReturnValue(completed),
      getJob: vi.fn().mockReturnValue(completed),
      requestCancellation: vi.fn(),
    } as any;
    const recordHealth = vi.fn();
    const service = createParserCanaryService(strapi([
      { id: 3, slug: 'investmoscow', is_active: true },
    ]), { queue, runId: () => 'canary-listing', sleep: vi.fn(), recordHealth });

    const result = await service.run({ trigger: 'manual', windowKey: 'listing-only' });

    expect(result.results).toEqual([listingOnly]);
    expect(recordHealth).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      classification: expect.objectContaining({ status: 'healthy' }),
      counters: expect.objectContaining({ details_attempted: 0, details_ok: 0 }),
    }));
  });

  it('skips observably without queue work when the shared pipeline lock is busy', async () => {
    mockAcquire.mockResolvedValue(false);
    const queue = { addToQueue: vi.fn() } as any;
    const service = createParserCanaryService(strapi(), { queue, runId: () => 'canary-busy' });

    await expect(service.run({ trigger: 'cron', windowKey: '2026-08-14' })).resolves.toEqual({
      run_id: 'canary-busy', skipped: true, reason: 'pipeline_not_idle', results: [],
    });
    expect(queue.addToQueue).not.toHaveBeenCalled();
    expect(mockUpdateState).not.toHaveBeenCalled();
    expect(mockRelease).not.toHaveBeenCalled();
  });

  it('uses a separate canary_no_samples reason for an empty probe result', async () => {
    const noSamples = {
      source: 'm-ets', checked: 0, listing_ok: false,
      detail_supported: true, detail_ok: true,
      details_attempted: 0, details_ok: 0, details_failed: 0,
      property_block_found: 0, location_label_found: 0,
      confirmed_address: 0, confirmed_region_only: 0, missing: 0,
      semantic_fingerprint: 'c'.repeat(64), status: 'degraded', reason: 'no_samples',
    };
    const completed = { id: 41, status: 'completed', result: noSamples };
    const queue = {
      addToQueue: vi.fn().mockReturnValue(completed),
      getJob: vi.fn().mockReturnValue(completed),
      requestCancellation: vi.fn(),
    } as any;
    const recordHealth = vi.fn();
    const service = createParserCanaryService(strapi(), {
      queue, runId: () => 'canary-empty', sleep: vi.fn(), recordHealth,
    });

    await service.run({ trigger: 'manual', windowKey: 'empty-sample' });

    expect(recordHealth).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      classification: expect.objectContaining({
        status: 'degraded', reason_code: 'degraded.canary_no_samples',
      }),
    }));
  });

  it('does not leak malformed queue results and does not retry failed sources', async () => {
    const jobs = [{ id: 11, status: 'completed', result: { source: 'm-ets', address: 'secret' } }];
    const queue = {
      addToQueue: vi.fn().mockReturnValue(jobs[0]),
      getJob: vi.fn().mockReturnValue(jobs[0]),
      requestCancellation: vi.fn(),
    } as any;
    const service = createParserCanaryService(strapi(), { queue, runId: () => 'canary-malformed', sleep: vi.fn(), recordHealth: vi.fn() });

    const result = await service.run({ trigger: 'manual', windowKey: 'manual-1' });

    expect(result.results[0]).toMatchObject({ source: 'm-ets', status: 'degraded', reason: 'malformed_result' });
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(queue.addToQueue).toHaveBeenCalledTimes(1);
  });

  it('keeps cancelling state and skips health/release when acknowledgement cap finds an active job', async () => {
    let clock = 0;
    const runningJob = { id: 11, status: 'running' };
    const queue = {
      addToQueue: vi.fn().mockReturnValue(runningJob),
      getJob: vi.fn().mockReturnValue(runningJob),
      requestCancellation: vi.fn(),
    } as any;
    const api = strapi();
    const service = createParserCanaryService(api, {
      queue,
      now: () => clock,
      runId: () => 'canary-timeout',
      sleep: vi.fn(async (ms: number) => { clock += ms; }),
      recordHealth: vi.fn(),
    });

    const result = await service.run({
      trigger: 'manual', windowKey: 'manual-timeout', probeTimeoutMs: 1_000,
    });

    expect(queue.requestCancellation).toHaveBeenCalledWith(11);
    expect(result).toEqual({
      run_id: 'canary-timeout',
      skipped: true,
      reason: 'terminal_ack_pending',
      pending_job_ids: [11],
      results: [],
    });
    expect(mockRelease).not.toHaveBeenCalled();
    expect(mockUpdateState).toHaveBeenLastCalledWith(
      api,
      expect.objectContaining({ status: 'cancelling', stage: 'canary', job_ids: [11] }),
      expect.stringMatching(/acknowledgement|terminal|ожид/i),
      true,
    );
    expect(clock).toBeLessThanOrEqual(61_250);
  });

  it('keeps the lifecycle locked when cancellation request fails and the job stays active', async () => {
    let clock = 0;
    const runningJob = { id: 12, status: 'running' };
    const recordHealth = vi.fn();
    const api = strapi();
    const queue = {
      addToQueue: vi.fn().mockReturnValue(runningJob),
      getJob: vi.fn().mockReturnValue(runningJob),
      requestCancellation: vi.fn(() => { throw new Error('unsafe queue details'); }),
    } as any;
    const service = createParserCanaryService(api, {
      queue,
      now: () => clock,
      runId: () => 'canary-cancel-error',
      sleep: vi.fn(async (ms: number) => { clock += ms; }),
      recordHealth,
    });

    const result = await service.run({ trigger: 'manual', windowKey: 'cancel-error', probeTimeoutMs: 1_000 });

    expect(result).toEqual({
      run_id: 'canary-cancel-error', skipped: true, reason: 'terminal_ack_pending',
      pending_job_ids: [12], results: [],
    });
    expect(queue.requestCancellation).toHaveBeenCalledWith(12);
    expect(api.log.warn).toHaveBeenCalledWith(
      '[parser-canary] Cancellation request failed; awaiting terminal acknowledgement',
    );
    expect(recordHealth).not.toHaveBeenCalled();
    expect(mockRelease).not.toHaveBeenCalled();
  });

  it('allows normal release when a failed cancellation request is followed by terminal completion', async () => {
    let clock = 0;
    let cancellationRequested = false;
    const completed = { id: 13, status: 'completed', result: healthy('m-ets') };
    const running = { id: 13, status: 'running' };
    const recordHealth = vi.fn();
    const queue = {
      addToQueue: vi.fn().mockReturnValue(running),
      getJob: vi.fn(() => cancellationRequested ? completed : running),
      requestCancellation: vi.fn(() => {
        cancellationRequested = true;
        throw new Error('unsafe queue details');
      }),
    } as any;
    const service = createParserCanaryService(strapi(), {
      queue,
      now: () => clock,
      runId: () => 'canary-cancel-terminal',
      sleep: vi.fn(async (ms: number) => { clock += ms; }),
      recordHealth,
    });

    await expect(service.run({ trigger: 'manual', windowKey: 'cancel-terminal', probeTimeoutMs: 1_000 }))
      .resolves.toEqual({ run_id: 'canary-cancel-terminal', skipped: false, results: [healthy('m-ets')] });
    expect(recordHealth).toHaveBeenCalledTimes(1);
    expect(mockRelease).toHaveBeenCalledWith(
      expect.anything(), 'canary-cancel-terminal', expect.objectContaining({ status: 'idle' }),
    );
  });

  it('maps exact partial detail counters without collapsing a failed sample to zero detail work', async () => {
    const partial = {
      ...healthy('m-ets'),
      checked: 2,
      details_attempted: 2,
      details_ok: 1,
      details_failed: 1,
      detail_ok: false,
      property_block_found: 1,
      location_label_found: 1,
      confirmed_address: 1,
      missing: 0,
      status: 'degraded',
      reason: 'detail_failed',
    };
    const completed = { id: 14, status: 'completed', result: partial };
    const queue = {
      addToQueue: vi.fn().mockReturnValue(completed),
      getJob: vi.fn().mockReturnValue(completed),
      requestCancellation: vi.fn(),
    } as any;
    const recordHealth = vi.fn();
    const service = createParserCanaryService(strapi(), {
      queue, runId: () => 'canary-partial', sleep: vi.fn(), recordHealth,
    });

    await expect(service.run({ trigger: 'manual', windowKey: 'partial-details' }))
      .resolves.toEqual({ run_id: 'canary-partial', skipped: false, results: [partial] });
    expect(recordHealth).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      counters: expect.objectContaining({ details_attempted: 2, details_ok: 1 }),
    }));
  });

  it('does not clear a newer lifecycle when ownership changed before finally', async () => {
    mockRelease.mockResolvedValue(false);
    const completed = { id: 11, status: 'completed', result: healthy('m-ets') };
    const queue = {
      addToQueue: vi.fn().mockReturnValue(completed),
      getJob: vi.fn().mockReturnValue(completed),
      requestCancellation: vi.fn(),
    } as any;
    const api = strapi();
    const service = createParserCanaryService(api, {
      queue, runId: () => 'stale-canary', sleep: vi.fn(), recordHealth: vi.fn(),
    });

    await service.run({ trigger: 'manual', windowKey: 'manual-stale' });

    expect(mockRelease).toHaveBeenCalledWith(
      api, 'stale-canary', expect.objectContaining({ status: 'idle' }),
    );
    expect(api.log.warn).toHaveBeenCalledWith(expect.stringContaining('ownership changed'));
  });
});
