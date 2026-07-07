export default {
  routes: [
    { method: 'GET', path: '/market-references', handler: 'market-reference.find', config: { auth: false, policies: [] } },
    { method: 'GET', path: '/market-references/:id', handler: 'market-reference.findOne', config: { auth: false, policies: [] } },
    { method: 'POST', path: '/market-references', handler: 'market-reference.create', config: { auth: false, policies: [] } },
    { method: 'PUT', path: '/market-references/:id', handler: 'market-reference.update', config: { auth: false, policies: [] } },
    { method: 'DELETE', path: '/market-references/:id', handler: 'market-reference.delete', config: { auth: false, policies: [] } },
  ],
};
