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

export default factories.createCoreService('api::property.property', ({ strapi }) => ({
  /**
   * Построить SQL-запрос для getFocus с фильтрами, сортировкой, пагинацией.
   */
  async getFocusQuery(params: FocusParams): Promise<FocusResult> {
    const s = strapi as unknown as StrapiInstance;
    const { threshold, city, property_type: propertyType, tags: tagsParam, sort: sortParam, page, pageSize } = params;

    // Построить SQL-запрос с фильтрами
    const conditions: string[] = ['focus_score >= ?'];
    const queryParams: any[] = [threshold];

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
        filters: { city, property_type: propertyType, tags: tagsParam, sort: sortParam },
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
