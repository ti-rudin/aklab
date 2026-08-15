import { errors } from '@strapi/utils';

const USER_UID = 'plugin::users-permissions.user';
const PROFILE_UID = 'api::user-profile.user-profile';
const HARD_DELETE_MESSAGE = 'Hard deletion of users is disabled; block the user account instead.';

type ProfileQuery = {
  findOne: (params?: unknown) => Promise<unknown>;
  create: (params: { data: Record<string, unknown> }) => Promise<unknown>;
};

type UserLifecycleStrapi = {
  db: {
    query: (uid: string) => ProfileQuery;
    lifecycles: {
      subscribe: (subscriber: UserLifecycleSubscriber) => void;
    };
  };
};

type UserLifecycleEvent = {
  result?: {
    id?: unknown;
  };
};

export type UserLifecycleSubscriber = {
  models: [typeof USER_UID];
  afterCreate: (event: UserLifecycleEvent) => Promise<void>;
  beforeDelete: (event: unknown) => never;
  beforeDeleteMany: (event: unknown) => never;
};

const registeredStrapiInstances = new WeakSet<object>();

function assertPositiveNumericUserId(userId: unknown): asserts userId is number {
  if (typeof userId !== 'number' || !Number.isSafeInteger(userId) || userId <= 0) {
    throw new TypeError('userId must be a positive numeric user ID');
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const candidate = error as { code?: unknown; name?: unknown; message?: unknown };
  const code = typeof candidate.code === 'string' ? candidate.code : '';
  const name = typeof candidate.name === 'string' ? candidate.name : '';
  const message = typeof candidate.message === 'string' ? candidate.message : '';

  if (code === 'SQLITE_CONSTRAINT_UNIQUE' || code === '23505' || code === 'ER_DUP_ENTRY') {
    return true;
  }

  if (name === 'UniqueConstraintError') return true;

  return /unique constraint|duplicate key|already exists/i.test(message);
}

function profileDefaults(userId: number): Record<string, unknown> {
  return {
    user: userId,
    user_id: userId,
    regions: [],
    property_types: [],
    price_from: null,
    price_to: null,
    area_from: null,
    area_to: null,
    stop_words: [],
    filter_rent: true,
    digest_email: null,
    digest_enabled: false,
    profile_version: 1,
  };
}

/**
 * Return the one profile belonging to a user, creating it with safe defaults
 * when necessary. The scalar user_id lookup is the idempotency boundary.
 */
export async function ensureUserProfile(
  strapi: UserLifecycleStrapi,
  userId: unknown,
): Promise<unknown> {
  assertPositiveNumericUserId(userId);

  const query = strapi.db.query(PROFILE_UID);
  const existing = await query.findOne({ where: { user_id: userId } });
  if (existing) return existing;

  try {
    return await query.create({ data: profileDefaults(userId) });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;

    // Another transaction may have won the unique user_id insert. Only return
    // that winner; every other create or read error remains observable.
    const racedProfile = await query.findOne({ where: { user_id: userId } });
    if (racedProfile) return racedProfile;
    throw error;
  }
}

export function createUserLifecycleSubscriber(strapi: UserLifecycleStrapi): UserLifecycleSubscriber {
  return {
    models: [USER_UID],
    async afterCreate(event) {
      await ensureUserProfile(strapi, event.result?.id);
    },
    beforeDelete() {
      throw new errors.ApplicationError(HARD_DELETE_MESSAGE);
    },
    beforeDeleteMany() {
      throw new errors.ApplicationError(HARD_DELETE_MESSAGE);
    },
  };
}

/** Register exactly one subscriber for a Strapi instance during this process. */
export function registerUserLifecycleSubscriber(strapi: UserLifecycleStrapi): void {
  if (registeredStrapiInstances.has(strapi as object)) return;

  strapi.db.lifecycles.subscribe(createUserLifecycleSubscriber(strapi));
  registeredStrapiInstances.add(strapi as object);
}
