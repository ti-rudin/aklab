/**
 * SQLite Queue Worker — поллинг очереди и обработка задач
 */
import type Database from 'better-sqlite3';
import type { Job, WorkerOptions } from './types';
type JobHandler = (job: Job) => Promise<any>;
export declare class Worker {
    private db;
    private queueName;
    private handler;
    private concurrency;
    private pollInterval;
    private activeCount;
    private pollTimer;
    private stopped;
    private stmtFetch;
    private stmtClaim;
    private stmtComplete;
    private stmtFail;
    private stmtRetry;
    constructor(db: Database.Database, queueName: string, handler: JobHandler, opts?: WorkerOptions);
    private start;
    private poll;
    private rowToJob;
    stop(): void;
    /**
     * Graceful stop — прекращаем брать новые задачи и ждём завершения активных
     */
    gracefulStop(timeoutMs?: number): Promise<void>;
    getActiveCount(): number;
}
export {};
