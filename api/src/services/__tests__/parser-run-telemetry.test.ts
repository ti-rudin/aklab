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
      status: 'success', counters: { listed: 10, eligible: 4, existing: 3, pre_filtered: 3, details_attempted: 0, details_ok: 0, created: 0, skipped: 0, failed: 0, property_block_found: 0, location_label_found: 0, location_confirmed_address: 0, location_confirmed_region_only: 0, location_missing: 0, location_unresolved: 0, schema_mismatch: 0 },
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
    const counters = { listed: 10, eligible: 4, existing: 3, pre_filtered: 3, details_attempted: 0, details_ok: 0, created: 0, skipped: 0, failed: 0, property_block_found: 0, location_label_found: 0, location_confirmed_address: 0, location_confirmed_region_only: 0, location_missing: 0, location_unresolved: 0, schema_mismatch: 0 };

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

  it('persists immutable filter snapshot metadata and rejects a conflicting overwrite', async () => {
    const snapshot = {
      schemaVersion: 1,
      scope: 'single',
      createdAt: '2026-08-07T10:00:00.000Z',
      windowEndAt: '2026-08-07T10:00:00.000Z',
      profiles: [],
      hash: 'a'.repeat(64),
    } as any;
    const update = vi.fn().mockResolvedValue({ id: 3, run_id: 'run-1', profile_scope: 'single' });
    const findOne = vi.fn()
      .mockResolvedValueOnce({ id: 3, run_id: 'run-1', status: 'running' })
      .mockResolvedValueOnce({ id: 3, run_id: 'run-1', status: 'running', profile_scope: 'single', filter_snapshot_hash: snapshot.hash, filter_snapshot_schema_version: 1, filter_snapshot: snapshot, target_user_id: 7 })
      .mockResolvedValueOnce({ id: 3, run_id: 'run-1', status: 'running', profile_scope: 'single', filter_snapshot_hash: 'b'.repeat(64), filter_snapshot_schema_version: 1, filter_snapshot: { ...snapshot, hash: 'b'.repeat(64) }, target_user_id: 7 });
    const telemetry = createParserRunTelemetry({
      db: { query: vi.fn().mockReturnValue({ findOne, update }) },
    } as any);

    await telemetry.ensureParserRunSnapshot({
      runId: 'run-1',
      profileScope: 'single',
      targetUserId: 7,
      snapshot,
    });

    expect(update).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 3,
        profile_scope: null,
        target_user_id: null,
        filter_snapshot: null,
        filter_snapshot_hash: null,
        filter_snapshot_schema_version: null,
      }),
      data: expect.objectContaining({
        profile_scope: 'single',
        target_user_id: 7,
        filter_snapshot: snapshot,
        filter_snapshot_hash: snapshot.hash,
        filter_snapshot_schema_version: 1,
      }),
    });

    await expect(telemetry.ensureParserRunSnapshot({
      runId: 'run-1', profileScope: 'single', targetUserId: 7, snapshot,
    })).resolves.toBeDefined();
    await expect(telemetry.ensureParserRunSnapshot({
      runId: 'run-1', profileScope: 'single', targetUserId: 7, snapshot,
    })).rejects.toThrow('snapshot');
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('rejects a concurrent conflicting snapshot after the conditional first write loses the race', async () => {
    const first = { id: 3, run_id: 'run-1', status: 'running' };
    const winner = {
      id: 3,
      run_id: 'run-1',
      profile_scope: 'single',
      target_user_id: 8,
      filter_snapshot_hash: 'b'.repeat(64),
      filter_snapshot_schema_version: 1,
      filter_snapshot: { schemaVersion: 1, scope: 'single', profiles: [], hash: 'b'.repeat(64) },
    };
    const findOne = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(winner);
    const update = vi.fn().mockResolvedValue(null);
    const telemetry = createParserRunTelemetry({
      db: { query: vi.fn().mockReturnValue({ findOne, update }) },
    } as any);
    const snapshot = {
      schemaVersion: 1,
      scope: 'single',
      createdAt: '2026-08-07T10:00:00.000Z',
      windowEndAt: '2026-08-07T10:00:00.000Z',
      profiles: [],
      hash: 'a'.repeat(64),
    } as any;

    await expect(telemetry.ensureParserRunSnapshot({
      runId: 'run-1', profileScope: 'single', targetUserId: 7, snapshot,
    })).rejects.toThrow('snapshot');
    expect(findOne).toHaveBeenCalledTimes(2);
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
      data: expect.objectContaining({ status: 'cancelled', error_message: 'parser.cancelled', finished_at: expect.any(String) }),
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

  it('persists one immutable digest window for a running parser run', async () => {
    const windowEndAt = '2026-08-07T12:30:00.000Z';
    const update = vi.fn().mockResolvedValue({ id: 3, status: 'running', digest_window_end_at: windowEndAt });
    const findOne = vi.fn().mockResolvedValue({ id: 3, run_id: 'run-1', status: 'running', digest_window_end_at: null });
    const telemetry = createParserRunTelemetry({
      db: { query: vi.fn().mockReturnValue({ findOne, update }) },
    } as any);

    await telemetry.setDigestWindowEndAt({ runId: 'run-1', windowEndAt });

    expect(update).toHaveBeenCalledWith({
      where: { id: 3, status: 'running', digest_window_end_at: null },
      data: { digest_window_end_at: windowEndAt },
    });
  });

  it('persists valid digest counters through the Query Engine for a running parser run', async () => {
    const update = vi.fn().mockResolvedValue({ id: 3, status: 'running', digest_scheduled: 3 });
    const findOne = vi.fn().mockResolvedValue({ id: 3, run_id: 'run-1', status: 'running' });
    const query = vi.fn().mockReturnValue({ findOne, update });
    const telemetry = createParserRunTelemetry({ db: { query } } as any);

    await telemetry.setDigestCounters({ runId: 'run-1', scheduled: 3, sent: 1, skipped: 1, failed: 1 });

    expect(query).toHaveBeenCalledWith('api::parser-run.parser-run');
    expect(update).toHaveBeenCalledWith({
      where: {
        id: 3,
        status: 'running',
        digest_scheduled: 0,
        digest_sent: 0,
        digest_skipped: 0,
        digest_failed: 0,
      },
      data: { digest_scheduled: 3, digest_sent: 1, digest_skipped: 1, digest_failed: 1 },
    });
  });

  it('accepts only an exact replay and rejects conflicting persisted digest counters', async () => {
    const update = vi.fn();
    const findOne = vi.fn().mockResolvedValue({
      id: 3,
      run_id: 'run-1',
      status: 'running',
      digest_scheduled: 3,
      digest_sent: 1,
      digest_skipped: 1,
      digest_failed: 1,
    });
    const telemetry = createParserRunTelemetry({
      db: { query: vi.fn().mockReturnValue({ findOne, update }) },
    } as any);

    await expect(telemetry.setDigestCounters({ runId: 'run-1', scheduled: 3, sent: 1, skipped: 1, failed: 1 }))
      .resolves.toMatchObject({ digest_scheduled: 3 });
    await expect(telemetry.setDigestCounters({ runId: 'run-1', scheduled: 3, sent: 2, skipped: 1, failed: 0 }))
      .rejects.toThrow(/digest counters/i);
    expect(update).not.toHaveBeenCalled();
  });

  it('accepts an exact concurrent CAS winner but never overwrites it', async () => {
    const winner = {
      id: 3,
      run_id: 'run-1',
      status: 'running',
      digest_scheduled: 2,
      digest_sent: 1,
      digest_skipped: 1,
      digest_failed: 0,
    };
    const findOne = vi.fn()
      .mockResolvedValueOnce({
        id: 3,
        run_id: 'run-1',
        status: 'running',
        digest_scheduled: 0,
        digest_sent: 0,
        digest_skipped: 0,
        digest_failed: 0,
      })
      .mockResolvedValueOnce(winner);
    const update = vi.fn().mockResolvedValue(null);
    const telemetry = createParserRunTelemetry({
      db: { query: vi.fn().mockReturnValue({ findOne, update }) },
    } as any);

    await expect(telemetry.setDigestCounters({ runId: 'run-1', scheduled: 2, sent: 1, skipped: 1, failed: 0 }))
      .resolves.toBe(winner);
    expect(update).toHaveBeenCalledTimes(1);
    expect(findOne).toHaveBeenCalledTimes(2);
  });

  it('rejects unsafe digest counters and invariant violations before querying', async () => {
    const query = vi.fn();
    const telemetry = createParserRunTelemetry({ db: { query } } as any);
    const base = { runId: 'run-1', scheduled: 1, sent: 1, skipped: 0, failed: 0 };

    await expect(telemetry.setDigestCounters({ ...base, sent: -1 })).rejects.toThrow(/digest counters/i);
    await expect(telemetry.setDigestCounters({ ...base, scheduled: 2 })).rejects.toThrow(/digest counters/i);
    await expect(telemetry.setDigestCounters({ ...base, failed: Number.MAX_SAFE_INTEGER + 1 })).rejects.toThrow(/digest counters/i);
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects missing and non-running parser runs without changing terminal telemetry', async () => {
    const missingQuery = vi.fn().mockReturnValue({ findOne: vi.fn().mockResolvedValue(null), update: vi.fn() });
    const missingTelemetry = createParserRunTelemetry({ db: { query: missingQuery } } as any);
    await expect(missingTelemetry.setDigestCounters({ runId: 'run-missing', scheduled: 0, sent: 0, skipped: 0, failed: 0 }))
      .rejects.toThrow(/parser run/i);

    const update = vi.fn();
    const terminalQuery = vi.fn().mockReturnValue({
      findOne: vi.fn().mockResolvedValue({ id: 3, run_id: 'run-1', status: 'succeeded' }),
      update,
    });
    const terminalTelemetry = createParserRunTelemetry({ db: { query: terminalQuery } } as any);
    await expect(terminalTelemetry.setDigestCounters({ runId: 'run-1', scheduled: 0, sent: 0, skipped: 0, failed: 0 }))
      .rejects.toThrow(/running/i);
    expect(update).not.toHaveBeenCalled();
  });
});
