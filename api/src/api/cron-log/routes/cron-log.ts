export default {
  routes: [
    { method: 'POST', path: '/internal/cron-logs', handler: 'cron-log.internalCreate', config: { auth: false, policies: ['global::service-token'] } },
    { method: 'GET', path: '/cron-logs', handler: 'cron-log.find', config: { auth: false, policies: [] } },
    { method: 'GET', path: '/cron-logs/:id', handler: 'cron-log.findOne', config: { auth: false, policies: [] } },
    { method: 'POST', path: '/cron-logs', handler: 'cron-log.create', config: { auth: {}, policies: [] } },
    { method: 'PUT', path: '/cron-logs/:id', handler: 'cron-log.update', config: { auth: {}, policies: [] } },
    { method: 'DELETE', path: '/cron-logs/:id', handler: 'cron-log.delete', config: { auth: {}, policies: [] } },
  ],
};
