/**
 * Queue worker для parser-fabrikant.
 * Слушает очередь 'parse-fabrikant' и вызывает handler.
 */

import { startQueueWorker as startWorker, logger } from '@aklab/service-shared';
import { handleParseJob } from './handler';

export function startQueueWorker(): void {
  startWorker(handleParseJob);
  logger.info('Queue worker registered for parse-fabrikant');
}
