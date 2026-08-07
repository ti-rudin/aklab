import { factories } from '@strapi/strapi';
import {
  createUserPropertyScopeRepository,
  UserPropertyScopeMalformedError,
  UserPropertyScopeNotReadyError,
  UserPropertyScopeQueryError,
  UserPropertyScopeUnavailableError,
  UserPropertyScopeValidationError,
} from '../../../services/user-property-scope';

const EVENT_UID = 'api::property-event.property-event';
const EVENT_SELECT = [
  'documentId',
  'event_type',
  'old_value',
  'new_value',
  'createdAt',
  'updatedAt',
] as const;
const EVENT_TYPES = new Set([
  'created',
  'entered_focus',
  'left_focus',
  'score_changed',
  'status_changed',
  'price_changed',
]);
const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE = 100_000;
const MAX_PAGE_SIZE = 100;

interface EventDto {
  documentId: string;
  event_type: string;
  old_value: string | null;
  new_value: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function actorId(ctx: any): number {
  const value = ctx?.state?.user?.id;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new UserPropertyScopeValidationError();
  }
  return value;
}

function strictSegment(value: unknown): value is string {
  return typeof value === 'string'
    && value !== ''
    && value === value.trim()
    && value.length <= 256
    && value !== '.'
    && value !== '..'
    && !value.includes('/')
    && !value.includes('\\');
}

function routeParams(ctx: any, single: boolean): { documentId: string; eventId?: string } {
  const params = ctx?.params;
  const allowedKeys = single ? new Set(['documentId', 'eventId']) : new Set(['documentId']);
  if (!isRecord(params)
    || Object.keys(params).some((key) => !allowedKeys.has(key))
    || !strictSegment(params.documentId)) {
    throw new Error('INVALID_PROPERTY_EVENT_PARAMS');
  }
  const eventId = params.eventId;
  if (single) {
    if (!strictSegment(eventId)) {
      throw new Error('INVALID_PROPERTY_EVENT_PARAMS');
    }
    return { documentId: params.documentId, eventId };
  }
  return { documentId: params.documentId };
}

function integerQueryValue(value: unknown, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' && typeof value !== 'number') throw new UserPropertyScopeValidationError();
  const parsed = typeof value === 'number' ? value : Number(value.trim());
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) {
    throw new UserPropertyScopeValidationError();
  }
  return parsed;
}

function pagination(ctx: any): { page: number; pageSize: number } {
  const query = ctx?.query ?? {};
  if (!isRecord(query)) throw new UserPropertyScopeValidationError();
  const allowed = new Set(['page', 'pageSize']);
  if (Object.keys(query).some((key) => !allowed.has(key))) {
    throw new UserPropertyScopeValidationError();
  }
  return {
    page: integerQueryValue(query.page, DEFAULT_PAGE, MAX_PAGE),
    pageSize: integerQueryValue(query.pageSize, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE),
  };
}

function nullableText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new Error('INVALID_PROPERTY_EVENT_ROW');
  return value;
}

function eventDto(value: unknown): EventDto {
  if (!isRecord(value)
    || typeof value.documentId !== 'string'
    || value.documentId === ''
    || typeof value.event_type !== 'string'
    || !EVENT_TYPES.has(value.event_type)) {
    throw new Error('INVALID_PROPERTY_EVENT_ROW');
  }
  const createdAt = nullableText(value.createdAt);
  const updatedAt = nullableText(value.updatedAt);
  return {
    documentId: value.documentId,
    event_type: value.event_type,
    old_value: nullableText(value.old_value),
    new_value: nullableText(value.new_value),
    createdAt,
    updatedAt,
  };
}

function scopeErrorResponse(ctx: any, error: unknown): void {
  if (error instanceof UserPropertyScopeValidationError) {
    ctx.status = 400;
    ctx.body = { error: 'Invalid property event query' };
    return;
  }
  if (error instanceof UserPropertyScopeNotReadyError) {
    ctx.status = 409;
    ctx.body = { error: 'Property profile is not ready' };
    return;
  }
  if (
    error instanceof UserPropertyScopeMalformedError
    || error instanceof UserPropertyScopeUnavailableError
    || error instanceof UserPropertyScopeQueryError
  ) {
    ctx.status = 500;
    ctx.body = { error: 'Property scope unavailable' };
    return;
  }
  ctx.status = 500;
  ctx.body = { error: 'Property scope unavailable' };
}

function invalidParamsResponse(ctx: any): void {
  ctx.status = 400;
  ctx.body = { error: 'Invalid property event parameters' };
}

function queryFailureResponse(ctx: any): void {
  ctx.status = 500;
  ctx.body = { error: 'Property events unavailable' };
}

async function visibleProperty(
  strapi: any,
  ctx: any,
  documentId: string,
): Promise<boolean> {
  try {
    const repository = createUserPropertyScopeRepository(strapi);
    const userId = actorId(ctx);
    const property = await repository.detail(userId, documentId, {});
    if (property === null) {
      ctx.status = 404;
      ctx.body = { error: 'Property not found' };
      return false;
    }
    return true;
  } catch (error) {
    scopeErrorResponse(ctx, error);
    return false;
  }
}

export default factories.createCoreController(EVENT_UID, ({ strapi }) => ({
  async findMine(ctx) {
    let params: { documentId: string };
    try {
      params = routeParams(ctx, false);
    } catch {
      invalidParamsResponse(ctx);
      return;
    }

    let page: number;
    let pageSize: number;
    try {
      ({ page, pageSize } = pagination(ctx));
    } catch {
      ctx.status = 400;
      ctx.body = { error: 'Invalid property event query' };
      return;
    }

    if (!(await visibleProperty(strapi, ctx, params.documentId))) return;

    const query = strapi.db.query(EVENT_UID);
    const offset = (page - 1) * pageSize;
    let rows: unknown;
    try {
      rows = await query.findMany({
        where: { property: { documentId: params.documentId } },
        select: [...EVENT_SELECT],
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        limit: pageSize + 1,
        offset,
      });
      if (!Array.isArray(rows)) throw new Error('INVALID_PROPERTY_EVENT_ROWS');
      const hasNextPage = rows.length > pageSize;
      const data = rows.slice(0, pageSize).map(eventDto);
      ctx.body = { data, meta: { page, pageSize, hasNextPage } };
    } catch {
      queryFailureResponse(ctx);
    }
  },

  async findOneMine(ctx) {
    let params: { documentId: string; eventId: string };
    try {
      params = routeParams(ctx, true) as { documentId: string; eventId: string };
    } catch {
      invalidParamsResponse(ctx);
      return;
    }

    if (!(await visibleProperty(strapi, ctx, params.documentId))) return;

    const query = strapi.db.query(EVENT_UID);
    try {
      const row = await query.findOne({
        where: {
          documentId: params.eventId,
          property: { documentId: params.documentId },
        },
        select: [...EVENT_SELECT],
      });
      if (row === null || row === undefined) {
        ctx.status = 404;
        ctx.body = { error: 'Event not found' };
        return;
      }
      ctx.body = { data: eventDto(row) };
    } catch {
      queryFailureResponse(ctx);
    }
  },
}));
