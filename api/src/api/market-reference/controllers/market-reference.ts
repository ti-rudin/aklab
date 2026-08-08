/**
 * market-reference controller
 */
import { factories } from '@strapi/strapi';

const CITIES = new Set(['moscow', 'mo', 'other']);
const PROPERTY_TYPES = new Set(['office', 'warehouse', 'retail', 'production', 'free_purpose', 'other']);
const QUERY_KEYS = new Set(['city', 'property_type']);

function validQuery(query: unknown): query is { city: string; property_type: string } {
  if (!query || typeof query !== 'object' || Array.isArray(query)) return false;
  const value = query as Record<string, unknown>;
  if (Object.keys(value).some((key) => !QUERY_KEYS.has(key))) return false;
  return typeof value.city === 'string'
    && CITIES.has(value.city)
    && typeof value.property_type === 'string'
    && PROPERTY_TYPES.has(value.property_type);
}

export default factories.createCoreController('api::market-reference.market-reference', ({ strapi }) => ({
  async internalFindActive(ctx) {
    if (!validQuery(ctx.query)) {
      ctx.status = 400;
      ctx.body = { error: 'Invalid market reference query' };
      return;
    }

    const rows = await strapi.db.query('api::market-reference.market-reference').findMany({
      where: { city: ctx.query.city, property_type: ctx.query.property_type, is_active: true },
      select: ['id', 'city', 'property_type', 'price_per_sqm', 'effective_from', 'is_active'],
      orderBy: [{ id: 'asc' }],
      limit: 1,
    });
    ctx.body = { data: Array.isArray(rows) && rows.length > 0 ? rows[0] : null };
  },
}));
