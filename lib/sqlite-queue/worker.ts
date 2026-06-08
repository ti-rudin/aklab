/**
 * SQLite Queue Worker — поллинг очереди и обработка задач
 */

import type Database from 'better-sqlite3';
import type { Job, JobRow, WorkerOptions } from './types';
import { PermanentError } from './types';

type JobHandler = (job: Job) => Promise<any>;

export class Worker {
  private db: Database.Database;
  private queueName: string;
  private handler: JobHandler;
  private concurrency: number;
  private pollInterval: number;
  private activeCount: number = 0;
  private pollTimer: NodeJS.Timeout | null = null;
  private stopped: boolean = false;

  private stmtFetch: Database.Statement;
  private stmtClaim: Database.Statement;
  private stmtComplete: Database.Statement;
  private stmtFail: Database.Statement;
  private stmtRetry: Database.Statement;

  constructor(db: Database.Database, queueName: string, handler: JobHandler, opts?: WorkerOptions) {
    this.db = db;
    this.queueName = queueName;
    this.handler = handler;
    this.concurrency = opts?.concurrency ?? 1;
    this.pollInterval = opts?.pollInterval ?? 200;

    // Атомарный захват задачи: UPDATE + RETURNING вместо SELECT + UPDATE (race condition fix)
    this.stmtFetch = db.prepare(`
      UPDATE jobs
      SET status = 'active', started_at = ?, attempts = attempts + 1
      WHERE id = (
        SELECT id FROM jobs
        WHERE queue = ? AND status = 'pending' AND (scheduled_at IS NULL OR scheduled_at <= ?)
        ORDER BY priority DESC, id ASC
        LIMIT 1
      ) AND status = 'pending'
      RETURNING *
    `);

    // Оставлен для обратной совместимости, но не используется в poll()
    this.stmtClaim = db.prepare(`
      UPDATE jobs SET status = 'active', started_at = ?, attempts = attempts + 1
      WHERE id = ? AND status = 'pending'
    `);

    this.stmtComplete = db.prepare(`
      UPDATE jobs SET status = 'completed', result = ?, completed_at = ?
      WHERE id = ? AND status = 'active'
    `);

    this.stmtFail = db.prepare(`
      UPDATE jobs SET status = 'failed', error = ?, completed_at = ?
      WHERE id = ? AND status = 'active'
    `);

    this.stmtRetry = db.prepare(`
      UPDATE jobs SET status = 'pending', error = ?, scheduled_at = ?
      WHERE id = ? AND status = 'active'
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
      // Атомарный захват: UPDATE ... RETURNING * (одна операция, без race condition)
      const row = this.stmtFetch.get(now, this.queueName, now) as JobRow | undefined;
      if (!row) return;

      this.activeCount++;

      const job = this.rowToJob(row);
      job.status = 'active';
      job.started_at = now;

      this.handler(job)
        .then((result) => {
          try {
            this.stmtComplete.run(JSON.stringify(result), Date.now(), job.id);
          } catch (err) {
            console.error(`[SqliteQueue] Failed to save result for job ${job.id}:`, err);
          }
        })
        .catch((err: Error) => {
          try {
            const errorMsg = err.message || String(err);
            const isPermanent = err instanceof PermanentError || (err as Error & { permanent?: boolean })?.permanent === true;

            if (!isPermanent && job.attempts < job.max_attempts) {
              // Retry с exponential backoff (только temporary ошибки)
              const delayMs = Math.pow(2, job.attempts) * 1000;
              const retryAt = Date.now() + delayMs;
              this.stmtRetry.run(errorMsg, retryAt, job.id);
            } else {
              // PermanentError или исчерпаны попытки — сразу fail
              this.stmtFail.run(errorMsg, Date.now(), job.id);
            }
          } catch (dbErr) {
            console.error(`[SqliteQueue] Failed to update failed job ${job.id}:`, dbErr);
          }
        })
        .finally(() => {
          this.activeCount--;
        });
    } catch (err) {
      // SQLITE_BUSY или другая ошибка — пропускаем этот цикл
      if ((err as NodeJS.ErrnoException)?.code !== 'SQLITE_BUSY') {
        console.error(`[SqliteQueue Worker ${this.queueName}] Poll error:`, err);
      }
    }
  }

  private rowToJob(row: JobRow): Job {
    return {
      ...row,
      status: row.status as Job['status'],
      data: JSON.parse(row.data),
      result: row.result ? JSON.parse(row.result) : null,
    };
  }

  stop(): void {
    this.stopped = true;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * Graceful stop — прекращаем брать новые задачи и ждём завершения активных
   */
  async gracefulStop(timeoutMs = 15000): Promise<void> {
    this.stopped = true;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    // Ждём завершения активных задач с таймаутом
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
