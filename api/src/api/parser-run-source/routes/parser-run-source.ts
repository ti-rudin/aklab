export default {
  routes: [
    {
      method: 'PUT' as const,
      path: '/internal/parser-run-sources/:identityKey/running',
      handler: 'api::parser-run-source.parser-run-source.markRunningInternal',
      config: { auth: false, policies: ['global::service-token'] },
    },
    {
      method: 'PUT' as const,
      path: '/internal/parser-run-sources/:identityKey/terminal',
      handler: 'api::parser-run-source.parser-run-source.finishInternal',
      config: { auth: false, policies: ['global::service-token'] },
    },
  ],
};
