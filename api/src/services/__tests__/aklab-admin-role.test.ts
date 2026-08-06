import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AKLAB_ADMIN_ROLE_DATA, ensureAklabAdminRole } from '../aklab-admin-role';

const ROLE_UID = 'plugin::users-permissions.role';
const testDir = dirname(fileURLToPath(import.meta.url));

function makeStrapi() {
  const roleQuery = {
    findOne: vi.fn(),
    create: vi.fn(),
  };

  return {
    db: {
      query: vi.fn((uid: string) => {
        if (uid !== ROLE_UID) throw new Error(`unexpected uid: ${uid}`);
        return roleQuery;
      }),
    },
    roleQuery,
  };
}

describe('ensureAklabAdminRole', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the existing role found by exact type without creating or changing it', async () => {
    const strapi = makeStrapi();
    const existing = {
      id: 12,
      name: 'AKLAB Admin',
      description: 'custom persisted description',
      type: 'aklab_admin',
    };
    strapi.roleQuery.findOne.mockResolvedValue(existing);

    await expect(ensureAklabAdminRole(strapi as any)).resolves.toBe(existing);
    expect(strapi.db.query).toHaveBeenCalledWith(ROLE_UID);
    expect(strapi.roleQuery.findOne).toHaveBeenCalledWith({
      where: { type: 'aklab_admin' },
    });
    expect(strapi.roleQuery.create).not.toHaveBeenCalled();
  });

  it('creates the stable role with exactly the approved static data when absent', async () => {
    const strapi = makeStrapi();
    const created = { id: 12, ...AKLAB_ADMIN_ROLE_DATA };
    strapi.roleQuery.findOne.mockResolvedValue(null);
    strapi.roleQuery.create.mockResolvedValue(created);

    await expect(ensureAklabAdminRole(strapi as any)).resolves.toBe(created);
    expect(strapi.roleQuery.create).toHaveBeenCalledWith({
      data: {
        name: 'AKLAB Admin',
        description: AKLAB_ADMIN_ROLE_DATA.description,
        type: 'aklab_admin',
      },
    });
    expect(strapi.roleQuery.create.mock.calls[0][0].data).not.toHaveProperty('users');
    expect(strapi.roleQuery.create.mock.calls[0][0].data).not.toHaveProperty('permissions');
  });

  it('re-reads and returns the winner after a concurrent unique race', async () => {
    const strapi = makeStrapi();
    const winner = { id: 99, ...AKLAB_ADMIN_ROLE_DATA };
    const uniqueError = Object.assign(new Error('UNIQUE constraint failed: up_roles.type'), {
      code: 'SQLITE_CONSTRAINT_UNIQUE',
    });
    strapi.roleQuery.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(winner);
    strapi.roleQuery.create.mockRejectedValue(uniqueError);

    await expect(ensureAklabAdminRole(strapi as any)).resolves.toBe(winner);
    expect(strapi.roleQuery.findOne).toHaveBeenCalledTimes(2);
    expect(strapi.roleQuery.findOne).toHaveBeenLastCalledWith({
      where: { type: 'aklab_admin' },
    });
  });

  it('rethrows the original unique error when no concurrent winner can be read', async () => {
    const strapi = makeStrapi();
    const uniqueError = Object.assign(new Error('UNIQUE constraint failed: up_roles.type'), {
      code: 'SQLITE_CONSTRAINT_UNIQUE',
    });
    strapi.roleQuery.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    strapi.roleQuery.create.mockRejectedValue(uniqueError);

    await expect(ensureAklabAdminRole(strapi as any)).rejects.toBe(uniqueError);
  });

  it('does not swallow a non-unique database error', async () => {
    const strapi = makeStrapi();
    const databaseError = Object.assign(new Error('database is locked'), {
      code: 'SQLITE_BUSY',
    });
    strapi.roleQuery.findOne.mockResolvedValue(null);
    strapi.roleQuery.create.mockRejectedValue(databaseError);

    await expect(ensureAklabAdminRole(strapi as any)).rejects.toBe(databaseError);
    expect(strapi.roleQuery.findOne).toHaveBeenCalledTimes(1);
  });
});

describe('AKLAB Admin role registration seam', () => {
  it('uses Query Engine only and calls role seeding before existing seeders', () => {
    const serviceSource = readFileSync(join(testDir, '..', 'aklab-admin-role.ts'), 'utf8');
    const bootstrapSource = readFileSync(join(testDir, '..', '..', 'index.ts'), 'utf8');

    expect(serviceSource).not.toContain('entityService');
    const roleCall = bootstrapSource.indexOf('await ensureAklabAdminRole');
    const seedersCall = bootstrapSource.indexOf('await runSeeders');
    expect(roleCall).toBeGreaterThanOrEqual(0);
    expect(seedersCall).toBeGreaterThan(roleCall);
  });
});
