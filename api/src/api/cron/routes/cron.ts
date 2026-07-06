/**
 * Custom cron routes — ручной запуск парсинга/анализа/дайджеста/скоринга.
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
      config: {},
    },
    {
      method: 'POST',
      path: '/cron/analyze',
      handler: 'cron.analyzeAll',
      config: {},
    },
    {
      method: 'POST',
      path: '/cron/digest',
      handler: 'cron.sendDigest',
      config: {},
    },
    {
      method: 'POST',
      path: '/cron/score',
      handler: 'cron.scoreProperties',
      config: {},
    },
    {
      method: 'GET',
      path: '/cron/analyze-progress',
      handler: 'cron.analyzeProgress',
      config: { auth: false, policies: [] },
    },
  ],
};
