/**
 * setting router — singleType, auth: false (single-tenant app)
 */
export default {
  routes: [
    { method: 'GET', path: '/setting', handler: 'setting.find', config: { auth: false, policies: [] } },
    { method: 'PUT', path: '/setting', handler: 'setting.update', config: { auth: false, policies: [] } },
    { method: 'DELETE', path: '/setting', handler: 'setting.delete', config: { auth: false, policies: [] } },
  ],
};
