import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import DashboardView from '../DashboardView.vue'
import StatCard from '@/components/ui/StatCard.vue'

vi.mock('@/api/strapi', () => ({ default: { get: vi.fn() } }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/composables/useToast', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }) }))

import api from '@/api/strapi'

const mockStats = {
  total: 120,
  inFocus: 15,
  hot: 8,
  undervalued: 5,
  newToday: 3,
  typeBreakdown: { office: 40, warehouse: 30, retail: 20 },
}

const mockTopProperties = [
  {
    documentId: 'p1',
    title: 'Горячий склад',
    address: 'ул. Пушкина, 10',
    city: 'moscow',
    focus_score: 85,
    tags: ['undervalued', 'has_minimum_price'],
    source: 'torgi-gov',
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
    if (url === '/properties/focus') {
      return Promise.resolve({
        data: {
          data: mockTopProperties,
          meta: { page: 1, pageSize: 5, total: 2, totalPages: 1 },
        },
      })
    }
    return Promise.resolve({ data: {} })
  })
}

async function mountAndWait() {
  setupApiSuccess()
  const wrapper = mount(DashboardView)
  await flushPromises()
  return wrapper
}

describe('DashboardView strict scoped contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders direct stats response in KPI cards', async () => {
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

  it('uses only supported navigation query keys', async () => {
    const wrapper = await mountAndWait()
    const cards = wrapper.findAllComponents(StatCard)

    expect(cards.find(card => card.props('title') === 'Горячие (≥50)')?.props('to')).toBe(
      '/properties?tab=focus',
    )
    expect(cards.find(card => card.props('title') === 'Новые 24ч')?.props('to')).toBe(
      '/properties?status=new',
    )
  })

  it('requests focus with flat params and no unsupported filters', async () => {
    await mountAndWait()

    expect(api.get).toHaveBeenCalledWith('/properties/stats')
    expect(api.get).toHaveBeenCalledWith('/properties/focus', {
      params: { page: 1, pageSize: 5, sort: '-focus_score' },
    })
    const focusCall = (api.get as ReturnType<typeof vi.fn>).mock.calls.find((call) => call[0] === '/properties/focus')
    expect(focusCall?.[1]?.params).not.toHaveProperty('threshold')
    expect(focusCall?.[1]?.params).not.toHaveProperty('newSince')
    expect(focusCall?.[1]?.params).not.toHaveProperty('filters')
  })

  it('shows profile-not-ready state for 409 without logging out', async () => {
    ;(api.get as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url === '/properties/stats') return Promise.reject({ response: { status: 409 } })
      return Promise.resolve({ data: { data: [], meta: { page: 1, pageSize: 5, total: 0, totalPages: 0 } } })
    })

    const wrapper = mount(DashboardView)
    await flushPromises()

    expect(wrapper.text()).toContain('Профиль')
    expect(wrapper.text()).toContain('готов')
  })

  it('renders hot properties by documentId with safe fields', async () => {
    const wrapper = await mountAndWait()

    expect(wrapper.text()).toContain('🔥 Горячие объекты')
    expect(wrapper.text()).toContain('Горячий склад')
    expect(wrapper.text()).toContain('Источник: torgi-gov')
    expect(wrapper.text()).toContain('Недооценённый')
    expect(wrapper.text()).toContain('85')
  })

  it('renders loading skeletons before requests resolve', () => {
    ;(api.get as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}))
    const wrapper = mount(DashboardView)

    expect(wrapper.findAll('.skeleton')).toHaveLength(4)
  })
})
