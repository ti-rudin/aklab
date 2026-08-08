export default {
  routes: [
    { method: 'GET', path: '/internal/market-references/active', handler: 'market-reference.internalFindActive', config: { auth: false, policies: ['global::service-token'] } },
    { method: 'GET', path: '/market-references', handler: 'market-reference.find', config: { auth: false, policies: ['global::authenticated-user', 'global::aklab-admin'] } },
    { method: 'GET', path: '/market-references/:id', handler: 'market-reference.findOne', config: { auth: false, policies: ['global::authenticated-user', 'global::aklab-admin'] } },
    { method: 'POST', path: '/market-references', handler: 'market-reference.create', config: { auth: false, policies: ['global::authenticated-user', 'global::aklab-admin'] } },
    { method: 'PUT', path: '/market-references/:id', handler: 'market-reference.update', config: { auth: false, policies: ['global::authenticated-user', 'global::aklab-admin'] } },
    { method: 'DELETE', path: '/market-references/:id', handler: 'market-reference.delete', config: { auth: false, policies: ['global::authenticated-user', 'global::aklab-admin'] } },
  ],
};
