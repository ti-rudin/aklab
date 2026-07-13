import { startQueueWorker as startWorker, logger } from '@aklab/service-shared';
import { handleParseJob } from './handler';

export function startQueueWorker(): void {
  startWorker(handleParseJob);
  logger.info('Queue worker registered for parse-fedresurs');
}
