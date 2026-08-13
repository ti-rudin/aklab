/**
 * property controller
 *
 * Тонкий контроллер: парсинг параметров → вызов service → ответ.
 * Кастомные эндпоинты: servePhoto, getFocus, fetchPhotos, geocode.
 */
import { factories } from "@strapi/strapi";
import * as path from "path";
import { getQueueService } from '../../../services/queueService';
import { resolvePhotoPath } from '../../../services/photo-storage';
import {
  createUserPropertyScopeRepository,
  UserPropertyScopeMalformedError,
  UserPropertyScopeNotReadyError,
  UserPropertyScopeQueryError,
  UserPropertyScopeUnavailableError,
  UserPropertyScopeValidationError,
  type UserPropertyScopeRequest,
} from '../../../services/user-property-scope';
import { PropertyUpsertValidationError } from '../services/property';
import {
  CatalogCleanupBusyError,
  CatalogCleanupConfirmationError,
  CatalogCleanupProtectedDataError,
  clearPropertyCatalog,
  isCatalogCleanupMaintenanceModeEnabled,
} from '../../../services/property-catalog-cleanup';

const INTERNAL_PROPERTY_FIELDS = new Set([
  'is_undervalued',
  'deviation_percent',
  'manual_price_per_sqm',
  'photos',
  'photos_downloaded',
]);

const PHOTO_MIME_BY_EXTENSION: Readonly<Record<string, string>> = Object.freeze({
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
});

const SCOPED_QUERY_KEYS = new Set([
  'city',
  'property_type',
  'status',
  'search',
  'sort',
  'page',
  'pageSize',
]);

const FOCUS_QUERY_KEYS = new Set([...SCOPED_QUERY_KEYS, 'threshold']);

type ScopedRequest = UserPropertyScopeRequest;

function internalPayload(ctx: any, allowedFields: Set<string>): Record<string, unknown> | null {
  const data = ctx.request?.body?.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return null;
  }

  const fields = Object.keys(data);
  if (fields.length === 0 || fields.some((field) => !allowedFields.has(field))) {
    return null;
  }

  return data as Record<string, unknown>;
}

function actorId(ctx: any): number {
  const value = ctx?.state?.user?.id;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new UserPropertyScopeValidationError();
  }
  return value;
}

function queryRecord(ctx: any): Record<string, unknown> {
  const query = ctx?.query ?? {};
  if (!query || typeof query !== 'object' || Array.isArray(query)) {
    throw new UserPropertyScopeValidationError();
  }
  return query as Record<string, unknown>;
}

function queryString(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') throw new UserPropertyScopeValidationError();
  return value;
}

function queryCsv(value: unknown): string[] {
  const raw = queryString(value);
  const values = raw.split(',').map((item) => item.trim());
  if (values.some((item) => item === '')) throw new UserPropertyScopeValidationError();
  return values;
}

function queryNumber(value: unknown, integer: boolean): number {
  if (typeof value !== 'string' && typeof value !== 'number') throw new UserPropertyScopeValidationError();
  const raw = typeof value === 'string' ? value.trim() : value;
  if (raw === '') throw new UserPropertyScopeValidationError();
  const parsed = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(parsed) || (integer && !Number.isSafeInteger(parsed))) {
    throw new UserPropertyScopeValidationError();
  }
  return parsed;
}

function parseScopedQuery(ctx: any, focus = false): ScopedRequest {
  const input = queryRecord(ctx);
  const allowedKeys = focus ? FOCUS_QUERY_KEYS : SCOPED_QUERY_KEYS;
  if (Object.keys(input).some((key) => !allowedKeys.has(key))) {
    throw new UserPropertyScopeValidationError();
  }

  const request: ScopedRequest = {};
  if (input.city !== undefined) request.city = queryCsv(input.city) as ScopedRequest['city'];
  if (input.property_type !== undefined) request.propertyType = queryCsv(input.property_type) as ScopedRequest['propertyType'];
  if (input.status !== undefined) request.status = queryCsv(input.status) as ScopedRequest['status'];
  if (input.search !== undefined) request.search = queryString(input.search).trim();
  if (input.sort !== undefined) request.sort = queryString(input.sort);
  if (input.page !== undefined) request.page = queryNumber(input.page, true);
  if (input.pageSize !== undefined) request.pageSize = queryNumber(input.pageSize, true);
  if (focus) {
    request.focusThreshold = input.threshold === undefined ? 0 : queryNumber(input.threshold, false);
  }
  return request;
}

function safePathSegment(value: unknown): value is string {
  return typeof value === 'string'
    && value !== ''
    && value === path.basename(value)
    && !value.includes('/')
    && !/[\\/]/.test(value)
    && value !== '.'
    && value !== '..';
}

function safeDocumentId(value: unknown): value is string {
  return safePathSegment(value)
    && value.length <= 256
    && value === value.trim();
}

function finiteCoordinate(value: unknown): number {
  if (value === null || value === undefined) return NaN;
  if (typeof value === 'string' && value.trim() === '') return NaN;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function scopeErrorResponse(ctx: any, error: unknown): void {
  if (error instanceof UserPropertyScopeValidationError) {
    ctx.status = 400;
    ctx.body = { error: 'Invalid property query' };
    return;
  }
  if (error instanceof UserPropertyScopeNotReadyError) {
    ctx.status = 409;
    ctx.body = { error: 'Property profile is not ready' };
    return;
  }
  if (
    error instanceof UserPropertyScopeMalformedError
    || error instanceof UserPropertyScopeUnavailableError
    || error instanceof UserPropertyScopeQueryError
  ) {
    ctx.status = 500;
    ctx.body = { error: 'Property scope unavailable' };
    return;
  }
  ctx.status = 500;
  ctx.body = { error: 'Property scope unavailable' };
}

async function runScoped(ctx: any, operation: () => Promise<void>): Promise<void> {
  try {
    await operation();
  } catch (error) {
    scopeErrorResponse(ctx, error);
  }
}

export default factories.createCoreController('api::property.property', ({ strapi }) => ({
  /** Admin-only, confirmation-gated full disposable object-catalog cleanup. */
  async clearNew(ctx) {
    try {
      const result = await clearPropertyCatalog(strapi as any, {
        confirmation: ctx.request.body?.confirmation,
      });
      ctx.status = 200;
      ctx.body = { data: result };
    } catch (error) {
      if (error instanceof CatalogCleanupConfirmationError) {
        ctx.status = 400;
        ctx.body = { error: 'Invalid catalog cleanup confirmation' };
        return;
      }
      if (
        error instanceof CatalogCleanupBusyError
        || error instanceof CatalogCleanupProtectedDataError
      ) {
        ctx.status = 409;
        ctx.body = { error: 'Property catalog cleanup is not safe to run' };
        return;
      }
      strapi.log.error('property_catalog_cleanup_failed', {
        error_name: error instanceof Error ? error.name : 'UnknownError',
      });
      ctx.status = 500;
      ctx.body = { error: 'Property catalog cleanup failed' };
    }
  },

  /**
   * GET /api/properties
   * Canonical profile-scoped list. Query Engine/core find is deliberately not used.
   */
  async find(ctx) {
    await runScoped(ctx, async () => {
      const repository = createUserPropertyScopeRepository(strapi);
      const userId = actorId(ctx);
      const request = parseScopedQuery(ctx);
      ctx.body = await repository.list(userId, request);
    });
  },

  /**
   * GET /api/properties/:id
   * Detail is looked up through the same positive profile predicate as list.
   */
  async findOne(ctx) {
    await runScoped(ctx, async () => {
      const repository = createUserPropertyScopeRepository(strapi);
      const userId = actorId(ctx);
      const request = parseScopedQuery(ctx);
      const property = await repository.detail(userId, ctx.params?.id, request);
      if (property === null) {
        ctx.status = 404;
        ctx.body = { error: 'Property not found' };
        return;
      }
      ctx.body = { data: property };
    });
  },

  /**
   * POST /api/properties/upsert
   * Parser-only identity upsert. The service returns the concurrent winner
   * instead of leaking a SQLite unique-constraint exception to a worker.
   */
  async upsert(ctx) {
    if (isCatalogCleanupMaintenanceModeEnabled()) {
      ctx.status = 409;
      ctx.body = { error: 'Выполняется обслуживание каталога.' };
      return;
    }
    const data = ctx.request?.body?.data;
    if (!data || typeof data.source !== 'string' || !data.source.trim()
      || typeof data.external_id !== 'string' || !data.external_id.trim()) {
      ctx.status = 400;
      ctx.body = { error: 'source and external_id are required' };
      return;
    }

    try {
      const result = await strapi.service('api::property.property').upsertByIdentity(data);
      ctx.status = result.created ? 201 : 200;
      ctx.body = { data: result.property, meta: { created: result.created } };
    } catch (error) {
      if (error instanceof PropertyUpsertValidationError) {
        ctx.status = 400;
        ctx.body = { error: error.message };
        return;
      }
      throw error;
    }
  },

  /** GET /api/internal/properties/exists — parser-only identity lookup. */
  async internalExists(ctx) {
    const source = ctx.query?.source;
    const externalId = ctx.query?.external_id;
    if (typeof source !== 'string' || source === '' || source !== source.trim()
      || typeof externalId !== 'string' || externalId === '' || externalId !== externalId.trim()) {
      ctx.status = 400;
      ctx.body = { error: 'source and external_id are required' };
      return;
    }

    const property = await strapi.db.query('api::property.property').findOne({
      where: { source, external_id: externalId },
      select: ['id'],
    });
    ctx.body = { data: { exists: Boolean(property) } };
  },

  /** GET /api/internal/properties/:id — service-only canonical read. */
  async internalFindOne(ctx) {
    if (!safeDocumentId(ctx.params?.id)) {
      ctx.status = 400;
      ctx.body = { error: 'Invalid property id' };
      return;
    }

    const property = await strapi.db.query('api::property.property').findOne({
      where: { documentId: ctx.params.id },
    });
    if (!property) {
      ctx.status = 404;
      ctx.body = { error: 'Property not found' };
      return;
    }

    ctx.body = { data: property };
  },

  /**
   * PUT /api/internal/properties/:id
   * Service-only updates for analyzer and photo-fetcher fields.
   */
  async internalUpdate(ctx) {
    if (isCatalogCleanupMaintenanceModeEnabled()) {
      ctx.status = 409;
      ctx.body = { error: 'Выполняется обслуживание каталога.' };
      return;
    }
    const data = internalPayload(ctx, INTERNAL_PROPERTY_FIELDS);
    if (!data) {
      ctx.status = 400;
      ctx.body = { error: 'Invalid internal property update payload' };
      return;
    }

    const updated = await strapi.db.query('api::property.property').update({
      where: { documentId: ctx.params.id },
      data,
    });
    if (!updated) {
      ctx.status = 404;
      ctx.body = { error: 'Property not found' };
      return;
    }

    ctx.body = { data: updated };
  },

  /**
   * GET /api/photos/:documentId/:filename
   * Scope-check before touching the filesystem; private cache only.
   */
  async servePhoto(ctx) {
    await runScoped(ctx, async () => {
      const repository = createUserPropertyScopeRepository(strapi);
      const userId = actorId(ctx);
      const { documentId, filename } = ctx.params || {};
      const property = await repository.detail(userId, documentId, {});
      if (property === null) {
        ctx.status = 404;
        ctx.body = { error: 'Photo not found' };
        return;
      }

      if (!safePathSegment(documentId) || !safePathSegment(filename)) {
        ctx.status = 400;
        ctx.body = { error: 'Invalid photo path' };
        return;
      }
      const ext = path.extname(filename).toLowerCase();
      const contentType = PHOTO_MIME_BY_EXTENSION[ext];
      if (!contentType) {
        ctx.status = 400;
        ctx.body = { error: 'Invalid photo path' };
        return;
      }

      const filePath = resolvePhotoPath(documentId, filename);
      try {
        const fs = await import('fs/promises');
        await fs.access(filePath);
        const buffer = await fs.readFile(filePath);
        ctx.set('Content-Type', contentType);
        ctx.set('Cache-Control', 'private, max-age=86400');
        ctx.body = buffer;
      } catch {
        ctx.status = 404;
        ctx.body = { error: 'Photo not found' };
      }
    });
  },

  /**
   * GET /api/properties/focus
   * The focus view is the canonical list predicate plus one threshold.
   */
  async getFocus(ctx) {
    await runScoped(ctx, async () => {
      const repository = createUserPropertyScopeRepository(strapi);
      const userId = actorId(ctx);
      const request = parseScopedQuery(ctx, true);
      ctx.body = await repository.list(userId, request);
    });
  },

  /**
   * GET /api/properties/stats
   * Profile-scoped aggregate DTO; no unscoped Query Engine counts.
   */
  async getStats(ctx) {
    await runScoped(ctx, async () => {
      const repository = createUserPropertyScopeRepository(strapi);
      const userId = actorId(ctx);
      const request = parseScopedQuery(ctx);
      if (Object.keys(request).length > 0) {
        // Stats has no list filters beyond the canonical profile; reject rather
        // than silently changing the dashboard contract.
        throw new UserPropertyScopeValidationError();
      }
      ctx.body = await repository.stats(userId, new Date());
    });
  },

  async fetchPhotos(ctx) {
    await runScoped(ctx, async () => {
      if (isCatalogCleanupMaintenanceModeEnabled()) {
        ctx.status = 409;
        ctx.body = { error: 'Выполняется обслуживание каталога.' };
        return;
      }
      const repository = createUserPropertyScopeRepository(strapi);
      const userId = actorId(ctx);
      const id = ctx.params?.id;
      if (!safeDocumentId(id)) {
        throw new UserPropertyScopeValidationError();
      }

      // The positive canonical predicate must run before the property read or queue side effect.
      const visibleProperty = await repository.detail(userId, id, {});
      if (visibleProperty === null) {
        ctx.status = 404;
        ctx.body = { error: 'Property not found' };
        return;
      }

      const property = await strapi.db.query('api::property.property').findOne({
        where: { documentId: id },
      });

      if (!property) {
        ctx.status = 404;
        ctx.body = { error: 'Property not found' };
        return;
      }

      if (property.photos_downloaded) {
        ctx.body = { queued: false, reason: 'already_downloaded', photos: property.photos };
        return;
      }

      if (!property.url) {
        ctx.body = { queued: false, reason: 'no_url' };
        return;
      }

      try {
        const qs = getQueueService();
        qs.addToQueue('fetch-photos', {
          documentId: property.documentId,
          url: property.url,
          source: property.source,
        }, { correlationId: `photo-lazy-${property.documentId}` });

        ctx.body = { queued: true };
      } catch {
        ctx.status = 500;
        ctx.body = { error: 'Failed to queue photo fetch' };
      }
    });
  },

  /**
   * GET /api/properties/:id/geocode
   * Геокодирование объекта через Nominatim, кеширование в БД.
   */
  async geocode(ctx) {
    await runScoped(ctx, async () => {
      const repository = createUserPropertyScopeRepository(strapi);
      const userId = actorId(ctx);
      const id = ctx.params?.id;
      if (!safeDocumentId(id)) {
        throw new UserPropertyScopeValidationError();
      }

      // Scope-check before the property read, network call, and canonical cache write.
      const visibleProperty = await repository.detail(userId, id, {});
      if (visibleProperty === null) {
        ctx.status = 404;
        ctx.body = { error: 'Property not found' };
        return;
      }

      const property = await strapi.db.query('api::property.property').findOne({
        where: { documentId: id },
      });
      if (!property) {
        ctx.status = 404;
        ctx.body = { error: 'Property not found' };
        return;
      }

      const cachedLatitude = finiteCoordinate(property.latitude);
      const cachedLongitude = finiteCoordinate(property.longitude);
      if (Number.isFinite(cachedLatitude) && Number.isFinite(cachedLongitude)) {
        ctx.body = { latitude: property.latitude, longitude: property.longitude, cached: true };
        return;
      }
      if (!property.address) {
        ctx.status = 400;
        ctx.body = { error: 'No address' };
        return;
      }

      try {
        const query = encodeURIComponent(property.address);
        const resp = await fetch(`https://nominatim.openstreetmap.org/search?q=${query}&format=json&limit=1&accept-language=ru`, {
          headers: { 'User-Agent': 'AKLAB/1.0 (monitoring@aklab.ru)' },
        });
        const results = await resp.json() as any[];
        if (results.length === 0) {
          ctx.body = { latitude: null, longitude: null, cached: false };
          return;
        }
        const latitude = finiteCoordinate(results[0]?.lat);
        const longitude = finiteCoordinate(results[0]?.lon);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
          throw new Error('Invalid geocoder coordinates');
        }

        await strapi.db.query('api::property.property').update({
          where: { documentId: id },
          data: { latitude, longitude },
        });
        ctx.body = { latitude, longitude, cached: false };
      } catch {
        ctx.status = 500;
        ctx.body = { error: 'Geocoding failed' };
      }
    });
  },
}));
