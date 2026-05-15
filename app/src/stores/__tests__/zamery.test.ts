import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useZameryStore } from '../zamery'

vi.mock('@/api/strapi', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    },
  },
}))

describe('zamery store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('initializes with empty items', () => {
    const store = useZameryStore()
    expect(store.items).toEqual([])
    expect(store.loading).toBe(false)
  })

  it('getById returns undefined for non-existent id', () => {
    const store = useZameryStore()
    expect(store.getById('non-existent')).toBeUndefined()
  })
})
