/**
 * SQLite Queue Worker — поллинг очереди и обработка задач
 */
import type Database from 'better-sqlite3';
import type { JobHandler, WorkerOptions } from './types';
export declare class Worker {
    private db;
    private queueName;
    private handler;
    private concurrency;
    private pollInterval;
    private leaseDurationMs;
    private heartbeatIntervalMs;
    private workerId;
    private activeCount;
    private pollTimer;
    private stopped;
    private stmtFetch;
    private stmtClaim;
    private stmtComplete;
    private stmtFail;
    private stmtRetry;
    private stmtHeartbeat;
    private stmtCancellationRequested;
    private stmtLeaseValid;
    constructor(db: Database.Database, queueName: string, handler: JobHandler, opts?: WorkerOptions);
    private start;
    private poll;
    private completeOrCancel;
    private failOrRetry;
    private failCancelled;
    private heartbeat;
    private isCancellationRequested;
    private isLeaseValid;
    private rowToJob;
    stop(): void;
    /** Graceful stop — прекращаем брать новые задачи и ждём завершения активных */
    gracefulStop(timeoutMs?: number): Promise<void>;
    getActiveCount(): number;
}
