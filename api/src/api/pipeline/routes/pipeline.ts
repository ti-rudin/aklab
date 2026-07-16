/**
 * Pipeline routes — SSE-based pipeline orchestrator.
 */
export default {
  routes: [
    {
      method: 'POST',
      path: '/pipeline/start',
      handler: 'pipeline.start',
      config: { auth: false, policies: ['global::authenticated-user'] },
    },
    {
      method: 'POST',
      path: '/pipeline/cancel',
      handler: 'pipeline.cancel',
      config: { auth: false, policies: ['global::authenticated-user'] },
    },
    {
      method: 'POST',
      path: '/pipeline/reset',
      handler: 'pipeline.reset',
      config: { auth: false, policies: ['global::authenticated-user'] },
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
