/**
 * property service
 *
 * Кастомные методы: getFocusQuery.
 * Чистая бизнес-логика без HTTP-зависимостей.
 */
import { factories } from '@strapi/strapi';
import { regionFromStructuredLocation } from '@aklab/parse-rules';
import type { StrapiInstance } from '../../../types/strapi';

interface FocusParams {
  threshold: number;
  city?: string;
  property_type?: string;
  tags?: string;
  search?: string;
  sort: string;
  page: number;
  pageSize: number;
}

interface FocusResult {
  data: any[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    threshold: number;
    filters: Record<string, any>;
  };
}

const ALLOWED_SORTS: Record<string, string> = {
  focus_score: 'focus_score',
  price_per_sqm: 'price_per_sqm',
  area_sqm: 'area_sqm',
  deviation_percent: 'deviation_percent',
  createdAt: 'created_at',
};

const PROPERTY_UID = 'api::property.property';

// Keep this list aligned with the parser payload assembled by
// services/_shared/src/parse-handler.ts.  It is intentionally narrower than
// the content type: public parser upsert must never set workflow, scoring,
// local-media, or manual-review fields.
const PARSER_OWNED_FIELDS = new Set([
  'source',
  'external_id',
  'url',
  'title',
  'area_sqm',
  'price',
  'minimum_price',
  'auction_end_at',
  'price_per_sqm',
  'property_type',
  'auction_type',
  'published_at_source',
  'description',
  'contacts',
  'photo_urls',
  'property_location',
  'parties',
  // Existing parser workers supply this ingestion timestamp. It is parser
  // owned; all workflow/scoring timestamps remain outside the allowlist.
  'first_seen_at',
]);

// Explicit values from content-types/property/schema.json.  Keep the runtime
// route independent from JSON-module compiler settings while making schema
// changes require an intentional allowlist update here.
const PROPERTY_SCHEMA_ENUMS = {
  source: new Set([
    'fedresurs', 'aggregator-bankrot', 'torgi-gov', 'investmoscow',
    'invest-mosreg', 'roseltorg', 'fabrikant', 'alfalot', 'etprf',
    'sberbank-ast', 'm-ets',
  ]),
  property_type: new Set([
    'office', 'warehouse', 'retail', 'production', 'free_purpose',
    'apartment', 'land', 'other',
  ]),
  auction_type: new Set(['bankruptcy', 'privatization', 'marketplace']),
  city: new Set(['moscow', 'mo', 'tver', 'tver_oblast', 'other']),
};

const LOCATION_STATUSES = new Set([
  'confirmed_address', 'confirmed_region_only', 'missing',
]);
const STRUCTURED_SOURCE_KINDS = new Set(['dom_field', 'api_field', 'xml_field', 'ssr_field']);
const PARTY_SOURCE_KINDS = new Set([...STRUCTURED_SOURCE_KINDS, 'bounded_text']);
const PARTY_ROLES = new Set(['pledgee', 'secured_creditor', 'debtor', 'organizer', 'seller', 'customer']);
const PARTY_ADDRESS_KINDS = new Set(['legal', 'postal', 'actual', 'unknown']);
const PARTY_CONFIDENCE = new Set(['structured', 'explicit_text']);
const PROPERTY_LOCATION_FIELDS = new Set([
  'address', 'region', 'region_code', 'latitude', 'longitude',
  'status', 'source_kind', 'source_path',
]);
const PROPERTY_PARTY_FIELDS = new Set([
  'name', 'roles', 'inn', 'ogrn', 'kpp', 'addresses', 'phone', 'email',
  'source_path', 'source_kind', 'confidence',
]);
const PARTY_ADDRESS_FIELDS = new Set(['kind', 'value']);

const REQUIRED_PARSER_STRING_FIELDS = ['source', 'external_id', 'title'] as const;
const OPTIONAL_PARSER_STRING_FIELDS = [
  'url', 'auction_end_at', 'published_at_source', 'description', 'contacts', 'first_seen_at',
] as const;
const OPTIONAL_PARSER_NUMBER_FIELDS = [
  'area_sqm', 'price', 'minimum_price', 'price_per_sqm',
] as const;

export class PropertyUpsertValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PropertyUpsertValidationError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && value === value.trim();
}

function optionalString(record: Record<string, unknown>, field: string): boolean {
  return record[field] === undefined || nonEmptyString(record[field]);
}

function validCoordinate(value: unknown, min: number, max: number): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function validatePropertyLocation(value: unknown): void {
  if (!isRecord(value)
    || Object.keys(value).some(field => !PROPERTY_LOCATION_FIELDS.has(field))
    || !LOCATION_STATUSES.has(value.status as string)
    || !STRUCTURED_SOURCE_KINDS.has(value.source_kind as string)
    || !nonEmptyString(value.source_path)
    || !optionalString(value, 'address')
    || !optionalString(value, 'region')
    || !optionalString(value, 'region_code')) {
    throw new PropertyUpsertValidationError('property_location is malformed');
  }
  const hasLatitude = value.latitude !== undefined;
  const hasLongitude = value.longitude !== undefined;
  if (hasLatitude !== hasLongitude
    || (hasLatitude && !validCoordinate(value.latitude, -90, 90))
    || (hasLongitude && !validCoordinate(value.longitude, -180, 180))) {
    throw new PropertyUpsertValidationError('property_location is malformed');
  }
  if (value.status === 'confirmed_address' && !nonEmptyString(value.address)) {
    throw new PropertyUpsertValidationError('property_location is malformed');
  }
  if (value.status === 'confirmed_region_only' && nonEmptyString(value.address)) {
    throw new PropertyUpsertValidationError('property_location is malformed');
  }
  if (value.status === 'confirmed_region_only'
    && !nonEmptyString(value.region)
    && !nonEmptyString(value.region_code)
    && !hasLatitude) {
    throw new PropertyUpsertValidationError('property_location is malformed');
  }
  if (value.status === 'missing'
    && (value.address !== undefined || value.region !== undefined || value.region_code !== undefined || hasLatitude)) {
    throw new PropertyUpsertValidationError('property_location is malformed');
  }
}

function validateParties(value: unknown): void {
  if (!Array.isArray(value)) throw new PropertyUpsertValidationError('parties is malformed');
  for (const party of value) {
    if (!isRecord(party)
      || Object.keys(party).some(field => !PROPERTY_PARTY_FIELDS.has(field))
      || !nonEmptyString(party.name)
      || !Array.isArray(party.roles)
      || party.roles.length === 0
      || party.roles.some(role => typeof role !== 'string' || !PARTY_ROLES.has(role))
      || !nonEmptyString(party.source_path)
      || !PARTY_SOURCE_KINDS.has(party.source_kind as string)
      || !PARTY_CONFIDENCE.has(party.confidence as string)
      || !optionalString(party, 'inn')
      || !optionalString(party, 'ogrn')
      || !optionalString(party, 'kpp')
      || !optionalString(party, 'phone')
      || !optionalString(party, 'email')) {
      throw new PropertyUpsertValidationError('parties is malformed');
    }
    if (party.addresses !== undefined
      && (!Array.isArray(party.addresses) || party.addresses.some(address => (
        !isRecord(address)
        || Object.keys(address).some(field => !PARTY_ADDRESS_FIELDS.has(field))
        || !PARTY_ADDRESS_KINDS.has(address.kind as string)
        || !nonEmptyString(address.value)
      )))) {
      throw new PropertyUpsertValidationError('parties is malformed');
    }
  }
}

function projectTypedLegacyGeography(input: Record<string, unknown>): Record<string, unknown> {
  const location = input.property_location as Record<string, unknown>;
  const confirmed = location.status === 'confirmed_address'
    || location.status === 'confirmed_region_only';
  const address = location.status === 'confirmed_address' ? location.address as string : '';
  const city = confirmed
    ? regionFromStructuredLocation({
      ...(typeof location.address === 'string' ? { address: location.address } : {}),
      ...(typeof location.region === 'string' ? { region: location.region } : {}),
      ...(typeof location.region_code === 'string' ? { region_code: location.region_code } : {}),
    })
    : 'other';

  const projected: Record<string, unknown> = {
    ...input,
    address,
    city,
  };
  delete projected.latitude;
  delete projected.longitude;
  if (confirmed && typeof location.latitude === 'number' && typeof location.longitude === 'number') {
    projected.latitude = location.latitude;
    projected.longitude = location.longitude;
  }
  return projected;
}

function validateParserUpsertData(data: unknown): Record<string, any> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new PropertyUpsertValidationError('data must be an object');
  }

  const input = data as Record<string, unknown>;
  for (const field of Object.keys(input)) {
    if (!PARSER_OWNED_FIELDS.has(field)) {
      throw new PropertyUpsertValidationError(`Field "${field}" is not accepted by parser upsert`);
    }
  }

  for (const field of REQUIRED_PARSER_STRING_FIELDS) {
    const value = input[field];
    if (typeof value !== 'string' || value === '') {
      throw new PropertyUpsertValidationError(`${field} is required`);
    }
  }

  // Canonical identity is a database invariant too. Reject, rather than
  // silently trim, so the caller cannot create an identity different from the
  // one it submitted.
  for (const field of ['source', 'external_id'] as const) {
    if (input[field] !== (input[field] as string).trim()) {
      throw new PropertyUpsertValidationError(`${field} must not contain leading or trailing whitespace`);
    }
  }

  for (const field of OPTIONAL_PARSER_STRING_FIELDS) {
    if (input[field] !== undefined && typeof input[field] !== 'string') {
      throw new PropertyUpsertValidationError(`${field} must be a string`);
    }
  }
  for (const field of OPTIONAL_PARSER_NUMBER_FIELDS) {
    if (input[field] !== undefined && (typeof input[field] !== 'number' || !Number.isFinite(input[field]))) {
      throw new PropertyUpsertValidationError(`${field} must be a finite number`);
    }
  }
  if (input.photo_urls !== undefined
    && (!Array.isArray(input.photo_urls) || input.photo_urls.some((url) => typeof url !== 'string'))) {
    throw new PropertyUpsertValidationError('photo_urls must be an array of strings');
  }
  if (input.property_location === undefined) {
    throw new PropertyUpsertValidationError('property_location is required');
  }
  validatePropertyLocation(input.property_location);
  if (input.parties !== undefined) validateParties(input.parties);

  for (const field of Object.keys(PROPERTY_SCHEMA_ENUMS) as Array<keyof typeof PROPERTY_SCHEMA_ENUMS>) {
    const value = input[field];
    if (value !== undefined && (typeof value !== 'string' || !PROPERTY_SCHEMA_ENUMS[field].has(value))) {
      throw new PropertyUpsertValidationError(`${field} has an unsupported value`);
    }
  }

  // Build a fresh object from the checked keys; never pass a client object
  // through to Strapi's ORM. Typed property location is the only geography
  // authority; party data cannot alter the persisted projection, and stale
  // caller legacy geography fields are rejected above.
  return projectTypedLegacyGeography(
    Object.fromEntries(Object.keys(input).map((field) => [field, input[field]])),
  );
}

function isIdentityUniqueViolation(error: unknown): boolean {
  const candidate = error as { code?: string; message?: string } | undefined;
  const code = candidate?.code || '';
  const message = candidate?.message || '';
  return (code === 'SQLITE_CONSTRAINT' || code === 'SQLITE_CONSTRAINT_UNIQUE')
    && /properties\.(source|external_id)|source, external_id/i.test(message);
}

export default factories.createCoreService(PROPERTY_UID, ({ strapi }) => ({
  /**
   * Concurrency-safe create-or-return-existing for parser writes.
   * The database unique index is the authority: a concurrent winner is read
   * after its constraint error instead of surfacing a duplicate/500.
   */
  async upsertByIdentity(data: Record<string, any>): Promise<{ property: any; created: boolean }> {
    const parserData = validateParserUpsertData(data);
    const source = parserData.source;
    const externalId = parserData.external_id;

    const repository = strapi.db.query(PROPERTY_UID);
    const where = { source, external_id: externalId };
    const existing = await repository.findOne({ where });
    if (existing) return { property: existing, created: false };

    const createData = {
      ...parserData,
      // `strapi.db.query()` bypasses Strapi's REST JSON transformer. SQLite
      // therefore receives raw arrays unless we serialize them at this ORM boundary.
      tags: JSON.stringify([]),
      ...(parserData.photo_urls !== undefined
        ? { photo_urls: JSON.stringify(parserData.photo_urls) }
        : {}),
      property_location: JSON.stringify(parserData.property_location),
      ...(parserData.parties !== undefined
        ? { parties: JSON.stringify(parserData.parties) }
        : {}),
    };

    try {
      const property = await repository.create({
        data: createData,
      });
      return { property, created: true };
    } catch (error) {
      if (!isIdentityUniqueViolation(error)) throw error;
      const winner = await repository.findOne({ where });
      if (winner) return { property: winner, created: false };
      throw error;
    }
  },

  /**
   * Построить SQL-запрос для getFocus с фильтрами, сортировкой, пагинацией.
   */
  async getFocusQuery(params: FocusParams): Promise<FocusResult> {
    const s = strapi as unknown as StrapiInstance;
    const { threshold, city, property_type: propertyType, tags: tagsParam, search: searchParam, sort: sortParam, page, pageSize } = params;

    // Построить SQL-запрос с фильтрами
    const conditions: string[] = ['focus_score >= ?', 'status != ?'];
    const queryParams: any[] = [threshold, 'rejected'];

    if (city) {
      const cities = city.split(',').map((c) => c.trim()).filter(Boolean);
      if (cities.length === 1) {
        conditions.push('city = ?');
        queryParams.push(cities[0]);
      } else if (cities.length > 1) {
        conditions.push(`city IN (${cities.map(() => '?').join(',')})`);
        queryParams.push(...cities);
      }
    }

    if (propertyType) {
      const types = propertyType.split(',').map((t) => t.trim()).filter(Boolean);
      if (types.length === 1) {
        conditions.push('property_type = ?');
        queryParams.push(types[0]);
      } else if (types.length > 1) {
        conditions.push(`property_type IN (${types.map(() => '?').join(',')})`);
        queryParams.push(...types);
      }
    }

    // Теги: JSON-массив, проверяем наличие каждого тега через LIKE
    if (tagsParam) {
      const tags = tagsParam.split(',').map((t) => t.trim()).filter(Boolean);
      for (const tag of tags) {
        conditions.push('tags LIKE ?');
        queryParams.push('%"' + tag + '"%');
      }
    }

    // Поиск по title / address
    if (searchParam) {
      const q = `%${searchParam.trim()}%`
      conditions.push('(title LIKE ? OR address LIKE ?)')
      queryParams.push(q, q)
    }

    // Сортировка
    let sortField = 'focus_score';
    let sortDir = 'DESC';

    if (sortParam) {
      const desc = sortParam.startsWith('-');
      const field = desc ? sortParam.slice(1) : sortParam;
      if (ALLOWED_SORTS[field]) {
        sortField = ALLOWED_SORTS[field];
        sortDir = desc ? 'DESC' : 'ASC';
      }
    }

    const where = conditions.join(' AND ');
    const offset = (page - 1) * pageSize;

    // Считаем total
    const countResult = await s.db.connection.raw(
      'SELECT COUNT(*) as total FROM properties WHERE ' + where,
      queryParams
    );
    const total = countResult?.rows?.[0]?.total || countResult?.[0]?.total || 0;

    // Получаем данные
    const rows = await s.db.connection.raw(
      'SELECT * FROM properties WHERE ' + where + ' ORDER BY ' + sortField + ' ' + sortDir + ' LIMIT ? OFFSET ?',
      [...queryParams, pageSize, offset]
    );

    const data = rows?.rows || rows || [];

    return {
      data: data.map((row: any) => ({
        id: row.id,
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
        property_type: row.property_type,
        status: row.status,
        is_undervalued: row.is_undervalued,
        deviation_percent: row.deviation_percent,
        focus_score: row.focus_score,
        tags: typeof row.tags === 'string' ? JSON.parse(row.tags) : row.tags,
        minimum_price: row.minimum_price,
        first_seen_at: row.first_seen_at,
        createdAt: row.created_at,
      })),
      meta: {
        page,
        pageSize,
        total: Number(total),
        totalPages: Math.ceil(Number(total) / pageSize),
        threshold,
        filters: { city, property_type: propertyType, tags: tagsParam, search: searchParam, sort: sortParam },
      },
    };
  },

}));
