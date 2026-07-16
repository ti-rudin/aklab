/**
 * property router
 *
 * Core CRUD + кастомные эндпоинты.
 * НЕ используем coreRouter.routes — он вызывается до инициализации Strapi.
 */

export default {
  routes: [
    // Custom routes (must come before core to avoid conflicts)
    {
      method: 'POST',
      path: '/properties/upsert',
      handler: 'property.upsert',
      config: { auth: false, policies: ['global::service-token'] },
    },
    {
      method: 'POST',
      path: '/properties/clear-new',
      handler: 'property.clearNew',
      config: { auth: false, policies: [] },
    },
    {
      method: 'GET',
      path: '/photos/:documentId/:filename',
      handler: 'property.servePhoto',
      config: { auth: false, policies: [] },
    },
    {
      method: 'GET',
      path: '/properties/focus',
      handler: 'property.getFocus',
      config: { auth: false, policies: [] },
    },
    {
      method: 'GET',
      path: '/properties/:id/geocode',
      handler: 'property.geocode',
      config: { auth: false, policies: [] },
    },
    {
      method: 'POST',
      path: '/properties/:id/fetch-photos',
      handler: 'property.fetchPhotos',
      config: { auth: false, policies: [] },
    },
    {
      method: 'GET',
      path: '/properties/stats',
      handler: 'property.getStats',
      config: { auth: false, policies: [] },
    },
    // Core CRUD routes
    {
      method: 'GET',
      path: '/properties',
      handler: 'property.find',
      config: { auth: false, policies: [] },
    },
    {
      method: 'GET',
      path: '/properties/:id',
      handler: 'property.findOne',
      config: { auth: false, policies: [] },
    },
    {
      method: 'POST',
      path: '/properties',
      handler: 'property.create',
      config: { auth: false, policies: [] },
    },
    {
      method: 'PUT',
      path: '/properties/:id',
      handler: 'property.update',
      config: { auth: false, policies: [] },
    },
    {
      method: 'DELETE',
      path: '/properties/:id',
      handler: 'property.delete',
      config: { auth: false, policies: [] },
    },
  ],
};
