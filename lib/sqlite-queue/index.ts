/**
 * SQLite Queue — легковесная очередь задач на better-sqlite3
 *
 * Заменяет RabbitMQ (messaging между сервисами) и Redis/BullMQ (scheduling).
 * Все процессы работают с одним файлом queue.db через WAL mode.
 */

import Database from 'better-sqlite3';
import { Worker } from './worker';
import type { Job, JobHandler, JobRow, AddJobOptions, WorkerOptions, QueueStats, QueueStatsDetailed } from './types';

export { Worker } from './worker';
export { PermanentError } from './types';
export type { Job, JobHandler, JobRow, AddJobOptions, WorkerContext, WorkerOptions, QueueStats, QueueStatsDetailed } from './types';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    queue TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    data TEXT NOT NULL,
    result TEXT,
    error TEXT,
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,
    correlation_id TEXT,
    idempotency_key TEXT,
    created_at INTEGER NOT NULL,
    started_at INTEGER,
    completed_at INTEGER,
    scheduled_at INTEGER,
    priority INTEGER DEFAULT 0,
    locked_by TEXT,
    lease_token TEXT,
    lease_expires_at INTEGER,
    lease_duration_ms INTEGER,
    heartbeat_at INTEGER,
    cancellation_requested_at INTEGER
  );
`;

const SCHEMA_INDEXES = `
  CREATE INDEX IF NOT EXISTS idx_jobs_queue_status ON jobs(queue, status, scheduled_at);
  CREATE INDEX IF NOT EXISTS idx_jobs_correlation_id ON jobs(correlation_id);
  CREATE INDEX IF NOT EXISTS idx_jobs_cleanup ON jobs(status, completed_at);
`;

const ACTIVE_IDEMPOTENCY_INDEX = `
  CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_queue_idempotency_active
  ON jobs(queue, idempotency_key)
  WHERE idempotency_key IS NOT NULL AND status IN ('pending', 'active')
`;

const STALE_CONDITION = `
  ((lease_expires_at IS NOT NULL AND lease_expires_at <= ?)
   OR (lease_expires_at IS NULL AND started_at < ?))
`;

const MAX_IDEMPOTENCY_CONFLICT_RETRIES = 3;

export class SqliteQueue {
  private db: Database.Database;
  private workers: Worker[] = [];
  private staleCheckTimer: NodeJS.Timeout | null = null;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private staleTimeoutMin: number;
  private retentionHours: number;

  private stmtAdd: Database.Statement;
  private stmtGetById: Database.Statement;
  private stmtGetStatus: Database.Statement;
  private stmtFindByIdempotency: Database.Statement;
  private stmtStaleCancelled: Database.Statement;
  private stmtStaleRecovery: Database.Statement;
  private stmtStaleExhausted: Database.Statement;
  private stmtCleanup: Database.Statement;
  private stmtQueueStats: Database.Statement;
  private stmtAllQueues: Database.Statement;
  private stmtHeartbeat: Database.Statement;
  private stmtCancelPending: Database.Statement;
  private stmtRequestActiveCancellation: Database.Statement;

  constructor(dbPath: string, opts?: { staleTimeoutMin?: number; retentionHours?: number; disableTimers?: boolean }) {
    this.staleTimeoutMin = opts?.staleTimeoutMin ?? parseInt(process.env.QUEUE_STALE_TIMEOUT_MIN || '5', 10);
    this.retentionHours = opts?.retentionHours ?? parseInt(process.env.QUEUE_RETENTION_HOURS || '48', 10);

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    this.db.pragma('auto_vacuum = INCREMENTAL');
    this.migrateSchema();

    this.stmtAdd = this.db.prepare(`
      INSERT INTO jobs (queue, data, correlation_id, idempotency_key, created_at, scheduled_at, priority, max_attempts)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.stmtGetById = this.db.prepare('SELECT * FROM jobs WHERE id = ?');

    this.stmtGetStatus = this.db.prepare('SELECT status, result, error FROM jobs WHERE id = ?');

    this.stmtFindByIdempotency = this.db.prepare(
      `SELECT * FROM jobs WHERE queue = ? AND idempotency_key = ? AND status IN ('pending', 'active') LIMIT 1`
    );

    // Stale recovery clears the old ownership so a later claim has a fresh lease.
    this.stmtStaleCancelled = this.db.prepare(`
      UPDATE jobs
      SET status = 'failed', error = 'cancelled', completed_at = ?,
          locked_by = NULL, lease_token = NULL, lease_expires_at = NULL, heartbeat_at = NULL
      WHERE status = 'active' AND cancellation_requested_at IS NOT NULL AND ${STALE_CONDITION}
    `);
    this.stmtStaleExhausted = this.db.prepare(`
      UPDATE jobs
      SET status = 'failed', error = 'max attempts exceeded (stale)', completed_at = ?,
          locked_by = NULL, lease_token = NULL, lease_expires_at = NULL, heartbeat_at = NULL
      WHERE status = 'active' AND cancellation_requested_at IS NULL
        AND attempts >= max_attempts AND ${STALE_CONDITION}
    `);
    this.stmtStaleRecovery = this.db.prepare(`
      UPDATE jobs
      SET status = 'pending', error = 'stale job recovery',
          locked_by = NULL, lease_token = NULL, lease_expires_at = NULL, heartbeat_at = NULL
      WHERE status = 'active' AND cancellation_requested_at IS NULL
        AND attempts < max_attempts AND ${STALE_CONDITION}
    `);

    this.stmtCleanup = this.db.prepare(`
      DELETE FROM jobs WHERE status IN ('completed', 'failed') AND completed_at < ?
    `);

    this.stmtQueueStats = this.db.prepare(`
      SELECT status, COUNT(*) as count FROM jobs WHERE queue = ? GROUP BY status
    `);

    this.stmtAllQueues = this.db.prepare(`
      SELECT DISTINCT queue FROM jobs
    `);

    this.stmtHeartbeat = this.db.prepare(`
      UPDATE jobs
      SET heartbeat_at = ?, lease_expires_at = ? + COALESCE(lease_duration_ms, ?)
      WHERE id = ? AND status = 'active' AND lease_token = ?
    `);
    this.stmtCancelPending = this.db.prepare(`
      UPDATE jobs
      SET status = 'failed', error = 'cancelled', completed_at = ?
      WHERE id = ? AND status = 'pending'
    `);
    this.stmtRequestActiveCancellation = this.db.prepare(`
      UPDATE jobs
      SET cancellation_requested_at = COALESCE(cancellation_requested_at, ?)
      WHERE id = ? AND status = 'active'
    `);

    // Периодические задачи (отключаемы для worker-only процессов — таймеры только в Strapi)
    if (!opts?.disableTimers) {
      this.staleCheckTimer = setInterval(() => this.recoverStaleJobs(), 60_000);
      this.cleanupTimer = setInterval(() => this.cleanOldJobs(), 5 * 60_000);
    }
  }

  /**
   * Apply the static schema under a SQLite write lock so concurrently starting
   * processes see one serialized migration of their shared queue.db.
   */
  private migrateSchema(): void {
    let transactionStarted = false;
    try {
      this.db.exec('BEGIN IMMEDIATE');
      transactionStarted = true;
      this.db.exec(SCHEMA);

      // Re-read inside the lock: another process may have completed migration
      // before this connection acquired the write lock.
      const columns = this.db.prepare('PRAGMA table_info(jobs)').all() as Array<{ name: string }>;
      const existing = new Set(columns.map(column => column.name));
      const migrations: ReadonlyArray<{ name: string; statement: string }> = [
        { name: 'idempotency_key', statement: 'ALTER TABLE jobs ADD COLUMN idempotency_key TEXT' },
        { name: 'locked_by', statement: 'ALTER TABLE jobs ADD COLUMN locked_by TEXT' },
        { name: 'lease_token', statement: 'ALTER TABLE jobs ADD COLUMN lease_token TEXT' },
        { name: 'lease_expires_at', statement: 'ALTER TABLE jobs ADD COLUMN lease_expires_at INTEGER' },
        { name: 'lease_duration_ms', statement: 'ALTER TABLE jobs ADD COLUMN lease_duration_ms INTEGER' },
        { name: 'heartbeat_at', statement: 'ALTER TABLE jobs ADD COLUMN heartbeat_at INTEGER' },
        { name: 'cancellation_requested_at', statement: 'ALTER TABLE jobs ADD COLUMN cancellation_requested_at INTEGER' },
      ];

      for (const migration of migrations) {
        if (!existing.has(migration.name)) {
          this.db.exec(migration.statement);
        }
      }

      this.db.exec(SCHEMA_INDEXES);
      this.db.exec(ACTIVE_IDEMPOTENCY_INDEX);
      this.db.exec('COMMIT');
      transactionStarted = false;
    } catch (err) {
      if (transactionStarted) {
        try {
          this.db.exec('ROLLBACK');
        } catch {
          // The original migration error is the useful one for callers.
        }
      }
      throw err;
    }
  }

  /**
   * Добавить задачу в очередь.
   * correlationId служит только трассировке; дедупликация использует idempotencyKey.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Queue accepts arbitrary JSON payloads
  add(queue: string, data: any, opts?: AddJobOptions): Job {
    const now = Date.now();
    const scheduledAt = opts?.delay ? now + opts.delay : null;
    const correlationId = opts?.correlationId || null;
    // Compatibility for callers of the removed idempotent+correlationId pair: the
    // value is copied into the independent key; lookup still never uses correlation_id.
    const idempotencyKey = opts?.idempotencyKey ?? (opts?.idempotent ? correlationId : null);
    const priority = opts?.priority ?? 0;
    const maxAttempts = opts?.maxAttempts ?? 3;

    let lastConflict: unknown;
    for (let attempt = 0; attempt < MAX_IDEMPOTENCY_CONFLICT_RETRIES; attempt++) {
      try {
        const result = this.stmtAdd.run(
          queue,
          JSON.stringify(data),
          correlationId,
          idempotencyKey,
          now,
          scheduledAt,
          priority,
          maxAttempts
        );
        return this.getJob(result.lastInsertRowid as number)!;
      } catch (err) {
        // The partial unique index is the concurrency-safe source of truth. A
        // winner is usable only while it remains pending/active; terminal jobs
        // must not be returned to a caller retrying an idempotent submission.
        const errorCode = (err as NodeJS.ErrnoException).code;
        if (!idempotencyKey || (errorCode !== 'SQLITE_CONSTRAINT_UNIQUE' && errorCode !== 'SQLITE_CONSTRAINT')) {
          throw err;
        }
        lastConflict = err;

        const active = this.stmtFindByIdempotency.get(queue, idempotencyKey) as JobRow | undefined;
        if (active) return this.rowToJob(active);
        // The unique-index winner reached a terminal state before this read.
        // Retry the INSERT: the partial index no longer blocks a new job.
      }
    }

    // One final read covers a winner that was inserted after the last retry's
    // conflict but before this connection can issue another INSERT. Never
    // fall back to a terminal row here.
    const active = this.stmtFindByIdempotency.get(queue, idempotencyKey!) as JobRow | undefined;
    if (active) return this.rowToJob(active);
    throw lastConflict;
  }

  /**
   * Добавить задачу и дождаться результата (RPC паттерн)
   * Заменяет RabbitMQ sendRequest с replyTo + correlationId
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Queue accepts/returns arbitrary JSON payloads
  async addAndWait(queue: string, data: any, timeoutMs: number, correlationId?: string): Promise<any> {
    const job = this.add(queue, data, { correlationId });
    const deadline = Date.now() + timeoutMs;
    const pollInterval = parseInt(process.env.QUEUE_POLL_INTERVAL_MS || '200', 10);

    while (Date.now() < deadline) {
      const row = this.stmtGetStatus.get(job.id) as { status: string; result: string | null; error: string | null } | undefined;

      if (!row) {
        throw new Error(`[SqliteQueue] Job ${job.id} not found`);
      }

      if (row.status === 'completed') {
        return row.result ? JSON.parse(row.result) : null;
      }

      if (row.status === 'failed') {
        const error = new Error(row.error || `Job ${job.id} failed`) as Error & { errorCode: string; jobId: number };
        error.errorCode = 'JOB_FAILED';
        error.jobId = job.id;
        throw error;
      }

      await sleep(pollInterval);
    }

    // Pending jobs can fail immediately; running jobs must acknowledge cancellation.
    this.requestCancellation(job.id);

    const error = new Error(`[SqliteQueue] Timeout waiting for ${queue} job ${job.id} after ${timeoutMs}ms`) as Error & { errorCode: string; requestType: string; correlationId?: string };
    error.errorCode = 'REQUEST_TIMEOUT';
    error.requestType = queue;
    error.correlationId = correlationId;
    throw error;
  }

  /**
   * Запустить worker для обработки очереди
   */
  process(queue: string, handler: JobHandler, opts?: WorkerOptions): Worker {
    const pollInterval = opts?.pollInterval ?? parseInt(process.env.QUEUE_POLL_INTERVAL_MS || '200', 10);
    const worker = new Worker(this.db, queue, handler, {
      concurrency: opts?.concurrency ?? 1,
      pollInterval,
      leaseDurationMs: opts?.leaseDurationMs ?? this.staleTimeoutMin * 60_000,
      heartbeatIntervalMs: opts?.heartbeatIntervalMs,
    });
    this.workers.push(worker);
    return worker;
  }

  private rowToJob(row: JobRow): Job {
    return {
      ...row,
      status: row.status as Job['status'],
      data: JSON.parse(row.data),
      result: row.result ? JSON.parse(row.result) : null,
      leaseToken: row.lease_token,
    };
  }

  /** Получить задачу по ID */
  getJob(id: number): Job | null {
    const row = this.stmtGetById.get(id) as JobRow | undefined;
    if (!row) return null;
    return this.rowToJob(row);
  }

  /**
   * Renew an active lease. A claimed row supplies its own persisted duration;
   * stale pre-migration rows alone fall back to staleTimeoutMin.
   */
  heartbeat(jobId: number, leaseToken: string): boolean {
    const now = Date.now();
    const legacyLeaseDurationMs = this.staleTimeoutMin * 60_000;
    return this.stmtHeartbeat.run(now, now, legacyLeaseDurationMs, jobId, leaseToken).changes > 0;
  }

  /**
   * Request cooperative cancellation. Pending work is terminally cancelled;
   * running work remains active until its owner acknowledges the request.
   */
  requestCancellation(id: number): boolean {
    const now = Date.now();
    if (this.stmtCancelPending.run(now, id).changes > 0) return true;
    return this.stmtRequestActiveCancellation.run(now, id).changes > 0;
  }

  /**
   * Поиск jobs по префиксу correlationId (КРИТ-7: восстановление после рестарта)
   */
  findJobsByCorrelationPrefix(queue: string, prefix: string, statusFilter?: string[]): Job[] {
    const statuses = statusFilter || ['pending', 'active'];
    const placeholders = statuses.map(() => '?').join(',');
    const stmt = this.db.prepare(
      `SELECT * FROM jobs WHERE queue = ? AND correlation_id LIKE ? AND status IN (${placeholders}) LIMIT 10`
    );
    const rows = stmt.all(queue, `${prefix}%`, ...statuses) as JobRow[];
    return rows.map(row => this.rowToJob(row));
  }

  /** Статистика по одной очереди */
  getQueueStats(queue: string): QueueStats {
    const rows = this.stmtQueueStats.all(queue) as Array<{ status: string; count: number }>;
    const stats: QueueStats = { pending: 0, active: 0, completed: 0, failed: 0 };
    for (const row of rows) {
      if (row.status in stats) {
        stats[row.status as keyof QueueStats] = row.count;
      }
    }
    return stats;
  }

  /** Полная статистика по всем очередям (для /api/queue-stats endpoint) */
  getDetailedStats(): QueueStatsDetailed {
    const queues: Record<string, QueueStats> = {};
    const total: QueueStats = { pending: 0, active: 0, completed: 0, failed: 0 };

    const allQueues = this.stmtAllQueues.all() as Array<{ queue: string }>;
    for (const { queue } of allQueues) {
      const stats = this.getQueueStats(queue);
      queues[queue] = stats;
      total.pending += stats.pending;
      total.active += stats.active;
      total.completed += stats.completed;
      total.failed += stats.failed;
    }

    let dbSizeBytes = 0;
    try {
      const sizeRow = this.db.prepare("SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()").get() as { size: number } | undefined;
      dbSizeBytes = sizeRow?.size ?? 0;
    } catch {
      // ignore
    }

    return { queues, total, dbSizeBytes };
  }

  /** Восстановить зависшие задачи, prioritizing a lease over legacy started_at. */
  private recoverStaleJobs(): void {
    try {
      const threshold = Date.now() - this.staleTimeoutMin * 60_000;
      const now = Date.now();

      const cancelled = this.stmtStaleCancelled.run(now, now, threshold);
      if (cancelled.changes > 0) {
        console.warn(`[SqliteQueue] Failed ${cancelled.changes} stale cancelled jobs`);
      }

      const exhausted = this.stmtStaleExhausted.run(now, now, threshold);
      if (exhausted.changes > 0) {
        console.warn(`[SqliteQueue] Failed ${exhausted.changes} stale jobs (max attempts exceeded)`);
      }

      const result = this.stmtStaleRecovery.run(now, threshold);
      if (result.changes > 0) {
        console.warn(`[SqliteQueue] Recovered ${result.changes} stale jobs`);
      }
    } catch (err) {
      console.error('[SqliteQueue] Stale recovery error:', err);
    }
  }

  /** Очистить старые completed/failed задачи */
  private cleanOldJobs(): void {
    try {
      const threshold = Date.now() - this.retentionHours * 3600_000;
      const result = this.stmtCleanup.run(threshold);
      if (result.changes > 0) {
        console.log(`[SqliteQueue] Cleaned ${result.changes} old jobs`);
      }
    } catch (err) {
      console.error('[SqliteQueue] Cleanup error:', err);
    }
  }

  /** Отменить pending job (для отмены delayed/scheduled задач). */
  cancelJob(id: number): boolean {
    return this.stmtCancelPending.run(Date.now(), id).changes > 0;
  }

  /**
   * Queue-wide cancellation: pending jobs fail immediately; active jobs receive
   * a cooperative cancellation request and retain their lease until the handler exits.
   */
  clearQueue(queue: string): number {
    const now = Date.now();
    const clear = this.db.transaction(() => {
      const pending = this.db.prepare(
        "UPDATE jobs SET status = 'failed', error = 'queue cleared', completed_at = ? WHERE queue = ? AND status = 'pending'"
      ).run(now, queue).changes;
      const active = this.db.prepare(
        "UPDATE jobs SET cancellation_requested_at = COALESCE(cancellation_requested_at, ?) WHERE queue = ? AND status = 'active'"
      ).run(now, queue).changes;
      return pending + active;
    });
    return clear();
  }

  /** Ручная очистка */
  clean(olderThanMs?: number): number {
    const threshold = Date.now() - (olderThanMs ?? this.retentionHours * 3600_000);
    return this.stmtCleanup.run(threshold).changes;
  }

  /** Graceful close — ждём завершения активных задач во всех workers, затем закрываем БД */
  async gracefulClose(timeoutMs = 15000): Promise<void> {
    await Promise.all(this.workers.map(w => w.gracefulStop(timeoutMs)));
    this.close();
  }

  /** Остановить все workers и закрыть БД */
  close(): void {
    for (const worker of this.workers) {
      worker.stop();
    }
    this.workers = [];

    if (this.staleCheckTimer) {
      clearInterval(this.staleCheckTimer);
      this.staleCheckTimer = null;
    }
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    this.db.close();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
