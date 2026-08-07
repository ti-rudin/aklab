import { describe, expect, it, vi } from 'vitest';

vi.mock('@strapi/strapi', () => ({
  factories: {
    createCoreController: vi.fn((_uid: string, factory: any) => factory),
  },
}));

vi.mock('../../../../services/user-property-state', () => {
  class UserPropertyStateValidationError extends Error {}
  class UserPropertyStateNotFoundError extends Error {}
  class UserPropertyStateConflictError extends Error {}
  class UserPropertyStateMalformedError extends Error {}
  return {
    createUserPropertyStateService: vi.fn(),
    UserPropertyStateValidationError,
    UserPropertyStateNotFoundError,
    UserPropertyStateConflictError,
    UserPropertyStateMalformedError,
  };
});

import controllerFactory from '../user-property-state';
import stateRoutes from '../../routes/user-property-state';
import {
  createUserPropertyStateService,
  UserPropertyStateConflictError,
  UserPropertyStateMalformedError,
  UserPropertyStateNotFoundError,
  UserPropertyStateValidationError,
} from '../../../../services/user-property-state';

const serviceFactory = vi.mocked(createUserPropertyStateService);

function makeCtx(overrides: Record<string, unknown> = {}) {
  return {
    state: { user: { id: 7 } },
    params: { documentId: 'property-1' },
    request: {},
    status: 200,
    body: undefined as unknown,
    ...overrides,
  } as any;
}

function makeService() {
  return {
    get: vi.fn().mockResolvedValue({ status: 'new', property_document_id: 'property-1' }),
    put: vi.fn().mockResolvedValue({ status: 'viewed', property_document_id: 'property-1' }),
    remove: vi.fn().mockResolvedValue({ status: 'new', property_document_id: 'property-1' }),
  };
}

function actionsFor(service = makeService()) {
  serviceFactory.mockReturnValue(service as any);
  return { actions: (controllerFactory as any)({ strapi: { entityService: { forbidden: true } } }), service };
}

describe('user property state routes', () => {
  it('exposes exactly the three authenticated custom routes and no generic CRUD/list/public route', () => {
    expect(stateRoutes.routes).toEqual([
      {
        method: 'GET',
        path: '/me/properties/:documentId/state',
        handler: 'user-property-state.getState',
        config: { auth: false, policies: ['global::authenticated-user'] },
      },
      {
        method: 'PUT',
        path: '/me/properties/:documentId/state',
        handler: 'user-property-state.putState',
        config: { auth: false, policies: ['global::authenticated-user'] },
      },
      {
        method: 'DELETE',
        path: '/me/properties/:documentId/state',
        handler: 'user-property-state.deleteState',
        config: { auth: false, policies: ['global::authenticated-user'] },
      },
    ]);
    expect(stateRoutes.routes.map((route) => route.path)).not.toContain('/user-property-states');
    expect(stateRoutes.routes.some((route) => route.path.includes('/states'))).toBe(false);
  });
});

describe('user property state controller', () => {
  it('derives actor and document only from the protected state/route and returns an explicit DTO', async () => {
    const { actions, service } = actionsFor();
    const ctx = makeCtx({
      request: { body: { data: { actorId: 99, user_id: 99, property: 999 } } },
    });

    await actions.getState(ctx);

    expect(service.get).toHaveBeenCalledWith(7, 'property-1');
    expect(ctx.body).toEqual({ data: { status: 'new', property_document_id: 'property-1' } });
    expect(Object.keys(ctx.body.data)).toEqual(['status', 'property_document_id']);
    expect(ctx.body.data).not.toHaveProperty('actorId');
    expect(ctx.body.data).not.toHaveProperty('user');
    expect(ctx.body.data).not.toHaveProperty('property');
    expect(ctx.body.data).not.toHaveProperty('identity_key');
    expect(ctx.body.data).not.toHaveProperty('id');
  });

  it('rejects absent, non-numeric, non-safe, and forged actors before service access', async () => {
    for (const id of [undefined, null, 0, -1, 1.5, Number.NaN, '7', Number.MAX_SAFE_INTEGER + 1]) {
      const { actions, service } = actionsFor();
      const ctx = makeCtx({ state: { user: { id } } });

      await actions.getState(ctx);

      expect(ctx.status).toBe(401);
      expect(ctx.body).toEqual({ error: 'Unauthorized' });
      expect(service.get).not.toHaveBeenCalled();
    }
  });

  it('validates a strict bounded route documentId before service access', async () => {
    for (const documentId of ['', ' ', ' property-1', 'property-1 ', 'x'.repeat(257), 7, null]) {
      const { actions, service } = actionsFor();
      const ctx = makeCtx({ params: { documentId } });

      await actions.getState(ctx);

      expect(ctx.status).toBe(400);
      expect(ctx.body).toEqual({ error: 'Invalid user property state input' });
      expect(service.get).not.toHaveBeenCalled();
    }
  });

  it('requires the exact PUT body { data: { status } } and rejects forged identity fields', async () => {
    const invalidBodies = [
      undefined,
      {},
      { data: {} },
      { data: { status: 'viewed', user: 7 } },
      { data: { status: 'viewed', property: 101 } },
      { data: { status: 'viewed', identity_key: '7:property-1' } },
      { data: { status: 'viewed', id: 41 } },
      { data: { status: 'viewed' }, extra: true },
      { data: { status: 'newer' } },
    ];

    for (const body of invalidBodies) {
      const { actions, service } = actionsFor();
      const ctx = makeCtx({ request: { body } });

      await actions.putState(ctx);

      expect(ctx.status).toBe(400);
      expect(ctx.body).toEqual({ error: 'Invalid user property state input' });
      expect(service.put).not.toHaveBeenCalled();
    }

    const valid = actionsFor();
    await valid.actions.putState(makeCtx({ request: { body: { data: { status: 'viewed' } } } }));
    expect(valid.service.put).toHaveBeenCalledWith(7, 'property-1', 'viewed');
    expect(valid.service.put).toHaveBeenCalledTimes(1);
  });

  it('maps invisible/nonexistent properties to a safe 404 without leaking details', async () => {
    const service = makeService();
    service.get.mockRejectedValue(new UserPropertyStateNotFoundError('private property detail'));
    const { actions } = actionsFor(service);
    const ctx = makeCtx();

    await actions.getState(ctx);

    expect(ctx.status).toBe(404);
    expect(ctx.body).toEqual({ error: 'Property not found' });
    expect(JSON.stringify(ctx.body)).not.toContain('private');
  });

  it('returns safe 400/409/500 mappings for typed state errors without raw details', async () => {
    const cases = [
      [new UserPropertyStateValidationError('bad input'), 400, 'Invalid user property state input'],
      [new UserPropertyStateConflictError('race'), 409, 'User property state conflict'],
      [new UserPropertyStateMalformedError('corrupt relation'), 500, 'Internal server error'],
      [new Error('database secret'), 500, 'Internal server error'],
    ] as const;

    for (const [error, status, message] of cases) {
      const service = makeService();
      service.put.mockRejectedValue(error);
      const { actions } = actionsFor(service);
      const ctx = makeCtx({ request: { body: { data: { status: 'viewed' } } } });

      await actions.putState(ctx);

      expect(ctx.status).toBe(status);
      expect(ctx.body).toEqual({ error: message });
      expect(JSON.stringify(ctx.body)).not.toContain('secret');
    }
  });

  it('uses the same explicit DTO for PUT and idempotent DELETE', async () => {
    const { actions, service } = actionsFor();
    const putCtx = makeCtx({ request: { body: { data: { status: 'viewed' } } } });
    await actions.putState(putCtx);
    expect(putCtx.body).toEqual({ data: { status: 'viewed', property_document_id: 'property-1' } });

    const deleteCtx = makeCtx();
    await actions.deleteState(deleteCtx);
    expect(service.remove).toHaveBeenCalledWith(7, 'property-1');
    expect(deleteCtx.body).toEqual({ data: { status: 'new', property_document_id: 'property-1' } });
  });
});
