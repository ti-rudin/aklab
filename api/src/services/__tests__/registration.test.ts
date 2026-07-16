import { describe, expect, it, vi } from 'vitest';
import { disablePublicRegistration } from '../registration';

describe('disablePublicRegistration', () => {
  it('preserves plugin settings while preventing public account registration', async () => {
    const set = vi.fn().mockResolvedValue(undefined);
    const store = {
      get: vi.fn().mockResolvedValue({
        unique_email: true,
        allow_register: true,
        email_confirmation: false,
        default_role: 'authenticated',
      }),
      set,
    };
    const strapi = { store: vi.fn().mockReturnValue(store) };

    await disablePublicRegistration(strapi as any);

    expect(strapi.store).toHaveBeenCalledWith({ type: 'plugin', name: 'users-permissions' });
    expect(set).toHaveBeenCalledWith({
      key: 'advanced',
      value: {
        unique_email: true,
        allow_register: false,
        email_confirmation: false,
        default_role: 'authenticated',
      },
    });
  });

  it('fails closed when the users-permissions advanced settings are unavailable', async () => {
    const store = { get: vi.fn().mockResolvedValue(null), set: vi.fn() };

    await expect(disablePublicRegistration({ store: vi.fn().mockReturnValue(store) } as any))
      .rejects.toThrow('users-permissions advanced settings are unavailable');
    expect(store.set).not.toHaveBeenCalled();
  });
});
