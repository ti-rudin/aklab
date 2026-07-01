export default {
  routes: [
    { method: 'GET', path: '/market-references', handler: 'market-reference.find', config: { auth: {} } },
    { method: 'GET', path: '/market-references/:id', handler: 'market-reference.findOne', config: { auth: {} } },
    { method: 'POST', path: '/market-references', handler: 'market-reference.create', config: { auth: {} } },
    { method: 'PUT', path: '/market-references/:id', handler: 'market-reference.update', config: { auth: {} } },
    { method: 'DELETE', path: '/market-references/:id', handler: 'market-reference.delete', config: { auth: {} } },
  ],
};
