import { SqliteQueue } from '@aklab/sqlite-queue';
import { config } from './config';
import { handleDigestJob } from './handler';
import { logger } from './utils/logger';

let queue: SqliteQueue | null = null;

export function startQueueWorker(): void {
  queue = new SqliteQueue(config.queue.dbPath, { disableTimers: true });
  queue.process('digest-send', handleDigestJob, { concurrency: 1 });
  logger.info('Queue worker started — listening on digest-send');
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
    if (!queue) { resolve(); return; }
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
