/**
 * property router
 *
 * Стандартные CRUD-маршруты + кастомные эндпоинты.
 */
import { factories } from '@strapi/strapi';

const coreRouter = factories.createCoreRouter('api::property.property');

const customRoutes = [
  {
    method: 'POST' as const,
    path: '/properties/clear-new',
    handler: 'property.clearNew',
    config: {
      auth: false,
      policies: [],
    },
  },
  {
    method: 'GET' as const,
    path: '/photos/:documentId/:filename',
    handler: 'property.servePhoto',
    config: {
      auth: false,
      policies: [],
    },
  },
];

// coreRouter.routes may be a function or array depending on Strapi version
const getCoreRoutes = () => {
  const r = (coreRouter as any).routes;
  return typeof r === 'function' ? r() : r;
};

export default {
  routes: [...getCoreRoutes(), ...customRoutes],
};
