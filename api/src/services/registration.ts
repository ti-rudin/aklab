type AdvancedSettings = Record<string, unknown>;

type PluginStore = {
  get(options: { key: string }): Promise<AdvancedSettings | null | undefined>;
  set(options: { key: string; value: AdvancedSettings }): Promise<void>;
};

type StrapiStoreHost = {
  store(options: { type: 'plugin'; name: 'users-permissions' }): PluginStore;
};

/**
 * Public registration turns every valid JWT into a potential operator credential
 * in this single-tenant application. Keep the plugin's existing configuration,
 * but make account creation an explicit Admin Panel operation.
 */
export async function disablePublicRegistration(strapi: StrapiStoreHost): Promise<void> {
  const store = strapi.store({ type: 'plugin', name: 'users-permissions' });
  const advanced = await store.get({ key: 'advanced' });

  if (!advanced || typeof advanced !== 'object' || Array.isArray(advanced)) {
    throw new Error('users-permissions advanced settings are unavailable');
  }

  if (advanced.allow_register === false) return;

  await store.set({
    key: 'advanced',
    value: { ...advanced, allow_register: false },
  });
}
