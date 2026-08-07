import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyState } from '../state';

const {
  mockGetState,
  mockUpdateState,
  mockResetState,
  mockTryAcquire,
  mockBuildAll,
  mockBuildSingle,
  mockEnsureParserRun,
  mockEnsureSnapshot,
  mockFinishParserRun,
  mockParseAll,
  mockAnalyze,
  mockDigest,
  mockQueueAdd,
} = vi.hoisted(() => ({
  mockGetState: vi.fn(),
  mockUpdateState: vi.fn(),
  mockResetState: vi.fn(),
  mockTryAcquire: vi.fn(),
  mockBuildAll: vi.fn(),
  mockBuildSingle: vi.fn(),
  mockEnsureParserRun: vi.fn(),
  mockEnsureSnapshot: vi.fn(),
  mockFinishParserRun: vi.fn(),
  mockParseAll: vi.fn(),
  mockAnalyze: vi.fn(),
  mockDigest: vi.fn(),
  mockQueueAdd: vi.fn(),
}));

vi.mock('../../user-profile', () => ({
  buildAllActiveSnapshot: mockBuildAll,
  buildSingleUserSnapshot: mockBuildSingle,
}));

vi.mock('../../parser-run-telemetry', () => ({
  createParserRunTelemetry: vi.fn(() => ({
    ensureParserRun: mockEnsureParserRun,
    ensureParserRunSnapshot: mockEnsureSnapshot,
    finishParserRun: mockFinishParserRun,
  })),
}));

vi.mock('../state', async () => {
  const actual = await vi.importActual<typeof import('../state')>('../state');
  return {
    ...actual,
    getState: mockGetState,
    updateState: mockUpdateState,
    resetState: mockResetState,
    tryAcquireIdleState: mockTryAcquire,
  };
});

vi.mock('../stages', () => ({
  parseAll: mockParseAll,
  analyze: mockAnalyze,
  digest: mockDigest,
}));

vi.mock('../../pipeline-sse', () => ({ broadcastSSE: vi.fn() }));
vi.mock('../../queueService', () => ({ getQueueService: vi.fn(() => ({ addToQueue: mockQueueAdd, getJob: vi.fn() })) }));

import { PipelineService } from '../index';

const snapshot = {
  schemaVersion: 1 as const,
  scope: 'single' as const,
  createdAt: '2026-08-07T10:00:00.000Z',
  windowEndAt: '2026-08-07T10:00:00.000Z',
  profiles: [{
    userId: 7,
    profileId: 70,
    version: 1,
    regions: ['moscow' as const],
    propertyTypes: ['office' as const],
    priceFrom: null,
    priceTo: null,
    areaFrom: null,
    areaTo: null,
    stopWords: [],
  }],
  hash: 'a'.repeat(64),
};

function makeStrapi() {
  return {
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    db: { query: vi.fn().mockReturnValue({ findOne: vi.fn().mockResolvedValue({ parse_depth: 20 }) }) },
    entityService: { findMany: vi.fn() },
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetState.mockResolvedValue(emptyState());
  mockUpdateState.mockResolvedValue(undefined);
  mockTryAcquire.mockResolvedValue(true);
  mockEnsureParserRun.mockResolvedValue({ id: 3 });
  mockEnsureSnapshot.mockResolvedValue({ id: 3 });
  mockFinishParserRun.mockResolvedValue({ id: 3 });
  mockParseAll.mockResolvedValue({ created: 0, errors: [] });
  mockAnalyze.mockResolvedValue({ undervalued: 0, errors: [] });
  mockDigest.mockResolvedValue({ sent: false, errors: [] });
  mockQueueAdd.mockReturnValue({ id: 91, status: 'queued' });
});

describe('pipeline canonical snapshot lifecycle', () => {
  it('persists run-owned job ids fail-closed', async () => {
    const strapi = makeStrapi();
    const service = new PipelineService(strapi);
    (service as any).activeRunId = 'run-1';
    mockGetState.mockResolvedValue({ ...emptyState(), run_id: 'run-1', status: 'running' });

    await service.recordJobIds([42]);

    expect(mockUpdateState).toHaveBeenCalledWith(strapi, { job_ids: [42] }, undefined, true);
  });

  it('builds the manual single snapshot once after telemetry and before stages', async () => {
    const service = new PipelineService(makeStrapi());
    mockBuildSingle.mockResolvedValue(snapshot);
    const order: string[] = [];
    mockEnsureParserRun.mockImplementation(async () => { order.push('telemetry'); return { id: 3 }; });
    mockBuildSingle.mockImplementation(async () => { order.push('builder'); return snapshot; });
    mockEnsureSnapshot.mockImplementation(async () => { order.push('snapshot-telemetry'); return { id: 3 }; });
    mockParseAll.mockImplementation(async () => {
      order.push('stage');
      mockQueueAdd();
      order.push('queue');
      return { created: 0, errors: [] };
    });

    await service.start('parse', 25, 7, 'manual');
    await vi.waitFor(() => expect(mockParseAll).toHaveBeenCalled());

    expect(mockBuildSingle).toHaveBeenCalledTimes(1);
    expect(mockBuildAll).not.toHaveBeenCalled();
    expect(order).toEqual(['telemetry', 'builder', 'snapshot-telemetry', 'stage', 'queue']);
    expect(mockEnsureSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      profileScope: 'single', targetUserId: 7, snapshot,
    }));
    expect(mockUpdateState).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      filter_snapshot: snapshot,
      filter_snapshot_hash: snapshot.hash,
      filter_snapshot_scope: 'single',
      filter_snapshot_schema_version: 1,
      filter_snapshot_window_end_at: snapshot.windowEndAt,
    }), undefined, true);
  });

  it('resolves fresh setting depth and makes an unready manual profile a successful no-op', async () => {
    const strapi = makeStrapi();
    strapi.db.query().findOne.mockResolvedValue({ parse_depth: 41 });
    const service = new PipelineService(strapi);
    mockBuildSingle.mockResolvedValue(null);

    await service.start('digest', undefined, 7, 'manual');
    await vi.waitFor(() => expect(mockFinishParserRun).toHaveBeenCalledWith(expect.objectContaining({ status: 'succeeded' })));

    expect(mockBuildSingle).toHaveBeenCalledTimes(1);
    expect(mockEnsureSnapshot).toHaveBeenCalledWith(expect.objectContaining({ profileScope: 'none', snapshot: null }));
    expect(mockDigest).not.toHaveBeenCalled();
    expect(mockUpdateState).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      filter_snapshot: null,
      filter_snapshot_scope: 'none',
    }), undefined, true);
  });

  it('uses all-active snapshot for cron and treats an empty all snapshot as a no-op', async () => {
    const strapi = makeStrapi();
    strapi.db.query().findOne.mockResolvedValue({ parse_depth: 12 });
    const service = new PipelineService(strapi);
    mockBuildAll.mockResolvedValue({ ...snapshot, scope: 'all', profiles: [] });

    await service.run(undefined, undefined, 'cron');

    expect(mockBuildAll).toHaveBeenCalledTimes(1);
    expect(mockBuildSingle).not.toHaveBeenCalled();
    expect(mockEnsureSnapshot).toHaveBeenCalledWith(expect.objectContaining({ profileScope: 'all', snapshot: expect.objectContaining({ profiles: [] }) }));
    expect(mockParseAll).not.toHaveBeenCalled();
    expect(mockAnalyze).not.toHaveBeenCalled();
    expect(mockDigest).not.toHaveBeenCalled();
  });

  it('fails closed on malformed global depth before building a snapshot or starting stages', async () => {
    const strapi = makeStrapi();
    strapi.db.query().findOne.mockResolvedValue({ parse_depth: 0 });
    const service = new PipelineService(strapi);

    await expect(service.run(undefined, undefined, 'cron')).rejects.toMatchObject({ code: 'PIPELINE_CONFIGURATION_INVALID' });
    expect(mockBuildAll).not.toHaveBeenCalled();
    expect(mockParseAll).not.toHaveBeenCalled();
  });

  it('retains the in-memory lifecycle lock when terminal parser telemetry persistence fails', async () => {
    const service = new PipelineService(makeStrapi());
    mockBuildSingle.mockResolvedValue(snapshot);
    mockEnsureSnapshot.mockRejectedValue(new Error('snapshot persistence failed'));
    mockFinishParserRun.mockRejectedValue(new Error('telemetry finish failed'));

    await expect(service.start('parse', 25, 7, 'manual')).rejects.toBeTruthy();
    await expect(service.start('parse', 25, 7, 'manual')).rejects.toMatchObject({ code: 'PIPELINE_BUSY' });
    expect(mockParseAll).not.toHaveBeenCalled();
  });

  it('retains the in-memory lifecycle even when the durable blocking write also fails', async () => {
    const service = new PipelineService(makeStrapi());
    mockBuildSingle.mockResolvedValue(snapshot);
    mockEnsureSnapshot.mockRejectedValue(new Error('snapshot persistence failed'));
    mockFinishParserRun.mockRejectedValue(new Error('telemetry finish failed'));
    mockUpdateState
      .mockImplementationOnce(async () => undefined) // private pipeline snapshot
      .mockImplementationOnce(async () => undefined) // idle preflight terminal state
      .mockImplementationOnce(async () => { throw new Error('blocking write failed'); });

    await expect(service.start('parse', 25, 7, 'manual')).rejects.toBeTruthy();
    await expect(service.start('parse', 25, 7, 'manual')).rejects.toMatchObject({ code: 'PIPELINE_BUSY' });
    expect(mockParseAll).not.toHaveBeenCalled();
  });

  it('does not release the lifecycle when terminal state persistence fails after no-op telemetry completion', async () => {
    const service = new PipelineService(makeStrapi());
    mockBuildSingle.mockResolvedValue(null);
    mockUpdateState.mockImplementationOnce(async () => undefined).mockImplementationOnce(async () => {
      throw new Error('terminal state write failed');
    });

    await service.start('digest', 25, 7, 'manual');
    await vi.waitFor(() => expect(mockFinishParserRun).toHaveBeenCalledWith(expect.objectContaining({ status: 'succeeded' })));
    await expect(service.start('digest', 25, 7, 'manual')).rejects.toMatchObject({ code: 'PIPELINE_BUSY' });
  });
});
