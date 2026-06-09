/**
 * source routes — CRUD + health check.
 * Явные routes вместо createCoreRouter, чтобы добавить custom health endpoint.
 */
export default {
  routes: [
    // Custom health check (auth: false — публичный)
    {
      method: 'GET' as const,
      path: '/sources/:id/health',
      handler: 'api::source.source.healthCheck',
      config: { auth: false, policies: [] },
    },
    // Standard CRUD (без config — Users-Permissions обрабатывает автоматически)
    {
      method: 'GET' as const,
      path: '/sources',
      handler: 'api::source.source.find',
    },
    {
      method: 'GET' as const,
      path: '/sources/:id',
      handler: 'api::source.source.findOne',
    },
    {
      method: 'POST' as const,
      path: '/sources',
      handler: 'api::source.source.create',
    },
    {
      method: 'PUT' as const,
      path: '/sources/:id',
      handler: 'api::source.source.update',
    },
    {
      method: 'DELETE' as const,
      path: '/sources/:id',
      handler: 'api::source.source.delete',
    },
  ],
};
