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
  correlation_id: string | null;
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
  scheduled_at: number | null;
  priority: number;
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
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
  scheduled_at: number | null;
  priority: number;
}

export interface AddJobOptions {
  delay?: number;
  correlationId?: string;
  priority?: number;
  maxAttempts?: number;
  /** Если true и correlationId задан — не создавать дубликат pending/active задачи */
  idempotent?: boolean;
}

export interface WorkerOptions {
  concurrency?: number;
  pollInterval?: number;
}

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
