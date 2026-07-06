/**
 * SQLite Queue — легковесная очередь задач на better-sqlite3
 *
 * Заменяет RabbitMQ (messaging между сервисами) и Redis/BullMQ (scheduling).
 * Все процессы работают с одним файлом queue.db через WAL mode.
 */
import { Worker } from './worker';
import type { Job, AddJobOptions, WorkerOptions, QueueStats, QueueStatsDetailed } from './types';
export { Worker } from './worker';
export { PermanentError } from './types';
export type { Job, JobRow, AddJobOptions, WorkerOptions, QueueStats, QueueStatsDetailed } from './types';
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
    private stmtFindByCorrelation;
    private stmtStaleRecovery;
    private stmtStaleExhausted;
    private stmtCleanup;
    private stmtQueueStats;
    private stmtAllQueues;
    constructor(dbPath: string, opts?: {
        staleTimeoutMin?: number;
        retentionHours?: number;
        disableTimers?: boolean;
    });
    /**
     * Добавить задачу в очередь
     * Если correlationId указан и idempotent=true — проверяет дубликаты (pending/active)
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
    process(queue: string, handler: (job: Job) => Promise<any>, opts?: WorkerOptions): Worker;
    private rowToJob;
    /**
     * Получить задачу по ID
     */
    getJob(id: number): Job | null;
    /**
     * Поиск jobs по префиксу correlationId (КРИТ-7: восстановление после рестарта)
     */
    findJobsByCorrelationPrefix(queue: string, prefix: string, statusFilter?: string[]): Job[];
    /**
     * Статистика по одной очереди
     */
    getQueueStats(queue: string): QueueStats;
    /**
     * Полная статистика по всем очередям (для /api/queue-stats endpoint)
     */
    getDetailedStats(): QueueStatsDetailed;
    /**
     * Восстановить зависшие задачи (status=active дольше staleTimeoutMin)
     */
    private recoverStaleJobs;
    /**
     * Очистить старые completed/failed задачи
     */
    private cleanOldJobs;
    /**
     * Отменить pending job (для отмены delayed/scheduled задач)
     */
    cancelJob(id: number): boolean;
    /**
     * Очистить все pending/active задачи в очереди (для pipeline cancel)
     */
    clearQueue(queue: string): number;
    /**
     * Ручная очистка
     */
    clean(olderThanMs?: number): number;
    /**
     * Graceful close — ждём завершения активных задач во всех workers, затем закрываем БД
     */
    gracefulClose(timeoutMs?: number): Promise<void>;
    /**
     * Остановить все workers и закрыть БД
     */
    close(): void;
}
