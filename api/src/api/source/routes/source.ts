/**
 * source routes — CRUD + health check.
 * Явные routes вместо createCoreRouter, чтобы добавить custom health endpoint.
 */
export default {
  routes: [
    {
      method: 'PUT' as const,
      path: '/internal/sources/:id/stats',
      handler: 'api::source.source.internalUpdateStats',
      config: { auth: false, policies: ['global::service-token'] },
    },
    // Custom health check (auth: false — публичный)
    {
      method: 'GET' as const,
      path: '/sources/:id/health',
      handler: 'api::source.source.healthCheck',
      config: { auth: false, policies: [] },
    },
    // Standard CRUD (auth: false — single-tenant, API token не работает с config:{})
    {
      method: 'GET' as const,
      path: '/sources',
      handler: 'api::source.source.find',
      config: { auth: false, policies: [] },
    },
    {
      method: 'GET' as const,
      path: '/sources/:id',
      handler: 'api::source.source.findOne',
      config: { auth: false, policies: [] },
    },
    {
      method: 'POST' as const,
      path: '/sources',
      handler: 'api::source.source.create',
      config: { auth: false, policies: [] },
    },
    {
      method: 'PUT' as const,
      path: '/sources/:id',
      handler: 'api::source.source.update',
      config: { auth: false, policies: [] },
    },
    {
      method: 'DELETE' as const,
      path: '/sources/:id',
      handler: 'api::source.source.delete',
      config: { auth: false, policies: [] },
    },
  ],
};
