/**
 * Queue Service для Strapi (aklab)
 *
 * Singleton-обёртка над @aklab/sqlite-queue.
 * Донор: strapi/src/services/queueService.ts в tirobots.
 *
 * Фаза 0: скелет — инициализация очереди, базовые методы.
 * Фаза 3: REQUEST_TYPE_TO_QUEUE заполнен по docs/plan2.md.
 */

import { SqliteQueue } from '@aklab/sqlite-queue';
import type { Job } from '@aklab/sqlite-queue';

// Маппинг requestType → имя SQLite очереди.
const REQUEST_TYPE_TO_QUEUE: Record<string, string> = {
  'parse:bankruptcy:request': 'parse-bankruptcy',
  'analyze:property:request': 'analyze-property',
  'digest:send:request': 'digest-send',
};

// Singleton SqliteQueue
let queueInstance: SqliteQueue | null = null;

export function getQueueInstance(): SqliteQueue {
  if (!queueInstance) {
    // По умолчанию — queue.db в корне проекта (рядом с api/, доступен микросервисам).
    // В Фазе 8 зафиксируем абсолютный путь ~/aklab/queue.db на проде.
    const dbPath = process.env.QUEUE_DB_PATH || '../queue.db';
    queueInstance = new SqliteQueue(dbPath);
  }
  return queueInstance;
}

export interface QueueError {
  errorCode?: string;
  message: string;
  details?: any;
  correlationId?: string;
  requestType?: string;
}

/**
 * QueueService — управление очередями задач через SqliteQueue.
 */
export class QueueService {
  private queue: SqliteQueue;

  constructor() {
    this.queue = getQueueInstance();
  }

  /**
   * Отправляет запрос в очередь и ждёт ответа (RPC).
   */
  async sendRequest(
    requestType: string,
    message: any,
    timeoutMs = 60000,
    correlationId?: string
  ): Promise<any> {
    const queueName = REQUEST_TYPE_TO_QUEUE[requestType];
    if (!queueName) {
      throw {
        errorCode: 'UNKNOWN_REQUEST_TYPE',
        message: `Unknown request type: ${requestType}`,
        requestType,
      } as QueueError;
    }

    try {
      return await this.queue.addAndWait(queueName, message, timeoutMs, correlationId);
    } catch (error: any) {
      if (error?.errorCode) throw error;
      throw {
        errorCode: 'QUEUE_ERROR',
        message: error?.message || 'Queue request failed',
        correlationId,
        requestType,
      } as QueueError;
    }
  }

  /**
   * Добавить job напрямую в именованную очередь.
   */
  addToQueue(
    queueName: string,
    data: any,
    opts?: {
      delay?: number;
      correlationId?: string;
      idempotencyKey?: string;
      priority?: number;
      maxAttempts?: number;
    }
  ): Job {
    return this.queue.add(queueName, data, opts);
  }

  /**
   * Добавить job и дождаться результата.
   */
  async addAndWait(queueName: string, data: any, timeoutMs: number, correlationId?: string): Promise<any> {
    return this.queue.addAndWait(queueName, data, timeoutMs, correlationId);
  }

  /**
   * Запустить worker для обработки очереди (Strapi-side workers).
   */
  process(queueName: string, handler: (job: Job) => Promise<any>, opts?: { concurrency?: number }) {
    return this.queue.process(queueName, handler, opts);
  }

  /**
   * Статистика по всем очередям.
   */
  getDetailedStats() {
    return this.queue.getDetailedStats();
  }

  /** Получить конкретную job без привязки к агрегированной статистике очереди. */
  getJob(id: number): Job | null {
    return this.queue.getJob(id);
  }

  /** Request cooperative cancellation for one run-owned job. */
  requestCancellation(id: number): boolean {
    return this.queue.requestCancellation(id);
  }

  /**
   * Очистить все pending/active задачи в очереди (для legacy callers only).
   */
  clearQueue(queueName: string): number {
    return this.queue.clearQueue(queueName);
  }

  /**
   * Graceful close.
   */
  async close(): Promise<void> {
    if (queueInstance) {
      queueInstance.close();
      queueInstance = null;
    }
  }
}

let queueServiceInstance: QueueService | null = null;

export function getQueueService(): QueueService {
  if (!queueServiceInstance) {
    queueServiceInstance = new QueueService();
  }
  return queueServiceInstance;
}

export default getQueueService;
