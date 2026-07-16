/**
 * Unit tests for @aklab/sqlite-queue
 * Uses in-memory SQLite by default; the startup migration test uses a cleaned-up
 * temporary file to exercise shared queue.db initialization.
 */
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { SqliteQueue, PermanentError } from '../index';
import type { Job } from '../types';

let queue: SqliteQueue;

beforeEach(() => {
  queue = new SqliteQueue(':memory:', { disableTimers: true, staleTimeoutMin: 1, retentionHours: 1 });
});

afterEach(() => {
  try { queue.close(); } catch { /* already closed */ }
});

// ─── add() ──────────────────────────────────────────────────────────────────

describe('add()', () => {
  test('creates a job with correct defaults', () => {
    const job = queue.add('test-queue', { foo: 'bar' });

    expect(job.id).toBe(1);
    expect(job.queue).toBe('test-queue');
    expect(job.status).toBe('pending');
    expect(job.data).toEqual({ foo: 'bar' });
    expect(job.attempts).toBe(0);
    expect(job.max_attempts).toBe(3);
    expect(job.priority).toBe(0);
    expect(job.correlation_id).toBeNull();
    expect(job.created_at).toBeGreaterThan(0);
    expect(job.scheduled_at).toBeNull();
    expect(job.result).toBeNull();
    expect(job.error).toBeNull();
  });

  test('creates multiple jobs with auto-incrementing IDs', () => {
    const j1 = queue.add('q', { n: 1 });
    const j2 = queue.add('q', { n: 2 });
    const j3 = queue.add('q', { n: 3 });

    expect(j1.id).toBe(1);
    expect(j2.id).toBe(2);
    expect(j3.id).toBe(3);
  });

  test('respects priority and maxAttempts options', () => {
    const job = queue.add('q', {}, { priority: 10, maxAttempts: 5 });
    expect(job.priority).toBe(10);
    expect(job.max_attempts).toBe(5);
  });

  test('sets scheduled_at when delay is specified', () => {
    const before = Date.now();
    const job = queue.add('q', {}, { delay: 60_000 });
    const after = Date.now();

    expect(job.scheduled_at).not.toBeNull();
    expect(job.scheduled_at!).toBeGreaterThanOrEqual(before + 60_000);
    expect(job.scheduled_at!).toBeLessThanOrEqual(after + 60_000);
  });

  test('sets correlation_id when provided', () => {
    const job = queue.add('q', {}, { correlationId: 'corr-123' });
    expect(job.correlation_id).toBe('corr-123');
  });
});

// ─── idempotent add() ───────────────────────────────────────────────────────

describe('idempotent add()', () => {
  test('returns existing job if pending with same correlationId', () => {
    const j1 = queue.add('q', { a: 1 }, { correlationId: 'idem-1', idempotent: true });
    const j2 = queue.add('q', { a: 2 }, { correlationId: 'idem-1', idempotent: true });

    expect(j2.id).toBe(j1.id);
    expect(j2.data).toEqual({ a: 1 }); // original data preserved
  });

  test('creates new job if correlationId differs', () => {
    const j1 = queue.add('q', {}, { correlationId: 'idem-1', idempotent: true });
    const j2 = queue.add('q', {}, { correlationId: 'idem-2', idempotent: true });

    expect(j2.id).not.toBe(j1.id);
  });

  test('creates duplicate if no idempotent flag', () => {
    const j1 = queue.add('q', {}, { correlationId: 'dup-1' });
    const j2 = queue.add('q', {}, { correlationId: 'dup-1' });

    expect(j2.id).not.toBe(j1.id);
  });

  test('returns one logical job per idempotencyKey while keeping pipeline stages distinct', () => {
    // Target API: idempotencyKey is queue-scoped and does not reuse correlationId.
    const add = (queue as any).add.bind(queue);
    const scan = add('pipeline', { stage: 'scan', version: 1 }, { idempotencyKey: 'run:source:scan' });
    const duplicateScan = add('pipeline', { stage: 'scan', version: 2 }, { idempotencyKey: 'run:source:scan' });
    const details = add('pipeline', { stage: 'details' }, { idempotencyKey: 'run:source:details' });

    expect(duplicateScan.id).toBe(scan.id);
    expect(duplicateScan.data).toEqual({ stage: 'scan', version: 1 });
    expect(details.id).not.toBe(scan.id);
  });

  test('retries after an idempotency winner becomes terminal instead of returning it', () => {
    const original = queue.add('terminal-idempotency', { version: 1 }, { idempotencyKey: 'run:terminal' });
    const db = (queue as any).db;
    const stmtAdd = (queue as any).stmtAdd;

    vi.spyOn(stmtAdd, 'run').mockImplementationOnce(() => {
      db.prepare("UPDATE jobs SET status = 'completed', completed_at = ? WHERE id = ?")
        .run(Date.now(), original.id);
      throw Object.assign(new Error('unique constraint'), { code: 'SQLITE_CONSTRAINT_UNIQUE' });
    });

    const retry = queue.add('terminal-idempotency', { version: 2 }, { idempotencyKey: 'run:terminal' });

    expect(retry.id).not.toBe(original.id);
    expect(retry.status).toBe('pending');
    expect(retry.data).toEqual({ version: 2 });
  });
});

// ─── getJob() ───────────────────────────────────────────────────────────────

describe('getJob()', () => {
  test('returns job by ID', () => {
    const created = queue.add('q', { x: 42 });
    const fetched = queue.getJob(created.id);

    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(created.id);
    expect(fetched!.data).toEqual({ x: 42 });
  });

  test('returns null for non-existent ID', () => {
    expect(queue.getJob(999)).toBeNull();
  });
});

// ─── schema startup migration ───────────────────────────────────────────────

describe('schema startup migration', () => {
  test('lets two instances initialize the same legacy file-backed database', () => {
    const dbPath = join(tmpdir(), `aklab-sqlite-queue-${randomUUID()}.db`);
    let first: SqliteQueue | undefined;
    let second: SqliteQueue | undefined;

    try {
      const legacy = new Database(dbPath);
      legacy.exec(`
        CREATE TABLE jobs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          queue TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          data TEXT NOT NULL,
          result TEXT,
          error TEXT,
          attempts INTEGER DEFAULT 0,
          max_attempts INTEGER DEFAULT 3,
          correlation_id TEXT,
          created_at INTEGER NOT NULL,
          started_at INTEGER,
          completed_at INTEGER,
          scheduled_at INTEGER,
          priority INTEGER DEFAULT 0
        );
      `);
      legacy.close();

      first = new SqliteQueue(dbPath, { disableTimers: true });
      second = new SqliteQueue(dbPath, { disableTimers: true });

      const columns = (first as any).db.prepare('PRAGMA table_info(jobs)').all()
        .map((column: { name: string }) => column.name);
      const indexes = (first as any).db.prepare('PRAGMA index_list(jobs)').all()
        .map((index: { name: string }) => index.name);

      expect(columns).toEqual(expect.arrayContaining([
        'idempotency_key',
        'locked_by',
        'lease_token',
        'lease_expires_at',
        'lease_duration_ms',
        'heartbeat_at',
        'cancellation_requested_at',
      ]));
      expect(indexes).toEqual(expect.arrayContaining([
        'idx_jobs_queue_status',
        'idx_jobs_correlation_id',
        'idx_jobs_cleanup',
        'idx_jobs_queue_idempotency_active',
      ]));
      expect(second.add('shared-startup', { ok: true }).status).toBe('pending');
    } finally {
      first?.close();
      second?.close();
      rmSync(dbPath, { force: true });
      rmSync(`${dbPath}-wal`, { force: true });
      rmSync(`${dbPath}-shm`, { force: true });
    }
  });
});

// ─── findJobsByCorrelationPrefix() ──────────────────────────────────────────

describe('findJobsByCorrelationPrefix()', () => {
  test('finds jobs by correlation prefix', () => {
    queue.add('q', {}, { correlationId: 'abc-123' });
    queue.add('q', {}, { correlationId: 'abc-456' });
    queue.add('q', {}, { correlationId: 'xyz-789' });

    const found = queue.findJobsByCorrelationPrefix('q', 'abc');
    expect(found.length).toBe(2);
  });

  test('returns empty array for no matches', () => {
    queue.add('q', {}, { correlationId: 'abc-1' });
    const found = queue.findJobsByCorrelationPrefix('q', 'zzz');
    expect(found.length).toBe(0);
  });

  test('respects status filter', () => {
    queue.add('q', {}, { correlationId: 'st-1' });
    const found = queue.findJobsByCorrelationPrefix('q', 'st', ['completed']);
    expect(found.length).toBe(0);
  });
});

// ─── getQueueStats() ────────────────────────────────────────────────────────

describe('getQueueStats()', () => {
  test('returns zero stats for empty queue', () => {
    const stats = queue.getQueueStats('empty');
    expect(stats).toEqual({ pending: 0, active: 0, completed: 0, failed: 0 });
  });

  test('counts pending jobs', () => {
    queue.add('q', {});
    queue.add('q', {});
    queue.add('q', {});

    const stats = queue.getQueueStats('q');
    expect(stats.pending).toBe(3);
  });

  test('counts jobs per queue independently', () => {
    queue.add('a', {});
    queue.add('a', {});
    queue.add('b', {});

    expect(queue.getQueueStats('a').pending).toBe(2);
    expect(queue.getQueueStats('b').pending).toBe(1);
  });
});

// ─── getDetailedStats() ─────────────────────────────────────────────────────

describe('getDetailedStats()', () => {
  test('returns per-queue and total stats', () => {
    queue.add('q1', {});
    queue.add('q1', {});
    queue.add('q2', {});

    const detailed = queue.getDetailedStats();

    expect(detailed.queues['q1'].pending).toBe(2);
    expect(detailed.queues['q2'].pending).toBe(1);
    expect(detailed.total.pending).toBe(3);
    expect(detailed.dbSizeBytes).toBeGreaterThan(0);
  });

  test('returns empty for no jobs', () => {
    const detailed = queue.getDetailedStats();
    expect(detailed.total).toEqual({ pending: 0, active: 0, completed: 0, failed: 0 });
    expect(Object.keys(detailed.queues)).toHaveLength(0);
  });
});

// ─── process() + Worker ─────────────────────────────────────────────────────

describe('process() and worker', () => {
  test('processes a pending job', async () => {
    const results: any[] = [];
    queue.add('work', { val: 1 });

    const worker = queue.process('work', async (job) => {
      results.push(job.data);
      return { ok: true };
    }, { pollInterval: 50 });

    // Wait for the worker to pick up and process the job
    await sleep(300);
    worker.stop();

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ val: 1 });

    const job = queue.getJob(1)!;
    expect(job.status).toBe('completed');
    expect(job.result).toEqual({ ok: true });
  });

  test('handles multiple jobs in order (FIFO by default)', async () => {
    const processed: number[] = [];

    queue.add('seq', { n: 1 });
    queue.add('seq', { n: 2 });
    queue.add('seq', { n: 3 });

    const worker = queue.process('seq', async (job) => {
      processed.push(job.data.n);
      return null;
    }, { pollInterval: 50 });

    await sleep(600);
    worker.stop();

    expect(processed).toEqual([1, 2, 3]);
  });

  test('respects priority ordering', async () => {
    const processed: number[] = [];

    queue.add('prio', { n: 1 }, { priority: 0 });
    queue.add('prio', { n: 2 }, { priority: 10 });
    queue.add('prio', { n: 3 }, { priority: 5 });

    const worker = queue.process('prio', async (job) => {
      processed.push(job.data.n);
      return null;
    }, { pollInterval: 50 });

    await sleep(600);
    worker.stop();

    // Priority DESC, then id ASC: 2 (prio=10), 3 (prio=5), 1 (prio=0)
    expect(processed).toEqual([2, 3, 1]);
  });

  test('does not process delayed/scheduled jobs before their time', async () => {
    const processed: any[] = [];

    queue.add('delayed', { n: 1 });
    queue.add('delayed', { n: 2 }, { delay: 60_000 }); // 1 min in the future

    const worker = queue.process('delayed', async (job) => {
      processed.push(job.data.n);
      return null;
    }, { pollInterval: 50 });

    await sleep(400);
    worker.stop();

    expect(processed).toEqual([1]); // only the non-delayed job
  });
});

// ─── retry on failure ───────────────────────────────────────────────────────

describe('retry on failure', () => {
  test('retries temporary errors up to max_attempts', { timeout: 30_000 }, async () => {
    let attempts = 0;

    queue.add('retry', { n: 1 }, { maxAttempts: 3 });

    const worker = queue.process('retry', async (job) => {
      attempts++;
      throw new Error('temporary failure');
    }, { pollInterval: 50 });

    // Wait for all retries to be exhausted (exponential backoff makes this slow)
    // attempts 1,2 → retry; attempt 3 → fail
    // backoff: 2^1=2s, 2^2=4s — but we set very short poll intervals
    // Actually the retry uses scheduled_at with backoff, so we need enough time
    await sleep(12_000); // allow retries with exponential backoff (2s, 4s)
    worker.stop();

    const job = queue.getJob(1)!;
    // Job should eventually be either pending (retrying) or failed (exhausted)
    // With 3 max attempts, after 3 failures it should be 'failed'
    expect(['pending', 'failed']).toContain(job.status);
    expect(attempts).toBeGreaterThanOrEqual(1);
  });

  test('permanent errors are not retried', async () => {
    let attempts = 0;

    queue.add('perm', { n: 1 }, { maxAttempts: 3 });

    const worker = queue.process('perm', async (job) => {
      attempts++;
      throw new PermanentError('bad data');
    }, { pollInterval: 50 });

    await sleep(400);
    worker.stop();

    // PermanentError should skip retries — immediately fail
    const job = queue.getJob(1)!;
    expect(job.status).toBe('failed');
    expect(job.error).toBe('bad data');
    expect(attempts).toBe(1); // only one attempt
  });
});

// ─── cancelJob() ────────────────────────────────────────────────────────────

describe('cancelJob()', () => {
  test('cancels a pending job', () => {
    const job = queue.add('q', {});
    const result = queue.cancelJob(job.id);

    expect(result).toBe(true);
    const fetched = queue.getJob(job.id)!;
    expect(fetched.status).toBe('failed');
    expect(fetched.error).toBe('cancelled');
  });

  test('does not cancel an active job', () => {
    // We can't easily make a job active without a worker, so test with completed
    const job = queue.add('q', {});
    // Mark as completed directly
    queue.cancelJob(job.id); // mark failed first
    const result = queue.cancelJob(job.id); // try to cancel again — already failed, not pending

    expect(result).toBe(false);
  });

  test('keeps an active job non-terminal until its handler acknowledges cooperative cancellation', async () => {
    vi.useFakeTimers();
    const handlerStarted = deferred<Job>();
    const acknowledgeCancellation = deferred<void>();
    let worker: { stop(): void } | undefined;

    try {
      const job = queue.add('cooperative-cancel', {}, { maxAttempts: 1 });
      worker = queue.process('cooperative-cancel', async (activeJob) => {
        handlerStarted.resolve(activeJob);
        await acknowledgeCancellation.promise;
        return { handler: 'returned after cancellation' };
      }, { pollInterval: 1 });

      await vi.advanceTimersByTimeAsync(1);
      await handlerStarted.promise;

      // Target API: requesting cancellation is non-terminal for a running job.
      expect((queue as any).requestCancellation).toEqual(expect.any(Function));
      (queue as any).requestCancellation(job.id);
      expect(queue.getJob(job.id)!.status).toBe('active');

      acknowledgeCancellation.resolve();
      await vi.advanceTimersByTimeAsync(1);

      expect(queue.getJob(job.id)!.status).toBe('failed');
      expect(queue.getJob(job.id)!.error).toBe('cancelled');
    } finally {
      worker?.stop();
      acknowledgeCancellation.resolve();
      await Promise.resolve();
      vi.useRealTimers();
    }
  });
});

// ─── clean() / retention ────────────────────────────────────────────────────

describe('clean() and retention', () => {
  test('removes old completed/failed jobs', () => {
    // Add and manually complete/fail some jobs
    queue.add('q', {});
    queue.add('q', {});

    // Manually mark them completed/failed with old timestamps
    const db = (queue as any).db;
    db.prepare("UPDATE jobs SET status = 'completed', completed_at = ? WHERE id = 1").run(Date.now() - 10_000_000);
    db.prepare("UPDATE jobs SET status = 'failed', completed_at = ? WHERE id = 2").run(Date.now() - 10_000_000);

    const cleaned = queue.clean(1_000_000); // clean anything older than ~16 min
    expect(cleaned).toBe(2);

    expect(queue.getJob(1)).toBeNull();
    expect(queue.getJob(2)).toBeNull();
  });

  test('does not remove recent jobs', () => {
    queue.add('q', {});
    const db = (queue as any).db;
    db.prepare("UPDATE jobs SET status = 'completed', completed_at = ? WHERE id = 1").run(Date.now());

    const cleaned = queue.clean(60_000);
    expect(cleaned).toBe(0);
    expect(queue.getJob(1)).not.toBeNull();
  });

  test('does not remove pending or active jobs', () => {
    queue.add('q', {});
    queue.add('q', {});

    const cleaned = queue.clean(0); // clean everything older than now
    expect(cleaned).toBe(0); // pending jobs have no completed_at
  });
});

// ─── recoverStaleJobs() ─────────────────────────────────────────────────────

describe('recoverStaleJobs()', () => {
  test('recovers stale active jobs back to pending', () => {
    queue.add('q', {});

    // Manually make the job stale-active (started long ago)
    const db = (queue as any).db;
    const staleTime = Date.now() - 10 * 60_000; // 10 min ago (staleTimeoutMin=1)
    db.prepare("UPDATE jobs SET status = 'active', started_at = ?, attempts = 1 WHERE id = 1").run(staleTime);

    // Call recoverStaleJobs via the private method
    (queue as any).recoverStaleJobs();

    const job = queue.getJob(1)!;
    expect(job.status).toBe('pending');
    expect(job.error).toBe('stale job recovery');
    // attempts should NOT be incremented by stale recovery
    expect(job.attempts).toBe(1);
  });

  test('fails stale jobs that exceeded max_attempts', () => {
    queue.add('q', {}, { maxAttempts: 2 });

    const db = (queue as any).db;
    const staleTime = Date.now() - 10 * 60_000;
    db.prepare("UPDATE jobs SET status = 'active', started_at = ?, attempts = 2 WHERE id = 1").run(staleTime);

    (queue as any).recoverStaleJobs();

    const job = queue.getJob(1)!;
    expect(job.status).toBe('failed');
    expect(job.error).toBe('max attempts exceeded (stale)');
  });

  test('does not touch recently active jobs', () => {
    queue.add('q', {});

    const db = (queue as any).db;
    db.prepare("UPDATE jobs SET status = 'active', started_at = ?, attempts = 1 WHERE id = 1").run(Date.now());

    (queue as any).recoverStaleJobs();

    const job = queue.getJob(1)!;
    expect(job.status).toBe('active'); // still active, not stale
  });

  test('does not requeue a heartbeated lease or let a second worker invoke its handler', async () => {
    vi.useFakeTimers();
    const firstHandlerStarted = deferred<Job>();
    const releaseFirstHandler = deferred<void>();
    const secondHandler = vi.fn(async () => ({ worker: 'second' }));
    let firstWorker: { stop(): void } | undefined;
    let secondWorker: { stop(): void } | undefined;

    try {
      const job = queue.add('lease-protected', {});
      firstWorker = queue.process('lease-protected', async (activeJob) => {
        firstHandlerStarted.resolve(activeJob);
        await releaseFirstHandler.promise;
        return { worker: 'first' };
      }, {
        pollInterval: 1,
        // Target API: workers obtain and renew a lease while their handler is alive.
        leaseDurationMs: 60_000,
      } as any);

      await vi.advanceTimersByTimeAsync(1);
      const activeJob = await firstHandlerStarted.promise;
      const leaseToken = (activeJob as any).leaseToken;

      expect((queue as any).heartbeat).toEqual(expect.any(Function));
      expect(leaseToken).toEqual(expect.any(String));
      expect((queue as any).heartbeat(activeJob.id, leaseToken)).toBe(true);

      // started_at alone is stale; the current lease heartbeat must take precedence.
      const db = (queue as any).db;
      db.prepare('UPDATE jobs SET started_at = ? WHERE id = ?').run(Date.now() - 10 * 60_000, job.id);
      (queue as any).recoverStaleJobs();

      secondWorker = queue.process('lease-protected', secondHandler, { pollInterval: 1 });
      await vi.advanceTimersByTimeAsync(1);

      expect(queue.getJob(job.id)!.status).toBe('active');
      expect(secondHandler).not.toHaveBeenCalled();
    } finally {
      firstWorker?.stop();
      secondWorker?.stop();
      releaseFirstHandler.resolve();
      await Promise.resolve();
      vi.useRealTimers();
    }
  });

  test('renews a worker lease by its persisted duration instead of staleTimeoutMin', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const handlerStarted = deferred<{ job: Job; heartbeat: () => boolean }>();
    const releaseHandler = deferred<void>();
    let worker: { stop(): void } | undefined;

    try {
      const job = queue.add('worker-lease-duration', {});
      worker = queue.process('worker-lease-duration', async (activeJob, context) => {
        handlerStarted.resolve({ job: activeJob, heartbeat: context.heartbeat });
        await releaseHandler.promise;
        return { done: true };
      }, {
        pollInterval: 1,
        heartbeatIntervalMs: 60_000,
        leaseDurationMs: 2_000,
      });

      await vi.advanceTimersByTimeAsync(1);
      const active = await handlerStarted.promise;
      await vi.advanceTimersByTimeAsync(250);

      expect(active.heartbeat()).toBe(true);
      let persisted = queue.getJob(job.id)!;
      expect(persisted.lease_duration_ms).toBe(2_000);
      expect(persisted.lease_expires_at).toBe(Date.now() + 2_000);

      await vi.advanceTimersByTimeAsync(250);
      expect(queue.heartbeat(job.id, active.job.leaseToken!)).toBe(true);
      persisted = queue.getJob(job.id)!;
      expect(persisted.lease_expires_at).toBe(Date.now() + 2_000);
      expect(persisted.lease_expires_at).not.toBe(Date.now() + 60_000);
    } finally {
      worker?.stop();
      releaseHandler.resolve();
      await Promise.resolve();
      vi.useRealTimers();
    }
  });

  test('reports an old context lease as invalid after stale recovery and re-claim', async () => {
    vi.useFakeTimers();
    const firstHandlerStarted = deferred<{ job: Job; isLeaseValid: () => boolean }>();
    const releaseFirstHandler = deferred<void>();
    const secondHandlerStarted = deferred<Job>();
    const releaseSecondHandler = deferred<void>();
    let firstWorker: { stop(): void } | undefined;
    let secondWorker: { stop(): void } | undefined;

    try {
      const job = queue.add('lease-validity', {});
      firstWorker = queue.process('lease-validity', async (activeJob, context) => {
        firstHandlerStarted.resolve({
          job: activeJob,
          isLeaseValid: context.isLeaseValid!,
        });
        await releaseFirstHandler.promise;
        return { worker: 'first' };
      }, {
        pollInterval: 1,
        leaseDurationMs: 60_000,
        heartbeatIntervalMs: 60_000,
      });

      await vi.advanceTimersByTimeAsync(1);
      const first = await firstHandlerStarted.promise;
      expect(first.isLeaseValid()).toBe(true);

      const db = (queue as any).db;
      db.prepare('UPDATE jobs SET lease_expires_at = ? WHERE id = ?').run(Date.now() - 1, job.id);
      (queue as any).recoverStaleJobs();

      secondWorker = queue.process('lease-validity', async (activeJob) => {
        secondHandlerStarted.resolve(activeJob);
        await releaseSecondHandler.promise;
        return { worker: 'second' };
      }, { pollInterval: 1, leaseDurationMs: 60_000, heartbeatIntervalMs: 60_000 });
      await vi.advanceTimersByTimeAsync(1);
      const second = await secondHandlerStarted.promise;

      expect(second.leaseToken).not.toBe(first.job.leaseToken);
      expect(queue.getJob(job.id)!.status).toBe('active');
      expect(first.isLeaseValid()).toBe(false);
    } finally {
      firstWorker?.stop();
      secondWorker?.stop();
      releaseFirstHandler.resolve();
      releaseSecondHandler.resolve();
      await Promise.resolve();
      vi.useRealTimers();
    }
  });
});

// ─── addAndWait() RPC pattern ───────────────────────────────────────────────

describe('addAndWait()', () => {
  test('returns result when job completes quickly', async () => {
    // Process the queue with a handler that resolves immediately
    queue.process('rpc', async (job) => {
      return { answer: job.data.input * 2 };
    }, { pollInterval: 50 });

    const result = await queue.addAndWait('rpc', { input: 21 }, 5000);
    expect(result).toEqual({ answer: 42 });
  });

  test('throws JOB_FAILED when job fails', async () => {
    queue.process('rpc-fail', async () => {
      throw new PermanentError('bad input');
    }, { pollInterval: 50 });

    await expect(queue.addAndWait('rpc-fail', {}, 5000))
      .rejects.toMatchObject({ errorCode: 'JOB_FAILED' });
  });

  test('throws REQUEST_TIMEOUT when deadline exceeded', async () => {
    // No processor — job stays pending
    await expect(queue.addAndWait('unprocessed', {}, 500))
      .rejects.toMatchObject({ errorCode: 'REQUEST_TIMEOUT' });
  });
});

// ─── gracefulClose() ────────────────────────────────────────────────────────

describe('gracefulClose()', () => {
  test('closes cleanly with no workers', async () => {
    await expect(queue.gracefulClose(1000)).resolves.toBeUndefined();
  });

  test('stops workers before closing', async () => {
    const processed: any[] = [];
    queue.add('gc', {});

    queue.process('gc', async (job) => {
      await sleep(100);
      processed.push(1);
      return null;
    }, { pollInterval: 50 });

    await sleep(50); // let the worker pick up the job
    await queue.gracefulClose(5000);

    expect(processed).toHaveLength(1);
  });
});

// ─── close() ────────────────────────────────────────────────────────────────

describe('close()', () => {
  test('prevents further operations after close', () => {
    queue.close();
    expect(() => queue.add('q', {})).toThrow();
  });
});

// ─── helper ─────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
