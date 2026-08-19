import { SqliteQueue } from '@aklab/sqlite-queue';
import { config } from './config';
import { handleAnalyzeJob } from './handler';
import { logger } from './utils/logger';

let queue: SqliteQueue | null = null;

export function startQueueWorker(): void {
  queue = new SqliteQueue(config.queue.dbPath, { disableTimers: true });
  queue.process('analyze-property', handleAnalyzeJob, { concurrency: 3 });
  logger.info('Queue worker started — listening on analyze-property');
}

export function stopQueueWorker(): void {
  if (queue) {
    queue.close();
    queue = null;
    logger.info('Queue worker stopped');
  }
}

export async function gracefulStopQueueWorker(timeoutMs: number): Promise<void> {
  if (!queue) return;
  const q = queue;
  queue = null;
  try {
    await q.gracefulClose(timeoutMs);
    logger.info('Queue worker stopped gracefully');
  } catch (err: any) {
    logger.warn(`Queue graceful close error: ${err.message}`);
  }
}
