import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@strapi/strapi', () => ({
  factories: {
    createCoreController: vi.fn((_uid: string, factory: any) => factory),
  },
}));

import marketReferenceControllerFactory from '../market-reference';

function makeStrapi() {
  const query = { findMany: vi.fn() };
  return {
    db: { query: vi.fn().mockReturnValue(query) },
    _query: query,
  };
}

function makeCtx(query: Record<string, unknown>): any {
  return { query, body: undefined, status: 200 };
}

describe('market-reference internalFindActive', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns one deterministic active reference through an allowlisted projection', async () => {
    const strapi = makeStrapi();
    const reference = {
      id: 7,
      city: 'moscow',
      property_type: 'office',
      price_per_sqm: 123,
      effective_from: '2026-01-01',
      is_active: true,
    };
    strapi._query.findMany.mockResolvedValue([reference]);
    const actions = (marketReferenceControllerFactory as any)({ strapi });
    const ctx = makeCtx({ city: 'moscow', property_type: 'office' });

    await actions.internalFindActive(ctx);

    expect(strapi._query.findMany).toHaveBeenCalledWith({
      where: { city: 'moscow', property_type: 'office', is_active: true },
      select: ['id', 'city', 'property_type', 'price_per_sqm', 'effective_from', 'is_active'],
      orderBy: [{ id: 'asc' }],
      limit: 1,
    });
    expect(ctx.body).toEqual({ data: reference });
  });

  it('returns null when no active reference matches', async () => {
    const strapi = makeStrapi();
    strapi._query.findMany.mockResolvedValue([]);
    const actions = (marketReferenceControllerFactory as any)({ strapi });
    const ctx = makeCtx({ city: 'mo', property_type: 'warehouse' });

    await actions.internalFindActive(ctx);

    expect(ctx.body).toEqual({ data: null });
  });

  it('rejects missing, unknown, and non-enum query values before DB access', async () => {
    const strapi = makeStrapi();
    const actions = (marketReferenceControllerFactory as any)({ strapi });
    for (const query of [
      { city: 'moscow' },
      { city: 'moscow', property_type: 'office', populate: '*' },
      { city: 'unknown', property_type: 'office' },
      { city: 'moscow', property_type: 'land' },
    ]) {
      const ctx = makeCtx(query);
      await actions.internalFindActive(ctx);
      expect(ctx.status).toBe(400);
      expect(ctx.body).toEqual({ error: 'Invalid market reference query' });
    }
    expect(strapi._query.findMany).not.toHaveBeenCalled();
  });
});
