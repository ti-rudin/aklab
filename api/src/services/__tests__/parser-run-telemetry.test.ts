import { describe, expect, it, vi } from 'vitest';
import { createParserRunTelemetry } from '../parser-run-telemetry';

describe('parser run telemetry', () => {
  it('creates a queued source-stage record with a stable run/source/stage identity', async () => {
    const findOne = vi.fn().mockResolvedValue(null);
    const create = vi.fn().mockResolvedValue({ id: 7, identity_key: 'run-1:fabrikant:scan' });
    const telemetry = createParserRunTelemetry({
      db: { query: vi.fn().mockReturnValue({ findOne, create }) },
    } as any);

    await telemetry.ensureSourceStage({
      runId: 'run-1',
      sourceSlug: 'fabrikant',
      stage: 'scan',
      jobId: 41,
      parserRunId: 3,
      sourceId: 8,
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        identity_key: 'run-1:fabrikant:scan',
        source_slug: 'fabrikant',
        stage: 'scan',
        job_id: 41,
        status: 'queued',
        parser_run: 3,
        source: 8,
        listed: 0,
        eligible: 0,
        existing: 0,
        pre_filtered: 0,
        details_attempted: 0,
        details_ok: 0,
        created: 0,
        skipped: 0,
        failed: 0,
      }),
    });
  });

  it('reuses an existing source-stage identity without creating a duplicate', async () => {
    const existing = { id: 7, identity_key: 'run-1:fabrikant:scan', job_id: 41, status: 'queued' };
    const findOne = vi.fn().mockResolvedValue(existing);
    const create = vi.fn();
    const telemetry = createParserRunTelemetry({
      db: { query: vi.fn().mockReturnValue({ findOne, create }) },
    } as any);

    await expect(telemetry.ensureSourceStage({
      runId: 'run-1', sourceSlug: 'fabrikant', stage: 'scan', jobId: 41,
    })).resolves.toBe(existing);

    expect(findOne).toHaveBeenCalledWith({ where: { identity_key: 'run-1:fabrikant:scan' } });
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects a terminal update from a different queue job', async () => {
    const update = vi.fn();
    const telemetry = createParserRunTelemetry({
      db: { query: vi.fn().mockReturnValue({
        findOne: vi.fn().mockResolvedValue({ id: 7, identity_key: 'run-1:fabrikant:scan', job_id: 41, status: 'running' }),
        update,
      }) },
    } as any);

    await expect(telemetry.finishSourceStage({
      runId: 'run-1', sourceSlug: 'fabrikant', stage: 'scan', jobId: 42,
      status: 'success', counters: { listed: 10, eligible: 4, existing: 3, pre_filtered: 3, details_attempted: 0, details_ok: 0, created: 0, skipped: 0, failed: 0 },
    })).rejects.toThrow('does not own telemetry row');

    expect(update).not.toHaveBeenCalled();
  });

  it('persists an exact terminal counter snapshot once and never reopens the row', async () => {
    const update = vi.fn().mockResolvedValue({ id: 7, status: 'success' });
    const terminal = { id: 7, identity_key: 'run-1:fabrikant:scan', job_id: 41, status: 'success' };
    const findOne = vi.fn()
      .mockResolvedValueOnce({ id: 7, identity_key: 'run-1:fabrikant:scan', job_id: 41, status: 'running' })
      .mockResolvedValueOnce(terminal);
    const telemetry = createParserRunTelemetry({
      db: { query: vi.fn().mockReturnValue({ findOne, update }) },
    } as any);
    const counters = { listed: 10, eligible: 4, existing: 3, pre_filtered: 3, details_attempted: 0, details_ok: 0, created: 0, skipped: 0, failed: 0 };

    await telemetry.finishSourceStage({
      runId: 'run-1', sourceSlug: 'fabrikant', stage: 'scan', jobId: 41, status: 'success', counters,
    });
    await expect(telemetry.markSourceStageRunning({ runId: 'run-1', sourceSlug: 'fabrikant', stage: 'scan', jobId: 41 }))
      .resolves.toBe(terminal);

    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 7 },
      data: expect.objectContaining({ status: 'success', finished_at: expect.any(String), ...counters }),
    }));
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('reuses the concurrent winner when the unique identity insert races', async () => {
    const winner = { id: 7, identity_key: 'run-1:fabrikant:scan', job_id: null, status: 'queued' };
    const findOne = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(winner);
    const create = vi.fn().mockRejectedValue(new Error('SQLITE_CONSTRAINT: UNIQUE constraint failed: parser_run_sources.identity_key'));
    const telemetry = createParserRunTelemetry({
      db: { query: vi.fn().mockReturnValue({ findOne, create }) },
    } as any);

    await expect(telemetry.ensureSourceStage({ runId: 'run-1', sourceSlug: 'fabrikant', stage: 'scan' })).resolves.toBe(winner);
    expect(findOne).toHaveBeenCalledTimes(2);
  });

  it('creates a parser run once for the immutable run id', async () => {
    const findOne = vi.fn().mockResolvedValue(null);
    const create = vi.fn().mockResolvedValue({ id: 3, run_id: 'run-1' });
    const telemetry = createParserRunTelemetry({
      db: { query: vi.fn().mockReturnValue({ findOne, create }) },
    } as any);

    await telemetry.ensureParserRun({ runId: 'run-1', mode: 'full', trigger: 'manual' });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        run_id: 'run-1', mode: 'full', trigger: 'manual', status: 'running', started_at: expect.any(String),
      }),
    });
  });

  it('finishes a parser run with an immutable terminal outcome', async () => {
    const update = vi.fn().mockResolvedValue({ id: 3, status: 'succeeded' });
    const telemetry = createParserRunTelemetry({
      db: { query: vi.fn().mockReturnValue({ findOne: vi.fn().mockResolvedValue({ id: 3, status: 'running' }), update }) },
    } as any);

    await telemetry.finishParserRun({ runId: 'run-1', status: 'succeeded' });

    expect(update).toHaveBeenCalledWith({
      where: { id: 3 },
      data: { status: 'succeeded', finished_at: expect.any(String) },
    });
  });

  it('reconciles a worker success to the queue terminal failure for the same job', async () => {
    const update = vi.fn().mockResolvedValue({ id: 7, status: 'cancelled' });
    const telemetry = createParserRunTelemetry({
      db: { query: vi.fn().mockReturnValue({
        findOne: vi.fn().mockResolvedValue({ id: 7, identity_key: 'run-1:fabrikant:scan', job_id: 41, status: 'success' }),
        update,
      }) },
    } as any);

    await telemetry.reconcileSourceStageQueueFailure({
      runId: 'run-1', sourceSlug: 'fabrikant', stage: 'scan', jobId: 41,
      cancelled: true, errorMessage: 'Cancellation requested',
    });

    expect(update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: expect.objectContaining({ status: 'cancelled', error_message: 'Cancellation requested', finished_at: expect.any(String) }),
    });
  });

  it('attaches the exact numeric queue job to a pre-enqueued identity', async () => {
    const row = { id: 7, identity_key: 'run-1:fabrikant:scan', job_id: null, status: 'queued' };
    const findOne = vi.fn().mockResolvedValue(row);
    const update = vi.fn().mockResolvedValue({ ...row, job_id: 41 });
    const telemetry = createParserRunTelemetry({
      db: { query: vi.fn().mockReturnValue({ findOne, update }) },
    } as any);

    await telemetry.attachSourceStageJob({ runId: 'run-1', sourceSlug: 'fabrikant', stage: 'scan', jobId: 41 });

    expect(update).toHaveBeenCalledWith({ where: { id: 7 }, data: { job_id: 41 } });
  });

  it('creates a pre-enqueued source-stage record without a queue job id', async () => {
    const findOne = vi.fn().mockResolvedValue(null);
    const create = vi.fn().mockResolvedValue({ id: 7, identity_key: 'run-1:fabrikant:scan', job_id: null });
    const telemetry = createParserRunTelemetry({
      db: { query: vi.fn().mockReturnValue({ findOne, create }) },
    } as any);

    await telemetry.ensureSourceStage({ runId: 'run-1', sourceSlug: 'fabrikant', stage: 'scan', parserRunId: 3, sourceId: 8 });

    const createdData = create.mock.calls[0][0].data;
    expect(Object.hasOwn(createdData, 'job_id')).toBe(false);
  });
});
