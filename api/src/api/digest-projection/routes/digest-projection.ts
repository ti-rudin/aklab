export default {
  routes: [
    {
      method: 'POST' as const,
      path: '/internal/digest/properties',
      handler: 'api::digest-projection.digest-projection.properties',
      config: { auth: false, policies: ['global::service-token'] },
    },
    {
      method: 'POST' as const,
      path: '/internal/digest/delivery',
      handler: 'api::digest-projection.digest-projection.delivery',
      config: { auth: false, policies: ['global::service-token'] },
    },
  ],
};
