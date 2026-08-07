import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCreateScopeRepository = vi.hoisted(() => vi.fn());

vi.mock('../../../../services/user-property-scope', () => ({
  createUserPropertyScopeRepository: mockCreateScopeRepository,
  UserPropertyScopeValidationError: class UserPropertyScopeValidationError extends Error {},
  UserPropertyScopeNotReadyError: class UserPropertyScopeNotReadyError extends Error {},
  UserPropertyScopeMalformedError: class UserPropertyScopeMalformedError extends Error {},
  UserPropertyScopeUnavailableError: class UserPropertyScopeUnavailableError extends Error {},
  UserPropertyScopeQueryError: class UserPropertyScopeQueryError extends Error {},
}));

vi.mock('@strapi/strapi', () => ({
  factories: {
    createCoreController: vi.fn((_uid: string, factoryFn: any) => factoryFn),
  },
}));

import propertyEventControllerFactory from '../property-event';

function makeStrapi() {
  const eventQuery = {
    findMany: vi.fn(),
    findOne: vi.fn(),
  };
  const scopeRepository = {
    detail: vi.fn().mockResolvedValue({ documentId: 'property-doc' }),
  };
  return {
    db: {
      query: vi.fn().mockReturnValue(eventQuery),
    },
    _eventQuery: eventQuery,
    _scopeRepository: scopeRepository,
  };
}

function makeCtx(overrides: Record<string, any> = {}): any {
  return {
    state: { user: { id: 7 } },
    params: { documentId: 'property-doc' },
    query: {},
    body: undefined,
    status: 200,
    ...overrides,
  };
}

const eventRow = {
  documentId: 'event-doc-1',
  event_type: 'score_changed',
  old_value: '10',
  new_value: '20',
  createdAt: '2026-08-07T10:00:00.000Z',
  updatedAt: '2026-08-07T10:00:00.000Z',
  id: 99,
  property: { documentId: 'property-doc', title: 'private property' },
  private_metadata: 'must not escape',
};

describe('property event controller', () => {
  let strapi: ReturnType<typeof makeStrapi>;
  let actions: Record<string, (ctx: any) => Promise<void>>;

  beforeEach(() => {
    strapi = makeStrapi();
    actions = (propertyEventControllerFactory as any)({ strapi });
    vi.clearAllMocks();
    mockCreateScopeRepository.mockReturnValue(strapi._scopeRepository);
  });

  describe('findMine', () => {
    it('returns 404 and does not query events when the property is outside the actor scope', async () => {
      strapi._scopeRepository.detail.mockResolvedValue(null);
      const ctx = makeCtx({ params: { documentId: 'foreign-property' } });

      await actions.findMine(ctx);

      expect(strapi._scopeRepository.detail).toHaveBeenCalledWith(7, 'foreign-property', {});
      expect(strapi.db.query).not.toHaveBeenCalled();
      expect(ctx.status).toBe(404);
      expect(ctx.body).toEqual({ error: 'Property not found' });
    });

    it('rejects a missing actor before scope and event access', async () => {
      const ctx = makeCtx({ state: {}, params: { documentId: 'property-doc' } });

      await actions.findMine(ctx);

      expect(ctx.status).toBe(400);
      expect(ctx.body).toEqual({ error: 'Invalid property event query' });
      expect(strapi._scopeRepository.detail).not.toHaveBeenCalled();
      expect(strapi.db.query).not.toHaveBeenCalled();
    });

    it('checks scope first and queries only the visible property relation with bounded deterministic pagination', async () => {
      strapi._eventQuery.findMany.mockResolvedValue([
        eventRow,
        { ...eventRow, documentId: 'event-doc-2' },
        { ...eventRow, documentId: 'event-doc-3' },
      ]);
      const ctx = makeCtx({
        params: { documentId: 'property-doc' },
        query: { page: '2', pageSize: '2' },
      });

      await actions.findMine(ctx);

      expect(strapi._scopeRepository.detail).toHaveBeenCalledWith(7, 'property-doc', {});
      expect(strapi.db.query).toHaveBeenCalledWith('api::property-event.property-event');
      expect(strapi._eventQuery.findMany).toHaveBeenCalledWith({
        where: { property: { documentId: 'property-doc' } },
        select: ['documentId', 'event_type', 'old_value', 'new_value', 'createdAt', 'updatedAt'],
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        limit: 3,
        offset: 2,
      });
      expect(ctx.body).toEqual({
        data: [
          {
            documentId: 'event-doc-1',
            event_type: 'score_changed',
            old_value: '10',
            new_value: '20',
            createdAt: '2026-08-07T10:00:00.000Z',
            updatedAt: '2026-08-07T10:00:00.000Z',
          },
          {
            documentId: 'event-doc-2',
            event_type: 'score_changed',
            old_value: '10',
            new_value: '20',
            createdAt: '2026-08-07T10:00:00.000Z',
            updatedAt: '2026-08-07T10:00:00.000Z',
          },
        ],
        meta: { page: 2, pageSize: 2, hasNextPage: true },
      });
      expect(JSON.stringify(ctx.body)).not.toContain('private property');
      expect(JSON.stringify(ctx.body)).not.toContain('must not escape');
    });

    it('rejects arbitrary query, populate, and unbounded pagination before scope or event access', async () => {
      for (const query of [
        { populate: 'property' },
        { sort: 'createdAt:desc' },
        { page: '0' },
        { pageSize: '101' },
      ]) {
        const ctx = makeCtx({ query });
        await actions.findMine(ctx);

        expect(ctx.status).toBe(400);
        expect(ctx.body).toEqual({ error: 'Invalid property event query' });
      }
      expect(strapi._scopeRepository.detail).not.toHaveBeenCalled();
      expect(strapi.db.query).not.toHaveBeenCalled();
    });

    it('maps scope failures to stable responses without leaking details', async () => {
      strapi._scopeRepository.detail.mockRejectedValue(new Error('private SQL details'));
      const ctx = makeCtx();

      await actions.findMine(ctx);

      expect(ctx.status).toBe(500);
      expect(ctx.body).toEqual({ error: 'Property scope unavailable' });
      expect(JSON.stringify(ctx.body)).not.toContain('private SQL details');
      expect(strapi.db.query).not.toHaveBeenCalled();
    });
  });

  describe('findOneMine', () => {
    it('checks scope before querying a single event and returns an explicit DTO', async () => {
      strapi._eventQuery.findOne.mockResolvedValue(eventRow);
      const ctx = makeCtx({ params: { documentId: 'property-doc', eventId: 'event-doc-1' } });

      await actions.findOneMine(ctx);

      expect(strapi._scopeRepository.detail).toHaveBeenCalledWith(7, 'property-doc', {});
      expect(strapi._eventQuery.findOne).toHaveBeenCalledWith({
        where: {
          documentId: 'event-doc-1',
          property: { documentId: 'property-doc' },
        },
        select: ['documentId', 'event_type', 'old_value', 'new_value', 'createdAt', 'updatedAt'],
      });
      expect(ctx.body).toEqual({
        data: {
          documentId: 'event-doc-1',
          event_type: 'score_changed',
          old_value: '10',
          new_value: '20',
          createdAt: '2026-08-07T10:00:00.000Z',
          updatedAt: '2026-08-07T10:00:00.000Z',
        },
      });
      expect(JSON.stringify(ctx.body)).not.toContain('property');
      expect(JSON.stringify(ctx.body)).not.toContain('private_metadata');
    });

    it('returns 404 for an event that is not attached to the requested visible property', async () => {
      strapi._eventQuery.findOne.mockResolvedValue(null);
      const ctx = makeCtx({ params: { documentId: 'property-doc', eventId: 'foreign-event' } });

      await actions.findOneMine(ctx);

      expect(strapi._eventQuery.findOne).toHaveBeenCalledWith(expect.objectContaining({
        where: {
          documentId: 'foreign-event',
          property: { documentId: 'property-doc' },
        },
      }));
      expect(ctx.status).toBe(404);
      expect(ctx.body).toEqual({ error: 'Event not found' });
    });

    it('returns 404 and does not query an event when the property is outside scope', async () => {
      strapi._scopeRepository.detail.mockResolvedValue(null);
      const ctx = makeCtx({ params: { documentId: 'foreign-property', eventId: 'event-doc-1' } });

      await actions.findOneMine(ctx);

      expect(strapi._eventQuery.findOne).not.toHaveBeenCalled();
      expect(ctx.status).toBe(404);
      expect(ctx.body).toEqual({ error: 'Property not found' });
    });

    it('rejects malformed route params before scope and event access', async () => {
      for (const params of [
        { documentId: '', eventId: 'event-doc-1' },
        { documentId: 'property-doc', eventId: '../event' },
      ]) {
        const ctx = makeCtx({ params });
        await actions.findOneMine(ctx);

        expect(ctx.status).toBe(400);
        expect(ctx.body).toEqual({ error: 'Invalid property event parameters' });
      }
      expect(strapi._scopeRepository.detail).not.toHaveBeenCalled();
      expect(strapi.db.query).not.toHaveBeenCalled();
    });
  });
});
