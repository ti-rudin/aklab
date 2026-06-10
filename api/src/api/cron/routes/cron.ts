/**
 * Custom cron routes — ручной запуск парсинга/анализа/дайджеста.
 */
export default {
  routes: [
    {
      method: 'GET',
      path: '/cron/queue-stats',
      handler: 'cron.queueStats',
      config: { auth: false, policies: [] },
    },
    {
      method: 'POST',
      path: '/cron/parse/:slug',
      handler: 'cron.parseSource',
      config: { auth: false, policies: [] },
    },
    {
      method: 'POST',
      path: '/cron/analyze',
      handler: 'cron.analyzeAll',
      config: { auth: false, policies: [] },
    },
    {
      method: 'POST',
      path: '/cron/digest',
      handler: 'cron.sendDigest',
      config: { auth: false, policies: [] },
    },
  ],
};
