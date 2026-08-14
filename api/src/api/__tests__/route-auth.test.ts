import { describe, expect, it } from 'vitest';
import cronRoutes from '../cron/routes/cron';
import cronLogRoutes from '../cron-log/routes/cron-log';
import digestProjectionRoutes from '../digest-projection/routes/digest-projection';
import focusRuleRoutes from '../focus-rule/routes/focus-rule';
import marketReferenceRoutes from '../market-reference/routes/market-reference';
import pipelineRoutes from '../pipeline/routes/pipeline';
import parserRunSourceRoutes from '../parser-run-source/routes/parser-run-source';
import propertyRoutes from '../property/routes/property';
import propertyEventRoutes from '../property-event/routes/property-event';
import settingRoutes from '../setting/routes/setting';
import sourceRoutes from '../source/routes/source';

type RouteConfig = {
  auth: unknown;
  policies: readonly string[];
};

type Route = {
  method: string;
  path: string;
  handler: string;
  config?: RouteConfig;
};

type RouteModule = {
  routes: readonly Route[];
};

type RouteExpectation = {
  resource: string;
  method: string;
  path: string;
  handler: string;
  config: RouteConfig;
};

const ADMIN_CONFIG = {
  auth: false,
  policies: ['global::authenticated-user', 'global::aklab-admin'],
} as const;

const SERVICE_CONFIG = {
  auth: false,
  policies: ['global::service-token'],
} as const;

const USER_CONFIG = {
  auth: false,
  policies: ['global::authenticated-user'],
} as const;

const PUBLIC_HEALTH_CONFIG = {
  auth: false,
  policies: [],
} as const;

const GLOBAL_ROUTE_MODULES: readonly { resource: string; module: RouteModule }[] = [
  { resource: 'setting', module: settingRoutes },
  { resource: 'source', module: sourceRoutes },
  { resource: 'market-reference', module: marketReferenceRoutes },
  { resource: 'focus-rule', module: focusRuleRoutes },
  { resource: 'cron', module: cronRoutes },
  { resource: 'cron-log', module: cronLogRoutes },
  { resource: 'pipeline', module: pipelineRoutes },
  { resource: 'parser-run-source', module: parserRunSourceRoutes },
  { resource: 'digest-projection', module: digestProjectionRoutes },
];

const GLOBAL_ROUTE_EXPECTATIONS: readonly RouteExpectation[] = [
  { resource: 'setting', method: 'GET', path: '/internal/setting/analyzer', handler: 'setting.internalFindAnalyzer', config: SERVICE_CONFIG },
  { resource: 'setting', method: 'GET', path: '/setting', handler: 'setting.find', config: ADMIN_CONFIG },
  { resource: 'setting', method: 'PUT', path: '/setting', handler: 'setting.update', config: ADMIN_CONFIG },

  { resource: 'source', method: 'GET', path: '/internal/sources/:id/stats', handler: 'api::source.source.internalFindStats', config: SERVICE_CONFIG },
  { resource: 'source', method: 'PUT', path: '/internal/sources/:id/stats', handler: 'api::source.source.internalUpdateStats', config: SERVICE_CONFIG },
  { resource: 'source', method: 'GET', path: '/sources/:id/health', handler: 'api::source.source.healthCheck', config: PUBLIC_HEALTH_CONFIG },
  { resource: 'source', method: 'GET', path: '/sources', handler: 'api::source.source.find', config: ADMIN_CONFIG },
  { resource: 'source', method: 'GET', path: '/sources/:id', handler: 'api::source.source.findOne', config: ADMIN_CONFIG },
  { resource: 'source', method: 'POST', path: '/sources', handler: 'api::source.source.create', config: ADMIN_CONFIG },
  { resource: 'source', method: 'PUT', path: '/sources/:id', handler: 'api::source.source.update', config: ADMIN_CONFIG },
  { resource: 'source', method: 'DELETE', path: '/sources/:id', handler: 'api::source.source.delete', config: ADMIN_CONFIG },

  { resource: 'market-reference', method: 'GET', path: '/internal/market-references/active', handler: 'market-reference.internalFindActive', config: SERVICE_CONFIG },
  { resource: 'market-reference', method: 'GET', path: '/market-references', handler: 'market-reference.find', config: ADMIN_CONFIG },
  { resource: 'market-reference', method: 'GET', path: '/market-references/:id', handler: 'market-reference.findOne', config: ADMIN_CONFIG },
  { resource: 'market-reference', method: 'POST', path: '/market-references', handler: 'market-reference.create', config: ADMIN_CONFIG },
  { resource: 'market-reference', method: 'PUT', path: '/market-references/:id', handler: 'market-reference.update', config: ADMIN_CONFIG },
  { resource: 'market-reference', method: 'DELETE', path: '/market-references/:id', handler: 'market-reference.delete', config: ADMIN_CONFIG },

  { resource: 'focus-rule', method: 'GET', path: '/focus-rules', handler: 'focus-rule.find', config: ADMIN_CONFIG },
  { resource: 'focus-rule', method: 'GET', path: '/focus-rules/:id', handler: 'focus-rule.findOne', config: ADMIN_CONFIG },
  { resource: 'focus-rule', method: 'POST', path: '/focus-rules', handler: 'focus-rule.create', config: ADMIN_CONFIG },
  { resource: 'focus-rule', method: 'PUT', path: '/focus-rules/:id', handler: 'focus-rule.update', config: ADMIN_CONFIG },
  { resource: 'focus-rule', method: 'DELETE', path: '/focus-rules/:id', handler: 'focus-rule.delete', config: ADMIN_CONFIG },

  { resource: 'cron', method: 'GET', path: '/cron/queue-stats', handler: 'cron.queueStats', config: ADMIN_CONFIG },
  { resource: 'cron', method: 'POST', path: '/cron/parse/:slug', handler: 'cron.parseSource', config: ADMIN_CONFIG },
  { resource: 'cron', method: 'POST', path: '/cron/analyze', handler: 'cron.analyzeAll', config: ADMIN_CONFIG },
  { resource: 'cron', method: 'POST', path: '/cron/canary', handler: 'cron.parserCanary', config: ADMIN_CONFIG },
  { resource: 'cron', method: 'POST', path: '/cron/digest', handler: 'cron.sendDigest', config: ADMIN_CONFIG },
  { resource: 'cron', method: 'POST', path: '/cron/score', handler: 'cron.scoreProperties', config: ADMIN_CONFIG },
  { resource: 'cron', method: 'GET', path: '/cron/analyze-progress', handler: 'cron.analyzeProgress', config: ADMIN_CONFIG },

  { resource: 'cron-log', method: 'POST', path: '/internal/cron-logs', handler: 'cron-log.internalCreate', config: SERVICE_CONFIG },
  { resource: 'cron-log', method: 'GET', path: '/cron-logs', handler: 'cron-log.find', config: ADMIN_CONFIG },
  { resource: 'cron-log', method: 'GET', path: '/cron-logs/:id', handler: 'cron-log.findOne', config: ADMIN_CONFIG },
  { resource: 'cron-log', method: 'POST', path: '/cron-logs', handler: 'cron-log.create', config: ADMIN_CONFIG },
  { resource: 'cron-log', method: 'PUT', path: '/cron-logs/:id', handler: 'cron-log.update', config: ADMIN_CONFIG },
  { resource: 'cron-log', method: 'DELETE', path: '/cron-logs/:id', handler: 'cron-log.delete', config: ADMIN_CONFIG },

  { resource: 'pipeline', method: 'POST', path: '/pipeline/start', handler: 'pipeline.start', config: ADMIN_CONFIG },
  { resource: 'pipeline', method: 'POST', path: '/pipeline/cancel', handler: 'pipeline.cancel', config: ADMIN_CONFIG },
  { resource: 'pipeline', method: 'POST', path: '/pipeline/reset', handler: 'pipeline.reset', config: ADMIN_CONFIG },
  { resource: 'pipeline', method: 'GET', path: '/pipeline/status', handler: 'pipeline.status', config: ADMIN_CONFIG },

  { resource: 'parser-run-source', method: 'PUT', path: '/internal/parser-run-sources/:identityKey/running', handler: 'api::parser-run-source.parser-run-source.markRunningInternal', config: SERVICE_CONFIG },
  { resource: 'parser-run-source', method: 'PUT', path: '/internal/parser-run-sources/:identityKey/terminal', handler: 'api::parser-run-source.parser-run-source.finishInternal', config: SERVICE_CONFIG },

  { resource: 'digest-projection', method: 'POST', path: '/internal/digest/properties', handler: 'api::digest-projection.digest-projection.properties', config: SERVICE_CONFIG },
  { resource: 'digest-projection', method: 'POST', path: '/internal/digest/delivery', handler: 'api::digest-projection.digest-projection.delivery', config: SERVICE_CONFIG },
];

const PROPERTY_ROUTE_EXPECTATIONS: readonly RouteExpectation[] = [
  { resource: 'property', method: 'GET', path: '/internal/properties/exists', handler: 'property.internalExists', config: SERVICE_CONFIG },
  { resource: 'property', method: 'GET', path: '/internal/properties/:id', handler: 'property.internalFindOne', config: SERVICE_CONFIG },
  { resource: 'property', method: 'PUT', path: '/internal/properties/:id', handler: 'property.internalUpdate', config: SERVICE_CONFIG },
  { resource: 'property', method: 'POST', path: '/properties/upsert', handler: 'property.upsert', config: SERVICE_CONFIG },
  { resource: 'property', method: 'POST', path: '/properties/clear-new', handler: 'property.clearNew', config: ADMIN_CONFIG },
  { resource: 'property', method: 'GET', path: '/photos/:documentId/:filename', handler: 'property.servePhoto', config: USER_CONFIG },
  { resource: 'property', method: 'GET', path: '/properties/focus', handler: 'property.getFocus', config: USER_CONFIG },
  { resource: 'property', method: 'GET', path: '/properties/:id/geocode', handler: 'property.geocode', config: USER_CONFIG },
  { resource: 'property', method: 'POST', path: '/properties/:id/fetch-photos', handler: 'property.fetchPhotos', config: USER_CONFIG },
  { resource: 'property', method: 'GET', path: '/properties/stats', handler: 'property.getStats', config: USER_CONFIG },
  { resource: 'property', method: 'GET', path: '/properties', handler: 'property.find', config: USER_CONFIG },
  { resource: 'property', method: 'GET', path: '/properties/:id', handler: 'property.findOne', config: USER_CONFIG },
];

const PROPERTY_EVENT_ROUTE_EXPECTATIONS: readonly RouteExpectation[] = [
  { resource: 'property-event', method: 'GET', path: '/me/properties/:documentId/events', handler: 'property-event.findMine', config: USER_CONFIG },
  { resource: 'property-event', method: 'GET', path: '/me/properties/:documentId/events/:eventId', handler: 'property-event.findOneMine', config: USER_CONFIG },
];

function routeKey(resource: string, route: Pick<RouteExpectation, 'method' | 'path'>): string {
  return `${resource}|${route.method}|${route.path}`;
}

function getRoute(routes: RouteModule, method: string, path: string): Route {
  const route = routes.routes.find((candidate) => candidate.method === method && candidate.path === path);
  if (!route) throw new Error(`Route not found: ${method} ${path}`);
  return route;
}

describe('global/admin API route boundary', () => {
  it('classifies every allowed global route exactly once and preserves its contract', () => {
    const actualRoutes = GLOBAL_ROUTE_MODULES.flatMap(({ resource, module }) => (
      module.routes.map((route) => ({ resource, route }))
    ));
    const actualKeys = actualRoutes.map(({ resource, route }) => routeKey(resource, route));
    const expectedKeys = GLOBAL_ROUTE_EXPECTATIONS.map((route) => routeKey(route.resource, route));

    expect(new Set(actualKeys).size).toBe(actualKeys.length);
    expect(new Set(expectedKeys).size).toBe(expectedKeys.length);
    expect([...actualKeys].sort()).toEqual([...expectedKeys].sort());

    for (const expected of GLOBAL_ROUTE_EXPECTATIONS) {
      const actual = actualRoutes.find(({ resource, route }) => routeKey(resource, route) === routeKey(expected.resource, expected));
      expect(actual?.route).toEqual({
        method: expected.method,
        path: expected.path,
        handler: expected.handler,
        config: expected.config,
      });
    }
  });

  it('classifies every Property and Property Event route exactly once', () => {
    const modules = [
      { resource: 'property', module: propertyRoutes },
      { resource: 'property-event', module: propertyEventRoutes },
    ];
    const actualRoutes = modules.flatMap(({ resource, module }) => (
      module.routes.map((route) => ({ resource, route }))
    ));
    const actualKeys = actualRoutes.map(({ resource, route }) => routeKey(resource, route));
    const expected = [...PROPERTY_ROUTE_EXPECTATIONS, ...PROPERTY_EVENT_ROUTE_EXPECTATIONS];
    const expectedKeys = expected.map((route) => routeKey(route.resource, route));

    expect(new Set(actualKeys).size).toBe(actualKeys.length);
    expect([...actualKeys].sort()).toEqual([...expectedKeys].sort());

    for (const expectedRoute of expected) {
      const actual = actualRoutes.find(({ resource, route }) => (
        routeKey(resource, route) === routeKey(expectedRoute.resource, expectedRoute)
      ));
      expect(actual?.route).toEqual({
        method: expectedRoute.method,
        path: expectedRoute.path,
        handler: expectedRoute.handler,
        config: expectedRoute.config,
      });
    }
  });

  it('keeps parser-only writes behind the service token policy', () => {
    expect(getRoute(propertyRoutes, 'POST', '/properties/upsert').config)
      .toEqual({ auth: false, policies: ['global::service-token'] });
    expect(getRoute(propertyRoutes, 'PUT', '/internal/properties/:id').config)
      .toEqual({ auth: false, policies: ['global::service-token'] });
  });
});
