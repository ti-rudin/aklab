/**
 * SQLite Queue — типы и интерфейсы
 */

/**
 * PermanentError — ошибка, которую НЕ нужно ретраить.
 * Примеры: невалидные данные, отсутствующий ресурс, бизнес-ошибка.
 * Queue worker сразу помечает job как 'failed' без retry.
 */
export class PermanentError extends Error {
  readonly permanent = true;

  constructor(message: string) {
    super(message);
    this.name = 'PermanentError';
  }
}

export type JobStatus = 'pending' | 'active' | 'completed' | 'failed';

export interface Job {
  id: number;
  queue: string;
  status: JobStatus;
  data: any;
  result: any | null;
  error: string | null;
  attempts: number;
  max_attempts: number;
  /** Trace field only; it is not used as the primary idempotency key. */
  correlation_id: string | null;
  idempotency_key: string | null;
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
  scheduled_at: number | null;
  priority: number;
  locked_by: string | null;
  lease_token: string | null;
  lease_expires_at: number | null;
  /** Lease duration stored atomically with the current claim; null only for legacy rows. */
  lease_duration_ms: number | null;
  heartbeat_at: number | null;
  cancellation_requested_at: number | null;
  /** Camel-case alias for handlers and public consumers. */
  leaseToken: string | null;
}

export interface JobRow {
  id: number;
  queue: string;
  status: string;
  data: string;
  result: string | null;
  error: string | null;
  attempts: number;
  max_attempts: number;
  correlation_id: string | null;
  idempotency_key: string | null;
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
  scheduled_at: number | null;
  priority: number;
  locked_by: string | null;
  lease_token: string | null;
  lease_expires_at: number | null;
  lease_duration_ms: number | null;
  heartbeat_at: number | null;
  cancellation_requested_at: number | null;
}

export interface AddJobOptions {
  delay?: number;
  correlationId?: string;
  /** Queue-scoped key protected by a partial unique index while job is pending/active. */
  idempotencyKey?: string;
  priority?: number;
  maxAttempts?: number;
  /** @deprecated Use idempotencyKey. correlationId remains a trace field. */
  idempotent?: boolean;
}

export interface WorkerOptions {
  concurrency?: number;
  pollInterval?: number;
  /** Duration for which a claimed job is exclusively owned before a heartbeat is required. */
  leaseDurationMs?: number;
  /** Override the automatic lease-heartbeat interval. */
  heartbeatIntervalMs?: number;
}

/** Cooperative controls supplied as the second, optional worker-handler argument. */
export interface WorkerContext {
  leaseToken: string;
  heartbeat(): boolean;
  isCancellationRequested(): boolean;
  /**
   * Atomically verifies that this handler still owns a non-expired active lease.
   * Optional so existing handler/context implementations remain compatible.
   */
  isLeaseValid?(): boolean;
}

export type JobHandler = (job: Job, context: WorkerContext) => Promise<any> | any;

export interface QueueStats {
  pending: number;
  active: number;
  completed: number;
  failed: number;
}

export interface QueueStatsDetailed {
  queues: Record<string, QueueStats>;
  total: QueueStats;
  dbSizeBytes: number;
}
