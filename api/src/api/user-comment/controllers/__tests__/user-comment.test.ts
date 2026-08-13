import { describe, expect, it, vi } from 'vitest';

vi.mock('@strapi/strapi', () => ({
  factories: {
    createCoreController: vi.fn((_uid: string, factory: any) => factory),
  },
}));

const { commentService } = vi.hoisted(() => ({
  commentService: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('../../../../services/user-comment', () => ({
  createUserCommentService: vi.fn(() => commentService),
}));

import controllerFactory from '../user-comment';
import userCommentRoutes from '../../routes/user-comment';

function makeCtx(overrides: Record<string, unknown> = {}) {
  return {
    state: { user: { id: 7 } },
    params: { documentId: 'property-7', commentId: '9' },
    query: {},
    request: { body: { data: { text: 'hello' } } },
    status: 200,
    body: undefined as unknown,
    ...overrides,
  } as any;
}

function actions(strapi: unknown = {}) {
  return (controllerFactory as any)({ strapi });
}

describe('user comment custom routes', () => {
  it('exposes only canonical property comment routes with authenticated-user policy', () => {
    expect(userCommentRoutes.routes).toEqual([
      {
        method: 'GET',
        path: '/me/properties/:documentId/comments',
        handler: 'user-comment.listMine',
        config: { auth: false, policies: ['global::authenticated-user'] },
      },
      {
        method: 'POST',
        path: '/me/properties/:documentId/comments',
        handler: 'user-comment.createMine',
        config: { auth: false, policies: ['global::authenticated-user'] },
      },
      {
        method: 'PUT',
        path: '/me/properties/:documentId/comments/:commentId',
        handler: 'user-comment.updateMine',
        config: { auth: false, policies: ['global::authenticated-user'] },
      },
      {
        method: 'DELETE',
        path: '/me/properties/:documentId/comments/:commentId',
        handler: 'user-comment.deleteMine',
        config: { auth: false, policies: ['global::authenticated-user'] },
      },
    ]);
    expect(userCommentRoutes.routes.map((route) => route.path)).not.toContain('/user-comments');
    expect(userCommentRoutes.routes.map((route) => route.handler)).not.toContain('user-comment.find');
  });
});

describe('user comment controller boundary', () => {
  it('blocks comment mutations during catalog maintenance before service access', async () => {
    const previous = process.env.AKLAB_CATALOG_CLEANUP_MAINTENANCE_MODE;
    process.env.AKLAB_CATALOG_CLEANUP_MAINTENANCE_MODE = 'enabled';
    try {
      const ctx = makeCtx({ request: { body: { data: { text: 'hello' } } } });

      await actions().createMine(ctx);

      expect(ctx.status).toBe(409);
      expect(ctx.body).toEqual({ error: 'Выполняется обслуживание каталога.' });
      expect(commentService.create).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.AKLAB_CATALOG_CLEANUP_MAINTENANCE_MODE;
      else process.env.AKLAB_CATALOG_CLEANUP_MAINTENANCE_MODE = previous;
    }
  });
  it('takes the actor only from an exact positive safe integer state user id', async () => {
    commentService.list.mockResolvedValue({ data: [] });

    for (const id of [undefined, null, 0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '7']) {
      commentService.list.mockClear();
      const ctx = makeCtx({ state: { user: { id } } });

      await actions().listMine(ctx);

      expect(ctx.status).toBe(401);
      expect(ctx.body).toEqual({ error: 'Unauthorized' });
      expect(commentService.list).not.toHaveBeenCalled();
    }
  });

  it('passes only the route document id and actor to list, never query or body ownership inputs', async () => {
    const result = { data: [{ id: 1, text: 'hello', createdAt: null, updatedAt: null }] };
    commentService.list.mockResolvedValue(result);
    const ctx = makeCtx({
      query: { actorId: 99, author: 99, property: 99, id: 99 },
      request: { body: { data: { actorId: 99, author: 99, property: 99, id: 99 } } },
    });

    await actions().listMine(ctx);

    expect(commentService.list).toHaveBeenCalledWith(7, 'property-7');
    expect(ctx.body).toEqual(result);
  });

  it('trims text and accepts only the exact data.text body contract', async () => {
    const result = { data: { id: 1, text: 'hello', createdAt: null, updatedAt: null } };
    commentService.create.mockResolvedValue(result);
    const ctx = makeCtx({
      request: { body: { data: { text: '  hello  ' } } },
    });

    await actions().createMine(ctx);

    expect(commentService.create).toHaveBeenCalledWith(7, 'property-7', 'hello');
    expect(ctx.body).toEqual(result);

    for (const body of [
      undefined,
      null,
      {},
      { data: null },
      { data: { text: '' } },
      { data: { text: '   ' } },
      { data: { text: 'hello', author: 99 } },
      { data: { text: 'hello', property: 99 } },
      { data: { text: 'hello', id: 99 } },
      { data: { text: 'hello' }, actorId: 99 },
    ]) {
      commentService.create.mockClear();
      const invalidCtx = makeCtx({ request: { body } });

      await actions().createMine(invalidCtx);

      expect(invalidCtx.status).toBe(400);
      expect(invalidCtx.body).toEqual({ error: 'Invalid comment input' });
      expect(commentService.create).not.toHaveBeenCalled();
    }
  });

  it('rejects malformed bounded document and comment route ids before the service', async () => {
    for (const documentId of ['', ' property-7', 'property-7 ', 'x'.repeat(129)]) {
      commentService.list.mockClear();
      const ctx = makeCtx({ params: { documentId, commentId: '9' } });

      await actions().listMine(ctx);

      expect(ctx.status).toBe(400);
      expect(ctx.body).toEqual({ error: 'Invalid comment input' });
      expect(commentService.list).not.toHaveBeenCalled();
    }

    for (const commentId of ['', '0', '-1', '1.5', ' 9 ', '9x', '9007199254740992']) {
      commentService.update.mockClear();
      const ctx = makeCtx({ params: { documentId: 'property-7', commentId } });

      await actions().updateMine(ctx);

      expect(ctx.status).toBe(400);
      expect(ctx.body).toEqual({ error: 'Invalid comment input' });
      expect(commentService.update).not.toHaveBeenCalled();
    }
  });

  it('uses route comment id for update/delete and maps a safe not-found response', async () => {
    const result = { data: { id: 9, text: 'new', createdAt: null, updatedAt: null } };
    commentService.update.mockResolvedValue(result);
    const updateCtx = makeCtx({ request: { body: { data: { text: ' new ' } } } });

    await actions().updateMine(updateCtx);

    expect(commentService.update).toHaveBeenCalledWith(7, 'property-7', 9, 'new');
    expect(updateCtx.body).toEqual(result);

    commentService.delete.mockRejectedValue(new Error('private relation details must not leak'));
    const deleteCtx = makeCtx();

    await actions().deleteMine(deleteCtx);

    expect(deleteCtx.status).toBe(500);
    expect(deleteCtx.body).toEqual({ error: 'Internal server error' });
    expect(JSON.stringify(deleteCtx.body)).not.toContain('private relation');
  });
});
