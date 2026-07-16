export default {
  routes: [
    {
      method: 'PUT' as const,
      path: '/internal/sources/:id/stats',
      handler: 'api::source.source.internalUpdateStats',
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
      config: { auth: false, policies: ['global::authenticated-user'] },
    },
    {
      method: 'PUT' as const,
      path: '/sources/:id',
      handler: 'api::source.source.update',
      config: { auth: false, policies: ['global::authenticated-user'] },
    },
    {
      method: 'DELETE' as const,
      path: '/sources/:id',
      handler: 'api::source.source.delete',
      config: { auth: false, policies: ['global::authenticated-user'] },
    },
  ],
};
