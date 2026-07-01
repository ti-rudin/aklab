export default {
  routes: [
    { method: 'GET', path: '/user-comments', handler: 'user-comment.find', config: { auth: {} } },
    { method: 'GET', path: '/user-comments/:id', handler: 'user-comment.findOne', config: { auth: {} } },
    { method: 'POST', path: '/user-comments', handler: 'user-comment.create', config: { auth: {} } },
    { method: 'PUT', path: '/user-comments/:id', handler: 'user-comment.update', config: { auth: {} } },
    { method: 'DELETE', path: '/user-comments/:id', handler: 'user-comment.delete', config: { auth: {} } },
  ],
};
