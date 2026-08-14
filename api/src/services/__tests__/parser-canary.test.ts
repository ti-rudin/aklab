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
      operation: 'probe', source: 'm-ets', maxItems: 2, timeoutMs: 5_000,
    }, expect.objectContaining({ idempotencyKey: 'canary:2026-08-14:m-ets', maxAttempts: 1 }));
    expect(result).toEqual({ run_id: 'canary-test', skipped: false, results: [healthy('m-ets'), healthy('etprf')] });
    expect(mockRelease).toHaveBeenCalledWith(
      expect.anything(), 'canary-test', expect.objectContaining({ status: 'idle', stage: 'idle' }),
    );
  });

  it('keeps a successful listing-only source healthy without fake detail counters', async () => {
    const listingOnly = {
      source: 'investmoscow', checked: 1, listing_ok: true,
      detail_supported: false, detail_ok: true,
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

  it('bounds cancellation acknowledgement waiting and releases only its owned lifecycle', async () => {
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
    expect(result.results[0]).toMatchObject({ status: 'degraded', reason: 'job_failed' });
    expect(mockRelease).toHaveBeenCalledWith(
      api, 'canary-timeout', expect.objectContaining({ status: 'idle' }),
    );
    expect(clock).toBeLessThanOrEqual(61_250);
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
