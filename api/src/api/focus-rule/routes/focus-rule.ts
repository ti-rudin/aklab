export default {
  routes: [
    { method: 'GET', path: '/focus-rules', handler: 'focus-rule.find', config: { auth: false, policies: ['global::authenticated-user', 'global::aklab-admin'] } },
    { method: 'GET', path: '/focus-rules/:id', handler: 'focus-rule.findOne', config: { auth: false, policies: ['global::authenticated-user', 'global::aklab-admin'] } },
    { method: 'POST', path: '/focus-rules', handler: 'focus-rule.create', config: { auth: false, policies: ['global::authenticated-user', 'global::aklab-admin'] } },
    { method: 'PUT', path: '/focus-rules/:id', handler: 'focus-rule.update', config: { auth: false, policies: ['global::authenticated-user', 'global::aklab-admin'] } },
    { method: 'DELETE', path: '/focus-rules/:id', handler: 'focus-rule.delete', config: { auth: false, policies: ['global::authenticated-user', 'global::aklab-admin'] } },
  ],
};
