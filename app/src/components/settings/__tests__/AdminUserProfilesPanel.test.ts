import { describe, expect, it, vi, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import AdminUserProfilesPanel from '../AdminUserProfilesPanel.vue'
import api from '@/api/strapi'

vi.mock('@/api/strapi', () => ({ default: { get: vi.fn(), put: vi.fn() } }))

const selectedProfile = {
  id: 91,
  user_id: 42,
  regions: ['mo'],
  property_types: ['warehouse'],
  price_from: null,
  price_to: 10_000_000,
  area_from: null,
  area_to: null,
  stop_words: [],
  digest_email: 'target@example.test',
  digest_enabled: true,
  profile_version: 8,
}

function setup() {
  ;(api.get as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
    if (url === '/admin/user-profiles?page=1&pageSize=100') {
      return Promise.resolve({
        data: {
          data: [{ user_id: 42, email: 'target@example.test', username: 'target', profile_version: 8 }],
          meta: { pagination: { page: 1, pageSize: 100, pageCount: 1, total: 1 } },
        },
      })
    }
    if (url === '/admin/user-profiles/42') return Promise.resolve({ data: { data: selectedProfile } })
    return Promise.reject(new Error(`Unexpected GET ${url}`))
  })
  ;(api.put as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { data: selectedProfile } })
  return mount(AdminUserProfilesPanel)
}

describe('AdminUserProfilesPanel', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lists with bounded pagination and loads the selected profile by URL user_id', async () => {
    const wrapper = setup()
    await flushPromises()
    expect(api.get).toHaveBeenCalledWith('/admin/user-profiles?page=1&pageSize=100')

    await wrapper.get('[data-testid="profile-user-42"]').trigger('click')
    await flushPromises()
    expect(api.get).toHaveBeenCalledWith('/admin/user-profiles/42')
  })

  it('updates the selected target by URL and never puts target identity in the body', async () => {
    const wrapper = setup()
    await flushPromises()
    await wrapper.get('[data-testid="profile-user-42"]').trigger('click')
    await flushPromises()
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(api.put).toHaveBeenCalledWith('/admin/user-profiles/42', {
      data: {
        expectedVersion: 8,
        regions: ['mo'],
        property_types: ['warehouse'],
        price_from: null,
        price_to: 10_000_000,
        area_from: null,
        area_to: null,
        stop_words: [],
        digest_email: 'target@example.test',
        digest_enabled: true,
      },
    })
    expect(JSON.stringify((api.put as ReturnType<typeof vi.fn>).mock.calls)).not.toContain('user_id')
    expect(JSON.stringify((api.put as ReturnType<typeof vi.fn>).mock.calls)).not.toContain('role')
  })
})
