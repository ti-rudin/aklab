/**
 * @aklab/service-shared — общие модули для микросервисов парсинга.
 */

export { config } from './config';
export { logger } from './logger';
export { startHealthServer } from './health-server';
export { startQueueWorker, stopQueueWorker, gracefulStopQueueWorker } from './queue-worker';
export { propertyExists, createProperty, updateSourceStats, logCron, fetchProperty, findActiveMarketReference, fetchSetting, updateProperty } from './strapi-client';
export { createParseHandler } from './parse-handler';
export type { ParsedProperty, SourceParser } from './types';
