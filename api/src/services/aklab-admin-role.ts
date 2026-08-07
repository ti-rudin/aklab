const ROLE_UID = 'plugin::users-permissions.role' as const;
const ROLE_TYPE = 'aklab_admin' as const;

export const AKLAB_ADMIN_ROLE_DATA = {
  name: 'AKLAB Admin',
  description: 'AKLAB administrator role for authorized application operations.',
  type: ROLE_TYPE,
} as const;

type RoleQuery = {
  findOne: (params: { where: { type: typeof ROLE_TYPE } }) => Promise<unknown>;
  create: (params: { data: typeof AKLAB_ADMIN_ROLE_DATA }) => Promise<unknown>;
};

type RoleSeedingStrapi = {
  db: {
    query: (uid: typeof ROLE_UID) => RoleQuery;
  };
};

function isUniqueConstraintError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const candidate = error as {
    code?: unknown;
    errno?: unknown;
    name?: unknown;
    message?: unknown;
  };
  const code = typeof candidate.code === 'string' ? candidate.code : '';
  const name = typeof candidate.name === 'string' ? candidate.name : '';
  const message = typeof candidate.message === 'string' ? candidate.message : '';

  if (code === 'SQLITE_CONSTRAINT_UNIQUE' || code === '23505' || code === 'ER_DUP_ENTRY') {
    return true;
  }

  if (candidate.errno === 2067 || name === 'UniqueConstraintError') return true;

  return /unique constraint|duplicate key|duplicate entry/i.test(message);
}

function roleLookup() {
  return { where: { type: ROLE_TYPE } } as const;
}

/**
 * Ensures the stable AKLAB Admin role exists without assigning it to a user.
 * The role type is the database uniqueness boundary for concurrent bootstrap runs.
 */
export async function ensureAklabAdminRole(strapi: RoleSeedingStrapi): Promise<unknown> {
  const query = strapi.db.query(ROLE_UID);
  const existing = await query.findOne(roleLookup());
  if (existing) return existing;

  try {
    return await query.create({ data: { ...AKLAB_ADMIN_ROLE_DATA } });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;

    const winner = await query.findOne(roleLookup());
    if (winner) return winner;
    throw error;
  }
}
