import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockAddToQueue,
  mockGetJob,
  mockEnsureSourceStage,
  mockAttachSourceStageJob,
  mockUpdateState,
  mockScorePropertiesBatch,
} = vi.hoisted(() => ({
  mockAddToQueue: vi.fn(),
  mockGetJob: vi.fn(),
  mockEnsureSourceStage: vi.fn(),
  mockAttachSourceStageJob: vi.fn(),
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
    reconcileSourceStageQueueFailure: vi.fn(),
  })),
}));
vi.mock('../state', () => ({ updateState: mockUpdateState }));
vi.mock('../../focusEngine', () => ({ scorePropertiesBatch: mockScorePropertiesBatch }));

import { analyze, parseAll } from '../stages';

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
