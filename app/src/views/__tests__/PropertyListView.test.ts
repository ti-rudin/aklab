import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import PropertyListView from '../PropertyListView.vue'

vi.mock('@/api/strapi', () => ({ default: { get: vi.fn(), post: vi.fn() } }))

const mockPush = vi.fn()
let mockRouteHash = ''
let mockRouteQuery: Record<string, string | string[]> = {}
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useRoute: () => ({ params: {}, hash: mockRouteHash, query: mockRouteQuery }),
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

import api from '@/api/strapi'

async function mountAndWait(hash = '', query: Record<string, string | string[]> = {}) {
  mockRouteHash = hash
  mockRouteQuery = query
  const wrapper = mount(PropertyListView)
  await flushPromises()
  return wrapper
}

describe('PropertyListView strict scoped contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRouteHash = ''
    mockRouteQuery = {}
  })

  it('renders all, focus and work tabs', async () => {
    const wrapper = await mountAndWait()
    const tabs = wrapper.findAll('button').filter((button) =>
      ['Все объекты', 'В фокусе', 'В работе'].includes(button.text()),
    )

    expect(tabs.map((tab) => tab.text())).toEqual(['Все объекты', 'В фокусе', 'В работе'])
  })

  it('does not render parse launch or clear-new UI', async () => {
    const wrapper = await mountAndWait()

    expect(wrapper.find('.mock-all-tab').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('Очистить')
    expect(wrapper.text()).not.toContain('Запуск парсинга')
    expect(wrapper.find('.mock-confirm-dialog').exists()).toBe(false)
    expect(api.post).not.toHaveBeenCalled()
  })

  it('passes literal all and work status shortcuts to the respective tabs', async () => {
    const wrapper = await mountAndWait()
    const all = wrapper.findComponent({ name: 'PropertyAllTab' })
    expect(all.props('status')).toBe('new')

    const workButton = wrapper.findAll('button').find((button) => button.text() === 'В работе')!
    await workButton.trigger('click')
    await flushPromises()

    const work = wrapper.findComponent({ name: 'PropertyAllTab' })
    expect(work.props('status')).toBe('in_progress')
  })

  it('selects focus safely from hash or query even when route mocks include query', async () => {
    const byHash = await mountAndWait('#focus')
    expect(byHash.find('.mock-focus-tab').exists()).toBe(true)

    const byQuery = await mountAndWait('', { tab: 'focus' })
    expect(byQuery.find('.mock-focus-tab').exists()).toBe(true)
  })

  it('selects work from the supported status shortcut', async () => {
    const wrapper = await mountAndWait('', { status: 'in_progress' })

    expect(wrapper.findComponent({ name: 'PropertyAllTab' }).props('status')).toBe('in_progress')
  })
})
