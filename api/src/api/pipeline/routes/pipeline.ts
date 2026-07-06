/**
 * Pipeline routes — SSE-based pipeline orchestrator.
 */
export default {
  routes: [
    {
      method: 'POST',
      path: '/pipeline/start',
      handler: 'pipeline.start',
      config: {},
    },
    {
      method: 'POST',
      path: '/pipeline/cancel',
      handler: 'pipeline.cancel',
      config: {},
    },
    {
      method: 'POST',
      path: '/pipeline/reset',
      handler: 'pipeline.reset',
      config: {},
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
