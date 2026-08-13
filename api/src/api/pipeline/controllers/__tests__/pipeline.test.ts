import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPipeline = {
  start: vi.fn(),
  getState: vi.fn(),
  cancel: vi.fn(),
  forceReset: vi.fn(),
};

vi.mock('../../../../services/pipeline', () => ({
  getPipelineService: vi.fn(() => mockPipeline),
}));

import pipelineController from '../pipeline';

(globalThis as any).strapi = { log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } };

function makeCtx(body: unknown): any {
  return {
    request: { body },
    status: 200,
    body: undefined,
  };
}

describe('pipeline controller manual start contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPipeline.start.mockResolvedValue('run-1');
  });

  it('requires an exact positive targetUserId and forwards no request filters', async () => {
    const ctx = makeCtx({ mode: 'full', depth: 25, targetUserId: 7 });

    await pipelineController.start(ctx);

    expect(mockPipeline.start).toHaveBeenCalledWith('full', 25, 7, 'manual');
    expect(ctx.body).toMatchObject({ ok: true, run_id: 'run-1' });
  });

  it.each([
    {},
    { targetUserId: 0 },
    { targetUserId: '7' },
    { targetUserId: 1.5 },
    { targetUserId: Number.MAX_SAFE_INTEGER + 1 },
    { targetUserId: 7, filters: {} },
    { targetUserId: 7, unknown: true },
    { targetUserId: 7, depth: 0 },
    { targetUserId: 7, depth: 1001 },
    { targetUserId: 7, depth: '25' },
    { targetUserId: 7, mode: 'unknown' },
    null,
    [],
    [7],
  ])('rejects malformed body %j without starting a run', async body => {
    const ctx = makeCtx(body);

    await pipelineController.start(ctx);

    expect(ctx.status).toBe(400);
    expect(ctx.body).toEqual({ ok: false, code: 'PIPELINE_INPUT_INVALID', message: expect.any(String) });
    expect(mockPipeline.start).not.toHaveBeenCalled();
  });

  it('does not return raw pipeline/profile error details', async () => {
    mockPipeline.start.mockRejectedValue(Object.assign(new Error('SQLITE private profile email=secret@example.com'), {
      code: 'USER_PROFILE_UNAVAILABLE',
    }));
    const ctx = makeCtx({ targetUserId: 7 });

    await pipelineController.start(ctx);

    expect(ctx.status).toBe(409);
    expect(ctx.body).toEqual({ ok: false, code: 'USER_PROFILE_UNAVAILABLE', message: expect.any(String) });
    expect(JSON.stringify(ctx.body)).not.toContain('secret@example.com');
  });

  it('sanitizes status and cancellation responses', async () => {
    const privateState = {
      run_id: 'run-1',
      target_user_id: 7,
      filter_snapshot: { profiles: [{ userId: 7 }], hash: 'secret-snapshot' },
      filter_snapshot_hash: 'hash-1',
      filter_snapshot_scope: 'single',
      filter_snapshot_schema_version: 1,
      filter_snapshot_window_end_at: '2026-08-07T10:00:00.000Z',
      status: 'running', stage: 'parsing_scan', job_ids: [11], errors: [],
    } as any;
    mockPipeline.getState.mockResolvedValue(privateState);

    const statusCtx = makeCtx(undefined);
    await pipelineController.status(statusCtx);
    const cancelCtx = makeCtx(undefined);
    await pipelineController.cancel(cancelCtx);

    for (const body of [statusCtx.body, cancelCtx.body]) {
      const serialized = JSON.stringify(body);
      expect(serialized).not.toContain('secret-snapshot');
      expect(serialized).not.toContain('userId');
      expect(serialized).not.toContain('target_user_id');
      expect(body.state).toMatchObject({
        filter_snapshot_hash: 'hash-1',
        filter_snapshot_scope: 'single',
        filter_snapshot_schema_version: 1,
        filter_snapshot_window_end_at: '2026-08-07T10:00:00.000Z',
      });
    }
  });

  it.each(['cancel', 'reset'] as const)('refuses to %s a catalog cleanup maintenance lifecycle', async action => {
    mockPipeline.getState.mockResolvedValue({
      status: 'cancelling',
      stage: 'idle',
      run_id: 'catalog-cleanup:owned',
      job_ids: [],
      errors: [],
    });
    const ctx = makeCtx(undefined);

    await pipelineController[action](ctx);

    expect(ctx.status).toBe(409);
    expect(ctx.body).toEqual({
      ok: false,
      code: 'PIPELINE_MAINTENANCE_LOCKED',
      message: 'Выполняется обслуживание каталога.',
    });
    expect(mockPipeline.cancel).not.toHaveBeenCalled();
    expect(mockPipeline.forceReset).not.toHaveBeenCalled();
  });
});
