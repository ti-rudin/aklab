import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@strapi/strapi', () => ({
  factories: {
    createCoreController: vi.fn((_uid: string, factory: any) => factory),
  },
}));

import settingControllerFactory from '../setting';

function makeStrapi() {
  const query = { findOne: vi.fn() };
  return {
    db: { query: vi.fn().mockReturnValue(query) },
    _query: query,
  };
}

describe('setting internalFindAnalyzer', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns only the analyzer threshold projection', async () => {
    const strapi = makeStrapi();
    strapi._query.findOne.mockResolvedValue({ threshold_percent: 17.5 });
    const actions = (settingControllerFactory as any)({ strapi });
    const ctx: any = { body: undefined, status: 200 };

    await actions.internalFindAnalyzer(ctx);

    expect(strapi._query.findOne).toHaveBeenCalledWith({ select: ['threshold_percent'] });
    expect(ctx.body).toEqual({ data: { threshold_percent: 17.5 } });
    expect(JSON.stringify(ctx.body)).not.toContain('pipeline_state');
  });

  it('returns 404 when the singleton setting is absent', async () => {
    const strapi = makeStrapi();
    strapi._query.findOne.mockResolvedValue(null);
    const actions = (settingControllerFactory as any)({ strapi });
    const ctx: any = { body: undefined, status: 200 };

    await actions.internalFindAnalyzer(ctx);

    expect(ctx.status).toBe(404);
    expect(ctx.body).toEqual({ error: 'Setting not found' });
  });
});
