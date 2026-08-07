import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAuthStore } from '../auth'
import api from '@/api/strapi'
import { persistAuth, clearPersistedAuth } from '@/stores/auth-helpers'

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
    vi.clearAllMocks()
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

  it('refreshes the typed context after login and derives admin/profile getters only from fresh context', async () => {
    const context = {
      user: { id: 7, username: 'fresh-user', email: 'fresh@example.test' },
      role: { type: 'aklab_admin' },
      profileReady: true,
      multiuserEnabled: true,
    }
    ;(api.post as any).mockResolvedValue({ data: { jwt: 'fresh-token', user: context.user } })
    ;(api.get as any).mockResolvedValue({ data: { data: context } })
    const store = useAuthStore()

    await store.loginWithEmail('fresh@example.test', 'password')

    expect(api.get).toHaveBeenCalledWith('/me/context')
    expect(store.context).toEqual(context)
    expect(store.isAklabAdmin).toBe(true)
    expect(store.profileReady).toBe(true)
    expect(persistAuth).toHaveBeenLastCalledWith(context.user, 'fresh-token')
    expect(JSON.stringify((persistAuth as any).mock.calls)).not.toContain('profileReady')
    expect(localStorage.getItem('authContext')).toBeNull()
  })

  it('ignores a stale local role and uses the freshly loaded context role', async () => {
    localStorage.setItem('user', JSON.stringify({
      id: 7,
      username: 'cached-user',
      email: 'cached@example.test',
      role: { type: 'aklab_admin' },
    }))
    localStorage.setItem('jwt', 'cached-token')
    ;(api.get as any).mockResolvedValue({
      data: {
        data: {
          user: { id: 7, username: 'fresh-user', email: 'fresh@example.test' },
          role: { type: 'authenticated' },
          profileReady: false,
          multiuserEnabled: false,
        },
      },
    })
    const store = useAuthStore()

    await store.init()

    expect(api.get).toHaveBeenCalledWith('/me/context')
    expect(store.isAklabAdmin).toBe(false)
    expect(store.profileReady).toBe(false)
    expect(store.user).toEqual({ id: 7, username: 'fresh-user', email: 'fresh@example.test' })
  })

  it('clears the session on an exact 401 while preserving it on 403 during context refresh', async () => {
    localStorage.setItem('user', JSON.stringify({ id: 7, username: 'cached-user', email: 'cached@example.test' }))
    localStorage.setItem('jwt', 'cached-token')
    ;(api.get as any).mockRejectedValueOnce({ response: { status: 401 } })
    const unauthorized = useAuthStore()

    await unauthorized.init()

    expect(unauthorized.user).toBeNull()
    expect(unauthorized.token).toBeNull()
    expect(unauthorized.status).toBe('out')
    expect(clearPersistedAuth).toHaveBeenCalled()

    setActivePinia(createPinia())
    localStorage.setItem('user', JSON.stringify({ id: 8, username: 'cached-user', email: 'cached@example.test' }))
    localStorage.setItem('jwt', 'cached-token-2')
    ;(api.get as any).mockRejectedValueOnce({ response: { status: 403 } })
    const forbidden = useAuthStore()

    await forbidden.init()

    expect(forbidden.user).toEqual({ id: 8, username: 'cached-user', email: 'cached@example.test' })
    expect(forbidden.token).toBe('cached-token-2')
    expect(forbidden.status).toBe('in')
    expect(clearPersistedAuth).toHaveBeenCalledTimes(1)
  })
})
