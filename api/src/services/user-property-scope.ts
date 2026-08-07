import { normalizeUserParseProfile, type PropertyType, type Region, type UserParseProfile } from '@aklab/parse-rules';
import { buildSingleUserSnapshot } from './user-profile';

export type UserPropertyStatus = 'new' | 'in_progress' | 'viewed' | 'rejected';

export interface UserPropertyScopeRequest {
  city?: Region | readonly Region[];
  propertyType?: PropertyType | readonly PropertyType[];
  status?: UserPropertyStatus | readonly UserPropertyStatus[];
  search?: string;
  focusThreshold?: number;
  documentId?: string;
  sort?: string;
  page?: number;
  pageSize?: number;
  /** Internal-only freshness bounds; public controllers do not expose these keys. */
  firstSeenAfter?: string;
  firstSeenAtOrBefore?: string;
}

export interface UserPropertyScopeStrapi {
  db: {
    connection: {
      raw: (sql: string, bindings?: unknown[]) => Promise<unknown>;
    };
    query?: (uid: string) => unknown;
  };
}

export type UserPropertyProfileLoader = (
  userId: number,
) => Promise<UserParseProfile | null | undefined>;

export interface CompiledUserPropertyScope {
  readonly fromSql: string;
  readonly whereSql: string;
  readonly bindings: readonly unknown[];
  readonly orderBySql: string;
  readonly page: number;
  readonly pageSize: number;
}

export interface UserPropertyDto {
  documentId: string;
  title: unknown;
  source: unknown;
  external_id: unknown;
  url: unknown;
  city: unknown;
  address: unknown;
  area_sqm: unknown;
  price: unknown;
  price_per_sqm: unknown;
  manual_price_per_sqm: unknown;
  property_type: unknown;
  auction_type: unknown;
  published_at_source: unknown;
  description: unknown;
  contacts: unknown;
  photos_downloaded: boolean;
  latitude: unknown;
  longitude: unknown;
  is_undervalued: unknown;
  deviation_percent: unknown;
  focus_score: unknown;
  status: UserPropertyStatus;
  tags: unknown[];
  photo_urls: string[];
  photos: unknown[];
  minimum_price: unknown;
  first_seen_at: unknown;
  createdAt: unknown;
}

export interface UserPropertyListResult {
  data: UserPropertyDto[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export interface UserPropertyStats {
  total: number;
  inFocus: number;
  hot: number;
  undervalued: number;
  newToday: number;
  typeBreakdown: Record<string, number>;
}

export class UserPropertyScopeError extends Error {
  readonly code: string;

  constructor(name: string, code: string, message: string) {
    super(message);
    this.name = name;
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class UserPropertyScopeValidationError extends UserPropertyScopeError {
  constructor() {
    super('UserPropertyScopeValidationError', 'USER_PROPERTY_SCOPE_VALIDATION_ERROR', 'Invalid user property scope request.');
  }
}

export class UserPropertyScopeMalformedError extends UserPropertyScopeError {
  constructor() {
    super('UserPropertyScopeMalformedError', 'USER_PROPERTY_SCOPE_MALFORMED', 'Stored user property scope is malformed.');
  }
}

export class UserPropertyScopeNotReadyError extends UserPropertyScopeError {
  constructor() {
    super('UserPropertyScopeNotReadyError', 'USER_PROPERTY_SCOPE_NOT_READY', 'User property scope is not ready.');
  }
}

export class UserPropertyScopeUnavailableError extends UserPropertyScopeError {
  constructor() {
    super('UserPropertyScopeUnavailableError', 'USER_PROPERTY_SCOPE_UNAVAILABLE', 'User property scope is unavailable.');
  }
}

export class UserPropertyScopeQueryError extends UserPropertyScopeError {
  constructor() {
    super('UserPropertyScopeQueryError', 'USER_PROPERTY_SCOPE_QUERY_ERROR', 'User property scope query failed.');
  }
}

const FROM_SQL = 'FROM properties AS p LEFT JOIN user_property_states AS ups '
  + 'ON ups.property_document_id = p.document_id AND ups.user_id = ?';
const DEFAULT_STATUS: UserPropertyStatus = 'new';
const MAX_PAGE = 100_000;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const MAX_REQUEST_TEXT_LENGTH = 256;
const MAX_FILTER_CARDINALITY = 128;

const REGION_SET = new Set<Region>(['moscow', 'mo', 'other']);
const PROPERTY_TYPE_SET = new Set<PropertyType>([
  'office',
  'warehouse',
  'retail',
  'production',
  'free_purpose',
  'apartment',
  'land',
  'other',
]);
const STATUS_SET = new Set<UserPropertyStatus>(['new', 'in_progress', 'viewed', 'rejected']);

const SORT_COLUMNS: Readonly<Record<string, string>> = Object.freeze({
  focus_score: 'p.focus_score',
  price: 'p.price',
  price_per_sqm: 'p.price_per_sqm',
  area_sqm: 'p.area_sqm',
  deviation_percent: 'p.deviation_percent',
  createdAt: 'p.created_at',
  created_at: 'p.created_at',
});

const SELECT_COLUMNS = [
  'p.document_id AS document_id',
  'p.title AS title',
  'p.source AS source',
  'p.external_id AS external_id',
  'p.url AS url',
  'p.city AS city',
  'p.address AS address',
  'p.area_sqm AS area_sqm',
  'p.price AS price',
  'p.price_per_sqm AS price_per_sqm',
  'p.manual_price_per_sqm AS manual_price_per_sqm',
  'p.property_type AS property_type',
  'p.auction_type AS auction_type',
  'p.published_at_source AS published_at_source',
  'p.description AS description',
  'p.contacts AS contacts',
  'p.photos_downloaded AS photos_downloaded',
  'p.latitude AS latitude',
  'p.longitude AS longitude',
  'p.is_undervalued AS is_undervalued',
  'p.deviation_percent AS deviation_percent',
  'p.focus_score AS focus_score',
  'COALESCE(ups.status, ?) AS personal_status',
  'p.tags AS tags',
  'p.photo_urls AS photo_urls',
  'p.photos AS photos',
  'p.minimum_price AS minimum_price',
  'p.first_seen_at AS first_seen_at',
  'p.created_at AS created_at',
].join(', ');

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertPositiveUserId(value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new UserPropertyScopeValidationError();
  }
}

function normalizeProfile(profile: unknown): UserParseProfile {
  let normalized: UserParseProfile;
  try {
    normalized = normalizeUserParseProfile(profile as UserParseProfile);
  } catch {
    throw new UserPropertyScopeMalformedError();
  }

  if (normalized.regions.length === 0 || normalized.propertyTypes.length === 0) {
    throw new UserPropertyScopeNotReadyError();
  }
  return normalized;
}

function normalizeEnumFilter<T extends string>(
  value: T | readonly T[] | undefined,
  field: string,
  allowed: ReadonlySet<T>,
): T[] {
  if (value === undefined) return [];
  const values = Array.isArray(value) ? [...value] : [value];
  if (values.length === 0 || values.length > MAX_FILTER_CARDINALITY) {
    throw new UserPropertyScopeValidationError();
  }

  const normalized: T[] = [];
  const seen = new Set<T>();
  for (const item of values) {
    if (typeof item !== 'string') throw new UserPropertyScopeValidationError();
    const candidate = item.trim().toLowerCase() as T;
    if (!allowed.has(candidate) || seen.has(candidate)) throw new UserPropertyScopeValidationError();
    seen.add(candidate);
    normalized.push(candidate);
  }
  if (field === '' || normalized.length > allowed.size) throw new UserPropertyScopeValidationError();
  return normalized;
}

const EXACT_UTC_ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function normalizeExactUtcIso(value: unknown): string {
  if (
    typeof value !== 'string'
    || !EXACT_UTC_ISO_PATTERN.test(value)
    || Number.isNaN(Date.parse(value))
    || new Date(value).toISOString() !== value
  ) {
    throw new UserPropertyScopeValidationError();
  }
  return value;
}

function normalizeRequest(request: UserPropertyScopeRequest | undefined): {
  city: Region[];
  propertyType: PropertyType[];
  status: UserPropertyStatus[];
  search?: string;
  focusThreshold?: number;
  documentId?: string;
  sort: string;
  page: number;
  pageSize: number;
  firstSeenAfter?: string;
  firstSeenAtOrBefore?: string;
} {
  if (request !== undefined && !isRecord(request)) throw new UserPropertyScopeValidationError();
  const input = (request || {}) as Record<string, unknown>;
  const allowedKeys = new Set([
    'city',
    'propertyType',
    'status',
    'search',
    'focusThreshold',
    'documentId',
    'sort',
    'page',
    'pageSize',
    'firstSeenAfter',
    'firstSeenAtOrBefore',
  ]);
  if (Object.keys(input).some(key => !allowedKeys.has(key))) {
    throw new UserPropertyScopeValidationError();
  }

  const city = normalizeEnumFilter(input.city as Region | readonly Region[] | undefined, 'city', REGION_SET);
  const propertyType = normalizeEnumFilter(
    input.propertyType as PropertyType | readonly PropertyType[] | undefined,
    'propertyType',
    PROPERTY_TYPE_SET,
  );
  const status = normalizeEnumFilter(
    input.status as UserPropertyStatus | readonly UserPropertyStatus[] | undefined,
    'status',
    STATUS_SET,
  );

  let search: string | undefined;
  if (input.search !== undefined) {
    if (typeof input.search !== 'string') throw new UserPropertyScopeValidationError();
    const value = input.search.trim();
    if (value.length > MAX_REQUEST_TEXT_LENGTH) throw new UserPropertyScopeValidationError();
    if (value !== '') search = value;
  }

  let focusThreshold: number | undefined;
  if (input.focusThreshold !== undefined) {
    if (typeof input.focusThreshold !== 'number' || !Number.isFinite(input.focusThreshold) || input.focusThreshold < 0) {
      throw new UserPropertyScopeValidationError();
    }
    focusThreshold = input.focusThreshold;
  }

  let documentId: string | undefined;
  if (input.documentId !== undefined) {
    if (
      typeof input.documentId !== 'string'
      || input.documentId.trim() === ''
      || input.documentId !== input.documentId.trim()
      || input.documentId.length > MAX_REQUEST_TEXT_LENGTH
    ) {
      throw new UserPropertyScopeValidationError();
    }
    documentId = input.documentId;
  }

  let sort = 'focus_score DESC';
  if (input.sort !== undefined) {
    if (typeof input.sort !== 'string' || input.sort === '') throw new UserPropertyScopeValidationError();
    const descending = input.sort.startsWith('-');
    const field = descending ? input.sort.slice(1) : input.sort;
    const column = SORT_COLUMNS[field];
    if (!column || (input.sort.startsWith('-') && field === '')) throw new UserPropertyScopeValidationError();
    sort = `${column} ${descending ? 'DESC' : 'ASC'}`;
  }

  const page = input.page === undefined ? 1 : input.page;
  const pageSize = input.pageSize === undefined ? DEFAULT_PAGE_SIZE : input.pageSize;
  if (
    typeof page !== 'number'
    || !Number.isSafeInteger(page)
    || page < 1
    || page > MAX_PAGE
    || typeof pageSize !== 'number'
    || !Number.isSafeInteger(pageSize)
    || pageSize < 1
    || pageSize > MAX_PAGE_SIZE
  ) {
    throw new UserPropertyScopeValidationError();
  }

  let firstSeenAfter: string | undefined;
  let firstSeenAtOrBefore: string | undefined;
  if (input.firstSeenAfter !== undefined || input.firstSeenAtOrBefore !== undefined) {
    if (input.firstSeenAfter === undefined || input.firstSeenAtOrBefore === undefined) {
      throw new UserPropertyScopeValidationError();
    }
    firstSeenAfter = normalizeExactUtcIso(input.firstSeenAfter);
    firstSeenAtOrBefore = normalizeExactUtcIso(input.firstSeenAtOrBefore);
    if (Date.parse(firstSeenAfter) >= Date.parse(firstSeenAtOrBefore)) {
      throw new UserPropertyScopeValidationError();
    }
  }

  return {
    city,
    propertyType,
    status,
    search,
    focusThreshold,
    documentId,
    sort,
    page,
    pageSize,
    firstSeenAfter,
    firstSeenAtOrBefore,
  };
}

function escapeLike(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(',');
}

/**
 * Pure, parameterized compiler for the canonical user-property scope.
 * The returned profile predicates are immutable and every dynamic value is a binding.
 */
export function compileUserPropertyScope(
  profile: UserParseProfile,
  request?: UserPropertyScopeRequest,
): CompiledUserPropertyScope {
  const normalizedProfile = normalizeProfile(profile);
  const normalizedRequest = normalizeRequest(request);
  const where: string[] = [
    `p.city IN (${placeholders(normalizedProfile.regions.length)})`,
    `p.property_type IN (${placeholders(normalizedProfile.propertyTypes.length)})`,
  ];
  const bindings: unknown[] = [
    normalizedProfile.userId,
    ...normalizedProfile.regions,
    ...normalizedProfile.propertyTypes,
  ];

  if (normalizedProfile.priceFrom !== null) {
    where.push('(p.price IS NULL OR p.price >= ?)');
    bindings.push(normalizedProfile.priceFrom);
  }
  if (normalizedProfile.priceTo !== null) {
    where.push('(p.price IS NULL OR p.price <= ?)');
    bindings.push(normalizedProfile.priceTo);
  }
  if (normalizedProfile.areaFrom !== null) {
    where.push('(p.area_sqm IS NULL OR p.area_sqm >= ?)');
    bindings.push(normalizedProfile.areaFrom);
  }
  if (normalizedProfile.areaTo !== null) {
    where.push('(p.area_sqm IS NULL OR p.area_sqm <= ?)');
    bindings.push(normalizedProfile.areaTo);
  }

  const searchableText = "LOWER(COALESCE(p.title, '') || ' ' || COALESCE(p.description, ''))";
  for (const stopWord of normalizedProfile.stopWords) {
    where.push(`${searchableText} NOT LIKE ? ESCAPE '\\'`);
    bindings.push(`%${escapeLike(stopWord)}%`);
  }

  if (normalizedRequest.city.length > 0) {
    where.push(`p.city IN (${placeholders(normalizedRequest.city.length)})`);
    bindings.push(...normalizedRequest.city);
  }
  if (normalizedRequest.propertyType.length > 0) {
    where.push(`p.property_type IN (${placeholders(normalizedRequest.propertyType.length)})`);
    bindings.push(...normalizedRequest.propertyType);
  }
  if (normalizedRequest.status.length > 0) {
    where.push(`COALESCE(ups.status, ?) IN (${placeholders(normalizedRequest.status.length)})`);
    bindings.push(DEFAULT_STATUS, ...normalizedRequest.status);
  }
  if (normalizedRequest.search !== undefined) {
    const searchText = "LOWER(COALESCE(p.title, '') || ' ' || COALESCE(p.description, '') || ' ' || COALESCE(p.address, ''))";
    where.push(`${searchText} LIKE ? ESCAPE '\\'`);
    bindings.push(`%${escapeLike(normalizedRequest.search.toLowerCase())}%`);
  }
  if (normalizedRequest.focusThreshold !== undefined) {
    where.push('p.focus_score >= ?');
    bindings.push(normalizedRequest.focusThreshold);
  }
  if (normalizedRequest.documentId !== undefined) {
    where.push('p.document_id = ?');
    bindings.push(normalizedRequest.documentId);
  }
  if (normalizedRequest.firstSeenAfter !== undefined && normalizedRequest.firstSeenAtOrBefore !== undefined) {
    where.push('p.first_seen_at > ? AND p.first_seen_at <= ?');
    // Strapi's SQLite datetime columns are exposed to raw queries as epoch
    // milliseconds. Keep the API contract strict ISO, but bind the physical
    // representation so SQLite does not compare INTEGER values to TEXT.
    bindings.push(
      Date.parse(normalizedRequest.firstSeenAfter),
      Date.parse(normalizedRequest.firstSeenAtOrBefore),
    );
  }

  return Object.freeze({
    fromSql: FROM_SQL,
    whereSql: where.join(' AND '),
    bindings: Object.freeze(bindings),
    orderBySql: normalizedRequest.sort,
    page: normalizedRequest.page,
    pageSize: normalizedRequest.pageSize,
  });
}

function rowsFromRaw(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) {
    if (result.some(row => !isRecord(row))) throw new UserPropertyScopeQueryError();
    return result as Record<string, unknown>[];
  }
  if (isRecord(result) && Array.isArray(result.rows)) {
    if (result.rows.some(row => !isRecord(row))) throw new UserPropertyScopeQueryError();
    return result.rows as Record<string, unknown>[];
  }
  throw new UserPropertyScopeQueryError();
}

function safeJsonArray(value: unknown, stringsOnly = false): unknown[] {
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  if (stringsOnly) return parsed.filter(item => typeof item === 'string');
  return parsed;
}

function mapSqliteBoolean(value: unknown): boolean {
  // The explicit SELECT always supplies this column; absent legacy/mock rows fail closed to false.
  if (value === undefined || value === 0) return false;
  if (value === 1) return true;
  throw new UserPropertyScopeQueryError();
}

function mapDto(row: Record<string, unknown>): UserPropertyDto {
  if (typeof row.document_id !== 'string' || row.document_id === '') throw new UserPropertyScopeQueryError();
  const rawStatus = row.personal_status;
  let status: UserPropertyStatus;
  if (rawStatus === null || rawStatus === undefined) {
    status = DEFAULT_STATUS;
  } else if (typeof rawStatus === 'string' && STATUS_SET.has(rawStatus as UserPropertyStatus)) {
    status = rawStatus as UserPropertyStatus;
  } else {
    throw new UserPropertyScopeQueryError();
  }

  return {
    documentId: row.document_id,
    title: row.title,
    source: row.source,
    external_id: row.external_id,
    url: row.url,
    city: row.city,
    address: row.address,
    area_sqm: row.area_sqm,
    price: row.price,
    price_per_sqm: row.price_per_sqm,
    manual_price_per_sqm: row.manual_price_per_sqm,
    property_type: row.property_type,
    auction_type: row.auction_type,
    published_at_source: row.published_at_source,
    description: row.description,
    contacts: row.contacts,
    photos_downloaded: mapSqliteBoolean(row.photos_downloaded),
    latitude: row.latitude,
    longitude: row.longitude,
    is_undervalued: row.is_undervalued,
    deviation_percent: row.deviation_percent,
    focus_score: row.focus_score,
    status,
    tags: safeJsonArray(row.tags, true),
    photo_urls: safeJsonArray(row.photo_urls, true) as string[],
    photos: safeJsonArray(row.photos),
    minimum_price: row.minimum_price,
    first_seen_at: row.first_seen_at,
    createdAt: row.created_at,
  };
}

function totalFromRaw(result: unknown): number {
  const rows = rowsFromRaw(result);
  if (rows.length !== 1) throw new UserPropertyScopeQueryError();
  const value = rows[0].total;
  const total = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isSafeInteger(total) || total < 0) throw new UserPropertyScopeQueryError();
  return total;
}

function statsNumber(value: unknown): number {
  if (typeof value === 'string' && value.trim() === '') throw new UserPropertyScopeQueryError();
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new UserPropertyScopeQueryError();
  return parsed;
}

function statsAggregateFromRaw(result: unknown): Omit<UserPropertyStats, 'typeBreakdown'> {
  const rows = rowsFromRaw(result);
  if (rows.length !== 1) throw new UserPropertyScopeQueryError();
  const row = rows[0];
  return {
    total: statsNumber(row.total),
    inFocus: statsNumber(row.in_focus),
    hot: statsNumber(row.hot),
    undervalued: statsNumber(row.undervalued),
    newToday: statsNumber(row.new_today),
  };
}

function statsTypeBreakdownFromRaw(result: unknown): Record<string, number> {
  const rows = rowsFromRaw(result);
  const breakdown: Record<string, number> = {};
  for (const row of rows) {
    if (typeof row.property_type !== 'string' || !PROPERTY_TYPE_SET.has(row.property_type as PropertyType)) {
      throw new UserPropertyScopeQueryError();
    }
    if (Object.prototype.hasOwnProperty.call(breakdown, row.property_type)) {
      throw new UserPropertyScopeQueryError();
    }
    breakdown[row.property_type] = statsNumber(row.total);
  }
  return breakdown;
}

function statsWindow(now?: Date | string): { lower: string; upper: string; lowerEpoch: number; upperEpoch: number } {
  const date = now === undefined ? new Date() : now instanceof Date ? now : new Date(now);
  if (Number.isNaN(date.getTime())) throw new UserPropertyScopeValidationError();
  return {
    lower: new Date(date.getTime() - 24 * 60 * 60 * 1000).toISOString(),
    upper: date.toISOString(),
    lowerEpoch: date.getTime() - 24 * 60 * 60 * 1000,
    upperEpoch: date.getTime(),
  };
}

async function defaultProfileLoader(strapi: UserPropertyScopeStrapi, userId: number): Promise<UserParseProfile | null> {
  try {
    const snapshot = await buildSingleUserSnapshot(strapi as never, userId);
    return snapshot?.profiles.length === 1 ? snapshot.profiles[0] : null;
  } catch (error) {
    if (error instanceof UserPropertyScopeError) throw error;
    throw new UserPropertyScopeUnavailableError();
  }
}

export class UserPropertyScopeRepository {
  private readonly loadProfile: UserPropertyProfileLoader;

  constructor(
    private readonly strapi: UserPropertyScopeStrapi,
    loadProfile?: UserPropertyProfileLoader,
  ) {
    this.loadProfile = loadProfile || ((userId) => defaultProfileLoader(strapi, userId));
  }

  async compile(userId: unknown, request?: UserPropertyScopeRequest): Promise<CompiledUserPropertyScope> {
    assertPositiveUserId(userId);
    let loaded: UserParseProfile | null | undefined;
    try {
      loaded = await this.loadProfile(userId);
    } catch (error) {
      if (error instanceof UserPropertyScopeError) throw error;
      throw new UserPropertyScopeUnavailableError();
    }
    if (loaded === null || loaded === undefined) throw new UserPropertyScopeNotReadyError();

    const normalized = normalizeProfile(loaded);
    if (normalized.userId !== userId) throw new UserPropertyScopeMalformedError();
    return compileUserPropertyScope(normalized, request);
  }

  async count(userId: unknown, request?: UserPropertyScopeRequest): Promise<number> {
    const compiled = await this.compile(userId, request);
    let result: unknown;
    try {
      result = await this.strapi.db.connection.raw(
        `SELECT COUNT(*) AS total ${compiled.fromSql} WHERE ${compiled.whereSql}`,
        [...compiled.bindings],
      );
    } catch {
      throw new UserPropertyScopeQueryError();
    }
    return totalFromRaw(result);
  }

  /**
   * Aggregate only rows visible through the canonical profile predicate.
   * Legacy dashboard counters (total/inFocus/hot/typeBreakdown) intentionally
   * use the virtual personal status "new" (missing state means new). The
   * undervalued and newToday counters remain profile-visible across personal
   * statuses, so a user's review state cannot erase market signals.
   */
  async stats(userId: unknown, now?: Date | string): Promise<UserPropertyStats> {
    const compiled = await this.compile(userId, {});
    const window = statsWindow(now);
    const scopedCte = `WITH scoped AS (SELECT p.is_undervalued AS is_undervalued, `
      + `p.first_seen_at AS first_seen_at, p.property_type AS property_type, `
      + `p.focus_score AS focus_score, COALESCE(ups.status, 'new') AS personal_status `
      + `${compiled.fromSql} WHERE ${compiled.whereSql})`;

    let aggregateResult: unknown;
    let breakdownResult: unknown;
    try {
      aggregateResult = await this.strapi.db.connection.raw(
        `${scopedCte} SELECT `
          + `COALESCE(SUM(CASE WHEN personal_status = 'new' THEN 1 ELSE 0 END), 0) AS total, `
          + `COALESCE(SUM(CASE WHEN personal_status = 'new' AND focus_score > 0 THEN 1 ELSE 0 END), 0) AS in_focus, `
          + `COALESCE(SUM(CASE WHEN personal_status = 'new' AND focus_score >= 50 THEN 1 ELSE 0 END), 0) AS hot, `
          + `COALESCE(SUM(CASE WHEN is_undervalued = 1 THEN 1 ELSE 0 END), 0) AS undervalued, `
          + `COALESCE(SUM(CASE WHEN first_seen_at IS NOT NULL AND ((typeof(first_seen_at) IN ('integer', 'real') `
          + `AND first_seen_at >= ? AND first_seen_at <= ?) OR (typeof(first_seen_at) = 'text' `
          + `AND first_seen_at >= ? AND first_seen_at <= ?)) THEN 1 ELSE 0 END), 0) AS new_today FROM scoped`,
        [...compiled.bindings, window.lowerEpoch, window.upperEpoch, window.lower, window.upper],
      );
      breakdownResult = await this.strapi.db.connection.raw(
        `${scopedCte} SELECT property_type, COUNT(*) AS total FROM scoped `
          + `WHERE personal_status = 'new' GROUP BY property_type`,
        [...compiled.bindings],
      );
    } catch {
      throw new UserPropertyScopeQueryError();
    }

    return {
      ...statsAggregateFromRaw(aggregateResult),
      typeBreakdown: statsTypeBreakdownFromRaw(breakdownResult),
    };
  }

  async list(userId: unknown, request?: UserPropertyScopeRequest): Promise<UserPropertyListResult> {
    const compiled = await this.compile(userId, request);
    const offset = (compiled.page - 1) * compiled.pageSize;
    let countResult: unknown;
    let rowsResult: unknown;
    try {
      countResult = await this.strapi.db.connection.raw(
        `SELECT COUNT(*) AS total ${compiled.fromSql} WHERE ${compiled.whereSql}`,
        [...compiled.bindings],
      );
      rowsResult = await this.strapi.db.connection.raw(
        `SELECT ${SELECT_COLUMNS} ${compiled.fromSql} WHERE ${compiled.whereSql} ORDER BY ${compiled.orderBySql} LIMIT ? OFFSET ?`,
        [DEFAULT_STATUS, ...compiled.bindings, compiled.pageSize, offset],
      );
    } catch {
      throw new UserPropertyScopeQueryError();
    }
    const total = totalFromRaw(countResult);
    const data = rowsFromRaw(rowsResult).map(mapDto);
    return {
      data,
      meta: {
        page: compiled.page,
        pageSize: compiled.pageSize,
        total,
        totalPages: Math.ceil(total / compiled.pageSize),
      },
    };
  }

  async detail(
    userId: unknown,
    documentId: string,
    request?: UserPropertyScopeRequest,
  ): Promise<UserPropertyDto | null> {
    if (typeof documentId !== 'string' || documentId.trim() === '' || documentId !== documentId.trim()) {
      throw new UserPropertyScopeValidationError();
    }
    const compiled = await this.compile(userId, { ...(request || {}), documentId });
    let result: unknown;
    try {
      result = await this.strapi.db.connection.raw(
        `SELECT ${SELECT_COLUMNS} ${compiled.fromSql} WHERE ${compiled.whereSql} LIMIT 1`,
        [DEFAULT_STATUS, ...compiled.bindings],
      );
    } catch {
      throw new UserPropertyScopeQueryError();
    }
    const rows = rowsFromRaw(result);
    if (rows.length === 0) return null;
    if (rows.length !== 1) throw new UserPropertyScopeQueryError();
    return mapDto(rows[0]);
  }
}

export function createUserPropertyScopeRepository(
  strapi: UserPropertyScopeStrapi,
  loadProfile?: UserPropertyProfileLoader,
): UserPropertyScopeRepository {
  return new UserPropertyScopeRepository(strapi, loadProfile);
}

export { type PropertyType, type Region, type UserParseProfile };
