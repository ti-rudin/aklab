export default {
  routes: [
    { method: 'GET', path: '/cron-logs', handler: 'cron-log.find', config: { auth: false, policies: [] } },
    { method: 'GET', path: '/cron-logs/:id', handler: 'cron-log.findOne', config: { auth: false, policies: [] } },
    { method: 'POST', path: '/cron-logs', handler: 'cron-log.create', config: { auth: false, policies: [] } },
    { method: 'PUT', path: '/cron-logs/:id', handler: 'cron-log.update', config: { auth: false, policies: [] } },
    { method: 'DELETE', path: '/cron-logs/:id', handler: 'cron-log.delete', config: { auth: false, policies: [] } },
  ],
};
