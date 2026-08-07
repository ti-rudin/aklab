import {
  createUserPropertyScopeRepository,
  UserPropertyScopeError,
  type UserPropertyScopeStrapi,
} from './user-property-scope';

const COMMENT_UID = 'api::user-comment.user-comment';
const PROPERTY_UID = 'api::property.property';
const MAX_DOCUMENT_ID_LENGTH = 128;
const MAX_COMMENT_TEXT_LENGTH = 5000;

export const USER_COMMENT_SELECT = ['id', 'text', 'createdAt', 'updatedAt'] as const;

export type UserCommentDto = {
  id: number;
  text: string;
  createdAt: string | null;
  updatedAt: string | null;
};

export type UserCommentListResult = { data: UserCommentDto[] };
export type UserCommentResult = { data: UserCommentDto };

export interface UserCommentScopeRepository {
  detail(userId: unknown, documentId: string, request?: unknown): Promise<unknown | null>;
}

interface UserCommentQuery {
  findMany: (args: unknown) => Promise<unknown>;
  findOne: (args: unknown) => Promise<unknown>;
  create: (args: unknown) => Promise<unknown>;
  update: (args: unknown) => Promise<unknown>;
  delete: (args: unknown) => Promise<unknown>;
}

interface UserCommentStrapi {
  db: {
    query: (uid: string) => UserCommentQuery;
  };
}

type RecordValue = Record<string, unknown>;

type PropertyRef = {
  id: number;
  documentId: string;
};

export class UserCommentError extends Error {
  readonly code: string;

  constructor(name: string, code: string, message: string) {
    super(message);
    this.name = name;
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class UserCommentValidationError extends UserCommentError {
  constructor() {
    super('UserCommentValidationError', 'USER_COMMENT_VALIDATION_ERROR', 'Invalid user comment input.');
  }
}

export class UserCommentNotFoundError extends UserCommentError {
  constructor() {
    super('UserCommentNotFoundError', 'USER_COMMENT_NOT_FOUND', 'User comment was not found.');
  }
}

export class UserCommentConflictError extends UserCommentError {
  constructor() {
    super('UserCommentConflictError', 'USER_COMMENT_CONFLICT', 'User comment changed concurrently.');
  }
}

export class UserCommentQueryError extends UserCommentError {
  constructor() {
    super('UserCommentQueryError', 'USER_COMMENT_QUERY_ERROR', 'User comment query failed.');
  }
}

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export function validateUserCommentDocumentId(value: unknown): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > MAX_DOCUMENT_ID_LENGTH
    || value !== value.trim()
  ) {
    throw new UserCommentValidationError();
  }
  return value;
}

export function validateUserCommentId(value: unknown): number {
  if (typeof value === 'number') {
    if (!isPositiveSafeInteger(value)) throw new UserCommentValidationError();
    return value;
  }
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new UserCommentValidationError();
  }
  const parsed = Number(value);
  if (!isPositiveSafeInteger(parsed)) throw new UserCommentValidationError();
  return parsed;
}

export function validateUserCommentText(value: unknown): string {
  if (typeof value !== 'string') throw new UserCommentValidationError();
  const text = value.trim();
  if (text.length === 0 || text.length > MAX_COMMENT_TEXT_LENGTH) {
    throw new UserCommentValidationError();
  }
  return text;
}

function timestamp(value: unknown): string | null {
  if (value === null || typeof value === 'string') return value;
  throw new UserCommentQueryError();
}

function toCommentDto(value: unknown): UserCommentDto {
  if (!isRecord(value) || !isPositiveSafeInteger(value.id) || typeof value.text !== 'string') {
    throw new UserCommentQueryError();
  }
  return {
    id: value.id,
    text: value.text,
    createdAt: timestamp(value.createdAt),
    updatedAt: timestamp(value.updatedAt),
  };
}

function relationId(value: unknown): number | null {
  return isRecord(value) && isPositiveSafeInteger(value.id) ? value.id : null;
}

function propertyRef(value: unknown): PropertyRef | null {
  if (!isRecord(value) || !isPositiveSafeInteger(value.id) || typeof value.documentId !== 'string') {
    return null;
  }
  return { id: value.id, documentId: value.documentId };
}

function commentRelationsMatch(
  value: unknown,
  actorId: number,
  propertyId: number,
  documentId: string,
): boolean {
  if (!isRecord(value)) return false;
  const authorId = relationId(value.author);
  const property = propertyRef(value.property);
  return authorId === actorId && property?.id === propertyId && property.documentId === documentId;
}

export class UserCommentService {
  constructor(
    private readonly strapi: UserCommentStrapi,
    private readonly scope: UserCommentScopeRepository,
  ) {}

  private get commentQuery(): UserCommentQuery {
    return this.strapi.db.query(COMMENT_UID);
  }

  private get propertyQuery(): UserCommentQuery {
    return this.strapi.db.query(PROPERTY_UID);
  }

  private async canonicalProperty(actorId: unknown, documentId: unknown): Promise<PropertyRef> {
    if (!isPositiveSafeInteger(actorId)) throw new UserCommentValidationError();
    const canonicalDocumentId = validateUserCommentDocumentId(documentId);

    let visible: unknown;
    try {
      visible = await this.scope.detail(actorId, canonicalDocumentId);
    } catch (error) {
      if (error instanceof UserPropertyScopeError) throw new UserCommentNotFoundError();
      throw new UserCommentQueryError();
    }
    if (visible === null || visible === undefined) throw new UserCommentNotFoundError();

    let property: unknown;
    try {
      property = await this.propertyQuery.findOne({
        where: { documentId: canonicalDocumentId },
        select: ['id', 'documentId'],
      });
    } catch {
      throw new UserCommentQueryError();
    }
    if (
      !isRecord(property)
      || !isPositiveSafeInteger(property.id)
      || property.documentId !== canonicalDocumentId
    ) {
      throw new UserCommentNotFoundError();
    }
    return { id: property.id, documentId: canonicalDocumentId };
  }

  private async readOwnedComment(
    actorId: number,
    property: PropertyRef,
    commentId: number,
  ): Promise<RecordValue | null> {
    let comment: unknown;
    try {
      comment = await this.commentQuery.findOne({
        where: { id: commentId },
        select: [...USER_COMMENT_SELECT],
        populate: {
          author: { select: ['id'] },
          property: { select: ['id', 'documentId'] },
        },
      });
    } catch {
      throw new UserCommentQueryError();
    }
    if (comment === null || comment === undefined) return null;
    return commentRelationsMatch(comment, actorId, property.id, property.documentId)
      ? comment as RecordValue
      : null;
  }

  private async requireOwnedComment(
    actorId: number,
    property: PropertyRef,
    commentId: number,
  ): Promise<RecordValue> {
    const comment = await this.readOwnedComment(actorId, property, commentId);
    if (!comment) throw new UserCommentNotFoundError();
    return comment;
  }

  async list(actorId: unknown, documentId: unknown): Promise<UserCommentListResult> {
    const property = await this.canonicalProperty(actorId, documentId);
    let rows: unknown;
    try {
      rows = await this.commentQuery.findMany({
        where: { property: { id: property.id }, author: { id: actorId } },
        select: [...USER_COMMENT_SELECT],
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
    } catch {
      throw new UserCommentQueryError();
    }
    if (!Array.isArray(rows)) throw new UserCommentQueryError();
    return { data: rows.map(toCommentDto) };
  }

  async create(actorId: unknown, documentId: unknown, text: unknown): Promise<UserCommentResult> {
    if (!isPositiveSafeInteger(actorId)) throw new UserCommentValidationError();
    const normalizedText = validateUserCommentText(text);
    const property = await this.canonicalProperty(actorId, documentId);
    let created: unknown;
    try {
      created = await this.commentQuery.create({
        data: {
          text: normalizedText,
          author: actorId,
          property: property.id,
        },
      });
    } catch {
      throw new UserCommentQueryError();
    }
    return { data: toCommentDto(created) };
  }

  async update(
    actorId: unknown,
    documentId: unknown,
    commentId: unknown,
    text: unknown,
  ): Promise<UserCommentResult> {
    if (!isPositiveSafeInteger(actorId)) throw new UserCommentValidationError();
    const canonicalDocumentId = validateUserCommentDocumentId(documentId);
    const normalizedCommentId = validateUserCommentId(commentId);
    const normalizedText = validateUserCommentText(text);
    const property = await this.canonicalProperty(actorId, canonicalDocumentId);
    await this.requireOwnedComment(actorId, property, normalizedCommentId);

    let updated: unknown;
    try {
      updated = await this.commentQuery.update({
        where: {
          id: normalizedCommentId,
          property: { id: property.id },
          author: { id: actorId },
        },
        data: { text: normalizedText },
      });
    } catch {
      throw new UserCommentQueryError();
    }
    if (updated !== null && updated !== undefined) return { data: toCommentDto(updated) };

    const fresh = await this.readOwnedComment(actorId, property, normalizedCommentId);
    if (fresh) throw new UserCommentConflictError();
    throw new UserCommentNotFoundError();
  }

  async delete(actorId: unknown, documentId: unknown, commentId: unknown): Promise<UserCommentResult> {
    if (!isPositiveSafeInteger(actorId)) throw new UserCommentValidationError();
    const canonicalDocumentId = validateUserCommentDocumentId(documentId);
    const normalizedCommentId = validateUserCommentId(commentId);
    const property = await this.canonicalProperty(actorId, canonicalDocumentId);
    await this.requireOwnedComment(actorId, property, normalizedCommentId);

    let deleted: unknown;
    try {
      deleted = await this.commentQuery.delete({
        where: {
          id: normalizedCommentId,
          property: { id: property.id },
          author: { id: actorId },
        },
      });
    } catch {
      throw new UserCommentQueryError();
    }
    if (deleted !== null && deleted !== undefined) return { data: toCommentDto(deleted) };

    const fresh = await this.readOwnedComment(actorId, property, normalizedCommentId);
    if (fresh) throw new UserCommentConflictError();
    throw new UserCommentNotFoundError();
  }
}

export function createUserCommentService(
  strapi: UserCommentStrapi & UserPropertyScopeStrapi,
  scope?: UserCommentScopeRepository,
): UserCommentService {
  return new UserCommentService(
    strapi,
    scope || createUserPropertyScopeRepository(strapi),
  );
}
