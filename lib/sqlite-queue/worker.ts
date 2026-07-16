/**
 * SQLite Queue Worker — поллинг очереди и обработка задач
 */

import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { Job, JobHandler, JobRow, WorkerContext, WorkerOptions } from './types';
import { PermanentError } from './types';

const CANCELLATION_ERROR = 'cancelled';

export class Worker {
  private db: Database.Database;
  private queueName: string;
  private handler: JobHandler;
  private concurrency: number;
  private pollInterval: number;
  private leaseDurationMs: number;
  private heartbeatIntervalMs: number;
  private workerId: string;
  private activeCount: number = 0;
  private pollTimer: NodeJS.Timeout | null = null;
  private stopped: boolean = false;

  private stmtFetch: Database.Statement;
  private stmtClaim: Database.Statement;
  private stmtComplete: Database.Statement;
  private stmtFail: Database.Statement;
  private stmtRetry: Database.Statement;
  private stmtHeartbeat: Database.Statement;
  private stmtCancellationRequested: Database.Statement;
  private stmtLeaseValid: Database.Statement;

  constructor(db: Database.Database, queueName: string, handler: JobHandler, opts?: WorkerOptions) {
    this.db = db;
    this.queueName = queueName;
    this.handler = handler;
    this.concurrency = opts?.concurrency ?? 1;
    this.pollInterval = opts?.pollInterval ?? 200;
    this.leaseDurationMs = opts?.leaseDurationMs ?? parseInt(process.env.QUEUE_LEASE_DURATION_MS || '300000', 10);
    this.heartbeatIntervalMs = opts?.heartbeatIntervalMs ?? Math.max(10, Math.floor(this.leaseDurationMs / 2));
    this.workerId = `worker:${randomUUID()}`;

    // Atomic claim: a fresh owner and lease token are persisted with the state
    // transition, so an old worker can never complete another worker's claim.
    this.stmtFetch = db.prepare(`
      UPDATE jobs
      SET status = 'active', started_at = ?, attempts = attempts + 1,
          locked_by = ?, lease_token = ?, lease_expires_at = ?, heartbeat_at = ?,
          lease_duration_ms = ?, cancellation_requested_at = NULL
      WHERE id = (
        SELECT id FROM jobs
        WHERE queue = ? AND status = 'pending' AND (scheduled_at IS NULL OR scheduled_at <= ?)
        ORDER BY priority DESC, id ASC
        LIMIT 1
      ) AND status = 'pending'
      RETURNING *
    `);

    // Retained for private backwards compatibility. poll() uses stmtFetch above.
    this.stmtClaim = db.prepare(`
      UPDATE jobs
      SET status = 'active', started_at = ?, attempts = attempts + 1,
          locked_by = ?, lease_token = ?, lease_expires_at = ?, heartbeat_at = ?,
          lease_duration_ms = ?, cancellation_requested_at = NULL
      WHERE id = ? AND status = 'pending'
    `);

    this.stmtComplete = db.prepare(`
      UPDATE jobs
      SET status = 'completed', result = ?, completed_at = ?,
          locked_by = NULL, lease_token = NULL, lease_expires_at = NULL, heartbeat_at = NULL
      WHERE id = ? AND status = 'active' AND lease_token = ?
        AND cancellation_requested_at IS NULL
    `);

    this.stmtFail = db.prepare(`
      UPDATE jobs
      SET status = 'failed', error = ?, completed_at = ?,
          locked_by = NULL, lease_token = NULL, lease_expires_at = NULL, heartbeat_at = NULL
      WHERE id = ? AND status = 'active' AND lease_token = ?
    `);

    this.stmtRetry = db.prepare(`
      UPDATE jobs
      SET status = 'pending', error = ?, scheduled_at = ?,
          locked_by = NULL, lease_token = NULL, lease_expires_at = NULL, heartbeat_at = NULL
      WHERE id = ? AND status = 'active' AND lease_token = ?
        AND cancellation_requested_at IS NULL
    `);

    this.stmtHeartbeat = db.prepare(`
      UPDATE jobs
      SET heartbeat_at = ?, lease_expires_at = ? + COALESCE(lease_duration_ms, ?)
      WHERE id = ? AND status = 'active' AND lease_token = ?
    `);
    this.stmtCancellationRequested = db.prepare(`
      SELECT 1 FROM jobs
      WHERE id = ? AND status = 'active' AND lease_token = ?
        AND cancellation_requested_at IS NOT NULL
    `);
    this.stmtLeaseValid = db.prepare(`
      SELECT 1 FROM jobs
      WHERE id = ? AND status = 'active' AND lease_token = ?
        AND lease_expires_at IS NOT NULL AND lease_expires_at > ?
    `);

    this.start();
  }

  private start(): void {
    this.pollTimer = setInterval(() => this.poll(), this.pollInterval);
  }

  private poll(): void {
    if (this.stopped || this.activeCount >= this.concurrency) return;

    try {
      const now = Date.now();
      const leaseToken = randomUUID();
      const row = this.stmtFetch.get(
        now,
        this.workerId,
        leaseToken,
        now + this.leaseDurationMs,
        now,
        this.leaseDurationMs,
        this.queueName,
        now
      ) as JobRow | undefined;
      if (!row) return;

      this.activeCount++;
      const job = this.rowToJob(row);
      job.status = 'active';
      job.started_at = now;
      job.leaseToken = leaseToken;

      const context: WorkerContext = {
        leaseToken,
        heartbeat: () => this.heartbeat(job.id, leaseToken),
        isCancellationRequested: () => this.isCancellationRequested(job.id, leaseToken),
        isLeaseValid: () => this.isLeaseValid(job.id, leaseToken),
      };
      const heartbeatTimer = setInterval(() => context.heartbeat(), this.heartbeatIntervalMs);

      Promise.resolve()
        .then(() => this.handler(job, context))
        .then((result) => this.completeOrCancel(job, leaseToken, result))
        .catch((err: Error) => this.failOrRetry(job, leaseToken, err))
        .finally(() => {
          clearInterval(heartbeatTimer);
          this.activeCount--;
        });
    } catch (err) {
      // SQLITE_BUSY или другая ошибка — пропускаем этот цикл
      if ((err as NodeJS.ErrnoException)?.code !== 'SQLITE_BUSY') {
        console.error(`[SqliteQueue Worker ${this.queueName}] Poll error:`, err);
      }
    }
  }

  private completeOrCancel(job: Job, leaseToken: string, result: any): void {
    try {
      if (this.isCancellationRequested(job.id, leaseToken)) {
        this.failCancelled(job.id, leaseToken);
        return;
      }

      const completed = this.stmtComplete.run(JSON.stringify(result), Date.now(), job.id, leaseToken);
      // Cancellation can race a successful handler between the check and UPDATE.
      if (completed.changes === 0 && this.isCancellationRequested(job.id, leaseToken)) {
        this.failCancelled(job.id, leaseToken);
      }
    } catch (err) {
      console.error(`[SqliteQueue] Failed to save result for job ${job.id}:`, err);
    }
  }

  private failOrRetry(job: Job, leaseToken: string, err: Error): void {
    try {
      if (this.isCancellationRequested(job.id, leaseToken)) {
        this.failCancelled(job.id, leaseToken);
        return;
      }

      const errorMsg = err.message || String(err);
      const isPermanent = err instanceof PermanentError || (err as Error & { permanent?: boolean })?.permanent === true;

      if (!isPermanent && job.attempts < job.max_attempts) {
        // Retry с exponential backoff (только temporary ошибки).
        const delayMs = Math.pow(2, job.attempts) * 1000;
        const retryAt = Date.now() + delayMs;
        const retried = this.stmtRetry.run(errorMsg, retryAt, job.id, leaseToken);
        if (retried.changes === 0 && this.isCancellationRequested(job.id, leaseToken)) {
          this.failCancelled(job.id, leaseToken);
        }
      } else {
        this.stmtFail.run(errorMsg, Date.now(), job.id, leaseToken);
      }
    } catch (dbErr) {
      console.error(`[SqliteQueue] Failed to update failed job ${job.id}:`, dbErr);
    }
  }

  private failCancelled(jobId: number, leaseToken: string): void {
    this.stmtFail.run(CANCELLATION_ERROR, Date.now(), jobId, leaseToken);
  }

  private heartbeat(jobId: number, leaseToken: string): boolean {
    const now = Date.now();
    // New claims persist lease_duration_ms; this worker default is only for legacy rows.
    return this.stmtHeartbeat.run(now, now, this.leaseDurationMs, jobId, leaseToken).changes > 0;
  }

  private isCancellationRequested(jobId: number, leaseToken: string): boolean {
    return Boolean(this.stmtCancellationRequested.get(jobId, leaseToken));
  }

  private isLeaseValid(jobId: number, leaseToken: string): boolean {
    return Boolean(this.stmtLeaseValid.get(jobId, leaseToken, Date.now()));
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

  stop(): void {
    this.stopped = true;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /** Graceful stop — прекращаем брать новые задачи и ждём завершения активных */
  async gracefulStop(timeoutMs = 15000): Promise<void> {
    this.stopped = true;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    const deadline = Date.now() + timeoutMs;
    while (this.activeCount > 0 && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    if (this.activeCount > 0) {
      console.warn(`[SqliteQueue Worker ${this.queueName}] Force stopping with ${this.activeCount} active jobs`);
    }
  }

  getActiveCount(): number {
    return this.activeCount;
  }
}
