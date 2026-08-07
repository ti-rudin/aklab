import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

vi.mock('@/api/strapi', () => ({ default: { get: vi.fn() } }))

const mockReplace = vi.fn()
let routeQuery: Record<string, string | string[]> = {}
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn(), replace: mockReplace }),
  useRoute: () => ({ query: routeQuery }),
}))

vi.mock('@/components/SkeletonTable.vue', () => ({ default: { template: '<div class="skeleton-table" />' } }))
vi.mock('@/components/properties/PropertyCard.vue', () => ({
  default: {
    props: ['item'],
    template: '<div class="mock-property-card">{{ item.documentId }}</div>',
  },
}))
vi.mock('@/components/properties/PropertyTable.vue', () => ({
  default: {
    props: ['items'],
    emits: ['sort'],
    template: '<div class="mock-property-table"><button @click="$emit(\'sort\', \'title\')">sort</button><span v-for="item in items" :key="item.documentId">{{ item.documentId }}</span></div>',
  },
}))
vi.mock('@/components/properties/ViewToggle.vue', () => ({
  default: { props: ['modelValue'], template: '<div class="mock-view-toggle" />' },
}))
vi.mock('@/components/properties/FilterChips.vue', () => ({
  default: { props: ['modelValue', 'options'], template: '<div class="mock-filter-chips" />' },
}))

import api from '@/api/strapi'
import PropertyAllTab from '../PropertyAllTab.vue'

const mockedApi = vi.mocked(api)

async function mountTab(status: 'new' | 'in_progress', query: Record<string, string | string[]> = {}) {
  routeQuery = query
  mockedApi.get.mockResolvedValue({
    data: {
      data: [{ documentId: 'doc-1', title: 'Офис без numeric id' }],
      meta: { page: 1, pageSize: 25, total: 1, totalPages: 1 },
    },
  })
  const wrapper = mount(PropertyAllTab, { props: { status } })
  await flushPromises()
  return wrapper
}

describe('PropertyAllTab strict scoped contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    mockReplace.mockReset()
    routeQuery = {}
  })

  it('emits literal-all as supported flat params and ignores unsupported route filters', async () => {
    const wrapper = await mountTab('new', {
      city: 'moscow,mo',
      property_type: ['office', 'warehouse'],
      search: 'центр',
      status: 'new',
      source: 'legacy-source',
      priceFrom: '1',
      newSince: '24h',
      filters: 'nested',
    })

    expect(mockedApi.get).toHaveBeenCalledWith('/properties', {
      params: {
        city: 'moscow,mo',
        property_type: 'office,warehouse',
        search: 'центр',
        sort: '-createdAt',
        page: 1,
        pageSize: 25,
      },
    })
    expect(mockedApi.get.mock.calls.every((call) => {
      const params = call[1]?.params || {}
      return !('status' in params) && !('source' in params) && !('priceFrom' in params) && !('newSince' in params) && !('filters' in params)
    })).toBe(true)
    expect(wrapper.text()).toContain('doc-1')
  })

  it('uses status=in_progress only for the work shortcut', async () => {
    await mountTab('in_progress')

    expect(mockedApi.get).toHaveBeenCalledWith('/properties', {
      params: {
        status: 'in_progress',
        sort: '-createdAt',
        page: 1,
        pageSize: 25,
      },
    })
  })

  it('keeps pageSize at or below 100 and uses documentId for rendered identity', async () => {
    const wrapper = await mountTab('new')

    const request = mockedApi.get.mock.calls[0][1]?.params
    expect(request.pageSize).toBeLessThanOrEqual(100)
    expect(wrapper.find('.mock-property-card').text()).toContain('doc-1')
  })

  it('builds supported descending sort values', async () => {
    localStorage.setItem('aklab-view-mode', 'table')
    const wrapper = await mountTab('new')
    await wrapper.find('.mock-property-table button').trigger('click')
    await flushPromises()

    const requests = mockedApi.get.mock.calls.map((call) => call[1]?.params)
    expect(requests[requests.length - 1]).toMatchObject({ sort: '-title', page: 1, pageSize: 25 })
  })
})
