import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockAddToQueue,
  mockGetJob,
  mockEnsureSourceStage,
  mockAttachSourceStageJob,
  mockSetDigestWindowEndAt,
  mockSetDigestCounters,
  mockUpdateState,
  mockScorePropertiesBatch,
} = vi.hoisted(() => ({
  mockAddToQueue: vi.fn(),
  mockGetJob: vi.fn(),
  mockEnsureSourceStage: vi.fn(),
  mockAttachSourceStageJob: vi.fn(),
  mockSetDigestWindowEndAt: vi.fn(),
  mockSetDigestCounters: vi.fn(),
  mockUpdateState: vi.fn(),
  mockScorePropertiesBatch: vi.fn(),
}));

vi.mock('../../queueService', () => ({
  getQueueService: vi.fn(() => ({ addToQueue: mockAddToQueue, getJob: mockGetJob })),
}));
vi.mock('../../parser-run-telemetry', () => ({
  createParserRunTelemetry: vi.fn(() => ({
    ensureSourceStage: mockEnsureSourceStage,
    attachSourceStageJob: mockAttachSourceStageJob,
    setDigestWindowEndAt: mockSetDigestWindowEndAt,
    setDigestCounters: mockSetDigestCounters,
    reconcileSourceStageQueueFailure: vi.fn(),
  })),
}));
vi.mock('../state', () => ({ updateState: mockUpdateState }));
vi.mock('../../focusEngine', () => ({ scorePropertiesBatch: mockScorePropertiesBatch }));

import { analyze, digest, parseAll } from '../stages';

const filterSnapshot = Object.freeze({
  schemaVersion: 1 as const,
  scope: 'all' as const,
  createdAt: '2026-08-07T10:00:00.000Z',
  windowEndAt: '2026-08-07T10:00:00.000Z',
  profiles: Object.freeze([{ userId: 7 } as any]),
  hash: 'b'.repeat(64),
});

function makeCtx() {
  const strapi = {
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    entityService: {
      findMany: vi.fn().mockResolvedValue([{ id: 1, documentId: 'source-1', slug: 'source-one' }]),
    },
  } as any;
  return {
    strapi,
    isCancelled: vi.fn(() => false),
    requestCancellation: vi.fn(),
    getRunId: vi.fn(() => 'run-1'),
    getParserRunId: vi.fn(() => 3),
    getFilterSnapshot: vi.fn(() => filterSnapshot),
    recordJobIds: vi.fn(),
    getSourceStats: vi.fn(),
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  let nextId = 100;
  mockAddToQueue.mockImplementation((name: string, data: any) => ({ id: nextId++, status: 'queued', name, data }));
  mockGetJob.mockImplementation((id: number) => ({
    id,
    status: 'completed',
    result: id === 100 ? { total: 2, detailsNeeded: 1 } : { detailsFetched: 1, created: 1 },
  }));
  mockEnsureSourceStage.mockResolvedValue(undefined);
  mockAttachSourceStageJob.mockResolvedValue(undefined);
  mockSetDigestWindowEndAt.mockResolvedValue(undefined);
  mockSetDigestCounters.mockResolvedValue(undefined);
  mockUpdateState.mockResolvedValue(undefined);
  mockScorePropertiesBatch.mockResolvedValue({ scored: 1, in_focus: 1, by_tag: {} });
});

describe('parse stage canonical snapshot propagation', () => {
  it('passes the exact same immutable snapshot object and hash to scan and details jobs', async () => {
    const ctx = makeCtx();
    const result = await parseAll(ctx, 37);

    expect(result).toEqual({ created: 1, errors: [] });
    expect(mockAddToQueue).toHaveBeenCalledTimes(2);
    const scanData = mockAddToQueue.mock.calls[0][1];
    const detailData = mockAddToQueue.mock.calls[1][1];
    expect(scanData.filterSnapshot).toBe(filterSnapshot);
    expect(detailData.filterSnapshot).toBe(filterSnapshot);
    expect(scanData.filterSnapshotHash).toBe(filterSnapshot.hash);
    expect(detailData.filterSnapshotHash).toBe(filterSnapshot.hash);
    expect(scanData.depth).toBe(37);
    expect(detailData.depth).toBe(37);
    expect((ctx.strapi as any).db).toBeUndefined();
    expect(ctx.recordJobIds).toHaveBeenCalledTimes(2);
    expect(ctx.recordJobIds.mock.invocationCallOrder[0]).toBeLessThan(mockAttachSourceStageJob.mock.invocationCallOrder[0]);
    expect(ctx.recordJobIds.mock.invocationCallOrder[1]).toBeLessThan(mockAttachSourceStageJob.mock.invocationCallOrder[1]);
  });

  it('does not read sources or enqueue jobs for an empty snapshot', async () => {
    const ctx = makeCtx();
    ctx.getFilterSnapshot.mockReturnValue({ ...filterSnapshot, profiles: [] });

    await expect(parseAll(ctx, 1)).resolves.toEqual({ created: 0, errors: [] });
    expect(ctx.strapi.entityService.findMany).not.toHaveBeenCalled();
    expect(mockAddToQueue).not.toHaveBeenCalled();
  });
});

describe('analyze stage canonical candidate selection', () => {
  it('uses only the shared is_undervalued marker and ignores legacy Property.status', async () => {
    const ctx = makeCtx();
    ctx.getFilterSnapshot.mockReturnValue(null);
    const candidate = {
      id: 7,
      documentId: 'property-viewed',
      status: 'viewed',
      is_undervalued: null,
    };
    const undervaluedQuery = vi.fn().mockResolvedValue([{ id: candidate.id }]);
    ctx.strapi.entityService.findMany.mockResolvedValue([candidate]);
    ctx.strapi.db = {
      query: vi.fn(() => ({ findMany: undervaluedQuery })),
    };

    await expect(analyze(ctx)).resolves.toEqual({ undervalued: 1, errors: [] });

    expect(ctx.strapi.entityService.findMany).toHaveBeenCalledWith('api::property.property', {
      filters: { is_undervalued: { $null: true } },
      limit: -1,
    });
    const filters = ctx.strapi.entityService.findMany.mock.calls[0][1].filters;
    expect(filters).not.toHaveProperty('status');
    expect(filters.is_undervalued).toEqual({ $null: true });
    expect(mockScorePropertiesBatch).toHaveBeenCalledTimes(1);
  });
});

describe('digest stage immutable multi-user fan-out', () => {
  function makeDigestCtx(profiles: Array<{ userId: number }>, scope: 'all' | 'single' = 'all') {
    const ctx = makeCtx();
    const snapshot = Object.freeze({ ...filterSnapshot, scope, profiles: Object.freeze(profiles) });
    ctx.getFilterSnapshot.mockReturnValue(snapshot);
    const query = vi.fn();
    Object.defineProperty(ctx.strapi, 'db', {
      configurable: true,
      value: { query },
    });
    return { ctx, snapshot, query };
  }

  it('fans out one exact job for a single-user snapshot', async () => {
    const { ctx, snapshot, query } = makeDigestCtx([{ userId: 42 }], 'single');
    mockAddToQueue.mockReturnValue({ id: 151, status: 'queued', name: 'digest-send' });
    mockGetJob.mockReturnValue({ id: 151, status: 'completed', result: { sent: false, count: 0, reason: 'empty' } });

    await expect(digest(ctx)).resolves.toEqual({ sent: false, errors: [] });

    expect(mockSetDigestWindowEndAt).toHaveBeenCalledWith({
      runId: 'run-1',
      windowEndAt: expect.any(String),
    });
    expect(mockSetDigestWindowEndAt.mock.invocationCallOrder[0]).toBeLessThan(mockAddToQueue.mock.invocationCallOrder[0]);
    expect(mockAddToQueue).toHaveBeenCalledWith(
      'digest-send',
      { runId: 'run-1', userId: 42, snapshotHash: snapshot.hash, correlationId: 'digest-run-1' },
      { correlationId: 'digest-run-1', idempotencyKey: 'digest:run-1:42' },
    );
    expect(query).not.toHaveBeenCalled();
  });

  it('fans out one exact immutable job per snapshot profile with stable idempotency', async () => {
    const { ctx, snapshot, query } = makeDigestCtx([{ userId: 7 }, { userId: 11 }]);
    let nextId = 201;
    mockAddToQueue.mockImplementation((name: string, data: any, options: any) => ({
      id: nextId++, status: 'queued', name, data, options,
    }));
    mockGetJob.mockImplementation((id: number) => ({ id, status: 'completed', result: { sent: true, count: 2 } }));

    await expect(digest(ctx)).resolves.toEqual({ sent: true, errors: [] });

    expect(mockAddToQueue).toHaveBeenCalledTimes(2);
    expect(mockAddToQueue).toHaveBeenNthCalledWith(
      1,
      'digest-send',
      { runId: 'run-1', userId: 7, snapshotHash: snapshot.hash, correlationId: 'digest-run-1' },
      { correlationId: 'digest-run-1', idempotencyKey: 'digest:run-1:7' },
    );
    expect(mockAddToQueue).toHaveBeenNthCalledWith(
      2,
      'digest-send',
      { runId: 'run-1', userId: 11, snapshotHash: snapshot.hash, correlationId: 'digest-run-1' },
      { correlationId: 'digest-run-1', idempotencyKey: 'digest:run-1:11' },
    );
    for (const call of mockAddToQueue.mock.calls) {
      expect(Object.keys(call[1]).sort()).toEqual(['correlationId', 'runId', 'snapshotHash', 'userId']);
      expect(JSON.stringify(call[1])).not.toMatch(/smtpTo|date|filterSnapshot|profileId/);
    }
    expect(mockSetDigestCounters).toHaveBeenCalledWith({ runId: 'run-1', scheduled: 2, sent: 2, skipped: 0, failed: 0 });
    expect(mockUpdateState).toHaveBeenLastCalledWith(
      ctx.strapi,
      {
        stage: 'digest_done',
        errors: [],
        digest_scheduled: 2,
        digest_sent: 2,
        digest_skipped: 0,
        digest_failed: 0,
      },
      'Дайджест: 2 отправлено, 0 пропущено, 0 ошибок',
    );
    expect(query).not.toHaveBeenCalled();
  });

  it('validates duplicate snapshot users before the first enqueue', async () => {
    const { ctx } = makeDigestCtx([{ userId: 7 }, { userId: 7 }]);

    await expect(digest(ctx)).rejects.toThrow(/duplicate/i);
    expect(mockAddToQueue).not.toHaveBeenCalled();
    expect(ctx.recordJobIds).not.toHaveBeenCalled();
    expect(mockSetDigestCounters).not.toHaveBeenCalled();
  });

  it('skips an empty immutable snapshot without reading current profiles or settings', async () => {
    const { ctx, query } = makeDigestCtx([]);

    await expect(digest(ctx)).resolves.toEqual({ sent: false, errors: [] });
    expect(mockAddToQueue).not.toHaveBeenCalled();
    expect(mockSetDigestCounters).toHaveBeenCalledWith({ runId: 'run-1', scheduled: 0, sent: 0, skipped: 0, failed: 0 });
    expect(query).not.toHaveBeenCalled();
    expect(mockUpdateState).toHaveBeenLastCalledWith(
      ctx.strapi,
      {
        stage: 'digest_done',
        errors: [],
        digest_scheduled: 0,
        digest_sent: 0,
        digest_skipped: 0,
        digest_failed: 0,
      },
      'Дайджест пропущен — нет готовых профилей',
    );
  });

  it('derives sent, skipped, and failed counters without exposing worker error data', async () => {
    const { ctx } = makeDigestCtx([{ userId: 7 }, { userId: 11 }, { userId: 19 }]);
    let nextId = 301;
    mockAddToQueue.mockImplementation((name: string, data: any) => ({ id: nextId++, status: 'queued', name, data }));
    mockGetJob.mockImplementation((id: number) => {
      if (id === 301) return { id, status: 'completed', result: { sent: true, count: 4 } };
      if (id === 302) return { id, status: 'completed', result: { sent: false, count: 0, reason: 'no matching properties' } };
      return { id, status: 'failed', error: 'private body secret@example.test' };
    });

    await expect(digest(ctx)).resolves.toEqual({
      sent: true,
      errors: ['Дайджест: 1 задач завершились с ошибкой'],
    });
    expect(mockSetDigestCounters).toHaveBeenCalledWith({ runId: 'run-1', scheduled: 3, sent: 1, skipped: 1, failed: 1 });
    const counters = mockSetDigestCounters.mock.calls[0][0];
    expect(counters.scheduled).toBe(counters.sent + counters.skipped + counters.failed);
    expect(mockUpdateState).toHaveBeenLastCalledWith(
      ctx.strapi,
      {
        stage: 'digest_done',
        errors: ['Дайджест: 1 задач завершились с ошибкой'],
        digest_scheduled: 3,
        digest_sent: 1,
        digest_skipped: 1,
        digest_failed: 1,
      },
      'Дайджест: 1 отправлено, 1 пропущено, 1 ошибок',
    );
    expect(JSON.stringify(mockUpdateState.mock.calls)).not.toContain('secret@example.test');
    expect(JSON.stringify(mockUpdateState.mock.calls)).not.toContain('private body');
  });

  it('counts a malformed completed result as failed and returns a safe aggregate error', async () => {
    const { ctx } = makeDigestCtx([{ userId: 7 }]);
    mockAddToQueue.mockImplementation((name: string, data: any) => ({ id: 401, status: 'queued', name, data }));
    mockGetJob.mockReturnValue({ id: 401, status: 'completed', result: { sent: false, count: 1, reason: 'unsafe' } });

    await expect(digest(ctx)).resolves.toEqual({
      sent: false,
      errors: ['Дайджест: 1 задач завершились с ошибкой'],
    });
    expect(mockSetDigestCounters).toHaveBeenCalledWith({ runId: 'run-1', scheduled: 1, sent: 0, skipped: 0, failed: 1 });
    const counters = mockSetDigestCounters.mock.calls[0][0];
    expect(counters.scheduled).toBe(counters.sent + counters.skipped + counters.failed);
  });

  it('counts missing jobs as failed while preserving the aggregate invariant', async () => {
    const { ctx } = makeDigestCtx([{ userId: 7 }, { userId: 11 }]);
    let nextId = 451;
    mockAddToQueue.mockImplementation((name: string, data: any) => ({ id: nextId++, status: 'queued', name, data }));
    mockGetJob.mockImplementation((id: number) => id === 451
      ? { id, status: 'completed', result: { sent: true, count: 1 } }
      : null);

    await expect(digest(ctx)).resolves.toEqual({
      sent: true,
      errors: ['Дайджест: 1 задач завершились с ошибкой'],
    });

    expect(mockSetDigestCounters).toHaveBeenCalledWith({ runId: 'run-1', scheduled: 2, sent: 1, skipped: 0, failed: 1 });
    const counters = mockSetDigestCounters.mock.calls[0][0];
    expect(counters.scheduled).toBe(counters.sent + counters.skipped + counters.failed);
    expect(mockUpdateState).toHaveBeenLastCalledWith(
      ctx.strapi,
      {
        stage: 'digest_done',
        errors: ['Дайджест: 1 задач завершились с ошибкой'],
        digest_scheduled: 2,
        digest_sent: 1,
        digest_skipped: 0,
        digest_failed: 1,
      },
      'Дайджест: 1 отправлено, 0 пропущено, 1 ошибок',
    );
  });

  it('records each returned job before persisting digest counters', async () => {
    const { ctx } = makeDigestCtx([{ userId: 7 }, { userId: 11 }]);
    let nextId = 501;
    mockAddToQueue.mockImplementation((name: string, data: any) => ({ id: nextId++, status: 'queued', name, data }));
    mockGetJob.mockImplementation((id: number) => ({ id, status: 'completed', result: { sent: false, count: 0, reason: 'empty' } }));

    await digest(ctx);

    expect(ctx.recordJobIds).toHaveBeenCalledTimes(2);
    expect(ctx.recordJobIds.mock.invocationCallOrder.at(-1)).toBeLessThan(mockSetDigestCounters.mock.invocationCallOrder[0]);
    expect(mockSetDigestCounters.mock.invocationCallOrder[0]).toBeLessThan(
      mockUpdateState.mock.invocationCallOrder.at(-1)!,
    );
  });

  it('fails the digest stage when the aggregate state update fails after telemetry persistence', async () => {
    const { ctx } = makeDigestCtx([{ userId: 7 }]);
    mockAddToQueue.mockReturnValue({ id: 551, status: 'queued', name: 'digest-send' });
    mockGetJob.mockReturnValue({ id: 551, status: 'completed', result: { sent: true, count: 1 } });
    mockUpdateState.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('state write failed'));

    await expect(digest(ctx)).rejects.toThrow('state write failed');
    expect(mockSetDigestCounters).toHaveBeenCalledWith({ runId: 'run-1', scheduled: 1, sent: 1, skipped: 0, failed: 0 });
    expect(mockSetDigestCounters.mock.invocationCallOrder[0]).toBeLessThan(
      mockUpdateState.mock.invocationCallOrder.at(-1)!,
    );
  });

  it('stops enqueueing after cancellation while awaiting already-owned jobs', async () => {
    const { ctx } = makeDigestCtx([{ userId: 7 }, { userId: 11 }]);
    mockAddToQueue.mockImplementation((name: string, data: any) => ({ id: 601, status: 'queued', name, data }));
    mockGetJob.mockReturnValue({ id: 601, status: 'completed', result: { sent: true, count: 1 } });
    ctx.isCancelled.mockReturnValueOnce(false).mockReturnValueOnce(true);

    await expect(digest(ctx)).resolves.toEqual({ sent: true, errors: [] });
    expect(mockAddToQueue).toHaveBeenCalledTimes(1);
    expect(mockSetDigestCounters).toHaveBeenCalledWith({ runId: 'run-1', scheduled: 1, sent: 1, skipped: 0, failed: 0 });
  });
});
