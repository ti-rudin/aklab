/**
 * property controller
 *
 * Фаза 1: stub — стандартные CRUD-операции Strapi.
 * Кастомные эндпоинты: clearNew, servePhoto, getFocus.
 */
import { factories } from "@strapi/strapi";
import * as fs from "fs/promises";
import * as path from "path";

export default factories.createCoreController("api::property.property", ({ strapi }) => ({
  /**
   * POST /api/properties/clear-new
   * Удалить все объекты со статусом "new".
   */
  async clearNew(ctx) {
    const deleted = await strapi.db.query("api::property.property").deleteMany({
      where: { status: "new" },
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

    const filePath = path.join(process.cwd(), "data", "photos", safeDocumentId, safeFilename);

    try {
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

    const threshold = Number(query.threshold) || 20;
    const city = query.city as string | undefined;
    const propertyType = query.property_type as string | undefined;
    const tagsParam = query.tags as string | undefined;
    const sortParam = (query.sort as string) || "-focus_score";
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20));

    // Построить SQL-запрос с фильтрами
    const conditions: string[] = ["focus_score >= ?"];
    const params: any[] = [threshold];

    if (city) {
      const cities = city.split(",").map((c: string) => c.trim()).filter(Boolean);
      if (cities.length === 1) {
        conditions.push("city = ?");
        params.push(cities[0]);
      } else if (cities.length > 1) {
        conditions.push(`city IN (${cities.map(() => "?").join(",")})`);
        params.push(...cities);
      }
    }

    if (propertyType) {
      conditions.push("property_type = ?");
      params.push(propertyType);
    }

    // Теги: JSON-массив, проверяем наличие каждого тега через LIKE
    if (tagsParam) {
      const tags = tagsParam.split(",").map((t: string) => t.trim()).filter(Boolean);
      for (const tag of tags) {
        conditions.push("tags LIKE ?");
        params.push("%\"" + tag + "\"%");
      }
    }

    // Сортировка
    const allowedSorts: Record<string, string> = {
      focus_score: "focus_score",
      price_per_sqm: "price_per_sqm",
      area_sqm: "area_sqm",
      deviation_percent: "deviation_percent",
      createdAt: "created_at",
    };
    let sortField = "focus_score";
    let sortDir = "DESC";

    if (sortParam) {
      const desc = sortParam.startsWith("-");
      const field = desc ? sortParam.slice(1) : sortParam;
      if (allowedSorts[field]) {
        sortField = allowedSorts[field];
        sortDir = desc ? "DESC" : "ASC";
      }
    }

    const where = conditions.join(" AND ");
    const offset = (page - 1) * pageSize;

    // Считаем total
    const countResult = await (strapi as any).db.connection.raw(
      "SELECT COUNT(*) as total FROM properties WHERE " + where,
      params
    );
    const total = countResult?.rows?.[0]?.total || countResult?.[0]?.total || 0;

    // Получаем данные
    const rows = await (strapi as any).db.connection.raw(
      "SELECT * FROM properties WHERE " + where + " ORDER BY " + sortField + " " + sortDir + " LIMIT ? OFFSET ?",
      [...params, pageSize, offset]
    );

    const data = rows?.rows || rows || [];

    ctx.body = {
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
        tags: typeof row.tags === "string" ? JSON.parse(row.tags) : row.tags,
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
        filters: { city, property_type: propertyType, tags: tagsParam, sort: sortParam },
      },
    };
  },
}));
