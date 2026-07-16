import { describe, expect, it } from 'vitest';
import cronRoutes from '../cron/routes/cron';
import cronLogRoutes from '../cron-log/routes/cron-log';
import marketReferenceRoutes from '../market-reference/routes/market-reference';
import pipelineRoutes from '../pipeline/routes/pipeline';
import propertyRoutes from '../property/routes/property';
import settingRoutes from '../setting/routes/setting';
import sourceRoutes from '../source/routes/source';

type Route = {
  method: string;
  path: string;
  config: { auth: unknown; policies: string[] };
};

function getRoute(routes: { routes: Route[] }, method: string, path: string): Route {
  const route = routes.routes.find((candidate) => candidate.method === method && candidate.path === path);
  if (!route) throw new Error(`Route not found: ${method} ${path}`);
  return route;
}

describe('auth boundary for UI mutations', () => {
  const uiMutations: Array<[string, { routes: Route[] }, string, string]> = [
    ['cron parse', cronRoutes, 'POST', '/cron/parse/:slug'],
    ['cron analyze', cronRoutes, 'POST', '/cron/analyze'],
    ['cron digest', cronRoutes, 'POST', '/cron/digest'],
    ['cron score', cronRoutes, 'POST', '/cron/score'],
    ['cron log create', cronLogRoutes, 'POST', '/cron-logs'],
    ['cron log update', cronLogRoutes, 'PUT', '/cron-logs/:id'],
    ['cron log delete', cronLogRoutes, 'DELETE', '/cron-logs/:id'],
    ['market reference create', marketReferenceRoutes, 'POST', '/market-references'],
    ['market reference update', marketReferenceRoutes, 'PUT', '/market-references/:id'],
    ['market reference delete', marketReferenceRoutes, 'DELETE', '/market-references/:id'],
    ['pipeline start', pipelineRoutes, 'POST', '/pipeline/start'],
    ['pipeline cancel', pipelineRoutes, 'POST', '/pipeline/cancel'],
    ['pipeline reset', pipelineRoutes, 'POST', '/pipeline/reset'],
    ['property clear', propertyRoutes, 'POST', '/properties/clear-new'],
    ['property photo fetch', propertyRoutes, 'POST', '/properties/:id/fetch-photos'],
    ['property create', propertyRoutes, 'POST', '/properties'],
    ['property update', propertyRoutes, 'PUT', '/properties/:id'],
    ['property delete', propertyRoutes, 'DELETE', '/properties/:id'],
    ['setting update', settingRoutes, 'PUT', '/setting'],
    ['setting delete', settingRoutes, 'DELETE', '/setting'],
    ['source create', sourceRoutes, 'POST', '/sources'],
    ['source update', sourceRoutes, 'PUT', '/sources/:id'],
    ['source delete', sourceRoutes, 'DELETE', '/sources/:id'],
  ];

  it.each(uiMutations)('%s requires an authenticated user', (_name, routes, method, path) => {
    expect(getRoute(routes, method, path).config).toEqual({ auth: {}, policies: [] });
  });

  it('keeps parser-only writes behind the service token policy', () => {
    expect(getRoute(propertyRoutes, 'POST', '/properties/upsert').config)
      .toEqual({ auth: false, policies: ['global::service-token'] });
    expect(getRoute(propertyRoutes, 'PUT', '/internal/properties/:id').config)
      .toEqual({ auth: false, policies: ['global::service-token'] });
    expect(getRoute(sourceRoutes, 'PUT', '/internal/sources/:id/stats').config)
      .toEqual({ auth: false, policies: ['global::service-token'] });
    expect(getRoute(cronLogRoutes, 'POST', '/internal/cron-logs').config)
      .toEqual({ auth: false, policies: ['global::service-token'] });
  });
});
