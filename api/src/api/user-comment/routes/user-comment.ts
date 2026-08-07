export default {
  routes: [
    {
      method: 'GET',
      path: '/me/properties/:documentId/comments',
      handler: 'user-comment.listMine',
      config: { auth: false, policies: ['global::authenticated-user'] },
    },
    {
      method: 'POST',
      path: '/me/properties/:documentId/comments',
      handler: 'user-comment.createMine',
      config: { auth: false, policies: ['global::authenticated-user'] },
    },
    {
      method: 'PUT',
      path: '/me/properties/:documentId/comments/:commentId',
      handler: 'user-comment.updateMine',
      config: { auth: false, policies: ['global::authenticated-user'] },
    },
    {
      method: 'DELETE',
      path: '/me/properties/:documentId/comments/:commentId',
      handler: 'user-comment.deleteMine',
      config: { auth: false, policies: ['global::authenticated-user'] },
    },
  ],
};
