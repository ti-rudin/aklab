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
      method: 'GET',
      path: '/internal/properties/exists',
      handler: 'property.internalExists',
      config: { auth: false, policies: ['global::service-token'] },
    },
    {
      method: 'GET',
      path: '/internal/properties/:id',
      handler: 'property.internalFindOne',
      config: { auth: false, policies: ['global::service-token'] },
    },
    {
      method: 'PUT',
      path: '/internal/properties/:id',
      handler: 'property.internalUpdate',
      config: { auth: false, policies: ['global::service-token'] },
    },
    {
      method: 'POST',
      path: '/properties/upsert',
      handler: 'property.upsert',
      config: { auth: false, policies: ['global::service-token'] },
    },

    {
      method: 'GET',
      path: '/photos/:documentId/:filename',
      handler: 'property.servePhoto',
      config: { auth: false, policies: ['global::authenticated-user'] },
    },
    {
      method: 'GET',
      path: '/properties/focus',
      handler: 'property.getFocus',
      config: { auth: false, policies: ['global::authenticated-user'] },
    },
    {
      method: 'GET',
      path: '/properties/:id/geocode',
      handler: 'property.geocode',
      config: { auth: false, policies: ['global::authenticated-user'] },
    },
    {
      method: 'POST',
      path: '/properties/:id/fetch-photos',
      handler: 'property.fetchPhotos',
      config: { auth: false, policies: ['global::authenticated-user'] },
    },
    {
      method: 'GET',
      path: '/properties/stats',
      handler: 'property.getStats',
      config: { auth: false, policies: ['global::authenticated-user'] },
    },
    // Core CRUD routes
    {
      method: 'GET',
      path: '/properties',
      handler: 'property.find',
      config: { auth: false, policies: ['global::authenticated-user'] },
    },
    {
      method: 'GET',
      path: '/properties/:id',
      handler: 'property.findOne',
      config: { auth: false, policies: ['global::authenticated-user'] },
    },
  ],
};
