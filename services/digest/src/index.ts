import { startHealthServer } from './server';
import { startQueueWorker, gracefulStopQueueWorker } from './queue-worker';
import { logger } from './utils/logger';

const SHUTDOWN_TIMEOUT_MS = 15000;

async function main(): Promise<void> {
  logger.info('Starting digest service...');
  await startHealthServer();
  startQueueWorker();
  logger.info('Digest service ready');
}

function setupShutdown(): void {
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal} — shutting down...`);
    await gracefulStopQueueWorker(SHUTDOWN_TIMEOUT_MS);
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

setupShutdown();

main().catch((err) => {
  logger.error(`Startup failed: ${err.message}`);
  process.exit(1);
});
