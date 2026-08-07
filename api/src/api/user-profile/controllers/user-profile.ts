import { factories } from '@strapi/strapi';
import {
  getUserProfile,
  getUserContext,
  listUserProfiles,
  replaceUserProfile,
  toUserProfileDto,
  UserContextMalformedError,
  UserProfileConflictError,
  UserProfileMalformedError,
  UserProfileNotFoundError,
  UserProfileSnapshotError,
  UserProfileUnavailableError,
  UserProfileValidationError,
} from '../../../services/user-profile';

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;

type RecordValue = Record<string, unknown>;

type ProfileUpdatePayload = {
  input: RecordValue;
  expectedVersion: number;
};

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(value: RecordValue, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function actorId(ctx: any): number | null {
  const id = ctx?.state?.user?.id;
  return isPositiveSafeInteger(id) ? id : null;
}

function routeUserId(ctx: any): number | null {
  const value = ctx?.params?.userId;
  if (typeof value === 'number') return isPositiveSafeInteger(value) ? value : null;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return isPositiveSafeInteger(parsed) ? parsed : null;
}

function expectedVersion(value: unknown): value is number {
  return isPositiveSafeInteger(value);
}

function updatePayload(ctx: any): ProfileUpdatePayload | null {
  const body = ctx?.request?.body;
  if (!isRecord(body) || Object.keys(body).length !== 1 || !hasOwn(body, 'data') || !isRecord(body.data)) {
    return null;
  }
  if (!hasOwn(body.data, 'expectedVersion') || !expectedVersion(body.data.expectedVersion)) {
    return null;
  }

  const input = Object.fromEntries(
    Object.entries(body.data).filter(([key]) => key !== 'expectedVersion'),
  );
  return { input, expectedVersion: body.data.expectedVersion };
}

function pageValue(value: unknown, defaultValue: number): number | null {
  if (value === undefined) return defaultValue;
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? value : null;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function setUnauthorized(ctx: any): void {
  ctx.status = 401;
  ctx.body = { error: 'Unauthorized' };
}

function setBadRequest(ctx: any): void {
  ctx.status = 400;
  ctx.body = { error: 'Invalid user profile input' };
}

function setNotFound(ctx: any): void {
  ctx.status = 404;
  ctx.body = { error: 'User profile not found' };
}

function setServiceError(ctx: any, error: unknown): void {
  if (error instanceof UserContextMalformedError) {
    ctx.status = 500;
    ctx.body = { error: 'Internal server error' };
    return;
  }
  if (error instanceof UserProfileValidationError || error instanceof UserProfileMalformedError) {
    setBadRequest(ctx);
    return;
  }
  if (error instanceof UserProfileNotFoundError) {
    setNotFound(ctx);
    return;
  }
  if (error instanceof UserProfileConflictError) {
    ctx.status = 409;
    ctx.body = { error: 'User profile version conflict' };
    return;
  }
  if (error instanceof UserProfileUnavailableError) {
    ctx.status = 403;
    ctx.body = { error: 'Forbidden' };
    return;
  }
  if (error instanceof UserProfileSnapshotError) {
    setBadRequest(ctx);
    return;
  }
  ctx.status = 500;
  ctx.body = { error: 'Internal server error' };
}

function pagination(ctx: any): { page: number; pageSize: number } | null {
  const page = pageValue(ctx?.query?.page, DEFAULT_PAGE);
  const requestedPageSize = pageValue(ctx?.query?.pageSize, DEFAULT_PAGE_SIZE);
  if (page === null || requestedPageSize === null) return null;
  return { page, pageSize: Math.min(requestedPageSize, MAX_PAGE_SIZE) };
}

export default factories.createCoreController('api::user-profile.user-profile' as any, ({ strapi }) => ({
  async getMe(ctx) {
    const userId = actorId(ctx);
    if (userId === null) {
      setUnauthorized(ctx);
      return;
    }

    try {
      const profile = await getUserProfile(strapi as any, userId);
      if (!isRecord(profile)) {
        setNotFound(ctx);
        return;
      }
      ctx.body = { data: toUserProfileDto(profile) };
    } catch (error) {
      setServiceError(ctx, error);
    }
  },

  async getMeContext(ctx) {
    const userId = actorId(ctx);
    if (userId === null) {
      setUnauthorized(ctx);
      return;
    }

    try {
      ctx.body = { data: await getUserContext(strapi as any, userId) };
    } catch (error) {
      setServiceError(ctx, error);
    }
  },

  async updateMe(ctx) {
    const userId = actorId(ctx);
    if (userId === null) {
      setUnauthorized(ctx);
      return;
    }
    const payload = updatePayload(ctx);
    if (!payload) {
      setBadRequest(ctx);
      return;
    }

    try {
      const profile = await replaceUserProfile(strapi as any, userId, payload.input, payload.expectedVersion);
      ctx.body = { data: toUserProfileDto(profile) };
    } catch (error) {
      setServiceError(ctx, error);
    }
  },

  async listAdmin(ctx) {
    if (actorId(ctx) === null) {
      setUnauthorized(ctx);
      return;
    }
    const params = pagination(ctx);
    if (!params) {
      setBadRequest(ctx);
      return;
    }

    try {
      const result = await listUserProfiles(strapi as any, params.page, params.pageSize);
      ctx.body = {
        data: result.data,
        meta: {
          pagination: {
            page: result.meta.page,
            pageSize: result.meta.pageSize,
            pageCount: result.meta.totalPages,
            total: result.meta.total,
          },
        },
      };
    } catch (error) {
      setServiceError(ctx, error);
    }
  },

  async getAdmin(ctx) {
    if (actorId(ctx) === null) {
      setUnauthorized(ctx);
      return;
    }
    const userId = routeUserId(ctx);
    if (userId === null) {
      setBadRequest(ctx);
      return;
    }

    try {
      const profile = await getUserProfile(strapi as any, userId);
      if (!isRecord(profile)) {
        setNotFound(ctx);
        return;
      }
      ctx.body = { data: toUserProfileDto(profile) };
    } catch (error) {
      setServiceError(ctx, error);
    }
  },

  async updateAdmin(ctx) {
    if (actorId(ctx) === null) {
      setUnauthorized(ctx);
      return;
    }
    const userId = routeUserId(ctx);
    if (userId === null) {
      setBadRequest(ctx);
      return;
    }
    const payload = updatePayload(ctx);
    if (!payload) {
      setBadRequest(ctx);
      return;
    }

    try {
      const profile = await replaceUserProfile(strapi as any, userId, payload.input, payload.expectedVersion);
      ctx.body = { data: toUserProfileDto(profile) };
    } catch (error) {
      setServiceError(ctx, error);
    }
  },
}));
