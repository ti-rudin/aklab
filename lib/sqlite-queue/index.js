"use strict";
/**
 * SQLite Queue — легковесная очередь задач на better-sqlite3
 *
 * Заменяет RabbitMQ (messaging между сервисами) и Redis/BullMQ (scheduling).
 * Все процессы работают с одним файлом queue.db через WAL mode.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SqliteQueue = exports.PermanentError = exports.Worker = void 0;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const worker_1 = require("./worker");
var worker_2 = require("./worker");
Object.defineProperty(exports, "Worker", { enumerable: true, get: function () { return worker_2.Worker; } });
var types_1 = require("./types");
Object.defineProperty(exports, "PermanentError", { enumerable: true, get: function () { return types_1.PermanentError; } });
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
class SqliteQueue {
    constructor(dbPath, opts) {
        this.workers = [];
        this.staleCheckTimer = null;
        this.cleanupTimer = null;
        this.staleTimeoutMin = opts?.staleTimeoutMin ?? parseInt(process.env.QUEUE_STALE_TIMEOUT_MIN || '5', 10);
        this.retentionHours = opts?.retentionHours ?? parseInt(process.env.QUEUE_RETENTION_HOURS || '48', 10);
        this.db = new better_sqlite3_1.default(dbPath);
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
        this.stmtFindByCorrelation = this.db.prepare(`SELECT * FROM jobs WHERE queue = ? AND correlation_id = ? AND status IN ('pending', 'active') LIMIT 1`);
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
            this.staleCheckTimer = setInterval(() => this.recoverStaleJobs(), 60000);
            this.cleanupTimer = setInterval(() => this.cleanOldJobs(), 5 * 60000);
        }
    }
    /**
     * Добавить задачу в очередь
     * Если correlationId указан и idempotent=true — проверяет дубликаты (pending/active)
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Queue accepts arbitrary JSON payloads
    add(queue, data, opts) {
        const now = Date.now();
        const scheduledAt = opts?.delay ? now + opts.delay : null;
        const correlationId = opts?.correlationId || null;
        const priority = opts?.priority ?? 0;
        const maxAttempts = opts?.maxAttempts ?? 3;
        // Idempotency: если correlationId уже есть в pending/active — возвращаем существующую
        if (correlationId && opts?.idempotent) {
            const existing = this.stmtFindByCorrelation.get(queue, correlationId);
            if (existing) {
                return this.rowToJob(existing);
            }
        }
        const result = this.stmtAdd.run(queue, JSON.stringify(data), correlationId, now, scheduledAt, priority, maxAttempts);
        return this.getJob(result.lastInsertRowid);
    }
    /**
     * Добавить задачу и дождаться результата (RPC паттерн)
     * Заменяет RabbitMQ sendRequest с replyTo + correlationId
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Queue accepts/returns arbitrary JSON payloads
    async addAndWait(queue, data, timeoutMs, correlationId) {
        const job = this.add(queue, data, { correlationId });
        const deadline = Date.now() + timeoutMs;
        const pollInterval = parseInt(process.env.QUEUE_POLL_INTERVAL_MS || '200', 10);
        while (Date.now() < deadline) {
            const row = this.stmtGetStatus.get(job.id);
            if (!row) {
                throw new Error(`[SqliteQueue] Job ${job.id} not found`);
            }
            if (row.status === 'completed') {
                return row.result ? JSON.parse(row.result) : null;
            }
            if (row.status === 'failed') {
                const error = new Error(row.error || `Job ${job.id} failed`);
                error.errorCode = 'JOB_FAILED';
                error.jobId = job.id;
                throw error;
            }
            await sleep(pollInterval);
        }
        // Таймаут — помечаем job как failed
        const failStmt = this.db.prepare('UPDATE jobs SET status = ?, error = ?, completed_at = ? WHERE id = ? AND status IN (?, ?)');
        failStmt.run('failed', `Timeout after ${timeoutMs}ms`, Date.now(), job.id, 'pending', 'active');
        const error = new Error(`[SqliteQueue] Timeout waiting for ${queue} job ${job.id} after ${timeoutMs}ms`);
        error.errorCode = 'REQUEST_TIMEOUT';
        error.requestType = queue;
        error.correlationId = correlationId;
        throw error;
    }
    /**
     * Запустить worker для обработки очереди
     */
    process(queue, handler, opts) {
        const pollInterval = opts?.pollInterval ?? parseInt(process.env.QUEUE_POLL_INTERVAL_MS || '200', 10);
        const worker = new worker_1.Worker(this.db, queue, handler, {
            concurrency: opts?.concurrency ?? 1,
            pollInterval,
        });
        this.workers.push(worker);
        return worker;
    }
    rowToJob(row) {
        return {
            ...row,
            status: row.status,
            data: JSON.parse(row.data),
            result: row.result ? JSON.parse(row.result) : null,
        };
    }
    /**
     * Получить задачу по ID
     */
    getJob(id) {
        const row = this.stmtGetById.get(id);
        if (!row)
            return null;
        return this.rowToJob(row);
    }
    /**
     * Поиск jobs по префиксу correlationId (КРИТ-7: восстановление после рестарта)
     */
    findJobsByCorrelationPrefix(queue, prefix, statusFilter) {
        const statuses = statusFilter || ['pending', 'active'];
        const placeholders = statuses.map(() => '?').join(',');
        const stmt = this.db.prepare(`SELECT * FROM jobs WHERE queue = ? AND correlation_id LIKE ? AND status IN (${placeholders}) LIMIT 10`);
        const rows = stmt.all(queue, `${prefix}%`, ...statuses);
        return rows.map(row => this.rowToJob(row));
    }
    /**
     * Статистика по одной очереди
     */
    getQueueStats(queue) {
        const rows = this.stmtQueueStats.all(queue);
        const stats = { pending: 0, active: 0, completed: 0, failed: 0 };
        for (const row of rows) {
            if (row.status in stats) {
                stats[row.status] = row.count;
            }
        }
        return stats;
    }
    /**
     * Полная статистика по всем очередям (для /api/queue-stats endpoint)
     */
    getDetailedStats() {
        const queues = {};
        const total = { pending: 0, active: 0, completed: 0, failed: 0 };
        const allQueues = this.stmtAllQueues.all();
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
            const sizeRow = this.db.prepare("SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()").get();
            dbSizeBytes = sizeRow?.size ?? 0;
        }
        catch {
            // ignore
        }
        return { queues, total, dbSizeBytes };
    }
    /**
     * Восстановить зависшие задачи (status=active дольше staleTimeoutMin)
     */
    recoverStaleJobs() {
        try {
            const threshold = Date.now() - this.staleTimeoutMin * 60000;
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
        }
        catch (err) {
            console.error('[SqliteQueue] Stale recovery error:', err);
        }
    }
    /**
     * Очистить старые completed/failed задачи
     */
    cleanOldJobs() {
        try {
            const threshold = Date.now() - this.retentionHours * 3600000;
            const result = this.stmtCleanup.run(threshold);
            if (result.changes > 0) {
                console.log(`[SqliteQueue] Cleaned ${result.changes} old jobs`);
            }
        }
        catch (err) {
            console.error('[SqliteQueue] Cleanup error:', err);
        }
    }
    /**
     * Отменить pending job (для отмены delayed/scheduled задач)
     */
    cancelJob(id) {
        const stmt = this.db.prepare("UPDATE jobs SET status = 'failed', error = 'cancelled', completed_at = ? WHERE id = ? AND status = 'pending'");
        return stmt.run(Date.now(), id).changes > 0;
    }
    /**
     * Очистить все pending/active задачи в очереди (для pipeline cancel)
     */
    clearQueue(queue) {
        const now = Date.now();
        const stmt = this.db.prepare("UPDATE jobs SET status = 'failed', error = 'queue cleared', completed_at = ? WHERE queue = ? AND status IN ('pending', 'active')");
        return stmt.run(now, queue).changes;
    }
    /**
     * Ручная очистка
     */
    clean(olderThanMs) {
        const threshold = Date.now() - (olderThanMs ?? this.retentionHours * 3600000);
        return this.stmtCleanup.run(threshold).changes;
    }
    /**
     * Graceful close — ждём завершения активных задач во всех workers, затем закрываем БД
     */
    async gracefulClose(timeoutMs = 15000) {
        await Promise.all(this.workers.map(w => w.gracefulStop(timeoutMs)));
        this.close();
    }
    /**
     * Остановить все workers и закрыть БД
     */
    close() {
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
exports.SqliteQueue = SqliteQueue;
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
//# sourceMappingURL=index.js.map