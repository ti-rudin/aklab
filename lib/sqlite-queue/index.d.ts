/**
 * SQLite Queue — легковесная очередь задач на better-sqlite3
 *
 * Заменяет RabbitMQ (messaging между сервисами) и Redis/BullMQ (scheduling).
 * Все процессы работают с одним файлом queue.db через WAL mode.
 */
import { Worker } from './worker';
import type { Job, JobHandler, AddJobOptions, WorkerOptions, QueueStats, QueueStatsDetailed } from './types';
export { Worker } from './worker';
export { PermanentError } from './types';
export type { Job, JobHandler, JobRow, AddJobOptions, WorkerContext, WorkerOptions, QueueStats, QueueStatsDetailed } from './types';
export declare class SqliteQueue {
    private db;
    private workers;
    private staleCheckTimer;
    private cleanupTimer;
    private staleTimeoutMin;
    private retentionHours;
    private stmtAdd;
    private stmtGetById;
    private stmtGetStatus;
    private stmtFindByIdempotency;
    private stmtStaleCancelled;
    private stmtStaleRecovery;
    private stmtStaleExhausted;
    private stmtCleanup;
    private stmtQueueStats;
    private stmtAllQueues;
    private stmtHeartbeat;
    private stmtCancelPending;
    private stmtRequestActiveCancellation;
    constructor(dbPath: string, opts?: {
        staleTimeoutMin?: number;
        retentionHours?: number;
        disableTimers?: boolean;
    });
    /**
     * Apply the static schema under a SQLite write lock so concurrently starting
     * processes see one serialized migration of their shared queue.db.
     */
    private migrateSchema;
    /**
     * Добавить задачу в очередь.
     * correlationId служит только трассировке; дедупликация использует idempotencyKey.
     */
    add(queue: string, data: any, opts?: AddJobOptions): Job;
    /**
     * Добавить задачу и дождаться результата (RPC паттерн)
     * Заменяет RabbitMQ sendRequest с replyTo + correlationId
     */
    addAndWait(queue: string, data: any, timeoutMs: number, correlationId?: string): Promise<any>;
    /**
     * Запустить worker для обработки очереди
     */
    process(queue: string, handler: JobHandler, opts?: WorkerOptions): Worker;
    private rowToJob;
    /** Получить задачу по ID */
    getJob(id: number): Job | null;
    /**
     * Renew an active lease. A claimed row supplies its own persisted duration;
     * stale pre-migration rows alone fall back to staleTimeoutMin.
     */
    heartbeat(jobId: number, leaseToken: string): boolean;
    /**
     * Request cooperative cancellation. Pending work is terminally cancelled;
     * running work remains active until its owner acknowledges the request.
     */
    requestCancellation(id: number): boolean;
    /**
     * Поиск jobs по префиксу correlationId (КРИТ-7: восстановление после рестарта)
     */
    findJobsByCorrelationPrefix(queue: string, prefix: string, statusFilter?: string[]): Job[];
    /** Статистика по одной очереди */
    getQueueStats(queue: string): QueueStats;
    /** Полная статистика по всем очередям (для /api/queue-stats endpoint) */
    getDetailedStats(): QueueStatsDetailed;
    /** Восстановить зависшие задачи, prioritizing a lease over legacy started_at. */
    private recoverStaleJobs;
    /** Очистить старые completed/failed задачи */
    private cleanOldJobs;
    /** Отменить pending job (для отмены delayed/scheduled задач). */
    cancelJob(id: number): boolean;
    /**
     * Queue-wide cancellation: pending jobs fail immediately; active jobs receive
     * a cooperative cancellation request and retain their lease until the handler exits.
     */
    clearQueue(queue: string): number;
    /** Ручная очистка */
    clean(olderThanMs?: number): number;
    /** Graceful close — ждём завершения активных задач во всех workers, затем закрываем БД */
    gracefulClose(timeoutMs?: number): Promise<void>;
    /** Остановить все workers и закрыть БД */
    close(): void;
}
