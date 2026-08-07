export default {
  routes: [
    {
      method: 'GET' as const,
      path: '/me/properties/:documentId/state',
      handler: 'user-property-state.getState',
      config: { auth: false, policies: ['global::authenticated-user'] },
    },
    {
      method: 'PUT' as const,
      path: '/me/properties/:documentId/state',
      handler: 'user-property-state.putState',
      config: { auth: false, policies: ['global::authenticated-user'] },
    },
    {
      method: 'DELETE' as const,
      path: '/me/properties/:documentId/state',
      handler: 'user-property-state.deleteState',
      config: { auth: false, policies: ['global::authenticated-user'] },
    },
  ],
};
