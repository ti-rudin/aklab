/** Pipeline routes — admin-only controls and authenticated status polling. */
export default {
  routes: [
    {
      method: 'POST',
      path: '/pipeline/start',
      handler: 'pipeline.start',
      config: { auth: false, policies: ['global::authenticated-user', 'global::aklab-admin'] },
    },
    {
      method: 'POST',
      path: '/pipeline/cancel',
      handler: 'pipeline.cancel',
      config: { auth: false, policies: ['global::authenticated-user', 'global::aklab-admin'] },
    },
    {
      method: 'POST',
      path: '/pipeline/reset',
      handler: 'pipeline.reset',
      config: { auth: false, policies: ['global::authenticated-user', 'global::aklab-admin'] },
    },
    {
      method: 'GET',
      path: '/pipeline/status',
      handler: 'pipeline.status',
      config: { auth: false, policies: ['global::authenticated-user', 'global::aklab-admin'] },
    },
  ],
};
