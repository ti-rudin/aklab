import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import aklabAdmin from '../aklab-admin';

const USER_UID = 'plugin::users-permissions.user';
const originalStrapi = (globalThis as { strapi?: unknown }).strapi;

function makeContext(user: unknown, body: unknown = {}) {
  return {
    state: user === undefined ? {} : { user },
    request: { body },
  };
}

describe('aklab-admin policy', () => {
  const findOne = vi.fn();
  const query = vi.fn(() => ({ findOne }));

  beforeEach(() => {
    findOne.mockReset();
    query.mockClear();
    (globalThis as any).strapi = {
      db: { query },
    };
  });

  afterEach(() => {
    (globalThis as any).strapi = originalStrapi;
  });

  it('allows only an active user whose freshly loaded role has the exact admin type', async () => {
    findOne.mockResolvedValue({
      id: 7,
      blocked: false,
      confirmed: true,
      role: { type: 'aklab_admin', name: 'AKLAB Admin' },
    });

    await expect(aklabAdmin(makeContext({
      id: 7,
      blocked: false,
      confirmed: true,
      role: { type: 'authenticated' },
    }, { role: { type: 'aklab_admin' } }) as any)).resolves.toBe(true);

    expect(query).toHaveBeenCalledWith(USER_UID);
    expect(findOne).toHaveBeenCalledWith({
      where: { id: 7 },
      populate: { role: true },
    });
  });

  it('does not trust a stale state role or a forged request body role', async () => {
    findOne.mockResolvedValue({
      id: 7,
      blocked: false,
      confirmed: true,
      role: { type: 'authenticated' },
    });

    await expect(aklabAdmin(makeContext({
      id: 7,
      role: { type: 'aklab_admin' },
    }, { role: { type: 'aklab_admin' } }) as any)).resolves.toBe(false);
  });

  it('fails closed for missing or invalid user IDs without querying by an untrusted value', async () => {
    for (const id of [undefined, null, 0, -1, 1.5, NaN, '7']) {
      findOne.mockClear();
      await expect(aklabAdmin(makeContext({ id }) as any)).resolves.toBe(false);
      expect(findOne).not.toHaveBeenCalled();
    }
  });

  it('fails closed for missing, blocked, unconfirmed, or non-admin fresh users', async () => {
    const ctx = makeContext({ id: 7 });

    for (const freshUser of [
      null,
      { id: 7, blocked: true, confirmed: true, role: { type: 'aklab_admin' } },
      { id: 7, blocked: false, confirmed: false, role: { type: 'aklab_admin' } },
      { id: 7, blocked: false, confirmed: true, role: null },
      { id: 7, blocked: false, confirmed: true },
      { id: 7, blocked: false, confirmed: true, role: { type: 'authenticated' } },
      { id: 7, blocked: false, confirmed: true, role: { name: 'AKLAB Admin' } },
    ]) {
      findOne.mockResolvedValueOnce(freshUser);
      await expect(aklabAdmin(ctx as any)).resolves.toBe(false);
    }
  });

  it('fails closed when the fresh role query errors and does not expose the database error', async () => {
    findOne.mockRejectedValue(new Error('database contains user email secret@example.com'));

    await expect(aklabAdmin(makeContext({ id: 7 }) as any)).resolves.toBe(false);
  });
});
