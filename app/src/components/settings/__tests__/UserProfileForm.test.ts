import { describe, expect, it, vi, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import UserProfileForm from '../UserProfileForm.vue'
import api from '@/api/strapi'

const refreshContext = vi.fn()
vi.mock('@/api/strapi', () => ({ default: { get: vi.fn(), put: vi.fn() } }))
vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({ refreshContext }),
}))

const profile = {
  id: 11,
  user_id: 42,
  regions: ['moscow'],
  property_types: ['office'],
  price_from: null,
  price_to: null,
  area_from: null,
  area_to: null,
  stop_words: ['земля'],
  digest_email: 'old@example.test',
  digest_enabled: false,
  profile_version: 3,
}

function setup() {
  ;(api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { data: profile } })
  ;(api.put as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { data: { ...profile, profile_version: 4 } } })
  return mount(UserProfileForm)
}

describe('UserProfileForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    refreshContext.mockResolvedValue(undefined)
  })

  it('loads only the current user profile endpoint', async () => {
    setup()
    await flushPromises()

    expect(api.get).toHaveBeenCalledWith('/me/profile')
    expect(api.get).not.toHaveBeenCalledWith('/setting')
  })

  it('saves an explicit profile payload and refreshes auth context', async () => {
    const wrapper = setup()
    await flushPromises()

    await wrapper.get('[data-testid="profile-digest-email"]').setValue('new@example.test')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(api.put).toHaveBeenCalledWith('/me/profile', {
      data: {
        expectedVersion: 3,
        regions: ['moscow'],
        property_types: ['office'],
        price_from: null,
        price_to: null,
        area_from: null,
        area_to: null,
        stop_words: ['земля'],
        digest_email: 'new@example.test',
        digest_enabled: false,
      },
    })
    expect(refreshContext).toHaveBeenCalledTimes(1)
    expect(JSON.stringify((api.put as ReturnType<typeof vi.fn>).mock.calls)).not.toContain('user_id')
  })

  it('keeps the edited draft after a 409 and offers an explicit reload', async () => {
    const wrapper = setup()
    await flushPromises()
    await wrapper.get('[data-testid="profile-digest-email"]').setValue('draft@example.test')
    ;(api.put as ReturnType<typeof vi.fn>).mockRejectedValueOnce({ response: { status: 409 } })

    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.get('[data-testid="profile-digest-email"]').element).toHaveProperty('value', 'draft@example.test')
    expect(wrapper.text()).toContain('изменён')
    expect(wrapper.find('[data-testid="profile-reload"]').exists()).toBe(true)
  })

  it('fails closed on a malformed update acknowledgement', async () => {
    const wrapper = setup()
    await flushPromises()
    ;(api.put as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ data: { data: {} } })

    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(refreshContext).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Некорректный ответ профиля')
    expect(wrapper.text()).not.toContain('Профиль сохранён')
  })
})
