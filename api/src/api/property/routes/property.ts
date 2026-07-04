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
      method: 'POST',
      path: '/properties/:id/fetch-photos',
      handler: 'property.fetchPhotos',
      config: { auth: false, policies: [] },
    },
    // Core CRUD routes
    {
      method: 'GET',
      path: '/properties',
      handler: 'property.find',
      config: {},
    },
    {
      method: 'GET',
      path: '/properties/:id',
      handler: 'property.findOne',
      config: {},
    },
    {
      method: 'POST',
      path: '/properties',
      handler: 'property.create',
      config: {},
    },
    {
      method: 'PUT',
      path: '/properties/:id',
      handler: 'property.update',
      config: {},
    },
    {
      method: 'DELETE',
      path: '/properties/:id',
      handler: 'property.delete',
      config: {},
    },
  ],
};
