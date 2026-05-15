export default {
  type: 'content-api',
  routes: [
    // Кастомный роут — ПЕРЕД стандартными
    {
      method: 'POST',
      path: '/zamers/:id/calculate',
      handler: 'zamer.calculate',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    // Стандартные CRUD
    {
      method: 'GET',
      path: '/zamers',
      handler: 'zamer.find',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'GET',
      path: '/zamers/:id',
      handler: 'zamer.findOne',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'POST',
      path: '/zamers',
      handler: 'zamer.create',
      config: {
        policies: ['api::zamer.validate-zamer'],
        middlewares: [],
      },
    },
    {
      method: 'PUT',
      path: '/zamers/:id',
      handler: 'zamer.update',
      config: {
        policies: ['api::zamer.validate-zamer'],
        middlewares: [],
      },
    },
    {
      method: 'DELETE',
      path: '/zamers/:id',
      handler: 'zamer.delete',
      config: {
        policies: [],
        middlewares: [],
      },
    },
  ],
};
