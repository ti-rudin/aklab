/**
 * property-event router
 *
 * Read-only: find + findOne. События создаются серверно через createEvent.
 */
export default {
  routes: [
    {
      method: 'GET',
      path: '/property-events',
      handler: 'property-event.find',
      config: { auth: false, policies: [] },
    },
    {
      method: 'GET',
      path: '/property-events/:id',
      handler: 'property-event.findOne',
      config: { auth: false, policies: [] },
    },
  ],
};
