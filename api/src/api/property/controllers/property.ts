/**
 * property controller
 *
 * Тонкий контроллер: парсинг параметров → вызов service → ответ.
 * Кастомные эндпоинты: clearNew, servePhoto, getFocus, fetchPhotos.
 */
import { factories } from "@strapi/strapi";
import * as path from "path";
import { getQueueService } from '../../../services/queueService';
import { PropertyUpsertValidationError } from '../services/property';

const INTERNAL_PROPERTY_FIELDS = new Set([
  'is_undervalued',
  'deviation_percent',
  'manual_price_per_sqm',
  'photos',
  'photos_downloaded',
]);

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

export default factories.createCoreController("api::property.property", ({ strapi }) => ({
  /**
   * POST /api/properties/clear-new
   * Удалить все объекты кроме статуса "in_progress" (В работе).
   */
  async clearNew(ctx) {
    const result = await strapi.service('api::property.property').clearNew();
    ctx.body = result;
  },

  /**
   * POST /api/properties/upsert
   * Parser-only identity upsert. The service returns the concurrent winner
   * instead of leaking a SQLite unique-constraint exception to a worker.
   */
  async upsert(ctx) {
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

  /**
   * PUT /api/internal/properties/:id
   * Service-only updates for analyzer and photo-fetcher fields.
   */
  async internalUpdate(ctx) {
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
   * Serve downloaded property photos.
   */
  async servePhoto(ctx) {
    const { documentId, filename } = ctx.params;

    // Basic security: sanitize filename to prevent path traversal
    const safeFilename = path.basename(filename);
    const safeDocumentId = path.basename(documentId);

    const filePath = path.join(process.cwd(), "data", "photos", safeDocumentId, safeFilename);

    try {
      const fs = await import("fs/promises");
      await fs.access(filePath);
      const buffer = await fs.readFile(filePath);

      // Determine content type from extension
      const ext = path.extname(safeFilename).toLowerCase();
      let contentType = "image/jpeg";
      if (ext === ".png") contentType = "image/png";
      else if (ext === ".webp") contentType = "image/webp";

      ctx.set("Content-Type", contentType);
      ctx.set("Cache-Control", "public, max-age=86400");
      ctx.body = buffer;
    } catch {
      ctx.status = 404;
      ctx.body = { error: "Photo not found" };
    }
  },

  /**
   * GET /api/properties/focus
   * Список объектов с focus_score >= threshold, с фильтрацией, сортировкой, пагинацией.
   */
  async getFocus(ctx) {
    const query = ctx.query || {};

    const params = {
      threshold: Number(query.threshold) || 0,
      city: query.city as string | undefined,
      property_type: query.property_type as string | undefined,
      tags: query.tags as string | undefined,
      search: (query.search as string) || undefined,
      sort: (query.sort as string) || "-focus_score",
      page: Math.max(1, Number(query.page) || 1),
      pageSize: Math.min(100, Math.max(1, Number(query.pageSize) || 20)),
    };

    ctx.body = await strapi.service('api::property.property').getFocusQuery(params);
  },

  /**
   * GET /api/properties/stats
   * Агрегированная статистика для дашборда (1 запрос вместо N).
   */
  async getStats(ctx: any) {
    const s = strapi as any;
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const yesterdayISO = yesterday.toISOString();

    // Count helper: findMany + select: ['id'] + .length (gotcha #54)
    const countWhere = async (where: Record<string, any>) => {
      const rows = await s.db.query('api::property.property').findMany({ where, select: ['id'] });
      return rows?.length ?? 0;
    };

    // Оптимизация: 4 запроса вместо 6 с параллелизацией
    // Запрос 1: все status='new' → считаем total, inFocus, hot в JS
    // Запрос 2: is_undervalued count
    // Запрос 3: newToday count
    // Запрос 4: type breakdown
    const [newRows, undervalued, newToday, typeRows] = await Promise.all([
      s.db.query('api::property.property').findMany({
        where: { status: 'new' },
        select: ['focus_score'],
      }),
      countWhere({ is_undervalued: true }),
      countWhere({ first_seen_at: { $gte: yesterdayISO } }),
      s.db.query('api::property.property').findMany({
        where: { status: 'new' },
        select: ['property_type'],
      }),
    ]);

    // Считаем total, inFocus, hot из одного результата
    const total = newRows?.length ?? 0;
    let inFocus = 0, hot = 0;
    for (const row of newRows || []) {
      if (row.focus_score > 0) inFocus++;
      if (row.focus_score >= 50) hot++;
    }

    // Type breakdown
    const typeBreakdown: Record<string, number> = {};
    for (const p of typeRows || []) {
      const t = p.property_type || 'other';
      typeBreakdown[t] = (typeBreakdown[t] || 0) + 1;
    }

    ctx.body = { total, inFocus, hot, undervalued, newToday, typeBreakdown };
  },

  async fetchPhotos(ctx) {
    const { id } = ctx.params;

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
    } catch (err: any) {
      ctx.status = 500;
      ctx.body = { error: 'Failed to queue photo fetch', details: err.message };
    }
  },

  /**
   * GET /api/properties/:id/geocode
   * Геокодирование объекта через Nominatim, кеширование в БД.
   */
  async geocode(ctx) {
    const { id } = ctx.params;
    const property = await strapi.db.query('api::property.property').findOne({
      where: { documentId: id },
    });
    if (!property) {
      ctx.status = 404;
      ctx.body = { error: 'Property not found' };
      return;
    }
    // Return cached coordinates if available
    if (property.latitude && property.longitude) {
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
        headers: { 'User-Agent': 'AKLAB/1.0 (monitoring@aklab.ru)' }
      });
      const results = await resp.json() as any[];
      if (results.length === 0) {
        ctx.body = { latitude: null, longitude: null, cached: false };
        return;
      }
      const lat = parseFloat(results[0].lat);
      const lng = parseFloat(results[0].lon);
      // Cache in DB
      await strapi.db.query('api::property.property').update({
        where: { documentId: id },
        data: { latitude: lat, longitude: lng },
      });
      ctx.body = { latitude: lat, longitude: lng, cached: false };
    } catch (err: any) {
      ctx.status = 500;
      ctx.body = { error: 'Geocoding failed', details: err.message };
    }
  },
}));
