import { factories } from '@strapi/strapi';
import {
  createUserCommentService,
  type UserCommentService,
} from '../../../services/user-comment';

const MAX_DOCUMENT_ID_LENGTH = 128;
const MAX_COMMENT_TEXT_LENGTH = 5000;

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function actorId(ctx: any): number | null {
  const id = ctx?.state?.user?.id;
  return isPositiveSafeInteger(id) ? id : null;
}

function documentId(ctx: any): string | null {
  const value = ctx?.params?.documentId;
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > MAX_DOCUMENT_ID_LENGTH
    || value !== value.trim()
  ) return null;
  return value;
}

function commentId(ctx: any): number | null {
  const value = ctx?.params?.commentId;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return isPositiveSafeInteger(parsed) ? parsed : null;
}

function textBody(ctx: any): string | null {
  const body = ctx?.request?.body;
  if (!isRecord(body) || Object.keys(body).length !== 1 || !Object.prototype.hasOwnProperty.call(body, 'data')) {
    return null;
  }
  const data = body.data;
  if (!isRecord(data) || Object.keys(data).length !== 1 || !Object.prototype.hasOwnProperty.call(data, 'text')) {
    return null;
  }
  if (typeof data.text !== 'string') return null;
  const text = data.text.trim();
  return text.length > 0 && text.length <= MAX_COMMENT_TEXT_LENGTH ? text : null;
}

function setUnauthorized(ctx: any): void {
  ctx.status = 401;
  ctx.body = { error: 'Unauthorized' };
}

function setInvalidInput(ctx: any): void {
  ctx.status = 400;
  ctx.body = { error: 'Invalid comment input' };
}

function setNotFound(ctx: any): void {
  ctx.status = 404;
  ctx.body = { error: 'Not found' };
}

function setServiceError(ctx: any, error: unknown): void {
  const code = isRecord(error) ? error.code : undefined;
  if (code === 'USER_COMMENT_VALIDATION_ERROR') {
    setInvalidInput(ctx);
    return;
  }
  if (code === 'USER_COMMENT_NOT_FOUND') {
    setNotFound(ctx);
    return;
  }
  if (code === 'USER_COMMENT_CONFLICT') {
    ctx.status = 409;
    ctx.body = { error: 'Comment conflict' };
    return;
  }
  ctx.status = 500;
  ctx.body = { error: 'Internal server error' };
}

function routeInputs(ctx: any, needsCommentId = false): { actorId: number; documentId: string; commentId?: number } | null {
  const actor = actorId(ctx);
  const property = documentId(ctx);
  const comment = needsCommentId ? commentId(ctx) : undefined;
  if (actor === null || property === null || (needsCommentId && comment === null)) return null;
  return needsCommentId
    ? { actorId: actor, documentId: property, commentId: comment as number }
    : { actorId: actor, documentId: property };
}

async function execute(
  ctx: any,
  strapi: unknown,
  operation: (service: UserCommentService, input: NonNullable<ReturnType<typeof routeInputs>>) => Promise<unknown>,
  needsCommentId = false,
): Promise<void> {
  const input = routeInputs(ctx, needsCommentId);
  if (!input) {
    if (actorId(ctx) === null) setUnauthorized(ctx);
    else setInvalidInput(ctx);
    return;
  }

  try {
    const service = createUserCommentService(strapi as any);
    ctx.body = await operation(service, input);
  } catch (error) {
    setServiceError(ctx, error);
  }
}

export default factories.createCoreController('api::user-comment.user-comment', ({ strapi }) => ({
  async listMine(ctx) {
    await execute(ctx, strapi, (service, input) => service.list(input.actorId, input.documentId));
  },

  async createMine(ctx) {
    const text = textBody(ctx);
    if (text === null) {
      setInvalidInput(ctx);
      return;
    }
    await execute(ctx, strapi, async (service, input) => {
      const result = await service.create(input.actorId, input.documentId, text);
      ctx.status = 201;
      return result;
    });
  },

  async updateMine(ctx) {
    const text = textBody(ctx);
    if (text === null) {
      setInvalidInput(ctx);
      return;
    }
    await execute(
      ctx,
      strapi,
      (service, input) => service.update(input.actorId, input.documentId, input.commentId, text),
      true,
    );
  },

  async deleteMine(ctx) {
    await execute(
      ctx,
      strapi,
      (service, input) => service.delete(input.actorId, input.documentId, input.commentId),
      true,
    );
  },
}));
