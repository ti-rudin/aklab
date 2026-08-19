"use strict";
/**
 * SQLite Queue Worker — поллинг очереди и обработка задач
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.Worker = void 0;
const node_crypto_1 = require("node:crypto");
const types_1 = require("./types");
const CANCELLATION_ERROR = 'cancelled';
class Worker {
    constructor(db, queueName, handler, opts) {
        this.activeCount = 0;
        this.pollTimer = null;
        this.stopped = false;
        this.idleStreak = 0;
        this.currentPollInterval = 0;
        this.db = db;
        this.queueName = queueName;
        this.handler = handler;
        this.concurrency = opts?.concurrency ?? 1;
        this.pollInterval = opts?.pollInterval ?? 200;
        this.leaseDurationMs = opts?.leaseDurationMs ?? parseInt(process.env.QUEUE_LEASE_DURATION_MS || '300000', 10);
        this.heartbeatIntervalMs = opts?.heartbeatIntervalMs ?? Math.max(10, Math.floor(this.leaseDurationMs / 2));
        this.workerId = `worker:${(0, node_crypto_1.randomUUID)()}`;
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
        // stmtClaim удалён: poll() использует атомарный stmtFetch (SELECT + UPDATE за одну операцию)
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
    start() {
        this.currentPollInterval = this.pollInterval;
        this.schedulePoll();
    }
    schedulePoll() {
        if (this.stopped)
            return;
        this.pollTimer = setTimeout(() => {
            this.poll();
            if (!this.stopped)
                this.schedulePoll();
        }, this.currentPollInterval);
    }
    poll() {
        if (this.stopped || this.activeCount >= this.concurrency)
            return;
        try {
            const now = Date.now();
            const leaseToken = (0, node_crypto_1.randomUUID)();
            const row = this.stmtFetch.get(now, this.workerId, leaseToken, now + this.leaseDurationMs, now, this.leaseDurationMs, this.queueName, now);
            if (!row) {
                // Адаптивный backoff при пустой очереди: до 2s (не влияет на latency занятых воркеров)
                this.idleStreak = Math.min(this.idleStreak + 1, 10);
                this.currentPollInterval = Math.min(this.pollInterval * Math.pow(1.5, Math.min(this.idleStreak, 4)), 2000);
                return;
            }
            // Есть работа — сбрасываем backoff
            this.idleStreak = 0;
            this.currentPollInterval = this.pollInterval;
            this.activeCount++;
            const job = this.rowToJob(row);
            job.status = 'active';
            job.started_at = now;
            job.leaseToken = leaseToken;
            const context = {
                leaseToken,
                heartbeat: () => this.heartbeat(job.id, leaseToken),
                isCancellationRequested: () => this.isCancellationRequested(job.id, leaseToken),
                isLeaseValid: () => this.isLeaseValid(job.id, leaseToken),
            };
            const heartbeatTimer = setInterval(() => context.heartbeat(), this.heartbeatIntervalMs);
            Promise.resolve()
                .then(() => this.handler(job, context))
                .then((result) => this.completeOrCancel(job, leaseToken, result))
                .catch((err) => this.failOrRetry(job, leaseToken, err))
                .finally(() => {
                clearInterval(heartbeatTimer);
                this.activeCount--;
            });
        }
        catch (err) {
            // SQLITE_BUSY или другая ошибка — пропускаем этот цикл
            if (err?.code !== 'SQLITE_BUSY') {
                console.error(`[SqliteQueue Worker ${this.queueName}] Poll error:`, err);
            }
        }
    }
    completeOrCancel(job, leaseToken, result) {
        try {
            if (this.isCancellationRequested(job.id, leaseToken)) {
                this.failCancelled(job.id, leaseToken);
                return;
            }
            const completed = this.stmtComplete.run(JSON.stringify(result), Date.now(), job.id, leaseToken);
            // Cancellation can race a successful handler between the check and UPDATE.
            if (completed.changes === 0) {
                if (this.isCancellationRequested(job.id, leaseToken)) {
                    this.failCancelled(job.id, leaseToken);
                }
                else {
                    // Lease lost (stale recovery claimed the row) — handler result is silently dropped.
                    // Log so operators can investigate potential double-processing.
                    console.warn(`[SqliteQueue] Job ${job.id} (${this.queueName}): complete skipped — lease lost or job no longer active`);
                }
            }
        }
        catch (err) {
            console.error(`[SqliteQueue] Failed to save result for job ${job.id}:`, err);
        }
    }
    failOrRetry(job, leaseToken, err) {
        try {
            if (this.isCancellationRequested(job.id, leaseToken)) {
                this.failCancelled(job.id, leaseToken);
                return;
            }
            const errorMsg = err.message || String(err);
            const isPermanent = err instanceof types_1.PermanentError || err?.permanent === true;
            if (!isPermanent && job.attempts < job.max_attempts) {
                // Retry с exponential backoff (только temporary ошибки).
                const delayMs = Math.pow(2, job.attempts) * 1000;
                const retryAt = Date.now() + delayMs;
                const retried = this.stmtRetry.run(errorMsg, retryAt, job.id, leaseToken);
                if (retried.changes === 0 && this.isCancellationRequested(job.id, leaseToken)) {
                    this.failCancelled(job.id, leaseToken);
                }
            }
            else {
                this.stmtFail.run(errorMsg, Date.now(), job.id, leaseToken);
            }
        }
        catch (dbErr) {
            console.error(`[SqliteQueue] Failed to update failed job ${job.id}:`, dbErr);
        }
    }
    failCancelled(jobId, leaseToken) {
        this.stmtFail.run(CANCELLATION_ERROR, Date.now(), jobId, leaseToken);
    }
    heartbeat(jobId, leaseToken) {
        const now = Date.now();
        // New claims persist lease_duration_ms; this worker default is only for legacy rows.
        return this.stmtHeartbeat.run(now, now, this.leaseDurationMs, jobId, leaseToken).changes > 0;
    }
    isCancellationRequested(jobId, leaseToken) {
        return Boolean(this.stmtCancellationRequested.get(jobId, leaseToken));
    }
    isLeaseValid(jobId, leaseToken) {
        return Boolean(this.stmtLeaseValid.get(jobId, leaseToken, Date.now()));
    }
    rowToJob(row) {
        return {
            ...row,
            status: row.status,
            data: JSON.parse(row.data),
            result: row.result ? JSON.parse(row.result) : null,
            leaseToken: row.lease_token,
        };
    }
    stop() {
        this.stopped = true;
        if (this.pollTimer) {
            clearTimeout(this.pollTimer);
            this.pollTimer = null;
        }
    }
    /** Graceful stop — прекращаем брать новые задачи и ждём завершения активных */
    async gracefulStop(timeoutMs = 15000) {
        this.stopped = true;
        if (this.pollTimer) {
            clearTimeout(this.pollTimer);
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
    getActiveCount() {
        return this.activeCount;
    }
}
exports.Worker = Worker;
//# sourceMappingURL=worker.js.map