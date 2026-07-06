/**
 * Shared filter builder for Property queries.
 * Returns a Strapi ORM where clause from filter options.
 */
export interface PropertyFilters {
  city?: string[];
  propertyType?: string[];
  priceFrom?: number;
  priceTo?: number;
  status?: string;
}

export function buildPropertyWhere(filters?: PropertyFilters): Record<string, any> {
  const where: Record<string, any> = {};

  if (filters?.status) {
    where.status = filters.status;
  }

  if (filters?.city && Array.isArray(filters.city) && filters.city.length > 0) {
    where.city = { $in: filters.city };
  }

  if (filters?.propertyType && Array.isArray(filters.propertyType) && filters.propertyType.length > 0) {
    where.property_type = { $in: filters.propertyType };
  }

  if (filters?.priceFrom != null && !isNaN(filters.priceFrom)) {
    where.price = { ...(where.price || {}), $gte: filters.priceFrom };
  }

  if (filters?.priceTo != null && !isNaN(filters.priceTo)) {
    where.price = { ...(where.price || {}), $lte: filters.priceTo };
  }

  return where;
}
