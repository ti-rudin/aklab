/**
 * Pipeline routes — SSE-based pipeline orchestrator.
 */
export default {
  routes: [
    {
      method: 'POST',
      path: '/pipeline/start',
      handler: 'pipeline.start',
      config: { auth: {}, policies: [] },
    },
    {
      method: 'POST',
      path: '/pipeline/cancel',
      handler: 'pipeline.cancel',
      config: { auth: {}, policies: [] },
    },
    {
      method: 'POST',
      path: '/pipeline/reset',
      handler: 'pipeline.reset',
      config: { auth: {}, policies: [] },
    },
    {
      method: 'GET',
      path: '/pipeline/status',
      handler: 'pipeline.status',
      config: { auth: false, policies: [] },
    },
    {
      method: 'GET',
      path: '/pipeline/stream',
      handler: 'pipeline.stream',
      config: { auth: false, policies: [] },
    },
  ],
};
