import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import authenticatedUser from '../authenticated-user';

const originalStrapi = (globalThis as { strapi?: unknown }).strapi;

describe('authenticated-user policy', () => {
  const getToken = vi.fn();
  const fetchAuthenticatedUser = vi.fn();

  beforeEach(() => {
    getToken.mockReset();
    fetchAuthenticatedUser.mockReset();
    (globalThis as any).strapi = {
      plugin: vi.fn().mockReturnValue({
        service: (name: string) => name === 'jwt' ? { getToken } : { fetchAuthenticatedUser },
      }),
    };
  });

  afterEach(() => {
    (globalThis as any).strapi = originalStrapi;
  });

  it('fails closed when no valid bearer token exists', async () => {
    getToken.mockResolvedValue(null);
    const ctx = { request: { header: {} }, state: {} };

    await expect(authenticatedUser(ctx as any)).resolves.toBe(false);
    expect(fetchAuthenticatedUser).not.toHaveBeenCalled();
  });

  it('accepts an active confirmed user and exposes it to the handler', async () => {
    const user = { id: 7, blocked: false, confirmed: true };
    getToken.mockResolvedValue({ id: 7 });
    fetchAuthenticatedUser.mockResolvedValue(user);
    const ctx = { request: { header: { authorization: 'Bearer test' } }, state: {} as Record<string, unknown> };

    await expect(authenticatedUser(ctx as any)).resolves.toBe(true);
    expect(ctx.state.user).toBe(user);
  });

  it('rejects missing, blocked, and unconfirmed users', async () => {
    getToken.mockResolvedValue({ id: 7 });
    const ctx = { request: { header: {} }, state: {} };

    fetchAuthenticatedUser.mockResolvedValueOnce(null);
    await expect(authenticatedUser(ctx as any)).resolves.toBe(false);

    fetchAuthenticatedUser.mockResolvedValueOnce({ id: 7, blocked: true, confirmed: true });
    await expect(authenticatedUser(ctx as any)).resolves.toBe(false);

    fetchAuthenticatedUser.mockResolvedValueOnce({ id: 7, blocked: false, confirmed: false });
    await expect(authenticatedUser(ctx as any)).resolves.toBe(false);
  });

  it('does not let malformed JWT verification errors escape as 500', async () => {
    getToken.mockRejectedValue(new Error('Invalid token'));

    await expect(authenticatedUser({ request: { header: {} }, state: {} } as any)).resolves.toBe(false);
  });
});
