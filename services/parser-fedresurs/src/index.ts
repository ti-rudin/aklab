import { startHealthServer, gracefulStopQueueWorker, logger } from '@aklab/service-shared';
import { startQueueWorker } from './queue-worker';

const SHUTDOWN_TIMEOUT_MS = 30000; // Fedresurs needs more time (Qrator + multiple API calls)

async function main(): Promise<void> {
  logger.info('Starting parser-fedresurs service...');
  await startHealthServer();
  startQueueWorker();
  logger.info('parser-fedresurs service ready');
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
main().catch((err) => { logger.error(`Startup failed: ${err.message}`); process.exit(1); });
