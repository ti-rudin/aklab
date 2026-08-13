import { lstat, rm } from 'fs/promises';
import { randomUUID } from 'node:crypto';
import type { StrapiInstance } from '../types/strapi';
import { resolvePhotoDirectory } from './photo-storage';
import { getQueueService } from './queueService';
import { emptyState, tryAcquireIdleState, tryReleaseOwnedState } from './pipeline/state';

export const PROPERTY_CATALOG_CLEAR_CONFIRMATION = 'CLEAR_ALL_PROPERTIES';

export function isCatalogCleanupMaintenanceModeEnabled(): boolean {
  return process.env.AKLAB_CATALOG_CLEANUP_MAINTENANCE_MODE === 'enabled';
}

const PROTECTED_UIDS = {
  users: 'plugin::users-permissions.user',
  user_profiles: 'api::user-profile.user-profile',
  settings: 'api::setting.setting',
  sources: 'api::source.source',
  focus_rules: 'api::focus-rule.focus-rule',
  market_references: 'api::market-reference.market-reference',
} as const;

const DELETE_GRAPH = [
  ['user_property_states', 'api::user-property-state.user-property-state'],
  ['user_comments', 'api::user-comment.user-comment'],
  ['property_events', 'api::property-event.property-event'],
  ['properties', 'api::property.property'],
] as const;

type ProtectedCounts = Record<keyof typeof PROTECTED_UIDS, number>;
type DeletedCounts = Record<(typeof DELETE_GRAPH)[number][0], number>;

interface CleanupInput {
  confirmation?: unknown;
}

interface CleanupDependencies {
  maintenanceModeEnabled: () => boolean;
  acquireMaintenanceLock: (strapi: StrapiInstance, runId: string) => Promise<boolean>;
  releaseMaintenanceLock: (strapi: StrapiInstance, runId: string) => Promise<boolean>;
  getQueueStats: () => Promise<unknown> | unknown;
  removePhotoDirectory: (documentId: string) => Promise<boolean>;
}

export interface PropertyCatalogCleanupResult {
  deleted: DeletedCounts;
  protected_before: ProtectedCounts;
  protected_after: ProtectedCounts;
  photos: {
    attempted: number;
    deleted: number;
    failed: number;
  };
}

export class CatalogCleanupConfirmationError extends Error {
  constructor() {
    super(`confirmation must equal ${PROPERTY_CATALOG_CLEAR_CONFIRMATION}`);
    this.name = 'CatalogCleanupConfirmationError';
  }
}

export class CatalogCleanupBusyError extends Error {
  constructor() {
    super('property catalog cleanup requires an idle pipeline and empty live queues');
    this.name = 'CatalogCleanupBusyError';
  }
}

export class CatalogCleanupProtectedDataError extends Error {
  constructor() {
    super('protected catalog counts changed during property cleanup');
    this.name = 'CatalogCleanupProtectedDataError';
  }
}

function safeCount(value: unknown): number {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  if (value && typeof value === 'object' && 'count' in value) {
    return safeCount((value as { count?: unknown }).count);
  }
  return 0;
}

async function readProtectedCounts(strapi: StrapiInstance): Promise<ProtectedCounts> {
  const entries = await Promise.all(
    Object.entries(PROTECTED_UIDS).map(async ([name, uid]) => {
      const count = await strapi.db.query(uid).count();
      return [name, safeCount(count)] as const;
    }),
  );
  return Object.fromEntries(entries) as ProtectedCounts;
}

function protectedCountsEqual(before: ProtectedCounts, after: ProtectedCounts): boolean {
  return (Object.keys(PROTECTED_UIDS) as Array<keyof ProtectedCounts>)
    .every((key) => before[key] === after[key]);
}

function strictQueueCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function liveQueueCount(stats: unknown): number | null {
  if (!isRecord(stats) || !isRecord(stats.total)) return null;
  const pending = strictQueueCount(stats.total.pending);
  const active = strictQueueCount(stats.total.active);
  if (pending === null || active === null) return null;

  for (const [key, value] of Object.entries(stats.total)) {
    if (key === 'pending' || key === 'active' || key === 'completed' || key === 'failed') continue;
    const count = strictQueueCount(value);
    if (count === null || count > 0) return null;
  }

  if (stats.queues !== undefined) {
    if (!isRecord(stats.queues)) return null;
    let perQueuePending = 0;
    let perQueueActive = 0;
    for (const queue of Object.values(stats.queues)) {
      if (!isRecord(queue)) return null;
      const queuePending = strictQueueCount(queue.pending);
      const queueActive = strictQueueCount(queue.active);
      if (queuePending === null || queueActive === null) return null;
      perQueuePending += queuePending;
      perQueueActive += queueActive;
    }
    if (perQueuePending !== pending || perQueueActive !== active) return null;
  }

  return pending + active;
}

async function assertRuntimeQuiescent(
  dependencies: CleanupDependencies,
): Promise<void> {
  const queueStats = await dependencies.getQueueStats();
  const queueLive = liveQueueCount(queueStats);
  if (queueLive === null || queueLive > 0) {
    throw new CatalogCleanupBusyError();
  }
}

const defaultDependencies: CleanupDependencies = {
  maintenanceModeEnabled: isCatalogCleanupMaintenanceModeEnabled,
  acquireMaintenanceLock: async (strapi, runId) => {
    const now = new Date().toISOString();
    return tryAcquireIdleState(strapi, {
      ...emptyState(),
      run_id: runId,
      status: 'cancelling',
      stage: 'idle',
      message: 'Выполняется очистка каталога объектов.',
      started_at: now,
      updated_at: now,
    });
  },
  releaseMaintenanceLock: async (strapi, runId) => tryReleaseOwnedState(strapi, runId, {
    ...emptyState(),
    updated_at: new Date().toISOString(),
  }),
  getQueueStats: () => getQueueService().getDetailedStats(),
  removePhotoDirectory: async (documentId) => {
    const directory = resolvePhotoDirectory(documentId);
    try {
      await lstat(directory);
    } catch (error: unknown) {
      if ((error as { code?: unknown })?.code === 'ENOENT') return false;
      throw error;
    }
    await rm(directory, { recursive: true, force: true });
    return true;
  },
};

export async function clearPropertyCatalog(
  strapi: StrapiInstance,
  input: CleanupInput,
  dependencies: CleanupDependencies = defaultDependencies,
): Promise<PropertyCatalogCleanupResult> {
  if (input.confirmation !== PROPERTY_CATALOG_CLEAR_CONFIRMATION) {
    throw new CatalogCleanupConfirmationError();
  }
  if (!dependencies.maintenanceModeEnabled()) throw new CatalogCleanupBusyError();

  const maintenanceRunId = `catalog-cleanup:${randomUUID()}`;
  const acquired = await dependencies.acquireMaintenanceLock(strapi, maintenanceRunId);
  if (!acquired) throw new CatalogCleanupBusyError();

  let mutationStarted = false;
  try {
    await assertRuntimeQuiescent(dependencies);

    let deleted: DeletedCounts | undefined;
    let protectedBefore: ProtectedCounts | undefined;
    let protectedAfter: ProtectedCounts | undefined;
    let photoDocumentIds: string[] = [];

    await strapi.db.transaction(async () => {
      await assertRuntimeQuiescent(dependencies);
      protectedBefore = await readProtectedCounts(strapi);

      const propertyRows = await strapi.db.query('api::property.property').findMany({
        select: ['documentId'],
      });
      photoDocumentIds = Array.isArray(propertyRows)
        ? [...new Set(propertyRows
          .map((row) => row?.documentId)
          .filter((value): value is string => typeof value === 'string' && value.length > 0))]
        : [];

      const deletedEntries: Array<readonly [string, number]> = [];
      mutationStarted = true;
      for (const [name, uid] of DELETE_GRAPH) {
        const deleteResult = await strapi.db.query(uid).deleteMany({ where: {} });
        deletedEntries.push([name, safeCount(deleteResult)] as const);
      }
      deleted = Object.fromEntries(deletedEntries) as DeletedCounts;

      protectedAfter = await readProtectedCounts(strapi);
      if (!protectedCountsEqual(protectedBefore, protectedAfter)) {
        throw new CatalogCleanupProtectedDataError();
      }
    });

    if (!deleted || !protectedBefore || !protectedAfter) {
      throw new Error('property catalog cleanup transaction did not complete');
    }

    let photosDeleted = 0;
    let photosFailed = 0;
    for (const documentId of photoDocumentIds) {
      try {
        const removed = await dependencies.removePhotoDirectory(documentId);
        if (removed) photosDeleted += 1;
      } catch {
        photosFailed += 1;
      }
    }

    const result: PropertyCatalogCleanupResult = {
      deleted,
      protected_before: protectedBefore,
      protected_after: protectedAfter,
      photos: {
        attempted: photoDocumentIds.length,
        deleted: photosDeleted,
        failed: photosFailed,
      },
    };

    const released = await dependencies.releaseMaintenanceLock(strapi, maintenanceRunId);
    if (!released) throw new Error('property catalog cleanup lifecycle release failed');
    strapi.log.info('property_catalog_cleanup_completed', result);
    return result;
  } catch (error) {
    if (!mutationStarted) {
      try {
        const released = await dependencies.releaseMaintenanceLock(strapi, maintenanceRunId);
        if (!released) strapi.log.warn('property_catalog_cleanup_lock_release_failed');
      } catch {
        strapi.log.warn('property_catalog_cleanup_lock_release_failed');
      }
    }
    throw error;
  }
}
