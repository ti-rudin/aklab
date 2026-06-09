/**
 * source custom routes — health check.
 * Регистрируется ВДОБАВОК к createCoreRouter из source.ts.
 */
export default {
  type: 'content-api' as const,
  routes: [
    {
      method: 'GET' as const,
      path: '/sources/:id/health',
      handler: 'api::source.source.healthCheck',
      config: {
        auth: false,
        policies: [],
      },
    },
  ],
};
