/**
 * User-scoped property-event router.
 * Events are created server-side; no collection CRUD is exposed here.
 */
export default {
  routes: [
    {
      method: 'GET',
      path: '/me/properties/:documentId/events',
      handler: 'property-event.findMine',
      config: { auth: false, policies: ['global::authenticated-user'] },
    },
    {
      method: 'GET',
      path: '/me/properties/:documentId/events/:eventId',
      handler: 'property-event.findOneMine',
      config: { auth: false, policies: ['global::authenticated-user'] },
    },
  ],
};
