export default {
  routes: [
    { method: 'GET', path: '/cron-logs', handler: 'cron-log.find', config: { auth: {} } },
    { method: 'GET', path: '/cron-logs/:id', handler: 'cron-log.findOne', config: { auth: {} } },
    { method: 'POST', path: '/cron-logs', handler: 'cron-log.create', config: { auth: {} } },
    { method: 'PUT', path: '/cron-logs/:id', handler: 'cron-log.update', config: { auth: {} } },
    { method: 'DELETE', path: '/cron-logs/:id', handler: 'cron-log.delete', config: { auth: {} } },
  ],
};
