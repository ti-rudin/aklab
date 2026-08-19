export default {
  routes: [
    {
      method: 'GET' as const,
      path: '/internal/sources/:id/stats',
      handler: 'api::source.source.internalFindStats',
      config: { auth: false, policies: ['global::service-token'] },
    },
    {
      method: 'PUT' as const,
      path: '/internal/sources/:id/stats',
      handler: 'api::source.source.internalUpdateStats',
      config: { auth: false, policies: ['global::service-token'] },
    },
    {
      method: 'POST' as const,
      path: '/internal/sources/:id/stats/increment',
      handler: 'api::source.source.internalIncrementStats',
      config: { auth: false, policies: ['global::service-token'] },
    },
    // Health endpoint remains public for external monitoring.
    {
      method: 'GET' as const,
      path: '/sources/:id/health',
      handler: 'api::source.source.healthCheck',
      config: { auth: false, policies: [] },
    },
    {
      method: 'GET' as const,
      path: '/sources',
      handler: 'api::source.source.find',
      config: { auth: false, policies: ['global::authenticated-user', 'global::aklab-admin'] },
    },
    {
      method: 'GET' as const,
      path: '/sources/:id',
      handler: 'api::source.source.findOne',
      config: { auth: false, policies: ['global::authenticated-user', 'global::aklab-admin'] },
    },
    {
      method: 'POST' as const,
      path: '/sources',
      handler: 'api::source.source.create',
      config: { auth: false, policies: ['global::authenticated-user', 'global::aklab-admin'] },
    },
    {
      method: 'PUT' as const,
      path: '/sources/:id',
      handler: 'api::source.source.update',
      config: { auth: false, policies: ['global::authenticated-user', 'global::aklab-admin'] },
    },
    {
      method: 'DELETE' as const,
      path: '/sources/:id',
      handler: 'api::source.source.delete',
      config: { auth: false, policies: ['global::authenticated-user', 'global::aklab-admin'] },
    },
  ],
};
