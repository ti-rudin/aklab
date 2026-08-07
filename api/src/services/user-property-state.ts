import {
  createUserPropertyScopeRepository,
  UserPropertyScopeNotReadyError,
  type UserPropertyScopeRepository,
} from './user-property-scope';

export const USER_PROPERTY_STATE_UID = 'api::user-property-state.user-property-state';
export const PROPERTY_UID = 'api::property.property';

export type UserPropertyStateStatus = 'new' | 'in_progress' | 'viewed' | 'rejected';
export type StoredUserPropertyStateStatus = Exclude<UserPropertyStateStatus, 'new'>;

export interface UserPropertyStateDto {
  status: UserPropertyStateStatus;
  property_document_id: string;
}

export interface UserPropertyStateStrapi {
  db: {
    query: (uid: string) => UserPropertyStateQuery;
    connection?: unknown;
  };
}

export interface UserPropertyStateQuery {
  findOne: (params?: unknown) => Promise<unknown>;
  findMany: (params?: unknown) => Promise<unknown>;
  create: (params: { data: Record<string, unknown> }) => Promise<unknown>;
  update: (params: { where: Record<string, unknown>; data: Record<string, unknown> }) => Promise<unknown>;
  delete: (params: { where: Record<string, unknown> }) => Promise<unknown>;
}

export interface UserPropertyStateVisibilityRepository {
  detail: (userId: number, documentId: string) => Promise<unknown | null>;
}

export interface UserPropertyStateServiceOptions {
  scopeRepository?: UserPropertyStateVisibilityRepository | Pick<UserPropertyScopeRepository, 'detail'>;
}

export class UserPropertyStateError extends Error {
  readonly code: string;

  constructor(name: string, code: string, message: string) {
    super(message);
    this.name = name;
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class UserPropertyStateValidationError extends UserPropertyStateError {
  constructor() {
    super('UserPropertyStateValidationError', 'USER_PROPERTY_STATE_VALIDATION_ERROR', 'Invalid user property state input.');
  }
}

export class UserPropertyStateNotFoundError extends UserPropertyStateError {
  constructor() {
    super('UserPropertyStateNotFoundError', 'USER_PROPERTY_STATE_NOT_FOUND', 'Property not found.');
  }
}

export class UserPropertyStateConflictError extends UserPropertyStateError {
  constructor() {
    super('UserPropertyStateConflictError', 'USER_PROPERTY_STATE_CONFLICT', 'User property state conflict.');
  }
}

export class UserPropertyStateMalformedError extends UserPropertyStateError {
  constructor() {
    super('UserPropertyStateMalformedError', 'USER_PROPERTY_STATE_MALFORMED', 'Stored user property state is malformed.');
  }
}

const MAX_DOCUMENT_ID_LENGTH = 256;
const STATE_ROW_LIMIT = 2;
const STORED_STATUS_SET = new Set<StoredUserPropertyStateStatus>(['in_progress', 'viewed', 'rejected']);
const ALL_STATUS_SET = new Set<UserPropertyStateStatus>(['new', 'in_progress', 'viewed', 'rejected']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function assertUserId(value: unknown): asserts value is number {
  if (!isPositiveSafeInteger(value)) throw new UserPropertyStateValidationError();
}

function normalizeDocumentId(value: unknown): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > MAX_DOCUMENT_ID_LENGTH
    || value.trim() !== value
  ) {
    throw new UserPropertyStateValidationError();
  }
  return value;
}

function normalizeStatus(value: unknown): UserPropertyStateStatus {
  if (typeof value !== 'string' || !ALL_STATUS_SET.has(value as UserPropertyStateStatus)) {
    throw new UserPropertyStateValidationError();
  }
  return value as UserPropertyStateStatus;
}

function relationId(value: unknown): number | null {
  if (!isRecord(value) || !isPositiveSafeInteger(value.id)) return null;
  return value.id;
}

function isUniqueViolation(error: unknown): boolean {
  if (!isRecord(error)) return false;
  const code = typeof error.code === 'string' ? error.code : '';
  const name = typeof error.name === 'string' ? error.name : '';
  const message = typeof error.message === 'string' ? error.message : '';
  if (code === 'SQLITE_CONSTRAINT_UNIQUE' || code === '23505' || code === 'ER_DUP_ENTRY') return true;
  if (name === 'UniqueConstraintError') return true;
  return /unique constraint|unique violation|duplicate key|duplicate entry/i.test(message);
}

function virtualState(documentId: string): UserPropertyStateDto {
  return { status: 'new', property_document_id: documentId };
}

function toDto(row: Record<string, unknown>): UserPropertyStateDto {
  return {
    status: row.status as StoredUserPropertyStateStatus,
    property_document_id: row.property_document_id as string,
  };
}

function assertPropertyDocument(property: unknown, documentId: string): number {
  if (property === null || property === undefined) throw new UserPropertyStateNotFoundError();
  if (!isRecord(property) || property.documentId !== documentId || !isPositiveSafeInteger(property.id)) {
    throw new UserPropertyStateMalformedError();
  }
  return property.id;
}

function assertVisibleDetail(visible: unknown, documentId: string): void {
  if (visible === null || visible === undefined) throw new UserPropertyStateNotFoundError();
  if (!isRecord(visible) || visible.documentId !== documentId) throw new UserPropertyStateMalformedError();
}

function assertStateRow(
  value: unknown,
  userId: number,
  documentId: string,
  propertyId: number,
): Record<string, unknown> {
  if (!isRecord(value)) throw new UserPropertyStateMalformedError();
  if (!isPositiveSafeInteger(value.id)) throw new UserPropertyStateMalformedError();
  if (value.identity_key !== `${userId}:${documentId}`) throw new UserPropertyStateMalformedError();
  if (value.user_id !== userId) throw new UserPropertyStateMalformedError();
  if (value.property_document_id !== documentId) throw new UserPropertyStateMalformedError();
  if (typeof value.status !== 'string' || !STORED_STATUS_SET.has(value.status as StoredUserPropertyStateStatus)) {
    throw new UserPropertyStateMalformedError();
  }
  if (relationId(value.user) !== userId) throw new UserPropertyStateMalformedError();
  if (relationId(value.property) !== propertyId) throw new UserPropertyStateMalformedError();
  if (isRecord(value.property) && value.property.documentId !== undefined && value.property.documentId !== documentId) {
    throw new UserPropertyStateMalformedError();
  }
  return value;
}

export class UserPropertyStateService {
  private readonly scopeRepository: UserPropertyStateVisibilityRepository;

  constructor(
    private readonly strapi: UserPropertyStateStrapi,
    options: UserPropertyStateServiceOptions = {},
  ) {
    this.scopeRepository = options.scopeRepository || createUserPropertyScopeRepository(strapi as never);
  }

  private propertyQuery(): UserPropertyStateQuery {
    return this.strapi.db.query(PROPERTY_UID);
  }

  private stateQuery(): UserPropertyStateQuery {
    return this.strapi.db.query(USER_PROPERTY_STATE_UID);
  }

  private async context(userId: unknown, documentId: unknown): Promise<{ userId: number; documentId: string; propertyId: number }> {
    assertUserId(userId);
    const normalizedDocumentId = normalizeDocumentId(documentId);

    // This is intentionally the first database boundary. A property outside the
    // canonical scope is indistinguishable from a nonexistent property.
    let visible: unknown | null;
    try {
      visible = await this.scopeRepository.detail(userId, normalizedDocumentId);
    } catch (error) {
      if (error instanceof UserPropertyScopeNotReadyError) throw new UserPropertyStateNotFoundError();
      throw error;
    }
    assertVisibleDetail(visible, normalizedDocumentId);

    const property = await this.propertyQuery().findOne({
      where: { documentId: normalizedDocumentId },
      select: ['id', 'documentId'],
    });
    const propertyId = assertPropertyDocument(property, normalizedDocumentId);
    return { userId, documentId: normalizedDocumentId, propertyId };
  }

  private async findState(
    userId: number,
    documentId: string,
    propertyId: number,
  ): Promise<Record<string, unknown> | null> {
    const result = await this.stateQuery().findMany({
      where: { identity_key: `${userId}:${documentId}` },
      select: ['id', 'identity_key', 'user_id', 'property_document_id', 'status'],
      populate: {
        user: { fields: ['id'] },
        property: { fields: ['id', 'documentId'] },
      },
      limit: STATE_ROW_LIMIT,
    });
    if (!Array.isArray(result)) throw new UserPropertyStateMalformedError();
    if (result.length === 0) return null;
    if (result.length !== 1) throw new UserPropertyStateMalformedError();
    return assertStateRow(result[0], userId, documentId, propertyId);
  }

  async get(userId: unknown, documentId: unknown): Promise<UserPropertyStateDto> {
    const context = await this.context(userId, documentId);
    const row = await this.findState(context.userId, context.documentId, context.propertyId);
    return row ? toDto(row) : virtualState(context.documentId);
  }

  async put(userId: unknown, documentId: unknown, status: unknown): Promise<UserPropertyStateDto> {
    const normalizedStatus = normalizeStatus(status);
    const context = await this.context(userId, documentId);
    const existing = await this.findState(context.userId, context.documentId, context.propertyId);

    if (normalizedStatus === 'new') {
      if (!existing) return virtualState(context.documentId);
      const deleted = await this.stateQuery().delete({
        where: {
          id: existing.id,
          user_id: context.userId,
          property_document_id: context.documentId,
        },
      });
      if (deleted === null || deleted === undefined) throw new UserPropertyStateConflictError();
      return virtualState(context.documentId);
    }

    if (existing) {
      const updated = await this.stateQuery().update({
        where: {
          id: existing.id,
          user_id: context.userId,
          property_document_id: context.documentId,
        },
        data: { status: normalizedStatus },
      });
      if (updated === null || updated === undefined) throw new UserPropertyStateConflictError();
      return { status: normalizedStatus, property_document_id: context.documentId };
    }

    try {
      const created = await this.stateQuery().create({
        data: {
          identity_key: `${context.userId}:${context.documentId}`,
          user: context.userId,
          property: context.propertyId,
          user_id: context.userId,
          property_document_id: context.documentId,
          status: normalizedStatus,
        },
      });
      if (created === null || created === undefined) throw new UserPropertyStateConflictError();
      return { status: normalizedStatus, property_document_id: context.documentId };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const winner = await this.findState(context.userId, context.documentId, context.propertyId);
      if (winner) return toDto(winner);
      throw error;
    }
  }

  async remove(userId: unknown, documentId: unknown): Promise<UserPropertyStateDto> {
    const context = await this.context(userId, documentId);
    const existing = await this.findState(context.userId, context.documentId, context.propertyId);
    if (!existing) return virtualState(context.documentId);

    const deleted = await this.stateQuery().delete({
      where: {
        id: existing.id,
        user_id: context.userId,
        property_document_id: context.documentId,
      },
    });
    if (deleted === null || deleted === undefined) throw new UserPropertyStateConflictError();
    return virtualState(context.documentId);
  }
}

export function createUserPropertyStateService(
  strapi: UserPropertyStateStrapi,
  options: UserPropertyStateServiceOptions = {},
): UserPropertyStateService {
  return new UserPropertyStateService(strapi, options);
}
