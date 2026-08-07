import { factories } from '@strapi/strapi';
import {
  createUserPropertyStateService,
  UserPropertyStateConflictError,
  UserPropertyStateMalformedError,
  UserPropertyStateNotFoundError,
  UserPropertyStateValidationError,
  type UserPropertyStateStatus,
} from '../../../services/user-property-state';

const MAX_DOCUMENT_ID_LENGTH = 256;
const STATUS_SET = new Set<UserPropertyStateStatus>(['new', 'in_progress', 'viewed', 'rejected']);

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(value: RecordValue, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function actorId(ctx: any): number | null {
  const id = ctx?.state?.user?.id;
  return typeof id === 'number' && Number.isSafeInteger(id) && id > 0 ? id : null;
}

function documentId(ctx: any): string | null {
  const value = ctx?.params?.documentId;
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > MAX_DOCUMENT_ID_LENGTH
    || value.trim() !== value
  ) return null;
  return value;
}

function putStatus(ctx: any): UserPropertyStateStatus | null {
  const body = ctx?.request?.body;
  if (!isRecord(body) || Object.keys(body).length !== 1 || !hasOwn(body, 'data') || !isRecord(body.data)) return null;
  if (Object.keys(body.data).length !== 1 || !hasOwn(body.data, 'status')) return null;
  const status = body.data.status;
  return typeof status === 'string' && STATUS_SET.has(status as UserPropertyStateStatus)
    ? status as UserPropertyStateStatus
    : null;
}

function unauthorized(ctx: any): void {
  ctx.status = 401;
  ctx.body = { error: 'Unauthorized' };
}

function badRequest(ctx: any): void {
  ctx.status = 400;
  ctx.body = { error: 'Invalid user property state input' };
}

function notFound(ctx: any): void {
  ctx.status = 404;
  ctx.body = { error: 'Property not found' };
}

function serviceError(ctx: any, error: unknown): void {
  if (error instanceof UserPropertyStateValidationError) {
    badRequest(ctx);
    return;
  }
  if (error instanceof UserPropertyStateNotFoundError) {
    notFound(ctx);
    return;
  }
  if (error instanceof UserPropertyStateConflictError) {
    ctx.status = 409;
    ctx.body = { error: 'User property state conflict' };
    return;
  }
  if (error instanceof UserPropertyStateMalformedError) {
    ctx.status = 500;
    ctx.body = { error: 'Internal server error' };
    return;
  }
  ctx.status = 500;
  ctx.body = { error: 'Internal server error' };
}

export default factories.createCoreController('api::user-property-state.user-property-state' as any, ({ strapi }) => {
  const service = createUserPropertyStateService(strapi as any);

  return {
    async getState(ctx) {
      const userId = actorId(ctx);
      const propertyDocumentId = documentId(ctx);
      if (userId === null) {
        unauthorized(ctx);
        return;
      }
      if (propertyDocumentId === null) {
        badRequest(ctx);
        return;
      }

      try {
        ctx.body = { data: await service.get(userId, propertyDocumentId) };
      } catch (error) {
        serviceError(ctx, error);
      }
    },

    async putState(ctx) {
      const userId = actorId(ctx);
      const propertyDocumentId = documentId(ctx);
      if (userId === null) {
        unauthorized(ctx);
        return;
      }
      if (propertyDocumentId === null) {
        badRequest(ctx);
        return;
      }
      const status = putStatus(ctx);
      if (status === null) {
        badRequest(ctx);
        return;
      }

      try {
        ctx.body = { data: await service.put(userId, propertyDocumentId, status) };
      } catch (error) {
        serviceError(ctx, error);
      }
    },

    async deleteState(ctx) {
      const userId = actorId(ctx);
      const propertyDocumentId = documentId(ctx);
      if (userId === null) {
        unauthorized(ctx);
        return;
      }
      if (propertyDocumentId === null) {
        badRequest(ctx);
        return;
      }

      try {
        ctx.body = { data: await service.remove(userId, propertyDocumentId) };
      } catch (error) {
        serviceError(ctx, error);
      }
    },
  };
});
