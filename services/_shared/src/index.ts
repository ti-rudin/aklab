/**
 * @aklab/service-shared — общие модули для микросервисов парсинга.
 */

export { config } from './config';
export { logger } from './logger';
export { startHealthServer } from './health-server';
export { startQueueWorker, stopQueueWorker, gracefulStopQueueWorker, createParserMicroservice } from './queue-worker';
export { propertyExists, createProperty, updateSourceStats, resetSourceDetailsCounters, logCron, fetchProperty, findActiveMarketReference, fetchSetting, updateProperty } from './strapi-client';
export { createParseHandler } from './parse-handler';
export { randomDelay, USER_AGENTS, getRandomUA, retryGoto, createStealthContext } from './anti-ban';

export { classifyPropertyType } from './property-classifier';
export { extractAuctionEndAt, hasAuctionEnded, parseAuctionEndAt } from './auction-date';
export { parsePrice } from './price';
export {
  dedupeParties,
  derivePropertyRegion,
  extractAddressFromBoundedPropertyText,
  mergePropertyLocation,
  normalizeStructuredLocation,
  projectLegacyAddress,
} from './property-location';
export * from './parser-diagnostics';
export * from './parser-error';
export * from './parser-probe';
export type {
  ParsedProperty,
  PartyAddress,
  PropertyLocation,
  PropertyLocationStatus,
  PropertyParty,
  PropertyPartyRole,
  SourceParser,
  ParseOptions,
  ParseResult,
  ParserDetailResult,
  StructuredSourceKind,
} from './types';
