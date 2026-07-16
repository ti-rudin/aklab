type PolicyContext = {
  request: { header?: Record<string, string | undefined> };
  state: Record<string, unknown>;
};

type AuthenticatedUser = {
  id: string | number;
  blocked?: boolean;
  confirmed?: boolean;
};

/**
 * Uses the Users & Permissions JWT service directly rather than Strapi's route
 * auth middleware. In this Strapi 5 runtime, the middleware's rejected JWT
 * errors are serialized as 500; a policy rejection is the supported fail-closed
 * 403 path. Public registration is disabled at bootstrap, so a valid account is
 * created only through the Admin Panel.
 */
export default async function authenticatedUser(ctx: PolicyContext): Promise<boolean> {
  try {
    const plugin = strapi.plugin('users-permissions');
    const token = await plugin.service('jwt').getToken(ctx);
    if (!token?.id) return false;

    const user = await plugin.service('user').fetchAuthenticatedUser(token.id) as AuthenticatedUser | null;
    if (!user || user.blocked || user.confirmed === false) return false;

    ctx.state.user = user;
    return true;
  } catch {
    return false;
  }
}
