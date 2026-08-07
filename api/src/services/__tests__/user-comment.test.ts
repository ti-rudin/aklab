import { describe, expect, it, vi } from 'vitest';
import {
  createUserCommentService,
  UserCommentConflictError,
  UserCommentNotFoundError,
  UserCommentValidationError,
  type UserCommentScopeRepository,
} from '../user-comment';

const COMMENT_SELECT = ['id', 'text', 'createdAt', 'updatedAt'];

function makeScope(): UserCommentScopeRepository & { detail: ReturnType<typeof vi.fn> } {
  return { detail: vi.fn() };
}

function makeStrapi() {
  const propertyQuery = { findOne: vi.fn() };
  const commentQuery = {
    findMany: vi.fn(),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
  const strapi = {
    db: {
      query: vi.fn((uid: string) => {
        if (uid === 'api::property.property') return propertyQuery;
        if (uid === 'api::user-comment.user-comment') return commentQuery;
        throw new Error(`unexpected uid: ${uid}`);
      }),
    },
    entityService: {
      create: vi.fn(() => { throw new Error('entityService must not be used'); }),
      update: vi.fn(() => { throw new Error('entityService must not be used'); }),
      delete: vi.fn(() => { throw new Error('entityService must not be used'); }),
    },
    propertyQuery,
    commentQuery,
  };
  return strapi;
}

function visibleProperty(scope: ReturnType<typeof makeScope>) {
  scope.detail.mockResolvedValue({ documentId: 'property-7' });
}

function storedComment(overrides: Record<string, unknown> = {}) {
  return {
    id: 9,
    text: 'old text',
    createdAt: '2026-08-07T10:00:00.000Z',
    updatedAt: '2026-08-07T10:00:00.000Z',
    property: { id: 42, documentId: 'property-7' },
    author: { id: 7 },
    privateField: 'must not be returned',
    ...overrides,
  };
}

describe('user comment service canonical scope', () => {
  it('proves canonical property visibility before listing and queries only actor-owned property comments', async () => {
    const strapi = makeStrapi();
    const scope = makeScope();
    visibleProperty(scope);
    strapi.propertyQuery.findOne.mockResolvedValue({ id: 42, documentId: 'property-7', title: 'private' });
    strapi.commentQuery.findMany.mockResolvedValue([storedComment()]);
    const service = createUserCommentService(strapi as any, scope);

    const result = await service.list(7, 'property-7');

    expect(scope.detail).toHaveBeenCalledWith(7, 'property-7');
    expect(strapi.propertyQuery.findOne).toHaveBeenCalledWith({
      where: { documentId: 'property-7' },
      select: ['id', 'documentId'],
    });
    expect(strapi.commentQuery.findMany).toHaveBeenCalledWith({
      where: { property: { id: 42 }, author: { id: 7 } },
      select: COMMENT_SELECT,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    expect(result).toEqual({
      data: [{
        id: 9,
        text: 'old text',
        createdAt: '2026-08-07T10:00:00.000Z',
        updatedAt: '2026-08-07T10:00:00.000Z',
      }],
    });
    expect(JSON.stringify(result)).not.toContain('private');
    expect(strapi.entityService.create).not.toHaveBeenCalled();
  });

  it('returns the same not-found boundary for a non-visible property and never queries comments', async () => {
    const strapi = makeStrapi();
    const scope = makeScope();
    scope.detail.mockResolvedValue(null);
    const service = createUserCommentService(strapi as any, scope);

    await expect(service.list(7, 'outside-property')).rejects.toBeInstanceOf(UserCommentNotFoundError);
    await expect(service.create(7, 'outside-property', 'hello')).rejects.toBeInstanceOf(UserCommentNotFoundError);
    expect(strapi.propertyQuery.findOne).not.toHaveBeenCalled();
    expect(strapi.commentQuery.findMany).not.toHaveBeenCalled();
    expect(strapi.commentQuery.create).not.toHaveBeenCalled();
  });

  it('creates only trimmed text and injects both author and property relations server-side', async () => {
    const strapi = makeStrapi();
    const scope = makeScope();
    visibleProperty(scope);
    strapi.propertyQuery.findOne.mockResolvedValue({ id: 42, documentId: 'property-7' });
    strapi.commentQuery.create.mockResolvedValue(storedComment({ text: 'hello' }));
    const service = createUserCommentService(strapi as any, scope);

    const result = await service.create(7, 'property-7', '  hello  ');

    expect(strapi.commentQuery.create).toHaveBeenCalledWith({
      data: { text: 'hello', author: 7, property: 42 },
    });
    expect(result).toEqual({ data: {
      id: 9,
      text: 'hello',
      createdAt: '2026-08-07T10:00:00.000Z',
      updatedAt: '2026-08-07T10:00:00.000Z',
    } });
  });

  it('rejects malformed actor, bounded document ids, and text without touching Query Engine', async () => {
    const strapi = makeStrapi();
    const service = createUserCommentService(strapi as any, makeScope());

    for (const input of [
      [0, 'property-7', 'hello'],
      [7, '', 'hello'],
      [7, ' property-7', 'hello'],
      [7, 'x'.repeat(129), 'hello'],
      [7, 'property-7', ''],
      [7, 'property-7', '   '],
      [7, 'property-7', 'x'.repeat(5001)],
    ] as const) {
      await expect(service.create(input[0], input[1], input[2])).rejects.toBeInstanceOf(UserCommentValidationError);
    }

    expect(strapi.db.query).not.toHaveBeenCalled();
  });

  it('pre-reads and verifies both relations before an atomic owner/property update', async () => {
    const strapi = makeStrapi();
    const scope = makeScope();
    visibleProperty(scope);
    strapi.propertyQuery.findOne.mockResolvedValue({ id: 42, documentId: 'property-7' });
    strapi.commentQuery.findOne.mockResolvedValue(storedComment());
    strapi.commentQuery.update.mockResolvedValue(storedComment({ text: 'changed' }));
    const service = createUserCommentService(strapi as any, scope);

    const result = await service.update(7, 'property-7', 9, ' changed ');

    expect(strapi.commentQuery.findOne).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 9 },
      select: COMMENT_SELECT,
      populate: { author: { select: ['id'] }, property: { select: ['id', 'documentId'] } },
    }));
    expect(strapi.commentQuery.update).toHaveBeenCalledWith({
      where: { id: 9, property: { id: 42 }, author: { id: 7 } },
      data: { text: 'changed' },
    });
    expect(result.data).toEqual({
      id: 9,
      text: 'changed',
      createdAt: '2026-08-07T10:00:00.000Z',
      updatedAt: '2026-08-07T10:00:00.000Z',
    });
  });

  it('denies cross-owner, cross-property, and malformed relation rows indistinguishably before update/delete', async () => {
    for (const relation of [
      { author: { id: 8 }, property: { id: 42, documentId: 'property-7' } },
      { author: { id: 7 }, property: { id: 43, documentId: 'property-7' } },
      { author: null, property: { id: 42, documentId: 'property-7' } },
      { author: { id: 7 }, property: null },
    ]) {
      const strapi = makeStrapi();
      const scope = makeScope();
      visibleProperty(scope);
      strapi.propertyQuery.findOne.mockResolvedValue({ id: 42, documentId: 'property-7' });
      strapi.commentQuery.findOne.mockResolvedValue(storedComment(relation));
      const service = createUserCommentService(strapi as any, scope);

      await expect(service.update(7, 'property-7', 9, 'changed')).rejects.toBeInstanceOf(UserCommentNotFoundError);
      await expect(service.delete(7, 'property-7', 9)).rejects.toBeInstanceOf(UserCommentNotFoundError);
      expect(strapi.commentQuery.update).not.toHaveBeenCalled();
      expect(strapi.commentQuery.delete).not.toHaveBeenCalled();
    }
  });

  it('maps an owner-preserving zero-row update/delete to conflict and a changed owner to not-found', async () => {
    const strapi = makeStrapi();
    const scope = makeScope();
    visibleProperty(scope);
    strapi.propertyQuery.findOne.mockResolvedValue({ id: 42, documentId: 'property-7' });
    strapi.commentQuery.findOne
      .mockResolvedValueOnce(storedComment())
      .mockResolvedValueOnce(storedComment());
    strapi.commentQuery.update.mockResolvedValue(null);
    const service = createUserCommentService(strapi as any, scope);

    await expect(service.update(7, 'property-7', 9, 'changed')).rejects.toBeInstanceOf(UserCommentConflictError);

    const deleteStrapi = makeStrapi();
    const deleteScope = makeScope();
    visibleProperty(deleteScope);
    deleteStrapi.propertyQuery.findOne.mockResolvedValue({ id: 42, documentId: 'property-7' });
    deleteStrapi.commentQuery.findOne
      .mockResolvedValueOnce(storedComment())
      .mockResolvedValueOnce(storedComment({ author: { id: 8 } }));
    deleteStrapi.commentQuery.delete.mockResolvedValue(null);
    const deleteService = createUserCommentService(deleteStrapi as any, deleteScope);

    await expect(deleteService.delete(7, 'property-7', 9)).rejects.toBeInstanceOf(UserCommentNotFoundError);
    expect(deleteStrapi.commentQuery.delete).toHaveBeenCalledWith({
      where: { id: 9, property: { id: 42 }, author: { id: 7 } },
    });
  });

  it('returns an explicit DTO for delete and never uses entityService or relation population for list DTOs', async () => {
    const strapi = makeStrapi();
    const scope = makeScope();
    visibleProperty(scope);
    strapi.propertyQuery.findOne.mockResolvedValue({ id: 42, documentId: 'property-7' });
    strapi.commentQuery.findOne.mockResolvedValue(storedComment());
    strapi.commentQuery.delete.mockResolvedValue(storedComment());
    const service = createUserCommentService(strapi as any, scope);

    await expect(service.delete(7, 'property-7', 9)).resolves.toEqual({ data: {
      id: 9,
      text: 'old text',
      createdAt: '2026-08-07T10:00:00.000Z',
      updatedAt: '2026-08-07T10:00:00.000Z',
    } });
    expect(strapi.entityService.create).not.toHaveBeenCalled();
    expect(strapi.entityService.update).not.toHaveBeenCalled();
    expect(strapi.entityService.delete).not.toHaveBeenCalled();
  });
});
