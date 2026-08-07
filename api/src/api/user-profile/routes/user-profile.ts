export default {
  routes: [
    {
      method: 'GET' as const,
      path: '/me/profile',
      handler: 'user-profile.getMe',
      config: { auth: false, policies: ['global::authenticated-user'] },
    },
    {
      method: 'PUT' as const,
      path: '/me/profile',
      handler: 'user-profile.updateMe',
      config: { auth: false, policies: ['global::authenticated-user'] },
    },
    {
      method: 'GET' as const,
      path: '/me/context',
      handler: 'user-profile.getMeContext',
      config: { auth: false, policies: ['global::authenticated-user'] },
    },
    {
      method: 'GET' as const,
      path: '/admin/user-profiles',
      handler: 'user-profile.listAdmin',
      config: { auth: false, policies: ['global::authenticated-user', 'global::aklab-admin'] },
    },
    {
      method: 'GET' as const,
      path: '/admin/user-profiles/:userId',
      handler: 'user-profile.getAdmin',
      config: { auth: false, policies: ['global::authenticated-user', 'global::aklab-admin'] },
    },
    {
      method: 'PUT' as const,
      path: '/admin/user-profiles/:userId',
      handler: 'user-profile.updateAdmin',
      config: { auth: false, policies: ['global::authenticated-user', 'global::aklab-admin'] },
    },
  ],
};
