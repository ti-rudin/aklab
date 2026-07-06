import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import PropertyListView from '../PropertyListView.vue'

vi.mock('@/api/strapi', () => ({ default: { get: vi.fn(), post: vi.fn() } }))

const mockPush = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useRoute: () => ({ params: {}, hash: '' }),
}))

const mockToast = { error: vi.fn(), success: vi.fn(), info: vi.fn() }
vi.mock('@/composables/useToast', () => ({ useToast: () => mockToast }))

vi.mock('@/components/properties/ParseLaunchPanel.vue', () => ({
  default: {
    name: 'ParseLaunchPanel',
    template: '<div class="mock-parse-panel" />',
    props: ['parseDepth'],
    emits: ['update:parseDepth', 'done'],
  },
}))

vi.mock('@/components/properties/PropertyAllTab.vue', () => ({
  default: {
    name: 'PropertyAllTab',
    template: '<div class="mock-all-tab" />',
    props: ['status'],
    expose: { total: 42, refresh: vi.fn() },
  },
}))

vi.mock('@/components/properties/PropertyFocusTab.vue', () => ({
  default: {
    name: 'PropertyFocusTab',
    template: '<div class="mock-focus-tab" />',
    expose: { total: 10 },
  },
}))

vi.mock('@/components/properties/ConfirmClearDialog.vue', () => ({
  default: {
    name: 'ConfirmClearDialog',
    template:
      '<div v-if="visible" class="mock-confirm-dialog"><button class="confirm-btn" @click="$emit(\'confirm\')">Да</button></div>',
    props: ['visible'],
    emits: ['confirm', 'cancel'],
  },
}))

import api from '@/api/strapi'

async function mountAndWait(routeHash = '') {
  // Override useRoute per test
  const { useRoute } = await import('vue-router')
  vi.mocked(useRoute).mockReturnValue({ params: {}, hash: routeHash } as any)

  const wrapper = mount(PropertyListView)
  await flushPromises()
  return wrapper
}

describe('PropertyListView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── 3 вкладки ─────────────────────────────────────────────────
  it('отображает 3 вкладки: «Все объекты», «В фокусе», «В работе»', async () => {
    const wrapper = await mountAndWait()

    const tabs = wrapper.findAll('button').filter((b) =>
      ['Все объекты', 'В фокусе', 'В работе'].includes(b.text()),
    )
    expect(tabs).toHaveLength(3)
    expect(tabs[0].text()).toBe('Все объекты')
    expect(tabs[1].text()).toBe('В фокусе')
    expect(tabs[2].text()).toBe('В работе')
  })

  // ── Вкладка «Все объекты» активна по умолчанию ────────────────
  it('вкладка «Все объекты» активна по умолчанию', async () => {
    const wrapper = await mountAndWait()

    // PropertyAllTab mock renders for "all" tab
    expect(wrapper.find('.mock-all-tab').exists()).toBe(true)
    expect(wrapper.find('.mock-parse-panel').exists()).toBe(true)
    // Focus tab should NOT be rendered
    expect(wrapper.find('.mock-focus-tab').exists()).toBe(false)
  })

  // ── Переключение вкладок ──────────────────────────────────────
  it('переключение вкладок отображает соответствующий контент', async () => {
    const wrapper = await mountAndWait()

    // Click "В фокусе"
    const focusTab = wrapper.findAll('button').find((b) => b.text() === 'В фокусе')!
    await focusTab.trigger('click')
    await flushPromises()

    expect(wrapper.find('.mock-focus-tab').exists()).toBe(true)
    // ParseLaunchPanel hidden on focus tab
    expect(wrapper.find('.mock-parse-panel').exists()).toBe(false)

    // Click "В работе"
    const workTab = wrapper.findAll('button').find((b) => b.text() === 'В работе')!
    await workTab.trigger('click')
    await flushPromises()

    // PropertyAllTab rendered for work status, no parse panel
    expect(wrapper.find('.mock-parse-panel').exists()).toBe(false)
  })

  // ── Кнопка «Очистить» видна только на вкладке «Все объекты» ───
  it('кнопка «Очистить» видна только на вкладке «Все объекты»', async () => {
    const wrapper = await mountAndWait()

    // On "all" tab — button visible
    const clearBtnAll = wrapper.findAll('button').find((b) => b.text() === 'Очистить')
    expect(clearBtnAll).toBeTruthy()

    // Switch to "В фокусе"
    const focusTab = wrapper.findAll('button').find((b) => b.text() === 'В фокусе')!
    await focusTab.trigger('click')
    await flushPromises()

    const clearBtnFocus = wrapper.findAll('button').find((b) => b.text() === 'Очистить')
    expect(clearBtnFocus).toBeUndefined()

    // Switch to "В работе"
    const workTab = wrapper.findAll('button').find((b) => b.text() === 'В работе')!
    await workTab.trigger('click')
    await flushPromises()

    const clearBtnWork = wrapper.findAll('button').find((b) => b.text() === 'Очистить')
    expect(clearBtnWork).toBeUndefined()
  })

  // ── ConfirmClearDialog при клике на «Очистить» ────────────────
  it('показывает ConfirmClearDialog при клике на «Очистить»', async () => {
    const wrapper = await mountAndWait()

    const clearBtn = wrapper.findAll('button').find((b) => b.text() === 'Очистить')!
    await clearBtn.trigger('click')
    await flushPromises()

    expect(wrapper.find('.mock-confirm-dialog').exists()).toBe(true)
  })

  // ── executeClearNew вызывает api.post ──────────────────────────
  it('executeClearNew вызывает api.post(\'/properties/clear-new\')', async () => {
    ;(api.post as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { deleted: 5, photosDeleted: 2 },
    })

    const wrapper = await mountAndWait()

    // Click "Очистить"
    const clearBtn = wrapper.findAll('button').find((b) => b.text() === 'Очистить')!
    await clearBtn.trigger('click')
    await flushPromises()

    // Click confirm button inside dialog
    const confirmBtn = wrapper.find('.confirm-btn')
    await confirmBtn.trigger('click')
    await flushPromises()

    expect(api.post).toHaveBeenCalledWith('/properties/clear-new')
  })

  // ── toast.success при успешной очистке ────────────────────────
  it('toast.success при успешной очистке', async () => {
    ;(api.post as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { deleted: 3, photosDeleted: 0 },
    })

    const wrapper = await mountAndWait()

    const clearBtn = wrapper.findAll('button').find((b) => b.text() === 'Очистить')!
    await clearBtn.trigger('click')
    await flushPromises()

    const confirmBtn = wrapper.find('.confirm-btn')
    await confirmBtn.trigger('click')
    await flushPromises()

    expect(mockToast.success).toHaveBeenCalledWith('Удалено 3 объектов')
  })

  // ── toast.error при ошибке ────────────────────────────────────
  it('toast.error при ошибке очистки', async () => {
    ;(api.post as ReturnType<typeof vi.fn>).mockRejectedValue({
      response: { data: { error: { message: 'Forbidden' } } },
      message: 'Request failed',
    })

    const wrapper = await mountAndWait()

    const clearBtn = wrapper.findAll('button').find((b) => b.text() === 'Очистить')!
    await clearBtn.trigger('click')
    await flushPromises()

    const confirmBtn = wrapper.find('.confirm-btn')
    await confirmBtn.trigger('click')
    await flushPromises()

    expect(mockToast.error).toHaveBeenCalledWith('Ошибка: Forbidden')
  })

  // ── hash #focus активирует вкладку «В фокусе» ────────────────
  it('hash #focus активирует вкладку «В фокусе»', async () => {
    // Mount with route hash '#focus'
    const { useRoute } = await import('vue-router')
    vi.mocked(useRoute).mockReturnValue({ params: {}, hash: '#focus' } as any)

    const wrapper = mount(PropertyListView)
    await flushPromises()

    // Focus tab should be rendered (since activeTab = 'focus')
    expect(wrapper.find('.mock-focus-tab').exists()).toBe(true)
    // Parse panel should NOT be rendered
    expect(wrapper.find('.mock-parse-panel').exists()).toBe(false)
  })
})
