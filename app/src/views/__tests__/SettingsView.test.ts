import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import SettingsView from '../SettingsView.vue'
import api from '@/api/strapi'

const push = vi.fn()
const logout = vi.fn()
let admin = false

vi.mock('@/api/strapi', () => ({ default: { get: vi.fn(), put: vi.fn(), post: vi.fn() } }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))
vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    get isAklabAdmin() {
      return admin
    },
    logout,
  }),
}))

vi.mock('@/components/settings/UserProfileForm.vue', () => ({
  default: { template: '<div data-testid="personal-profile">personal</div>' },
}))
vi.mock('@/components/settings/AdminUserProfilesPanel.vue', () => ({
  default: { template: '<div data-testid="admin-profiles">profiles</div>' },
}))
vi.mock('@/components/settings/SystemSettingsPanel.vue', () => ({
  default: { template: '<div data-testid="admin-system">system</div>' },
}))
vi.mock('@/components/settings/RulesPanel.vue', () => ({
  default: { template: '<div data-testid="admin-rules">rules</div>' },
}))
vi.mock('@/components/settings/SourcesPanel.vue', () => ({
  default: { template: '<div data-testid="admin-sources">sources</div>' },
}))
vi.mock('@/components/settings/MarketReferencesPanel.vue', () => ({
  default: { template: '<div data-testid="admin-references">references</div>' },
}))

describe('SettingsView', () => {
  beforeEach(() => {
    admin = false
    window.location.hash = ''
    vi.clearAllMocks()
  })

  it('defaults every user to personal profile and makes no admin requests or mounts', async () => {
    const wrapper = mount(SettingsView)
    await flushPromises()

    expect(wrapper.find('[data-testid="personal-profile"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('Системные настройки')
    expect(wrapper.text()).not.toContain('Профили пользователей')
    expect(api.get).not.toHaveBeenCalledWith(expect.stringContaining('/setting'))
    expect(api.get).not.toHaveBeenCalledWith(expect.stringContaining('/admin/'))
  })

  it('shows all five admin-only tabs for an admin, but no pipeline tab', async () => {
    admin = true
    const wrapper = mount(SettingsView)
    await flushPromises()

    expect(wrapper.text()).toContain('Профили пользователей')
    expect(wrapper.text()).toContain('Система')
    expect(wrapper.text()).toContain('Правила')
    expect(wrapper.text()).toContain('Источники')
    expect(wrapper.text()).toContain('Эталоны')
    expect(wrapper.text()).not.toContain('Пайплайн')
  })

  it('fails safe to personal profile when a non-admin forces an admin tab', async () => {
    window.location.hash = '#system'
    const wrapper = mount(SettingsView)
    await flushPromises()

    expect(wrapper.find('[data-testid="personal-profile"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('admin-system')
    expect(api.get).not.toHaveBeenCalledWith(expect.stringContaining('/setting'))
    expect(api.get).not.toHaveBeenCalledWith(expect.stringContaining('/admin/'))
  })
})
