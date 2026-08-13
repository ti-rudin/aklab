import { describe, expect, it, vi } from 'vitest';
import { emptyState, getState, sanitizePipelineState, tryReleaseOwnedState } from '../state';

describe('pipeline state snapshot privacy', () => {
  it('initializes digest outcome counters to zero in durable and sanitized state', () => {
    const state = emptyState();

    expect(state).toMatchObject({
      digest_scheduled: 0,
      digest_sent: 0,
      digest_skipped: 0,
      digest_failed: 0,
    });
    expect(sanitizePipelineState(state)).toMatchObject({
      digest_scheduled: 0,
      digest_sent: 0,
      digest_skipped: 0,
      digest_failed: 0,
    });
  });

  it('keeps snapshot metadata but never exposes the full snapshot or user ids', () => {
    const state = {
      ...emptyState(),
      run_id: 'run-1',
      filter_snapshot: {
        schemaVersion: 1,
        scope: 'single',
        createdAt: '2026-08-07T10:00:00.000Z',
        windowEndAt: '2026-08-07T10:00:00.000Z',
        profiles: [{ userId: 77, profileId: 88 }],
        hash: 'a'.repeat(64),
      },
      filter_snapshot_hash: 'a'.repeat(64),
      filter_snapshot_scope: 'single',
      filter_snapshot_schema_version: 1,
      filter_snapshot_window_end_at: '2026-08-07T10:00:00.000Z',
      target_user_id: 77,
      profile_ids: [77, 88],
      job_ids: [11],
      errors: ['one error'],
      sources_total: 2,
      sources_done: 1,
      digest_scheduled: 7,
      digest_sent: 3,
      digest_skipped: 2,
      digest_failed: 2,
    } as any;

    const sanitized = sanitizePipelineState(state);

    expect(sanitized).toMatchObject({
      run_id: 'run-1',
      filter_snapshot_hash: 'a'.repeat(64),
      filter_snapshot_scope: 'single',
      filter_snapshot_schema_version: 1,
      filter_snapshot_window_end_at: '2026-08-07T10:00:00.000Z',
      sources_total: 2,
      sources_done: 1,
      digest_scheduled: 7,
      digest_sent: 3,
      digest_skipped: 2,
      digest_failed: 2,
    });
    expect(Object.hasOwn(sanitized, 'filter_snapshot')).toBe(false);
    expect(Object.hasOwn(sanitized, 'target_user_id')).toBe(false);
    expect(Object.hasOwn(sanitized, 'profile_ids')).toBe(false);
    expect(JSON.stringify(sanitized)).not.toContain('77');
    expect(JSON.stringify(sanitized)).not.toContain('88');

    sanitized.job_ids.push(12);
    sanitized.errors.push('two errors');
    expect(state.job_ids).toEqual([11]);
    expect(state.errors).toEqual(['one error']);
  });

  it('preserves valid digest outcome counters and defaults missing or invalid values to zero on reload', async () => {
    const findOne = vi.fn().mockResolvedValue({
      pipeline_state: {
        ...emptyState(),
        digest_scheduled: 7,
        digest_sent: 3,
        digest_skipped: 2,
        digest_failed: 2,
      },
    });
    const strapi = { db: { query: vi.fn().mockReturnValue({ findOne }) } } as any;

    await expect(getState(strapi)).resolves.toMatchObject({
      digest_scheduled: 7,
      digest_sent: 3,
      digest_skipped: 2,
      digest_failed: 2,
    });

    findOne.mockResolvedValueOnce({
      pipeline_state: {
        digest_scheduled: -1,
        digest_sent: 1.5,
        digest_skipped: '2',
        digest_failed: Number.POSITIVE_INFINITY,
      },
    });

    await expect(getState(strapi)).resolves.toMatchObject({
      digest_scheduled: 0,
      digest_sent: 0,
      digest_skipped: 0,
      digest_failed: 0,
    });
  });

  it('returns a blocking recovery state instead of idle when durable state is unreadable', async () => {
    const strapi = {
      db: { query: vi.fn().mockReturnValue({ findOne: vi.fn().mockResolvedValue({ pipeline_state: '{broken-json' }) }) },
    } as any;

    const state = await getState(strapi);

    expect(state.status).toBe('cancelling');
    expect(state.stage).toBe('error');
    expect(state.run_id).toBeNull();
    expect(state.message).toContain('восстанов');
  });

  it('releases a lifecycle only when the durable run id is still owned by the caller', async () => {
    const raw = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: 1 }] })
      .mockResolvedValueOnce({ rows: [] });
    const strapi = {
      db: {
        query: vi.fn().mockReturnValue({ findOne: vi.fn().mockResolvedValue({ id: 1 }) }),
        connection: { raw },
      },
    } as any;
    const idle = { ...emptyState(), updated_at: '2026-08-13T00:00:00.000Z' };

    await expect(tryReleaseOwnedState(strapi, 'catalog-cleanup:owned', idle)).resolves.toBe(true);
    await expect(tryReleaseOwnedState(strapi, 'catalog-cleanup:stale', idle)).resolves.toBe(false);

    expect(raw).toHaveBeenNthCalledWith(1, expect.stringContaining("json_extract(pipeline_state, '$.run_id') = ?"), [
      JSON.stringify(idle),
      idle.updated_at,
      1,
      'catalog-cleanup:owned',
    ]);
  });
});
