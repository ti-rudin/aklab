/**
 * property controller
 *
 * Тонкий контроллер: парсинг параметров → вызов service → ответ.
 * Кастомные эндпоинты: clearNew, servePhoto, getFocus, fetchPhotos.
 */
import { factories } from "@strapi/strapi";
import * as path from "path";
import { getQueueService } from '../../../services/queueService';

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
      threshold: Number(query.threshold) || 20,
      city: query.city as string | undefined,
      property_type: query.property_type as string | undefined,
      tags: query.tags as string | undefined,
      sort: (query.sort as string) || "-focus_score",
      page: Math.max(1, Number(query.page) || 1),
      pageSize: Math.min(100, Math.max(1, Number(query.pageSize) || 20)),
    };

    ctx.body = await strapi.service('api::property.property').getFocusQuery(params);
  },

  /**
   * POST /api/properties/:id/fetch-photos
   * Trigger lazy photo fetch for a property. Returns immediately.
   */
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
}));
