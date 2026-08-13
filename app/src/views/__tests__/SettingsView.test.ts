import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { reactive, ref } from 'vue'
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
vi.mock('@/composables/usePipeline', () => ({
  usePipeline: () => ({
    state: reactive({
      run_id: null, status: 'idle', stage: 'idle', message: '', sources_total: 0, sources_done: 0,
      details_fetched: 0, details_needed: 0, analyze_total: 0, analyze_done: 0,
      undervalued_count: 0, objects_created: 0, digest_scheduled: 0, digest_sent: 0,
      digest_skipped: 0, digest_failed: 0, errors: [],
    }),
    requestError: ref(''),
    isRunning: ref(false),
    start: vi.fn(), cancel: vi.fn(), reset: vi.fn(), checkOnMount: vi.fn(),
  }),
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

  it('shows all seven admin-only tabs and mounts destructive maintenance only after selection', async () => {
    admin = true
    const wrapper = mount(SettingsView)
    await flushPromises()

    expect(wrapper.text()).toContain('Профили пользователей')
    expect(wrapper.text()).toContain('Система')
    expect(wrapper.text()).toContain('Правила')
    expect(wrapper.text()).toContain('Источники')
    expect(wrapper.text()).toContain('Эталоны')
    expect(wrapper.text()).toContain('Пайплайн')
    expect(wrapper.text()).toContain('Обслуживание')
    expect(wrapper.find('[data-testid="admin-pipeline"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="admin-maintenance"]').exists()).toBe(false)

    await wrapper.findAll('button').find(button => button.text().includes('Пайплайн'))!.trigger('click')
    await vi.dynamicImportSettled()
    await flushPromises()
    expect(wrapper.find('[data-testid="admin-pipeline"]').exists()).toBe(true)

    await wrapper.findAll('button').find(button => button.text().includes('Обслуживание'))!.trigger('click')
    await vi.dynamicImportSettled()
    await flushPromises()
    expect(wrapper.find('[data-testid="admin-maintenance"]').exists()).toBe(true)
  })

  it('fails safe to personal profile when a non-admin forces an admin tab', async () => {
    window.location.hash = '#pipeline'
    const wrapper = mount(SettingsView)
    await flushPromises()

    expect(wrapper.find('[data-testid="personal-profile"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('admin-system')
    expect(wrapper.find('[data-testid="admin-pipeline"]').exists()).toBe(false)
    expect(api.get).not.toHaveBeenCalledWith(expect.stringContaining('/setting'))
    expect(api.get).not.toHaveBeenCalledWith(expect.stringContaining('/admin/'))
  })
})
