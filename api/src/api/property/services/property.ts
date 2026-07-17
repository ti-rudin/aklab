/**
 * property service
 *
 * Кастомные методы: getFocusQuery, clearNew.
 * Чистая бизнес-логика без HTTP-зависимостей.
 */
import { factories } from '@strapi/strapi';
import * as fs from 'fs/promises';
import * as path from 'path';
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
  'address',
  'city',
  'area_sqm',
  'price',
  'minimum_price',
  'price_per_sqm',
  'property_type',
  'auction_type',
  'published_at_source',
  'description',
  'contacts',
  'photo_urls',
  'latitude',
  'longitude',
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
  city: new Set(['moscow', 'mo', 'other']),
};

const REQUIRED_PARSER_STRING_FIELDS = ['source', 'external_id', 'title'] as const;
const OPTIONAL_PARSER_STRING_FIELDS = [
  'url', 'address', 'published_at_source', 'description', 'contacts', 'first_seen_at',
] as const;
const OPTIONAL_PARSER_NUMBER_FIELDS = [
  'area_sqm', 'price', 'minimum_price', 'price_per_sqm', 'latitude', 'longitude',
] as const;

export class PropertyUpsertValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PropertyUpsertValidationError';
  }
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

  for (const field of Object.keys(PROPERTY_SCHEMA_ENUMS) as Array<keyof typeof PROPERTY_SCHEMA_ENUMS>) {
    const value = input[field];
    if (value !== undefined && (typeof value !== 'string' || !PROPERTY_SCHEMA_ENUMS[field].has(value))) {
      throw new PropertyUpsertValidationError(`${field} has an unsupported value`);
    }
  }

  // Build a fresh object from the checked keys; never pass a client object
  // through to Strapi's ORM.
  return Object.fromEntries(Object.keys(input).map((field) => [field, input[field]]));
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

  /**
   * Удалить все объекты кроме статуса "in_progress" (В работе).
   * Возвращает количество удалённых записей и папок с фото.
   */
  async clearNew(): Promise<{ deleted: number; photosDeleted: number }> {
    const keepStatus = 'in_progress';

    // 1. Находим объекты для удаления (все кроме "in_progress")
    const toDelete = await strapi.db.query('api::property.property').findMany({
      where: { status: { $ne: keepStatus } },
      select: ['documentId'],
    });

    // 2. Удаляем папки с фото
    const photosBase = path.join(process.cwd(), 'data', 'photos');
    let photosDeleted = 0;
    for (const prop of toDelete) {
      const photoDir = path.join(photosBase, prop.documentId);
      try {
        await fs.rm(photoDir, { recursive: true, force: true });
        photosDeleted++;
      } catch {
        // Папки могло не быть — это нормально
      }
    }

    // 3. Удаляем записи из БД
    const deleted = await strapi.db.query('api::property.property').deleteMany({
      where: { status: { $ne: keepStatus } },
    });

    return { deleted: deleted.count, photosDeleted };
  },
}));
