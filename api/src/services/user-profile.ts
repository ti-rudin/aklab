import {
  createUserFilterSnapshot,
  normalizeUserParseProfile,
  PROPERTY_TYPE_VALUES,
  REGION_VALUES,
  type PropertyType,
  type Region,
  type UserFilterSnapshot,
  type UserParseProfile,
} from '@aklab/parse-rules';
import { isMultiuserEnabled } from './multiuser-feature';

export const USER_UID = 'plugin::users-permissions.user';
export const PROFILE_UID = 'api::user-profile.user-profile';

const ALLOWED_PROFILE_FIELDS = [
  'regions',
  'property_types',
  'price_from',
  'price_to',
  'area_from',
  'area_to',
  'stop_words',
  'filter_rent',
  'digest_email',
  'digest_enabled',
] as const;

type AllowedProfileField = (typeof ALLOWED_PROFILE_FIELDS)[number];

const PROFILE_SCALAR_FIELDS = [
  'id',
  'user_id',
  'regions',
  'property_types',
  'price_from',
  'price_to',
  'area_from',
  'area_to',
  'stop_words',
  'filter_rent',
  'digest_email',
  'digest_enabled',
  'profile_version',
] as const;
const PROFILE_LIST_DEFAULT_PAGE = 1;
const PROFILE_LIST_DEFAULT_PAGE_SIZE = 20;
const PROFILE_LIST_MAX_PAGE = 1_000_000;
const PROFILE_LIST_MAX_PAGE_SIZE = 100;

type ProfileRecord = Record<string, unknown>;
type Query = {
  findOne: (params?: unknown) => Promise<unknown>;
  findMany: (params?: unknown) => Promise<unknown>;
  count: (params?: unknown) => Promise<unknown>;
  update: (params: { where: Record<string, unknown>; data: Record<string, unknown> }) => Promise<unknown>;
};
type StrapiLike = {
  db: {
    query: (uid: string) => Query;
  };
};

export type UserProfileDto = {
  id: number;
  user_id: number;
  regions: Region[];
  property_types: PropertyType[];
  price_from: number | null;
  price_to: number | null;
  area_from: number | null;
  area_to: number | null;
  stop_words: string[];
  filter_rent: boolean;
  digest_email: string | null;
  digest_enabled: boolean;
  profile_version: number;
};

export type UserContextDto = {
  user: {
    id: number;
    username: string;
    email: string;
  };
  role: { type: string } | null;
  profileReady: boolean;
  multiuserEnabled: boolean;
};

export class UserProfileError extends Error {
  readonly code: string;

  constructor(name: string, code: string, message: string) {
    super(message);
    this.name = name;
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class UserProfileValidationError extends UserProfileError {
  constructor() {
    super('UserProfileValidationError', 'USER_PROFILE_VALIDATION_ERROR', 'Invalid user profile input.');
  }
}

export class UserProfileNotFoundError extends UserProfileError {
  constructor() {
    super('UserProfileNotFoundError', 'USER_PROFILE_NOT_FOUND', 'User profile was not found.');
  }
}

export class UserProfileConflictError extends UserProfileError {
  readonly expectedVersion: number;
  readonly actualVersion: number;

  constructor(expectedVersion: number, actualVersion: number) {
    super('UserProfileConflictError', 'USER_PROFILE_VERSION_CONFLICT', 'User profile version conflict.');
    this.expectedVersion = expectedVersion;
    this.actualVersion = actualVersion;
  }
}

export class UserProfileUnavailableError extends UserProfileError {
  constructor() {
    super('UserProfileUnavailableError', 'USER_PROFILE_UNAVAILABLE', 'User is unavailable.');
  }
}

export class UserProfileMalformedError extends UserProfileError {
  constructor() {
    super('UserProfileMalformedError', 'USER_PROFILE_MALFORMED', 'Stored user profile is malformed.');
  }
}

export class UserProfileSnapshotError extends UserProfileError {
  constructor() {
    super('UserProfileSnapshotError', 'USER_PROFILE_SNAPSHOT_ERROR', 'User profile snapshot could not be built.');
  }
}

export class UserContextMalformedError extends UserProfileError {
  constructor() {
    super('UserContextMalformedError', 'USER_CONTEXT_MALFORMED', 'User context is malformed.');
  }
}

function isRecord(value: unknown): value is ProfileRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(value: ProfileRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function assertPositiveUserId(value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new UserProfileValidationError();
  }
}

function assertVersion(value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new UserProfileValidationError();
  }
}

function normalizeVersion(value: unknown): number {
  if (typeof value === 'number') {
    assertVersion(value);
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    assertVersion(parsed);
    return parsed;
  }
  throw new UserProfileMalformedError();
}

function parseStoredArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.slice();
  if (typeof value !== 'string' || value.trim() === '') throw new UserProfileMalformedError();

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new UserProfileMalformedError();
  }
  if (!Array.isArray(parsed)) throw new UserProfileMalformedError();
  return parsed;
}

function normalizeArray<T extends string>(value: unknown, allowed: readonly T[]): T[] {
  const parsed = parseStoredArray(value);
  if (parsed.some(item => typeof item !== 'string')) throw new UserProfileMalformedError();
  const normalized = [...new Set(parsed.map(item => (item as string).trim().toLowerCase()).filter(Boolean))].sort();
  if (normalized.some(item => !allowed.includes(item as T))) throw new UserProfileMalformedError();
  return normalized as T[];
}

function normalizeInputArray<T extends string>(value: unknown, allowed: readonly T[]): T[] {
  try {
    const parsed = Array.isArray(value) ? value : (() => {
      if (typeof value !== 'string' || value.trim() === '') throw new Error('invalid');
      const decoded = JSON.parse(value);
      if (!Array.isArray(decoded)) throw new Error('invalid');
      return decoded;
    })();
    if (parsed.some(item => typeof item !== 'string')) throw new Error('invalid');
    const normalized = [...new Set(parsed.map(item => (item as string).trim().toLowerCase()).filter(Boolean))].sort();
    if (normalized.some(item => !allowed.includes(item as T))) throw new Error('invalid');
    return normalized as T[];
  } catch {
    throw new UserProfileValidationError();
  }
}

function normalizeDecimal(value: unknown, malformed: boolean): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' && typeof value !== 'string') {
    if (malformed) throw new UserProfileMalformedError();
    throw new UserProfileValidationError();
  }
  if (typeof value === 'string' && value.trim() === '') {
    if (malformed) throw new UserProfileMalformedError();
    throw new UserProfileValidationError();
  }
  const parsed = typeof value === 'number' ? value : Number(value.trim());
  if (!Number.isFinite(parsed) || parsed < 0) {
    if (malformed) throw new UserProfileMalformedError();
    throw new UserProfileValidationError();
  }
  return parsed;
}

const DIGEST_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_DIGEST_RECIPIENTS = 10;
const MAX_DIGEST_EMAIL_LENGTH = 320;

function invalidDigestEmail(malformed: boolean): never {
  if (malformed) throw new UserProfileMalformedError();
  throw new UserProfileValidationError();
}

function normalizeDigestEmailList(value: unknown, malformed: boolean): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') invalidDigestEmail(malformed);
  const raw = value.trim();
  if (raw === '') invalidDigestEmail(malformed);

  const recipients = raw.split(',').map(recipient => recipient.trim());
  if (
    recipients.length > MAX_DIGEST_RECIPIENTS
    || recipients.some(recipient => recipient === '' || recipient.length > MAX_DIGEST_EMAIL_LENGTH || !DIGEST_EMAIL_PATTERN.test(recipient))
  ) {
    invalidDigestEmail(malformed);
  }

  const unique = new Map<string, string>();
  for (const recipient of recipients) {
    const key = recipient.toLowerCase();
    if (!unique.has(key)) unique.set(key, recipient);
  }
  return [...unique.values()].join(', ');
}

function normalizeInputEmail(value: unknown): string | null {
  return normalizeDigestEmailList(value, false);
}

function normalizeStoredEmail(value: unknown): string | null {
  return normalizeDigestEmailList(value, true);
}

function normalizeBoolean(value: unknown, malformed: boolean): boolean {
  if (typeof value !== 'boolean') {
    if (malformed) throw new UserProfileMalformedError();
    throw new UserProfileValidationError();
  }
  return value;
}

function normalizeStoredBooleanWithDefault(value: unknown, defaultValue: boolean): boolean {
  return value === undefined || value === null ? defaultValue : normalizeBoolean(value, true);
}

function assertOrderedRange(from: number | null, to: number | null, malformed: boolean): void {
  if (from !== null && to !== null && from > to) {
    if (malformed) throw new UserProfileMalformedError();
    throw new UserProfileValidationError();
  }
}

function toCanonicalProfile(record: ProfileRecord): UserParseProfile {
  try {
    if (!Number.isSafeInteger(record.id) || (record.id as number) <= 0) throw new Error('id');
    if (!Number.isSafeInteger(record.user_id) || (record.user_id as number) <= 0) throw new Error('user_id');

    const priceFrom = normalizeDecimal(record.price_from, true);
    const priceTo = normalizeDecimal(record.price_to, true);
    const areaFrom = normalizeDecimal(record.area_from, true);
    const areaTo = normalizeDecimal(record.area_to, true);
    assertOrderedRange(priceFrom, priceTo, true);
    assertOrderedRange(areaFrom, areaTo, true);

    const version = normalizeVersion(record.profile_version);
    const regions = normalizeArray(record.regions, REGION_VALUES);
    const propertyTypes = normalizeArray(record.property_types, PROPERTY_TYPE_VALUES);
    const stopWords = normalizeStringArray(record.stop_words, true);
    const filterRent = normalizeStoredBooleanWithDefault(record.filter_rent, true);
    const digestEmail = normalizeStoredEmail(record.digest_email);
    const digestEnabled = normalizeBoolean(record.digest_enabled, true);
    if (digestEnabled && !digestEmail) throw new UserProfileMalformedError();

    return normalizeUserParseProfile({
      userId: record.user_id as number,
      profileId: record.id as number,
      version,
      regions,
      propertyTypes,
      priceFrom,
      priceTo,
      areaFrom,
      areaTo,
      stopWords,
      filterRent,
    });
  } catch {
    throw new UserProfileMalformedError();
  }
}

/** Convert a stored row to the only DTO exposed by the profile custom API. */
export function toUserProfileDto(value: unknown): UserProfileDto {
  if (!isRecord(value)) throw new UserProfileMalformedError();
  const canonical = toCanonicalProfile(value);
  return {
    id: canonical.profileId,
    user_id: canonical.userId,
    regions: canonical.regions,
    property_types: canonical.propertyTypes,
    price_from: canonical.priceFrom,
    price_to: canonical.priceTo,
    area_from: canonical.areaFrom,
    area_to: canonical.areaTo,
    stop_words: canonical.stopWords,
    filter_rent: canonical.filterRent ?? true,
    digest_email: normalizeStoredEmail(value.digest_email),
    digest_enabled: normalizeBoolean(value.digest_enabled, true),
    profile_version: canonical.version,
  };
}

function normalizeStringArray(value: unknown, malformed: boolean): string[] {
  try {
    const parsed = parseStoredArray(value);
    if (parsed.some(item => typeof item !== 'string')) throw new Error('invalid');
    const normalized = [...new Set(parsed.map(item => (item as string).trim().toLowerCase()).filter(Boolean))].sort();
    return normalized;
  } catch (error) {
    if (error instanceof UserProfileError) {
      if (malformed) throw error;
      throw new UserProfileValidationError();
    }
    if (malformed) throw new UserProfileMalformedError();
    throw new UserProfileValidationError();
  }
}

function canonicalReadyProfile(profile: unknown): UserParseProfile {
  if (!isRecord(profile)) throw new UserProfileMalformedError();
  if (hasOwn(profile, 'userId') || hasOwn(profile, 'profileId') || hasOwn(profile, 'propertyTypes')) {
    try {
      return normalizeUserParseProfile(profile as unknown as UserParseProfile);
    } catch {
      throw new UserProfileMalformedError();
    }
  }
  return toCanonicalProfile(profile);
}

/** True only for a structurally valid profile with both required non-empty filters. */
export function isProfileReady(profile: unknown): boolean {
  try {
    const normalized = canonicalReadyProfile(profile);
    return normalized.regions.length > 0 && normalized.propertyTypes.length > 0;
  } catch {
    return false;
  }
}

async function freshContextUser(strapi: StrapiLike, userId: number): Promise<ProfileRecord> {
  let user: unknown;
  try {
    user = await strapi.db.query(USER_UID).findOne({
      where: { id: userId },
      populate: { role: true },
    });
  } catch {
    throw new UserProfileUnavailableError();
  }
  if (!isRecord(user) || user.blocked !== false || user.confirmed !== true) {
    throw new UserProfileUnavailableError();
  }
  if (
    user.id !== userId
    || typeof user.username !== 'string'
    || user.username.length === 0
    || typeof user.email !== 'string'
    || user.email.length === 0
  ) {
    throw new UserContextMalformedError();
  }
  return user;
}

function exactMultiuserEnabled(env: NodeJS.ProcessEnv): boolean {
  const value = env?.MULTIUSER_ENABLED;
  return value === 'true' && isMultiuserEnabled({ MULTIUSER_ENABLED: 'true' });
}

/** Read fresh identity, role, and profile readiness without exposing database metadata. */
export async function getUserContext(
  strapi: StrapiLike,
  userId: unknown,
  env: NodeJS.ProcessEnv = process.env,
): Promise<UserContextDto> {
  assertPositiveUserId(userId);
  const user = await freshContextUser(strapi, userId);

  let storedProfile: unknown;
  try {
    storedProfile = await getUserProfile(strapi, userId);
  } catch {
    throw new UserContextMalformedError();
  }

  const role = isRecord(user.role) && typeof user.role.type === 'string'
    ? { type: user.role.type }
    : null;

  return {
    user: {
      id: user.id as number,
      username: user.username as string,
      email: user.email as string,
    },
    role,
    profileReady: storedProfile !== null && storedProfile !== undefined && isProfileReady(storedProfile),
    multiuserEnabled: exactMultiuserEnabled(env),
  };
}

/** Read a profile through the scalar ownership key only. */
export async function getUserProfile(strapi: StrapiLike, userId: unknown): Promise<unknown> {
  assertPositiveUserId(userId);
  return strapi.db.query(PROFILE_UID).findOne({ where: { user_id: userId } });
}

function assertProfileListPagination(page: unknown, pageSize: unknown): asserts page is number {
  if (
    typeof page !== 'number'
    || !Number.isSafeInteger(page)
    || page < PROFILE_LIST_DEFAULT_PAGE
    || page > PROFILE_LIST_MAX_PAGE
    || typeof pageSize !== 'number'
    || !Number.isSafeInteger(pageSize)
    || pageSize < 1
    || pageSize > PROFILE_LIST_MAX_PAGE_SIZE
  ) {
    throw new UserProfileValidationError();
  }
  const offset = (page - 1) * pageSize;
  if (!Number.isSafeInteger(offset)) throw new UserProfileValidationError();
}

/** List profiles with scalar-only, deterministic Query Engine pagination. */
export async function listUserProfiles(
  strapi: StrapiLike,
  page = PROFILE_LIST_DEFAULT_PAGE,
  pageSize = PROFILE_LIST_DEFAULT_PAGE_SIZE,
): Promise<{
  data: UserProfileDto[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}> {
  assertProfileListPagination(page, pageSize);
  const query = strapi.db.query(PROFILE_UID);
  const totalValue = await query.count({ where: {} });
  if (
    typeof totalValue !== 'number'
    || !Number.isSafeInteger(totalValue)
    || totalValue < 0
  ) {
    throw new UserProfileMalformedError();
  }
  const rows = await query.findMany({
    select: PROFILE_SCALAR_FIELDS,
    orderBy: [{ user_id: 'asc' }, { id: 'asc' }],
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });
  if (!Array.isArray(rows)) throw new UserProfileMalformedError();
  return {
    data: rows.map(toUserProfileDto),
    meta: {
      page,
      pageSize,
      total: totalValue,
      totalPages: Math.ceil(totalValue / pageSize),
    },
  };
}

function assertInputObject(input: unknown): asserts input is ProfileRecord {
  if (!isRecord(input)) throw new UserProfileValidationError();
  for (const key of Object.keys(input)) {
    const lower = key.toLowerCase();
    const forbiddenIdentity = [
      'id',
      'documentid',
      'user',
      'user_id',
      'userid',
      'profile_version',
      'profileversion',
    ].includes(lower)
      || ((lower.includes('actor') || lower.includes('target')) && lower.includes('id'));
    if (forbiddenIdentity || !(ALLOWED_PROFILE_FIELDS as readonly string[]).includes(key)) {
      throw new UserProfileValidationError();
    }
  }
}

function valueOrCurrent(input: ProfileRecord, field: AllowedProfileField, current: ProfileRecord, currentValue: unknown): unknown {
  return hasOwn(input, field) ? input[field] : currentValue ?? current[field];
}

function normalizeCandidateProfile(candidate: UserParseProfile): UserParseProfile {
  try {
    return normalizeUserParseProfile(candidate);
  } catch {
    throw new UserProfileValidationError();
  }
}

/** Validate and replace only filter/digest fields, using optimistic versioning. */
export async function replaceUserProfile(
  strapi: StrapiLike,
  userId: unknown,
  input: unknown,
  expectedVersion?: unknown,
): Promise<unknown> {
  assertPositiveUserId(userId);
  assertInputObject(input);
  if (expectedVersion !== undefined) assertVersion(expectedVersion);

  const existing = await getUserProfile(strapi, userId);
  if (!isRecord(existing)) throw new UserProfileNotFoundError();
  const current = toCanonicalProfile(existing);
  const currentVersion = current.version;
  if (expectedVersion !== undefined && expectedVersion !== currentVersion) {
    throw new UserProfileConflictError(expectedVersion as number, currentVersion);
  }
  const regions = normalizeInputArray(valueOrCurrent(input, 'regions', existing, current.regions), REGION_VALUES);
  const propertyTypes = normalizeInputArray(
    valueOrCurrent(input, 'property_types', existing, current.propertyTypes),
    PROPERTY_TYPE_VALUES,
  );
  const priceFrom = normalizeDecimal(valueOrCurrent(input, 'price_from', existing, current.priceFrom), false);
  const priceTo = normalizeDecimal(valueOrCurrent(input, 'price_to', existing, current.priceTo), false);
  const areaFrom = normalizeDecimal(valueOrCurrent(input, 'area_from', existing, current.areaFrom), false);
  const areaTo = normalizeDecimal(valueOrCurrent(input, 'area_to', existing, current.areaTo), false);
  assertOrderedRange(priceFrom, priceTo, false);
  assertOrderedRange(areaFrom, areaTo, false);
  const stopWords = normalizeStringArray(valueOrCurrent(input, 'stop_words', existing, current.stopWords), false);
  const filterRent = normalizeBoolean(
    valueOrCurrent(input, 'filter_rent', existing, current.filterRent ?? true),
    false,
  );
  const candidate = normalizeCandidateProfile({
    userId,
    profileId: current.profileId,
    version: currentVersion,
    regions,
    propertyTypes,
    priceFrom,
    priceTo,
    areaFrom,
    areaTo,
    stopWords,
    filterRent,
  });
  const currentDigestEmail = normalizeStoredEmail(existing.digest_email);
  const currentDigestEnabled = normalizeBoolean(existing.digest_enabled, true);
  const digestEmail = normalizeInputEmail(valueOrCurrent(input, 'digest_email', existing, currentDigestEmail));
  const digestEnabled = normalizeBoolean(
    valueOrCurrent(input, 'digest_enabled', existing, currentDigestEnabled),
    false,
  );
  if (digestEnabled && !digestEmail) throw new UserProfileValidationError();

  const sameArray = (left: readonly string[], right: readonly string[]): boolean => (
    left.length === right.length && left.every((value, index) => value === right[index])
  );
  if (
    sameArray(candidate.regions, current.regions)
    && sameArray(candidate.propertyTypes, current.propertyTypes)
    && candidate.priceFrom === current.priceFrom
    && candidate.priceTo === current.priceTo
    && candidate.areaFrom === current.areaFrom
    && candidate.areaTo === current.areaTo
    && sameArray(candidate.stopWords, current.stopWords)
    && candidate.filterRent === (current.filterRent ?? true)
    && digestEmail === currentDigestEmail
    && digestEnabled === currentDigestEnabled
  ) {
    return existing;
  }

  if (currentVersion >= Number.MAX_SAFE_INTEGER) throw new UserProfileValidationError();

  const updated = await strapi.db.query(PROFILE_UID).update({
    where: { id: current.profileId, profile_version: currentVersion },
    data: {
      regions: candidate.regions,
      property_types: candidate.propertyTypes,
      price_from: candidate.priceFrom,
      price_to: candidate.priceTo,
      area_from: candidate.areaFrom,
      area_to: candidate.areaTo,
      stop_words: candidate.stopWords,
      filter_rent: candidate.filterRent,
      digest_email: digestEmail,
      digest_enabled: digestEnabled,
      profile_version: currentVersion + 1,
    },
  });

  if (updated !== null && updated !== undefined) return updated;

  const fresh = await getUserProfile(strapi, userId);
  if (!isRecord(fresh)) throw new UserProfileNotFoundError();
  const freshProfile = toCanonicalProfile(fresh);
  const requestedVersion = expectedVersion === undefined ? currentVersion : expectedVersion as number;
  throw new UserProfileConflictError(requestedVersion, freshProfile.version);
}

function normalizeNow(now?: Date | string): string {
  const date = now === undefined ? new Date() : now instanceof Date ? now : new Date(now);
  if (Number.isNaN(date.getTime())) throw new UserProfileValidationError();
  return date.toISOString();
}

function safeSnapshotError(): UserProfileSnapshotError {
  return new UserProfileSnapshotError();
}

function activeUserId(user: unknown): number {
  if (!isRecord(user) || !Number.isSafeInteger(user.id) || (user.id as number) <= 0) throw safeSnapshotError();
  return user.id as number;
}

async function findActiveUsers(strapi: StrapiLike): Promise<ProfileRecord[]> {
  let users: unknown;
  try {
    users = await strapi.db.query(USER_UID).findMany({
      where: { blocked: false, confirmed: true },
      orderBy: { id: 'asc' },
    });
  } catch {
    throw safeSnapshotError();
  }
  if (!Array.isArray(users)) throw safeSnapshotError();

  const active = users.filter(user => isRecord(user) && user.blocked === false && user.confirmed === true) as ProfileRecord[];
  const seen = new Set<number>();
  for (const user of active) {
    const id = activeUserId(user);
    if (seen.has(id)) throw safeSnapshotError();
    seen.add(id);
  }
  active.sort((left, right) => (left.id as number) - (right.id as number));
  return active;
}

async function findProfilesForUsers(strapi: StrapiLike, userIds: number[]): Promise<Map<number, ProfileRecord>> {
  if (userIds.length === 0) return new Map();
  let profiles: unknown;
  try {
    profiles = await strapi.db.query(PROFILE_UID).findMany({
      where: { user_id: { $in: userIds } },
      orderBy: { id: 'asc' },
    });
  } catch {
    throw safeSnapshotError();
  }
  if (!Array.isArray(profiles)) throw safeSnapshotError();

  const activeIds = new Set(userIds);
  const byUserId = new Map<number, ProfileRecord>();
  for (const value of profiles) {
    if (!isRecord(value) || !Number.isSafeInteger(value.user_id) || (value.user_id as number) <= 0) {
      throw safeSnapshotError();
    }
    const userId = value.user_id as number;
    if (!activeIds.has(userId) || byUserId.has(userId)) throw safeSnapshotError();
    byUserId.set(userId, value);
  }
  return byUserId;
}

function readySnapshotProfile(value: ProfileRecord): UserParseProfile | null {
  const normalized = toCanonicalProfile(value);
  if (!isProfileReady(normalized)) return null;
  return normalized;
}

function freezeSnapshot(snapshot: UserFilterSnapshot): UserFilterSnapshot {
  const freeze = (value: unknown): unknown => {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.freeze(value);
      for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
    }
    return value;
  };
  return freeze(snapshot) as UserFilterSnapshot;
}

/** Build an immutable all-user snapshot from a fresh active-user query. */
export async function buildAllActiveSnapshot(strapi: StrapiLike, now?: Date | string): Promise<UserFilterSnapshot> {
  const windowEndAt = normalizeNow(now);
  const users = await findActiveUsers(strapi);
  const profiles = await findProfilesForUsers(strapi, users.map(activeUserId));
  const readyProfiles: UserParseProfile[] = [];
  for (const user of users) {
    const stored = profiles.get(activeUserId(user));
    if (!stored) continue;
    const ready = readySnapshotProfile(stored);
    if (ready) readyProfiles.push(ready);
  }

  return freezeSnapshot(createUserFilterSnapshot({
    schemaVersion: 1,
    scope: 'all',
    createdAt: windowEndAt,
    windowEndAt,
    profiles: readyProfiles,
  }));
}

/** Build an immutable single-user snapshot, or null for a valid but unready profile. */
export async function buildSingleUserSnapshot(
  strapi: StrapiLike,
  targetUserId: unknown,
  now?: Date | string,
): Promise<UserFilterSnapshot | null> {
  assertPositiveUserId(targetUserId);
  const windowEndAt = normalizeNow(now);
  let user: unknown;
  try {
    user = await strapi.db.query(USER_UID).findOne({ where: { id: targetUserId } });
  } catch {
    throw new UserProfileUnavailableError();
  }
  if (!isRecord(user) || user.blocked !== false || user.confirmed !== true) {
    throw new UserProfileUnavailableError();
  }

  const stored = await getUserProfile(strapi, targetUserId);
  if (!isRecord(stored)) return null;
  const ready = readySnapshotProfile(stored);
  if (!ready) return null;

  return freezeSnapshot(createUserFilterSnapshot({
    schemaVersion: 1,
    scope: 'single',
    createdAt: windowEndAt,
    windowEndAt,
    profiles: [ready],
  }));
}

export type { PropertyType, Region, UserFilterSnapshot, UserParseProfile };
export { PROPERTY_TYPE_VALUES, REGION_VALUES };
