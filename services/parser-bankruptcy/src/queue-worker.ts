/**
 * Queue worker для parser-bankruptcy.
 * Слушает очередь 'parse-bankruptcy' и вызывает handler.
 */

import { SqliteQueue } from '@aklab/sqlite-queue';
import { config } from './config';
import { handleParseJob } from './handler';
import { logger } from './utils/logger';

let queue: SqliteQueue | null = null;

export function startQueueWorker(): void {
  queue = new SqliteQueue(config.queue.dbPath, { disableTimers: true });
  queue.process('parse-bankruptcy', handleParseJob, { concurrency: 2 });
  logger.info('Queue worker started — listening on parse-bankruptcy');
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

    // SqliteQueue не имеет drain — просто закрываем по таймауту
    stopQueueWorker();
    clearTimeout(timer);
    resolve();
  });
}
