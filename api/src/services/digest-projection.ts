import {
  normalizeUserFilterSnapshot,
  type UserFilterSnapshot,
  type UserParseProfile,
} from '@aklab/parse-rules';
import {
  createUserPropertyScopeRepository,
  type UserPropertyListResult,
} from './user-property-scope';

export const PARSER_RUN_UID = 'api::parser-run.parser-run';
export const SETTING_UID = 'api::setting.setting';
export const USER_UID = 'plugin::users-permissions.user';
export const USER_PROFILE_UID = 'api::user-profile.user-profile';

const PARSER_RUN_SELECT = [
  'run_id',
  'status',
  'filter_snapshot',
  'filter_snapshot_hash',
  'filter_snapshot_schema_version',
  'profile_scope',
  'digest_window_end_at',
] as const;
const DAY_MS = 24 * 60 * 60 * 1000;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 320;
const MAX_DIGEST_RECIPIENTS = 10;
const MAX_RUN_ID_LENGTH = 128;
const PROFILE_SCOPE_SET = new Set(['all', 'single']);

type RecordValue = Record<string, unknown>;

type DigestProjectionQuery = {
  findOne: (params?: unknown) => Promise<unknown>;
};

export interface DigestProjectionStrapi {
  db: {
    query: (uid: string) => DigestProjectionQuery;
    connection: {
      raw: (sql: string, bindings?: unknown[]) => Promise<unknown>;
    };
  };
}

export interface DigestProjectionPropertiesInput {
  runId: string;
  userId: number;
  snapshotHash: string;
  page: number;
  pageSize: number;
}

export interface DigestProjectionDeliveryInput {
  runId: string;
  userId: number;
  snapshotHash: string;
}

export type DigestDeliveryResult =
  | { enabled: false; reason: 'inactive' | 'disabled' | 'missing_email' }
  | { enabled: true; emails: string[] };

export class DigestProjectionError extends Error {
  readonly code: string;

  constructor(name: string, code: string, message: string) {
    super(message);
    this.name = name;
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class DigestProjectionValidationError extends DigestProjectionError {
  constructor() {
    super('DigestProjectionValidationError', 'DIGEST_PROJECTION_VALIDATION_ERROR', 'Invalid digest projection request.');
  }
}

export class DigestProjectionNotFoundError extends DigestProjectionError {
  constructor() {
    super('DigestProjectionNotFoundError', 'DIGEST_PROJECTION_NOT_FOUND', 'Digest projection was not found.');
  }
}

export class DigestProjectionConflictError extends DigestProjectionError {
  constructor() {
    super('DigestProjectionConflictError', 'DIGEST_PROJECTION_CONFLICT', 'Digest projection snapshot conflict.');
  }
}

export class DigestProjectionMalformedError extends DigestProjectionError {
  constructor() {
    super('DigestProjectionMalformedError', 'DIGEST_PROJECTION_MALFORMED', 'Digest projection data is malformed.');
  }
}

export class DigestProjectionUnavailableError extends DigestProjectionError {
  constructor() {
    super('DigestProjectionUnavailableError', 'DIGEST_PROJECTION_UNAVAILABLE', 'Digest projection is unavailable.');
  }
}

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(value: RecordValue, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function exactInput(value: unknown, fields: readonly string[]): RecordValue {
  if (!isRecord(value) || Object.keys(value).length !== fields.length) {
    throw new DigestProjectionValidationError();
  }
  const allowed = new Set(fields);
  if (Object.keys(value).some(key => !allowed.has(key)) || fields.some(field => !hasOwn(value, field))) {
    throw new DigestProjectionValidationError();
  }
  return value;
}

function normalizeRunId(value: unknown): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > MAX_RUN_ID_LENGTH
    || value.trim() !== value
    || /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new DigestProjectionValidationError();
  }
  return value;
}

function normalizeUserId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new DigestProjectionValidationError();
  }
  return value;
}

function normalizeSnapshotHash(value: unknown): string {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw new DigestProjectionValidationError();
  }
  return value;
}

function normalizePage(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 100_000) {
    throw new DigestProjectionValidationError();
  }
  return value;
}

function normalizePageSize(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 100) {
    throw new DigestProjectionValidationError();
  }
  return value;
}

function normalizePropertiesInput(value: unknown): DigestProjectionPropertiesInput {
  const input = exactInput(value, ['runId', 'userId', 'snapshotHash', 'page', 'pageSize']);
  return {
    runId: normalizeRunId(input.runId),
    userId: normalizeUserId(input.userId),
    snapshotHash: normalizeSnapshotHash(input.snapshotHash),
    page: normalizePage(input.page),
    pageSize: normalizePageSize(input.pageSize),
  };
}

function normalizeDeliveryInput(value: unknown): DigestProjectionDeliveryInput {
  const input = exactInput(value, ['runId', 'userId', 'snapshotHash']);
  return {
    runId: normalizeRunId(input.runId),
    userId: normalizeUserId(input.userId),
    snapshotHash: normalizeSnapshotHash(input.snapshotHash),
  };
}

function parseStoredSnapshot(value: unknown): RecordValue {
  if (isRecord(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (isRecord(parsed)) return parsed;
    } catch {
      // Convert all persisted-shape failures to one generic typed error below.
    }
  }
  throw new DigestProjectionMalformedError();
}

function snapshotContext(
  row: RecordValue,
  requestedHash: string,
  userId: number,
): { snapshot: UserFilterSnapshot; profile: UserParseProfile; lower: string; upper: string } {
  if (row.status !== 'running' || row.profile_scope === 'none') {
    throw new DigestProjectionNotFoundError();
  }
  if (
    typeof row.filter_snapshot_hash !== 'string'
    || !SHA256_PATTERN.test(row.filter_snapshot_hash)
    || row.filter_snapshot_schema_version !== 1
    || typeof row.profile_scope !== 'string'
    || !PROFILE_SCOPE_SET.has(row.profile_scope)
  ) {
    throw new DigestProjectionMalformedError();
  }

  const storedSnapshot = parseStoredSnapshot(row.filter_snapshot);
  if (storedSnapshot.hash !== row.filter_snapshot_hash) {
    throw new DigestProjectionMalformedError();
  }

  let snapshot: UserFilterSnapshot;
  try {
    snapshot = normalizeUserFilterSnapshot(storedSnapshot as unknown as UserFilterSnapshot);
  } catch {
    const rawProfiles = storedSnapshot.profiles;
    if (Array.isArray(rawProfiles)) {
      const duplicateMatches = rawProfiles.filter(profile => isRecord(profile) && profile.userId === userId).length;
      if (duplicateMatches > 1) throw new DigestProjectionConflictError();
    }
    throw new DigestProjectionMalformedError();
  }
  if (
    snapshot.hash !== row.filter_snapshot_hash
    || snapshot.hash !== requestedHash
    || snapshot.schemaVersion !== row.filter_snapshot_schema_version
    || snapshot.scope !== row.profile_scope
  ) {
    if (snapshot.hash !== row.filter_snapshot_hash || snapshot.schemaVersion !== row.filter_snapshot_schema_version || snapshot.scope !== row.profile_scope) {
      throw new DigestProjectionMalformedError();
    }
    throw new DigestProjectionConflictError();
  }

  const matches = snapshot.profiles.filter(profile => profile.userId === userId);
  if (matches.length !== 1) throw new DigestProjectionNotFoundError();

  const snapshotEpoch = Date.parse(snapshot.windowEndAt);
  const upperEpoch = typeof row.digest_window_end_at === 'string'
    ? Date.parse(row.digest_window_end_at)
    : Number.NaN;
  if (
    !Number.isFinite(snapshotEpoch)
    || !Number.isFinite(upperEpoch)
    || new Date(upperEpoch).toISOString() !== row.digest_window_end_at
    || upperEpoch < snapshotEpoch
  ) {
    throw new DigestProjectionMalformedError();
  }
  const upper = new Date(upperEpoch).toISOString();
  const lower = new Date(upperEpoch - DAY_MS).toISOString();
  return { snapshot, profile: matches[0], lower, upper };
}

async function loadSnapshotContext(
  strapi: DigestProjectionStrapi,
  input: DigestProjectionPropertiesInput | DigestProjectionDeliveryInput,
): Promise<{ snapshot: UserFilterSnapshot; profile: UserParseProfile; lower: string; upper: string }> {
  let row: unknown;
  try {
    row = await strapi.db.query(PARSER_RUN_UID).findOne({
      where: { run_id: input.runId, status: 'running' },
      select: [...PARSER_RUN_SELECT],
    });
  } catch {
    throw new DigestProjectionUnavailableError();
  }
  if (!isRecord(row)) throw new DigestProjectionNotFoundError();
  return snapshotContext(row, input.snapshotHash, input.userId);
}

function normalizeThreshold(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new DigestProjectionMalformedError();
  }
  return value;
}

async function loadThreshold(strapi: DigestProjectionStrapi): Promise<number> {
  let row: unknown;
  try {
    row = await strapi.db.query(SETTING_UID).findOne({ select: ['threshold_percent'] });
  } catch {
    throw new DigestProjectionUnavailableError();
  }
  if (!isRecord(row) || !hasOwn(row, 'threshold_percent')) {
    throw new DigestProjectionMalformedError();
  }
  return normalizeThreshold(row.threshold_percent);
}

function normalizeCurrentEmails(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (typeof value !== 'string') throw new DigestProjectionMalformedError();
  const raw = value.trim();
  if (raw === '') return [];

  const recipients = raw.split(',').map(recipient => recipient.trim());
  if (
    recipients.length > MAX_DIGEST_RECIPIENTS
    || recipients.some(recipient => recipient === '' || recipient.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(recipient))
  ) {
    throw new DigestProjectionMalformedError();
  }

  const unique = new Map<string, string>();
  for (const recipient of recipients) {
    const key = recipient.toLowerCase();
    if (!unique.has(key)) unique.set(key, recipient);
  }
  return [...unique.values()];
}

async function loadCurrentDelivery(
  strapi: DigestProjectionStrapi,
  userId: number,
): Promise<DigestDeliveryResult> {
  let user: unknown;
  try {
    user = await strapi.db.query(USER_UID).findOne({
      where: { id: userId },
      select: ['blocked', 'confirmed'],
    });
  } catch {
    throw new DigestProjectionUnavailableError();
  }
  if (!isRecord(user) || user.blocked !== false || user.confirmed !== true) {
    return { enabled: false, reason: 'inactive' };
  }

  let profile: unknown;
  try {
    profile = await strapi.db.query(USER_PROFILE_UID).findOne({
      where: { user_id: userId },
      select: ['digest_enabled', 'digest_email'],
    });
  } catch {
    throw new DigestProjectionUnavailableError();
  }
  if (!isRecord(profile)) return { enabled: false, reason: 'disabled' };
  if (typeof profile.digest_enabled !== 'boolean') throw new DigestProjectionMalformedError();
  if (!profile.digest_enabled) return { enabled: false, reason: 'disabled' };
  const emails = normalizeCurrentEmails(profile.digest_email);
  if (emails.length === 0) return { enabled: false, reason: 'missing_email' };
  return { enabled: true, emails };
}

export class DigestProjectionService {
  constructor(private readonly strapi: DigestProjectionStrapi) {}

  async properties(input: unknown): Promise<UserPropertyListResult & {
    meta: UserPropertyListResult['meta'] & { threshold: number; windowEndAt: string };
  }> {
    const normalized = normalizePropertiesInput(input);
    const context = await loadSnapshotContext(this.strapi, normalized);
    const threshold = await loadThreshold(this.strapi);
    const repository = createUserPropertyScopeRepository(
      this.strapi,
      async (userId) => userId === normalized.userId ? context.profile : null,
    );
    const result = await repository.list(normalized.userId, {
      focusThreshold: threshold,
      sort: '-focus_score',
      page: normalized.page,
      pageSize: normalized.pageSize,
      firstSeenAfter: context.lower,
      firstSeenAtOrBefore: context.upper,
    });
    return {
      data: result.data,
      meta: { ...result.meta, threshold, windowEndAt: context.upper },
    };
  }

  async delivery(input: unknown): Promise<DigestDeliveryResult> {
    const normalized = normalizeDeliveryInput(input);
    await loadSnapshotContext(this.strapi, normalized);
    return loadCurrentDelivery(this.strapi, normalized.userId);
  }
}

export function createDigestProjectionService(strapi: DigestProjectionStrapi): DigestProjectionService {
  return new DigestProjectionService(strapi);
}
