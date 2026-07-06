/**
 * SQLite Queue — легковесная очередь задач на better-sqlite3
 *
 * Заменяет RabbitMQ (messaging между сервисами) и Redis/BullMQ (scheduling).
 * Все процессы работают с одним файлом queue.db через WAL mode.
 */

import Database from 'better-sqlite3';
import { Worker } from './worker';
import type { Job, JobRow, AddJobOptions, WorkerOptions, QueueStats, QueueStatsDetailed } from './types';

export { Worker } from './worker';
export { PermanentError } from './types';
export type { Job, JobRow, AddJobOptions, WorkerOptions, QueueStats, QueueStatsDetailed } from './types';

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
    created_at INTEGER NOT NULL,
    started_at INTEGER,
    completed_at INTEGER,
    scheduled_at INTEGER,
    priority INTEGER DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_jobs_queue_status ON jobs(queue, status, scheduled_at);
  CREATE INDEX IF NOT EXISTS idx_jobs_correlation_id ON jobs(correlation_id);
  CREATE INDEX IF NOT EXISTS idx_jobs_cleanup ON jobs(status, completed_at);
`;

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
  private stmtFindByCorrelation: Database.Statement;
  private stmtStaleRecovery: Database.Statement;
  private stmtStaleExhausted: Database.Statement;
  private stmtCleanup: Database.Statement;
  private stmtQueueStats: Database.Statement;
  private stmtAllQueues: Database.Statement;

  constructor(dbPath: string, opts?: { staleTimeoutMin?: number; retentionHours?: number; disableTimers?: boolean }) {
    this.staleTimeoutMin = opts?.staleTimeoutMin ?? parseInt(process.env.QUEUE_STALE_TIMEOUT_MIN || '5', 10);
    this.retentionHours = opts?.retentionHours ?? parseInt(process.env.QUEUE_RETENTION_HOURS || '48', 10);

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    this.db.pragma('auto_vacuum = INCREMENTAL');
    this.db.exec(SCHEMA);

    this.stmtAdd = this.db.prepare(`
      INSERT INTO jobs (queue, data, correlation_id, created_at, scheduled_at, priority, max_attempts)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    this.stmtGetById = this.db.prepare('SELECT * FROM jobs WHERE id = ?');

    this.stmtGetStatus = this.db.prepare('SELECT status, result, error FROM jobs WHERE id = ?');

    // Idempotency: поиск pending/active по correlationId
    this.stmtFindByCorrelation = this.db.prepare(
      `SELECT * FROM jobs WHERE queue = ? AND correlation_id = ? AND status IN ('pending', 'active') LIMIT 1`
    );

    // Stale recovery: возвращаем в pending только если не исчерпаны попытки
    // НЕ инкрементируем attempts — worker уже сделал +1 при claim (stmtFetch)
    this.stmtStaleRecovery = this.db.prepare(`
      UPDATE jobs SET status = 'pending', error = 'stale job recovery'
      WHERE status = 'active' AND started_at < ? AND attempts < max_attempts
    `);

    // Stale jobs, превысившие max_attempts — помечаем как failed
    this.stmtStaleExhausted = this.db.prepare(`
      UPDATE jobs SET status = 'failed', error = 'max attempts exceeded (stale)', completed_at = ?
      WHERE status = 'active' AND started_at < ? AND attempts >= max_attempts
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

    // Периодические задачи (отключаемы для worker-only процессов — таймеры только в Strapi)
    if (!opts?.disableTimers) {
      this.staleCheckTimer = setInterval(() => this.recoverStaleJobs(), 60_000);
      this.cleanupTimer = setInterval(() => this.cleanOldJobs(), 5 * 60_000);
    }
  }

  /**
   * Добавить задачу в очередь
   * Если correlationId указан и idempotent=true — проверяет дубликаты (pending/active)
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Queue accepts arbitrary JSON payloads
  add(queue: string, data: any, opts?: AddJobOptions): Job {
    const now = Date.now();
    const scheduledAt = opts?.delay ? now + opts.delay : null;
    const correlationId = opts?.correlationId || null;
    const priority = opts?.priority ?? 0;
    const maxAttempts = opts?.maxAttempts ?? 3;

    // Idempotency: если correlationId уже есть в pending/active — возвращаем существующую
    if (correlationId && opts?.idempotent) {
      const existing = this.stmtFindByCorrelation.get(queue, correlationId) as JobRow | undefined;
      if (existing) {
        return this.rowToJob(existing);
      }
    }

    const result = this.stmtAdd.run(
      queue,
      JSON.stringify(data),
      correlationId,
      now,
      scheduledAt,
      priority,
      maxAttempts
    );

    return this.getJob(result.lastInsertRowid as number)!;
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

    // Таймаут — помечаем job как failed
    const failStmt = this.db.prepare('UPDATE jobs SET status = ?, error = ?, completed_at = ? WHERE id = ? AND status IN (?, ?)');
    failStmt.run('failed', `Timeout after ${timeoutMs}ms`, Date.now(), job.id, 'pending', 'active');

    const error = new Error(`[SqliteQueue] Timeout waiting for ${queue} job ${job.id} after ${timeoutMs}ms`) as Error & { errorCode: string; requestType: string; correlationId?: string };
    error.errorCode = 'REQUEST_TIMEOUT';
    error.requestType = queue;
    error.correlationId = correlationId;
    throw error;
  }

  /**
   * Запустить worker для обработки очереди
   */
  process(queue: string, handler: (job: Job) => Promise<any>, opts?: WorkerOptions): Worker {
    const pollInterval = opts?.pollInterval ?? parseInt(process.env.QUEUE_POLL_INTERVAL_MS || '200', 10);
    const worker = new Worker(this.db, queue, handler, {
      concurrency: opts?.concurrency ?? 1,
      pollInterval,
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
    };
  }

  /**
   * Получить задачу по ID
   */
  getJob(id: number): Job | null {
    const row = this.stmtGetById.get(id) as JobRow | undefined;
    if (!row) return null;
    return this.rowToJob(row);
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

  /**
   * Статистика по одной очереди
   */
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

  /**
   * Полная статистика по всем очередям (для /api/queue-stats endpoint)
   */
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

  /**
   * Восстановить зависшие задачи (status=active дольше staleTimeoutMin)
   */
  private recoverStaleJobs(): void {
    try {
      const threshold = Date.now() - this.staleTimeoutMin * 60_000;
      const now = Date.now();

      // Сначала фейлим задачи, превысившие max_attempts
      const exhausted = this.stmtStaleExhausted.run(now, threshold);
      if (exhausted.changes > 0) {
        console.warn(`[SqliteQueue] Failed ${exhausted.changes} stale jobs (max attempts exceeded)`);
      }

      // Затем восстанавливаем остальные зависшие задачи
      const result = this.stmtStaleRecovery.run(threshold);
      if (result.changes > 0) {
        console.warn(`[SqliteQueue] Recovered ${result.changes} stale jobs`);
      }
    } catch (err) {
      console.error('[SqliteQueue] Stale recovery error:', err);
    }
  }

  /**
   * Очистить старые completed/failed задачи
   */
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

  /**
   * Отменить pending job (для отмены delayed/scheduled задач)
   */
  cancelJob(id: number): boolean {
    const stmt = this.db.prepare(
      "UPDATE jobs SET status = 'failed', error = 'cancelled', completed_at = ? WHERE id = ? AND status = 'pending'"
    );
    return stmt.run(Date.now(), id).changes > 0;
  }

  /**
   * Очистить все pending/active задачи в очереди (для pipeline cancel)
   */
  clearQueue(queue: string): number {
    const now = Date.now();
    const stmt = this.db.prepare(
      "UPDATE jobs SET status = 'failed', error = 'queue cleared', completed_at = ? WHERE queue = ? AND status IN ('pending', 'active')"
    );
    return stmt.run(now, queue).changes;
  }

  /**
   * Ручная очистка
   */
  clean(olderThanMs?: number): number {
    const threshold = Date.now() - (olderThanMs ?? this.retentionHours * 3600_000);
    return this.stmtCleanup.run(threshold).changes;
  }

  /**
   * Graceful close — ждём завершения активных задач во всех workers, затем закрываем БД
   */
  async gracefulClose(timeoutMs = 15000): Promise<void> {
    await Promise.all(this.workers.map(w => w.gracefulStop(timeoutMs)));
    this.close();
  }

  /**
   * Остановить все workers и закрыть БД
   */
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
