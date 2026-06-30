import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAuthStore } from '../auth'

vi.mock('@/stores/auth-helpers', () => ({
  persistAuth: vi.fn(),
  clearPersistedAuth: vi.fn(),
  parseAuthError: vi.fn((e: any) => e?.message || 'Error'),
}));

vi.mock('@/api/strapi', () => ({
  default: {
    post: vi.fn(),
    get: vi.fn(),
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    },
  },
}))

describe('auth store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('initializes with null user and token', () => {
    const store = useAuthStore()
    expect(store.user).toBeNull()
    expect(store.token).toBeNull()
  })

  it('isAuthenticated returns false when no user', () => {
    const store = useAuthStore()
    expect(store.isAuthenticated).toBe(false)
  })

  it('logout clears user and token', async () => {
    const store = useAuthStore()
    store.user = { id: 1, email: 'test@test.com', username: 'test' }
    store.token = 'some-token'
    await store.logout()
    expect(store.user).toBeNull()
    expect(store.token).toBeNull()
  })
})
