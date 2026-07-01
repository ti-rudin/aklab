export default {
  routes: [
    { method: 'GET', path: '/focus-rules', handler: 'focus-rule.find', config: { auth: {} } },
    { method: 'GET', path: '/focus-rules/:id', handler: 'focus-rule.findOne', config: { auth: {} } },
    { method: 'POST', path: '/focus-rules', handler: 'focus-rule.create', config: { auth: {} } },
    { method: 'PUT', path: '/focus-rules/:id', handler: 'focus-rule.update', config: { auth: {} } },
    { method: 'DELETE', path: '/focus-rules/:id', handler: 'focus-rule.delete', config: { auth: {} } },
  ],
};
