const USER_UID = 'plugin::users-permissions.user';

type PolicyContext = {
  state?: {
    user?: {
      id?: unknown;
    };
  };
};

function isPositiveNumericId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/**
 * Authorizes the AKLAB Admin boundary from the current database role only.
 * Request payloads, client storage, and the role cached in ctx.state.user are
 * deliberately not authorization inputs.
 */
export default async function aklabAdmin(ctx: PolicyContext): Promise<boolean> {
  const userId = ctx?.state?.user?.id;
  if (!isPositiveNumericId(userId)) return false;

  try {
    const freshUser = await strapi.db
      .query(USER_UID)
      .findOne({
        where: { id: userId },
        populate: { role: true },
      });

    if (!freshUser || freshUser.blocked || freshUser.confirmed === false || !freshUser.role) {
      return false;
    }

    return freshUser.role.type === 'aklab_admin';
  } catch {
    return false;
  }
}
