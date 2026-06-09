/**
 * source routes — CRUD + custom healthCheck.
 */
export default {
  routes: [
    // Custom health check (должен быть ДО CRUD wildcard)
    {
      method: 'GET',
      path: '/sources/:id/health',
      handler: 'api::source.source.healthCheck',
      config: { auth: false, policies: [] },
    },
    // Standard CRUD
    {
      method: 'GET',
      path: '/sources',
      handler: 'api::source.source.find',
      config: { auth: {} },
    },
    {
      method: 'GET',
      path: '/sources/:id',
      handler: 'api::source.source.findOne',
      config: { auth: {} },
    },
    {
      method: 'POST',
      path: '/sources',
      handler: 'api::source.source.create',
      config: { auth: {} },
    },
    {
      method: 'PUT',
      path: '/sources/:id',
      handler: 'api::source.source.update',
      config: { auth: {} },
    },
    {
      method: 'DELETE',
      path: '/sources/:id',
      handler: 'api::source.source.delete',
      config: { auth: {} },
    },
  ],
};
