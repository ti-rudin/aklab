/**
 * Queue worker для микросервисов.
 * Слушает очередь из config.queueName и вызывает переданный handler.
 */

import { SqliteQueue } from '@aklab/sqlite-queue';
import type { Job } from '@aklab/sqlite-queue';
import { config } from './config';
import { logger } from './logger';

let queue: SqliteQueue | null = null;

export function startQueueWorker(handler: (job: Job) => Promise<any>): void {
  queue = new SqliteQueue(config.queue.dbPath, { disableTimers: true });
  queue.process(config.queueName, handler, { concurrency: 2 });
  logger.info(`Queue worker started — listening on ${config.queueName}`);
}

export function stopQueueWorker(): void {
  if (queue) {
    queue.close();
    queue = null;
    logger.info('Queue worker stopped');
  }
}

export function gracefulStopQueueWorker(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    if (!queue) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      logger.warn('Graceful stop timeout — force closing');
      stopQueueWorker();
      resolve();
    }, timeoutMs);

    stopQueueWorker();
    clearTimeout(timer);
    resolve();
  });
}
