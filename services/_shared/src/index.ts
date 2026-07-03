/**
 * @aklab/service-shared — общие модули для микросервисов парсинга.
 */

export { config } from './config';
export { logger } from './logger';
export { startHealthServer } from './health-server';
export { startQueueWorker, stopQueueWorker, gracefulStopQueueWorker } from './queue-worker';
export { propertyExists, createProperty, updateSourceStats, resetSourceDetailsCounters, logCron, fetchProperty, findActiveMarketReference, fetchSetting, updateProperty } from './strapi-client';
export { createParseHandler } from './parse-handler';
export { randomDelay, USER_AGENTS, getRandomUA, retryGoto, createStealthContext } from './anti-ban';
export { detectCity } from './city-detect';
export type { ParsedProperty, SourceParser, ParseOptions, ParseResult } from './types';
