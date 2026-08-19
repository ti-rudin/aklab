/**
 * Queue worker для микросервисов.
 * Слушает очередь из config.queueName и вызывает переданный handler.
 */

import { SqliteQueue } from '@aklab/sqlite-queue';
import type { Job, WorkerContext } from '@aklab/sqlite-queue';
import { config } from './config';
import { logger } from './logger';
import { startHealthServer } from './health-server';

let queue: SqliteQueue | null = null;

export function startQueueWorker(handler: (job: Job, workerContext: WorkerContext) => Promise<any>): void {
  const concurrency = parseInt(process.env.PARSER_CONCURRENCY || '2', 10);
  queue = new SqliteQueue(config.queue.dbPath, { disableTimers: true });
  queue.process(config.queueName, handler, { concurrency });
  logger.info(`Queue worker started — listening on ${config.queueName} (concurrency=${concurrency})`);
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

/**
 * Шаблон запуска парсер-микросервиса: health server + queue worker + SIGTERM.
 * Устраняет дублирование ~35 строк в каждом из 10+ парсеров.
 */
export function createParserMicroservice(
  serviceName: string,
  handler: (job: Job, workerContext: WorkerContext) => Promise<any>,
  options?: {
    shutdownTimeoutMs?: number;
    concurrency?: number;
  }
): void {
  const SHUTDOWN_TIMEOUT_MS = options?.shutdownTimeoutMs ?? 15000;
  const concurrency = options?.concurrency
    ?? parseInt(process.env.PARSER_CONCURRENCY || '2', 10);

  async function main(): Promise<void> {
    logger.info(`Starting ${serviceName} service...`);
    await startHealthServer();
    // Используем собственный queue для каждого микросервиса (не shared global)
    const q = new SqliteQueue(config.queue.dbPath, { disableTimers: true });
    queue = q;
    q.process(config.queueName, handler, { concurrency });
    logger.info(`${serviceName} service ready (queue=${config.queueName} concurrency=${concurrency})`);
  }

  function setupShutdown(): void {
    const shutdown = async (signal: string) => {
      logger.info(`[${serviceName}] Received ${signal} — shutting down...`);
      await gracefulStopQueueWorker(SHUTDOWN_TIMEOUT_MS);
      process.exit(0);
    };
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    process.on('SIGINT', () => void shutdown('SIGINT'));
  }

  setupShutdown();
  main().catch((err) => {
    logger.error(`[${serviceName}] Startup failed: ${err.message}`);
    process.exit(1);
  });
}
