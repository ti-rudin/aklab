/**
 * setting router — singleType.
 */
export default {
  routes: [
    { method: 'GET', path: '/internal/setting/analyzer', handler: 'setting.internalFindAnalyzer', config: { auth: false, policies: ['global::service-token'] } },
    { method: 'GET', path: '/setting', handler: 'setting.find', config: { auth: false, policies: ['global::authenticated-user', 'global::aklab-admin'] } },
    { method: 'PUT', path: '/setting', handler: 'setting.update', config: { auth: false, policies: ['global::authenticated-user', 'global::aklab-admin'] } },
  ],
};
