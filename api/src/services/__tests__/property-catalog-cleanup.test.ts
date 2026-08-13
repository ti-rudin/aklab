import { describe, expect, it, vi } from 'vitest';
import {
  CatalogCleanupBusyError,
  CatalogCleanupConfirmationError,
  CatalogCleanupProtectedDataError,
  clearPropertyCatalog,
} from '../property-catalog-cleanup';

const CONFIRMATION = 'CLEAR_ALL_PROPERTIES';

function makeHarness(options: {
  lockAcquired?: boolean;
  pending?: number;
  active?: number;
  protectedDrift?: boolean;
  photoFailure?: boolean;
  duplicatePhotoId?: boolean;
} = {}) {
  const operations: string[] = [];
  const protectedUids = new Set([
    'plugin::users-permissions.user',
    'api::user-profile.user-profile',
    'api::setting.setting',
    'api::source.source',
    'api::focus-rule.focus-rule',
    'api::market-reference.market-reference',
  ]);
  const protectedCalls = new Map<string, number>();
  const deleteCounts: Record<string, number> = {
    'api::user-property-state.user-property-state': 3,
    'api::user-comment.user-comment': 4,
    'api::property-event.property-event': 5,
    'api::property.property': 2,
  };

  const strapi = {
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    db: {
      query: vi.fn((uid: string) => ({
        count: vi.fn(async () => {
          const call = protectedCalls.get(uid) ?? 0;
          protectedCalls.set(uid, call + 1);
          if (options.protectedDrift && uid === 'api::source.source' && call > 0) return 1;
          return protectedUids.has(uid) ? 2 : 0;
        }),
        findMany: vi.fn(async () => uid === 'api::property.property'
          ? [
            { documentId: 'doc-a' },
            { documentId: options.duplicatePhotoId ? 'doc-a' : 'doc-b' },
          ]
          : []),
        deleteMany: vi.fn(async () => {
          operations.push(uid);
          return { count: deleteCounts[uid] ?? 0 };
        }),
      })),
      transaction: vi.fn(async (callback: (context: Record<string, unknown>) => Promise<void>) => {
        await callback({ trx: {}, rollback: vi.fn(), commit: vi.fn(), onCommit: vi.fn(), onRollback: vi.fn() });
      }),
    },
  };

  const removePhotoDirectory = vi.fn(async (documentId: string) => {
    if (options.photoFailure && documentId === 'doc-b') throw new Error('disk failure');
    return true;
  });
  const deps = {
    maintenanceModeEnabled: vi.fn(() => true),
    acquireMaintenanceLock: vi.fn(async () => options.lockAcquired ?? true),
    releaseMaintenanceLock: vi.fn(async () => true),
    getQueueStats: vi.fn(async () => ({
      total: {
        pending: options.pending ?? 0,
        active: options.active ?? 0,
        completed: 0,
        failed: 0,
      },
      queues: {},
      dbSizeBytes: 0,
    })),
    removePhotoDirectory,
  };

  return { strapi, deps, operations, removePhotoDirectory };
}

describe('property catalog cleanup', () => {
  it('rejects an inexact confirmation before reading runtime state', async () => {
    const { strapi, deps } = makeHarness();

    await expect(clearPropertyCatalog(strapi as never, { confirmation: 'clear' }, deps))
      .rejects.toBeInstanceOf(CatalogCleanupConfirmationError);

    expect(deps.acquireMaintenanceLock).not.toHaveBeenCalled();
    expect(strapi.db.transaction).not.toHaveBeenCalled();
  });

  it('rejects cleanup unless server maintenance mode was enabled after stopping writers', async () => {
    const { strapi, deps } = makeHarness();
    deps.maintenanceModeEnabled.mockReturnValue(false);

    await expect(clearPropertyCatalog(strapi as never, { confirmation: CONFIRMATION }, deps))
      .rejects.toBeInstanceOf(CatalogCleanupBusyError);

    expect(deps.acquireMaintenanceLock).not.toHaveBeenCalled();
    expect(strapi.db.transaction).not.toHaveBeenCalled();
  });

  it.each([
    ['non-idle lifecycle lock', { lockAcquired: false }],
    ['pending queue jobs', { pending: 1 }],
    ['active queue jobs', { active: 1 }],
  ])('fails closed for %s', async (_label, options) => {
    const { strapi, deps } = makeHarness(options);

    await expect(clearPropertyCatalog(strapi as never, { confirmation: CONFIRMATION }, deps))
      .rejects.toBeInstanceOf(CatalogCleanupBusyError);

    expect(strapi.db.transaction).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { total: { pending: 0 } },
    { total: { pending: Number.NaN, active: 0 } },
    { total: { pending: 0, active: -1 } },
    { total: { pending: 0, active: 0, processing: 1 } },
    {
      total: { pending: 0, active: 0 },
      queues: { parser: { pending: 0, active: 1, completed: 0, failed: 0 } },
    },
  ])('fails closed for malformed or inconsistent queue stats %#', async (stats) => {
    const { strapi, deps } = makeHarness();
    deps.getQueueStats.mockResolvedValue(stats as never);

    await expect(clearPropertyCatalog(strapi as never, { confirmation: CONFIRMATION }, deps))
      .rejects.toBeInstanceOf(CatalogCleanupBusyError);

    expect(strapi.db.transaction).not.toHaveBeenCalled();
  });

  it('rechecks runtime quiescence inside the transaction before the first delete', async () => {
    const { strapi, deps, operations } = makeHarness();
    deps.getQueueStats
      .mockResolvedValueOnce({ total: { pending: 0, active: 0, completed: 0, failed: 0 }, queues: {}, dbSizeBytes: 0 })
      .mockResolvedValueOnce({ total: { pending: 0, active: 1, completed: 0, failed: 0 }, queues: {}, dbSizeBytes: 0 });

    await expect(clearPropertyCatalog(strapi as never, { confirmation: CONFIRMATION }, deps))
      .rejects.toBeInstanceOf(CatalogCleanupBusyError);

    expect(strapi.db.transaction).toHaveBeenCalledTimes(1);
    expect(operations).toEqual([]);
    expect(deps.releaseMaintenanceLock).toHaveBeenCalledTimes(1);
  });

  it('deletes only the approved object graph child-to-parent and preserves protected counts', async () => {
    const { strapi, deps, operations, removePhotoDirectory } = makeHarness();

    const result = await clearPropertyCatalog(strapi as never, { confirmation: CONFIRMATION }, deps);

    expect(operations).toEqual([
      'api::user-property-state.user-property-state',
      'api::user-comment.user-comment',
      'api::property-event.property-event',
      'api::property.property',
    ]);
    expect(result.deleted).toEqual({
      user_property_states: 3,
      user_comments: 4,
      property_events: 5,
      properties: 2,
    });
    expect(result.protected_before).toEqual(result.protected_after);
    expect(removePhotoDirectory).toHaveBeenCalledTimes(2);
    expect(result.photos).toEqual({ attempted: 2, deleted: 2, failed: 0 });
    expect(result).not.toHaveProperty('reparse_started');
    expect(strapi.log.info).toHaveBeenCalledWith('property_catalog_cleanup_completed', {
      deleted: result.deleted,
      protected_before: result.protected_before,
      protected_after: result.protected_after,
      photos: result.photos,
    });
    expect(JSON.stringify(strapi.log.info.mock.calls)).not.toContain('doc-a');
    expect(JSON.stringify(strapi.log.info.mock.calls)).not.toContain('doc-b');
  });

  it('rejects protected-data drift before post-commit filesystem cleanup', async () => {
    const { strapi, deps, removePhotoDirectory } = makeHarness({ protectedDrift: true });

    await expect(clearPropertyCatalog(strapi as never, { confirmation: CONFIRMATION }, deps))
      .rejects.toBeInstanceOf(CatalogCleanupProtectedDataError);

    expect(removePhotoDirectory).not.toHaveBeenCalled();
  });

  it('aborts on a child delete failure before parent deletion, media cleanup, or success audit', async () => {
    const { strapi, deps, operations, removePhotoDirectory } = makeHarness();
    strapi.db.query.mockImplementation((uid: string) => ({
      count: vi.fn(async () => 2),
      findMany: vi.fn(async () => uid === 'api::property.property'
        ? [{ documentId: 'doc-a' }, { documentId: 'doc-b' }]
        : []),
      deleteMany: vi.fn(async () => {
        operations.push(`delete:${uid}`);
        if (uid === 'api::user-comment.user-comment') throw new Error('db failure');
        return { count: 1 };
      }),
    }));

    await expect(clearPropertyCatalog(strapi as never, { confirmation: CONFIRMATION }, deps))
      .rejects.toThrow('db failure');

    expect(operations).toEqual([
      'delete:api::user-property-state.user-property-state',
      'delete:api::user-comment.user-comment',
    ]);
    expect(removePhotoDirectory).not.toHaveBeenCalled();
    expect(strapi.log.info).not.toHaveBeenCalled();
  });

  it('reports bounded post-commit photo cleanup failures without exposing filesystem paths', async () => {
    const { strapi, deps } = makeHarness({ photoFailure: true });

    const result = await clearPropertyCatalog(strapi as never, { confirmation: CONFIRMATION }, deps);

    expect(result.photos).toEqual({ attempted: 2, deleted: 1, failed: 1 });
    expect(JSON.stringify(result)).not.toContain('/private/photos/doc-b');
    expect(JSON.stringify(result)).not.toContain('disk failure');
  });

  it('does not count an already absent photo directory as deleted', async () => {
    const { strapi, deps } = makeHarness();
    deps.removePhotoDirectory
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    const result = await clearPropertyCatalog(strapi as never, { confirmation: CONFIRMATION }, deps);

    expect(result.photos).toEqual({ attempted: 2, deleted: 1, failed: 0 });
  });

  it('deduplicates property document ids before media cleanup and counters', async () => {
    const { strapi, deps, removePhotoDirectory } = makeHarness({ duplicatePhotoId: true });

    const result = await clearPropertyCatalog(strapi as never, { confirmation: CONFIRMATION }, deps);

    expect(removePhotoDirectory).toHaveBeenCalledTimes(1);
    expect(removePhotoDirectory).toHaveBeenCalledWith('doc-a');
    expect(result.photos).toEqual({ attempted: 1, deleted: 1, failed: 0 });
  });

  it('does not emit a completed audit when the owned maintenance lease cannot be released', async () => {
    const { strapi, deps } = makeHarness();
    deps.releaseMaintenanceLock.mockResolvedValue(false);

    await expect(clearPropertyCatalog(strapi as never, { confirmation: CONFIRMATION }, deps))
      .rejects.toThrow('lifecycle release failed');

    expect(strapi.log.info).not.toHaveBeenCalled();
  });
});
