import { factories } from '@strapi/strapi';
import {
  createDigestProjectionService,
  DigestProjectionConflictError,
  DigestProjectionMalformedError,
  DigestProjectionNotFoundError,
  DigestProjectionUnavailableError,
  DigestProjectionValidationError,
} from '../../../services/digest-projection';

const PROPERTIES_FIELDS = ['runId', 'userId', 'snapshotHash', 'page', 'pageSize'] as const;
const DELIVERY_FIELDS = ['runId', 'userId', 'snapshotHash'] as const;

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactData(ctx: any, fields: readonly string[]): RecordValue | null {
  const body = ctx?.request?.body;
  const data = body?.data;
  if (!isRecord(body) || Object.keys(body).length !== 1 || !isRecord(data)) return null;
  if (
    Object.keys(data).length !== fields.length
    || fields.some(field => !Object.prototype.hasOwnProperty.call(data, field))
    || Object.keys(data).some(field => !fields.includes(field))
  ) return null;
  return data;
}

function badRequest(ctx: any): void {
  ctx.status = 400;
  ctx.body = { error: 'Invalid digest projection request' };
}

function mapServiceError(ctx: any, error: unknown): void {
  if (error instanceof DigestProjectionValidationError) {
    badRequest(ctx);
    return;
  }
  if (error instanceof DigestProjectionNotFoundError) {
    ctx.status = 404;
    ctx.body = { error: 'Digest projection not found' };
    return;
  }
  if (error instanceof DigestProjectionConflictError) {
    ctx.status = 409;
    ctx.body = { error: 'Digest projection conflict' };
    return;
  }
  if (error instanceof DigestProjectionMalformedError || error instanceof DigestProjectionUnavailableError) {
    ctx.status = 500;
    ctx.body = { error: 'Internal server error' };
    return;
  }
  ctx.status = 500;
  ctx.body = { error: 'Internal server error' };
}

export default factories.createCoreController('api::digest-projection.digest-projection' as any, ({ strapi }) => {
  const service = createDigestProjectionService(strapi as any);

  return {
    async properties(ctx) {
      const data = exactData(ctx, PROPERTIES_FIELDS);
      if (!data) {
        badRequest(ctx);
        return;
      }
      try {
        ctx.body = await service.properties(data);
      } catch (error) {
        mapServiceError(ctx, error);
      }
    },

    async delivery(ctx) {
      const data = exactData(ctx, DELIVERY_FIELDS);
      if (!data) {
        badRequest(ctx);
        return;
      }
      try {
        ctx.body = { data: await service.delivery(data) };
      } catch (error) {
        mapServiceError(ctx, error);
      }
    },
  };
});
