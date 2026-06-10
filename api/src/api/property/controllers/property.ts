/**
 * property controller
 *
 * Фаза 1: stub — стандартные CRUD-операции Strapi.
 * Кастомные эндпоинты: clearNew, servePhoto.
 */
import { factories } from '@strapi/strapi';
import * as fs from 'fs/promises';
import * as path from 'path';

export default factories.createCoreController('api::property.property', ({ strapi }) => ({
  /**
   * POST /api/properties/clear-new
   * Удалить все объекты со статусом 'new'.
   */
  async clearNew(ctx) {
    const deleted = await strapi.db.query('api::property.property').deleteMany({
      where: { status: 'new' },
    });
    ctx.body = { deleted: deleted.count };
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

    const filePath = path.join(process.cwd(), 'data', 'photos', safeDocumentId, safeFilename);

    try {
      await fs.access(filePath);
      const buffer = await fs.readFile(filePath);

      // Determine content type from extension
      const ext = path.extname(safeFilename).toLowerCase();
      let contentType = 'image/jpeg';
      if (ext === '.png') contentType = 'image/png';
      else if (ext === '.webp') contentType = 'image/webp';

      ctx.set('Content-Type', contentType);
      ctx.set('Cache-Control', 'public, max-age=86400');
      ctx.body = buffer;
    } catch {
      ctx.status = 404;
      ctx.body = { error: 'Photo not found' };
    }
  },
}));
