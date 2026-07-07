import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import DashboardView from '../DashboardView.vue'

vi.mock('@/api/strapi', () => ({ default: { get: vi.fn() } }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))

const mockToast = { error: vi.fn(), success: vi.fn(), info: vi.fn() }
vi.mock('@/composables/useToast', () => ({ useToast: () => mockToast }))

import api from '@/api/strapi'

const mockStats = {
  total: 120,
  inFocus: 15,
  hot: 8,
  undervalued: 5,
  newToday: 3,
  typeBreakdown: {
    office: 40,
    warehouse: 30,
    retail: 20,
  },
}

const mockTopProperties = [
  {
    documentId: 'p1',
    title: 'Горячий склад',
    address: 'ул. Пушкина, 10',
    city: 'moscow',
    focus_score: 85,
    tags: ['undervalued', 'has_minimum_price'],
  },
  {
    documentId: 'p2',
    title: 'Офис в центре',
    address: null,
    city: 'mo',
    focus_score: 60,
    tags: [],
  },
]

function setupApiSuccess() {
  ;(api.get as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
    if (url === '/properties/stats') return Promise.resolve({ data: mockStats })
    if (url === '/properties/focus')
      return Promise.resolve({ data: { data: mockTopProperties } })
    return Promise.resolve({ data: {} })
  })
}

async function mountAndWait() {
  setupApiSuccess()
  const wrapper = mount(DashboardView)
  await flushPromises()
  return wrapper
}

describe('DashboardView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── KPI карточки ──────────────────────────────────────────────
  it('отображает 4 KPI карточки при загрузке данных', async () => {
    const wrapper = await mountAndWait()

    expect(wrapper.text()).toContain('Всего объектов')
    expect(wrapper.text()).toContain('120')
    expect(wrapper.text()).toContain('В фокусе')
    expect(wrapper.text()).toContain('15')
    expect(wrapper.text()).toContain('Горячие (≥50)')
    expect(wrapper.text()).toContain('8')
    expect(wrapper.text()).toContain('Новые 24ч')
    expect(wrapper.text()).toContain('3')
  })

  // ── Скелетоны ─────────────────────────────────────────────────
  it('отображает скелетоны пока loading=true', async () => {
    // Don't resolve the api promises — keep loading=true
    ;(api.get as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}))
    const wrapper = mount(DashboardView)

    const skeletons = wrapper.findAll('.skeleton')
    expect(skeletons.length).toBe(4)
  })

  // ── Ошибка загрузки stats ─────────────────────────────────────
  it('показывает ошибку при ошибке загрузки stats', async () => {
    ;(api.get as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url === '/properties/stats') return Promise.reject(new Error('Network'))
      if (url === '/properties/focus')
        return Promise.resolve({ data: { data: [] } })
      return Promise.resolve({ data: {} })
    })

    const wrapper = mount(DashboardView)
    await flushPromises()

    expect(wrapper.text()).toContain('Ошибка загрузки статистики')
  })

  // ── Горячие объекты с тегами ──────────────────────────────────
  it('отображает горячие объекты с тегами через tagLabel', async () => {
    const wrapper = await mountAndWait()

    expect(wrapper.text()).toContain('🔥 Горячие объекты')
    expect(wrapper.text()).toContain('Горячий склад')
    expect(wrapper.text()).toContain('Офис в центре')
    // tagLabel('undervalued') → 'Недооценённый' (from formatters.ts)
    expect(wrapper.text()).toContain('Недооценённый')
    // score badge
    expect(wrapper.text()).toContain('85')
    expect(wrapper.text()).toContain('60')
  })

  // ── Кнопка «Обновить» вызывает refresh ───────────────────────
  it('кнопка «Обновить» вызывает refresh (api.get)', async () => {
    const wrapper = await mountAndWait()
    const initialCalls = (api.get as ReturnType<typeof vi.fn>).mock.calls.length

    const btn = wrapper.find('button')
    expect(btn.text()).toContain('Обновить')
    await btn.trigger('click')
    await flushPromises()

    // refresh() calls api.get 2 times again (stats + focus)
    expect((api.get as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
      initialCalls + 2,
    )
  })

  // ── Бар-чарт отображает типы недвижимости ─────────────────────
  it('бар-чарт отображает типы недвижимости', async () => {
    const wrapper = await mountAndWait()

    expect(wrapper.text()).toContain('📊 Объекты по типам')
    // typeLabel mappings: office → 'Офис', warehouse → 'Склад', retail → 'Торговля'
    expect(wrapper.text()).toContain('Офис')
    expect(wrapper.text()).toContain('Склад')
    expect(wrapper.text()).toContain('Торговля')
    // counts
    expect(wrapper.text()).toContain('40')
    expect(wrapper.text()).toContain('30')
    expect(wrapper.text()).toContain('20')
  })
})
