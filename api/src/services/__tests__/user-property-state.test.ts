import { describe, expect, it, vi } from 'vitest';
import {
  createUserPropertyStateService,
  UserPropertyStateConflictError,
  UserPropertyStateMalformedError,
  UserPropertyStateNotFoundError,
  type UserPropertyStateService,
} from '../user-property-state';

const STATE_UID = 'api::user-property-state.user-property-state';
const PROPERTY_UID = 'api::property.property';

const visibleProperty = { documentId: 'property-1' };
const property = { id: 101, documentId: 'property-1' };

function stateRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 41,
    identity_key: '7:property-1',
    user_id: 7,
    property_document_id: 'property-1',
    status: 'viewed',
    user: { id: 7 },
    property: { id: 101, documentId: 'property-1' },
    ...overrides,
  };
}

function makeHarness() {
  const scope = { detail: vi.fn().mockResolvedValue(visibleProperty) };
  const propertyQuery = { findOne: vi.fn().mockResolvedValue(property) };
  const stateQuery = {
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
  const strapi = {
    db: {
      query: vi.fn((uid: string) => {
        if (uid === PROPERTY_UID) return propertyQuery;
        if (uid === STATE_UID) return stateQuery;
        throw new Error(`unexpected uid: ${uid}`);
      }),
    },
    entityService: {
      findOne: vi.fn(() => { throw new Error('entityService must not be used'); }),
      create: vi.fn(() => { throw new Error('entityService must not be used'); }),
      update: vi.fn(() => { throw new Error('entityService must not be used'); }),
      delete: vi.fn(() => { throw new Error('entityService must not be used'); }),
    },
  };
  const service = createUserPropertyStateService(strapi as any, { scopeRepository: scope });
  return { scope, propertyQuery, stateQuery, strapi, service };
}

describe('user property state service', () => {
  it('returns the virtual new state without creating a sparse row when the owned row is absent', async () => {
    const { service, stateQuery } = makeHarness();

    await expect(service.get(7, 'property-1')).resolves.toEqual({
      status: 'new',
      property_document_id: 'property-1',
    });

    expect(stateQuery.findMany).toHaveBeenCalledTimes(1);
    expect(stateQuery.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { identity_key: '7:property-1' },
      populate: {
        user: { select: ['id'] },
        property: { select: ['id', 'documentId'] },
      },
    }));
    expect(JSON.stringify(stateQuery.findMany.mock.calls[0][0].populate)).not.toContain('fields');
    expect(stateQuery.create).not.toHaveBeenCalled();
  });

  it('checks canonical visibility before the property or state query and maps invisible properties to the same not-found error', async () => {
    const { service, scope, propertyQuery, stateQuery } = makeHarness();
    scope.detail.mockResolvedValue(null);

    await expect(service.get(7, 'property-1')).rejects.toBeInstanceOf(UserPropertyStateNotFoundError);
    expect(scope.detail).toHaveBeenCalledWith(7, 'property-1');
    expect(propertyQuery.findOne).not.toHaveBeenCalled();
    expect(stateQuery.findMany).not.toHaveBeenCalled();
  });

  it('maps a nonexistent property to the same safe not-found result after canonical visibility', async () => {
    const { service, propertyQuery, stateQuery } = makeHarness();
    propertyQuery.findOne.mockResolvedValue(null);

    await expect(service.get(7, 'property-1')).rejects.toBeInstanceOf(UserPropertyStateNotFoundError);
    expect(stateQuery.findMany).not.toHaveBeenCalled();
  });

  it('returns only the explicit state DTO and validates the scalar/relation ownership of an existing row', async () => {
    const { service, stateQuery } = makeHarness();
    stateQuery.findMany.mockResolvedValue([stateRow({
      documentId: 'private-state-document-id',
      createdAt: 'private-timestamp',
      email: 'private@example.test',
    })]);

    await expect(service.get(7, 'property-1')).resolves.toEqual({
      status: 'viewed',
      property_document_id: 'property-1',
    });
  });

  it('fails closed on scalar, identity, relation, and duplicate-row mismatches', async () => {
    for (const overrides of [
      { identity_key: '8:property-1' },
      { user_id: 8 },
      { property_document_id: 'property-2' },
      { user: { id: 8 } },
      { property: { id: 102, documentId: 'property-1' } },
    ]) {
      const { service, stateQuery } = makeHarness();
      stateQuery.findMany.mockResolvedValue([stateRow(overrides)]);
      await expect(service.get(7, 'property-1')).rejects.toBeInstanceOf(UserPropertyStateMalformedError);
    }

    const duplicate = makeHarness();
    duplicate.stateQuery.findMany.mockResolvedValue([stateRow(), stateRow({ id: 42 })]);
    await expect(duplicate.service.get(7, 'property-1')).rejects.toBeInstanceOf(UserPropertyStateMalformedError);
  });

  it('updates an existing state with an atomic scalar owner predicate and no client-controlled identity fields', async () => {
    const { service, stateQuery } = makeHarness();
    stateQuery.findMany.mockResolvedValue([stateRow()]);
    stateQuery.update.mockResolvedValue(stateRow({ status: 'in_progress' }));

    await expect(service.put(7, 'property-1', 'in_progress')).resolves.toEqual({
      status: 'in_progress',
      property_document_id: 'property-1',
    });

    expect(stateQuery.update).toHaveBeenCalledWith({
      where: { id: 41, user_id: 7, property_document_id: 'property-1' },
      data: { status: 'in_progress' },
    });
    expect(JSON.stringify(stateQuery.update.mock.calls[0][0].data)).not.toMatch(/user|property|identity|id/i);
  });

  it('maps an atomic update zero-row result to a safe conflict', async () => {
    const { service, stateQuery } = makeHarness();
    stateQuery.findMany.mockResolvedValue([stateRow()]);
    stateQuery.update.mockResolvedValue(null);

    await expect(service.put(7, 'property-1', 'in_progress')).rejects.toBeInstanceOf(UserPropertyStateConflictError);
    expect(stateQuery.update.mock.calls[0][0].where).toEqual({
      id: 41,
      user_id: 7,
      property_document_id: 'property-1',
    });
  });

  it('treats new as virtual and atomically deletes an existing row with scalar ownership predicates', async () => {
    const { service, stateQuery } = makeHarness();
    stateQuery.findMany.mockResolvedValue([stateRow()]);
    stateQuery.delete.mockResolvedValue(stateRow());

    await expect(service.put(7, 'property-1', 'new')).resolves.toEqual({
      status: 'new',
      property_document_id: 'property-1',
    });
    expect(stateQuery.delete).toHaveBeenCalledWith({
      where: { id: 41, user_id: 7, property_document_id: 'property-1' },
    });
  });

  it('makes DELETE idempotent when the sparse row is absent and conflicts when an atomic delete loses its row', async () => {
    const absent = makeHarness();
    await expect(absent.service.remove(7, 'property-1')).resolves.toEqual({
      status: 'new',
      property_document_id: 'property-1',
    });
    expect(absent.stateQuery.delete).not.toHaveBeenCalled();

    const raced = makeHarness();
    raced.stateQuery.findMany.mockResolvedValue([stateRow()]);
    raced.stateQuery.delete.mockResolvedValue(undefined);
    await expect(raced.service.remove(7, 'property-1')).rejects.toBeInstanceOf(UserPropertyStateConflictError);
  });

  it('creates an owned sparse row with server-derived identity, relations, and scalar ownership', async () => {
    const { service, stateQuery } = makeHarness();
    stateQuery.create.mockResolvedValue(stateRow({ status: 'rejected' }));

    await expect(service.put(7, 'property-1', 'rejected')).resolves.toEqual({
      status: 'rejected',
      property_document_id: 'property-1',
    });
    expect(stateQuery.create).toHaveBeenCalledWith({
      data: {
        identity_key: '7:property-1',
        user: 7,
        property: 101,
        user_id: 7,
        property_document_id: 'property-1',
        status: 'rejected',
      },
    });
  });

  it('keeps the same property document isolated by an exact per-user identity key', async () => {
    const { service, stateQuery } = makeHarness();
    stateQuery.create.mockResolvedValue(stateRow({
      identity_key: '8:property-1',
      user_id: 8,
      user: { id: 8 },
      status: 'viewed',
    }));

    await expect(service.put(8, 'property-1', 'viewed')).resolves.toEqual({
      status: 'viewed',
      property_document_id: 'property-1',
    });
    expect(stateQuery.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { identity_key: '8:property-1' },
    }));
    expect(stateQuery.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        identity_key: '8:property-1',
        user: 8,
        user_id: 8,
        property: 101,
        property_document_id: 'property-1',
      }),
    });
  });

  it('fresh-reads only a recognized unique race winner and never swallows unrelated create errors', async () => {
    const raced = makeHarness();
    const winner = stateRow({ status: 'in_progress' });
    raced.stateQuery.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([winner]);
    raced.stateQuery.create.mockRejectedValue(Object.assign(
      new Error('UNIQUE constraint failed: user_property_states.identity_key'),
      { code: 'SQLITE_CONSTRAINT_UNIQUE' },
    ));

    await expect(raced.service.put(7, 'property-1', 'in_progress')).resolves.toEqual({
      status: 'in_progress',
      property_document_id: 'property-1',
    });
    expect(raced.stateQuery.findMany).toHaveBeenCalledTimes(2);

    const unrelated = makeHarness();
    const error = new Error('database offline');
    unrelated.stateQuery.create.mockRejectedValue(error);
    await expect(unrelated.service.put(7, 'property-1', 'viewed')).rejects.toBe(error);
    expect(unrelated.stateQuery.findMany).toHaveBeenCalledTimes(1);

    const misleading = makeHarness();
    const misleadingError = new Error('table already exists');
    misleading.stateQuery.create.mockRejectedValue(misleadingError);
    await expect(misleading.service.put(7, 'property-1', 'viewed')).rejects.toBe(misleadingError);
    expect(misleading.stateQuery.findMany).toHaveBeenCalledTimes(1);
  });

  it('does not create duplicate rows when a unique race has no readable winner', async () => {
    const { service, stateQuery } = makeHarness();
    const error = Object.assign(new Error('UNIQUE constraint failed: user_property_states.identity_key'), {
      code: 'SQLITE_CONSTRAINT_UNIQUE',
    });
    stateQuery.create.mockRejectedValue(error);
    stateQuery.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    await expect(service.put(7, 'property-1', 'viewed')).rejects.toBe(error);
    expect(stateQuery.create).toHaveBeenCalledTimes(1);
    expect(stateQuery.findMany).toHaveBeenCalledTimes(2);
  });

  it('atomically applies the requested status to a different unique-race winner', async () => {
    const raced = makeHarness();
    const winner = stateRow({ status: 'viewed' });
    raced.stateQuery.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([winner]);
    raced.stateQuery.create.mockRejectedValue(Object.assign(
      new Error('UNIQUE constraint failed: user_property_states.identity_key'),
      { code: 'SQLITE_CONSTRAINT_UNIQUE' },
    ));
    raced.stateQuery.update.mockResolvedValue(stateRow({ status: 'in_progress' }));

    await expect(raced.service.put(7, 'property-1', 'in_progress')).resolves.toEqual({
      status: 'in_progress',
      property_document_id: 'property-1',
    });
    expect(raced.stateQuery.update).toHaveBeenCalledWith({
      where: { id: 41, user_id: 7, property_document_id: 'property-1' },
      data: { status: 'in_progress' },
    });
  });

  it('turns a zero-row race-winner update into a conflict', async () => {
    const raced = makeHarness();
    raced.stateQuery.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([stateRow({ status: 'viewed' })]);
    raced.stateQuery.create.mockRejectedValue(Object.assign(
      new Error('UNIQUE constraint failed: user_property_states.identity_key'),
      { code: 'SQLITE_CONSTRAINT_UNIQUE' },
    ));
    raced.stateQuery.update.mockResolvedValue(null);

    await expect(raced.service.put(7, 'property-1', 'in_progress')).rejects.toBeInstanceOf(UserPropertyStateConflictError);
  });

  it('validates every batch item and preflights every canonical context before the first write', async () => {
    const { service, scope, propertyQuery, stateQuery } = makeHarness();
    scope.detail.mockImplementation(async (_userId, documentId) => (
      documentId === 'property-1' ? { documentId } : null
    ));
    propertyQuery.findOne.mockImplementation(async (params: any) => ({
      id: params.where.documentId === 'property-1' ? 101 : 102,
      documentId: params.where.documentId,
    }));

    await expect(service.putBatch(7, [
      { documentId: 'property-1', status: 'viewed' },
      { documentId: 'property-2', status: 'rejected' },
    ])).rejects.toBeInstanceOf(UserPropertyStateNotFoundError);
    expect(scope.detail).toHaveBeenCalledTimes(2);
    expect(propertyQuery.findOne).toHaveBeenCalledTimes(1);
    expect(stateQuery.findMany).not.toHaveBeenCalled();
    expect(stateQuery.create).not.toHaveBeenCalled();
    expect(stateQuery.update).not.toHaveBeenCalled();
    expect(stateQuery.delete).not.toHaveBeenCalled();
  });

  it('applies a valid batch sequentially in input order without repeating canonical scope lookup', async () => {
    const { service, scope, propertyQuery, stateQuery } = makeHarness();
    scope.detail.mockImplementation(async (_userId, documentId) => ({ documentId }));
    propertyQuery.findOne.mockImplementation(async (params: any) => ({
      id: params.where.documentId === 'property-1' ? 101 : 102,
      documentId: params.where.documentId,
    }));
    stateQuery.create
      .mockResolvedValueOnce(stateRow({ status: 'viewed', property_document_id: 'property-1' }))
      .mockResolvedValueOnce(stateRow({
        id: 42,
        identity_key: '7:property-2',
        property_document_id: 'property-2',
        status: 'rejected',
        property: { id: 102, documentId: 'property-2' },
      }));

    await expect(service.putBatch(7, [
      { documentId: 'property-2', status: 'rejected' },
      { documentId: 'property-1', status: 'viewed' },
    ])).resolves.toEqual([
      { status: 'rejected', property_document_id: 'property-2' },
      { status: 'viewed', property_document_id: 'property-1' },
    ]);
    expect(scope.detail.mock.calls.map((call) => call[1])).toEqual(['property-2', 'property-1']);
    expect(propertyQuery.findOne).toHaveBeenCalledTimes(2);
    expect(stateQuery.create.mock.calls.map((call) => call[0].data.property_document_id)).toEqual([
      'property-2',
      'property-1',
    ]);
  });

  it('rejects malformed, empty, oversized, duplicate, and forged batch input before any database access', async () => {
    for (const items of [
      [],
      Array.from({ length: 101 }, (_, index) => ({ documentId: `property-${index}`, status: 'viewed' })),
      [{ documentId: 'property-1', status: 'viewed' }, { documentId: 'property-1', status: 'rejected' }],
      [{ documentId: 'property-1', status: 'viewed', user_id: 7 }],
      [{ documentId: 'property-1', status: 'viewed', actorId: 7 }],
      [{ documentId: 'property-1', status: 'invalid' }],
    ]) {
      const { service, scope, propertyQuery, stateQuery } = makeHarness();
      await expect(service.putBatch(7, items)).rejects.toBeInstanceOf(Error);
      expect(scope.detail).not.toHaveBeenCalled();
      expect(propertyQuery.findOne).not.toHaveBeenCalled();
      expect(stateQuery.findMany).not.toHaveBeenCalled();
      expect(stateQuery.create).not.toHaveBeenCalled();
    }
  });

  it('rejects forged actor/document/status inputs and never uses entityService', async () => {
    const { service, stateQuery, strapi } = makeHarness();
    for (const actor of [undefined, null, 0, -1, 1.5, Number.NaN, '7', Number.MAX_SAFE_INTEGER + 1]) {
      await expect(service.get(actor, 'property-1')).rejects.toThrow();
    }
    for (const documentId of ['', ' ', ' property-1', 'property-1 ', 'x'.repeat(257)]) {
      await expect(service.get(7, documentId)).rejects.toThrow();
    }
    for (const status of ['newer', '', null, 1, { value: 'viewed' }]) {
      await expect(service.put(7, 'property-1', status)).rejects.toThrow();
    }
    expect(stateQuery.create).not.toHaveBeenCalled();
    expect(strapi.entityService.findOne).not.toHaveBeenCalled();
    expect(strapi.entityService.create).not.toHaveBeenCalled();
    expect(strapi.entityService.update).not.toHaveBeenCalled();
    expect(strapi.entityService.delete).not.toHaveBeenCalled();
  });
});
