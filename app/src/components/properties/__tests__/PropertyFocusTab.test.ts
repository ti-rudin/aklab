import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import type { Property } from '@/composables/usePropertyData'
import api from '@/api/strapi'
import PropertyFocusTab from '../PropertyFocusTab.vue'

vi.mock('@/api/strapi', () => ({
  default: {
    get: vi.fn(),
    put: vi.fn(),
    post: vi.fn(),
  },
}))

const mockedApi = vi.mocked(api)

const baseItem: Property = {
  documentId: 'doc-1',
  title: 'Объект фокуса',
  address: 'ул. Тестовая, 1',
  city: 'moscow',
  property_type: 'office',
  area_sqm: '100',
  price: '5000000',
  price_per_sqm: '50000',
  status: 'new',
  is_undervalued: true,
  deviation_percent: '25',
  source: 'test',
  focus_score: 80,
  tags: ['new'],
  has_minimum_price: false,
}

function createTestRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/properties/:documentId', component: { template: '<div />' } }],
  })
}

function mountFocus(items: Property[], meta: Record<string, unknown> = {}) {
  mockedApi.get.mockImplementation((url: any) => {
    if (url === '/properties/focus') {
      return Promise.resolve({ data: { data: items, meta: { total: items.length, ...meta } } })
    }
    return Promise.resolve({ data: { ok: false } })
  })
  mockedApi.put.mockResolvedValue({ data: { ok: true } } as any)

  return mount(PropertyFocusTab, {
    global: { plugins: [createTestRouter()] },
  })
}

describe('PropertyFocusTab', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    ;(URL as any).createObjectURL = vi.fn(() => 'blob:test')
    ;(URL as any).revokeObjectURL = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('loads only the scoped focus endpoint and renders no admin analyzer controls', async () => {
    const wrapper = mountFocus([baseItem], { avgScore: 99 })
    await flushPromises()

    const urls = mockedApi.get.mock.calls.map(([url]) => url)
    expect(urls).toEqual(['/properties/focus'])
    expect(urls).not.toContain('/setting')
    expect(urls).not.toContain('/pipeline/status')
    expect(mockedApi.post).not.toHaveBeenCalled()
    expect(wrapper.text()).not.toContain('Пересчитать')
    expect(wrapper.text()).not.toContain('Средний скор')
  })

  it('uses the exact personal single-status endpoint and documentId', async () => {
    const wrapper = mountFocus([baseItem])
    await flushPromises()

    const rejectButton = wrapper.findAll('button').find(button => button.text() === 'Отклонить')
    expect(rejectButton).toBeTruthy()
    await rejectButton!.trigger('click')
    await flushPromises()

    expect(mockedApi.put).toHaveBeenCalledWith(
      '/me/properties/doc-1/status',
      { data: { status: 'rejected' } },
    )
    expect(mockedApi.put).not.toHaveBeenCalledWith(
      '/properties/doc-1',
      expect.anything(),
    )
  })

  it('sends selected statuses through sequential chunks of at most 100', async () => {
    const items = Array.from({ length: 101 }, (_, index) => ({
      ...baseItem,
      documentId: `doc-${index + 1}`,
      title: `Объект ${index + 1}`,
    }))
    localStorage.setItem('aklab-view-mode', 'table')
    const wrapper = mountFocus(items)
    await flushPromises()

    await wrapper.find('thead input[type="checkbox"]').trigger('change')
    await wrapper.find('button[aria-label="Отметить как просмотрено"]').trigger('click')
    await flushPromises()

    expect(mockedApi.put).toHaveBeenCalledTimes(2)
    expect(mockedApi.put.mock.calls[0]).toEqual([
      '/me/properties/statuses',
      { data: { items: items.slice(0, 100).map(item => ({ documentId: item.documentId, status: 'viewed' })) } },
    ])
    expect(mockedApi.put.mock.calls[1]).toEqual([
      '/me/properties/statuses',
      { data: { items: [{ documentId: 'doc-101', status: 'viewed' }] } },
    ])
    expect(wrapper.text()).not.toContain('Выбрано:')
  })

  it('pages CSV with pageSize 100, preserves scope, neutralizes formulas and cleans up the object URL', async () => {
    let focusRequestCount = 0
    const spreadsheetInjection = {
      ...baseItem,
      title: '=HYPERLINK("https://evil.invalid")',
      price: '-1+1',
    }
    mockedApi.get.mockImplementation((url: any, config: any) => {
      if (url !== '/properties/focus') return Promise.resolve({ data: { ok: false } })
      focusRequestCount += 1
      if (focusRequestCount === 1) {
        return Promise.resolve({ data: { data: [baseItem], meta: { total: 1 } } })
      }
      if (focusRequestCount === 2) {
        return Promise.resolve({ data: { data: [spreadsheetInjection], meta: { total: 101, totalPages: 2 } } })
      }
      expect((config as any).params.page).toBe(2)
      return Promise.resolve({ data: { data: [baseItem], meta: { total: 101, totalPages: 2 } } })
    })

    const wrapper = mount(PropertyFocusTab, {
      global: { plugins: [createTestRouter()] },
    })
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text().includes('Экспорт CSV'))!.trigger('click')
    await flushPromises()

    expect(mockedApi.get).toHaveBeenCalledTimes(3)
    expect(mockedApi.get.mock.calls[1][1]).toEqual({
      params: expect.objectContaining({ page: 1, pageSize: 100 }),
    })
    expect(mockedApi.get.mock.calls[2][1]).toEqual({
      params: expect.objectContaining({ page: 2, pageSize: 100 }),
    })
    for (const [, config] of mockedApi.get.mock.calls.slice(1)) {
      expect((config as any).params).not.toHaveProperty('tags')
      expect((config as any).params).not.toHaveProperty('priceFrom')
      expect((config as any).params).not.toHaveProperty('priceTo')
    }
    const exportedBlob = (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls[0][0] as Blob
    const csv = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(reader.error)
      reader.readAsText(exportedBlob)
    })
    expect(csv).toContain(`'=HYPERLINK`)
    expect(csv).toContain(`'-1+1`)
    expect((URL as any).revokeObjectURL).toHaveBeenCalledWith('blob:test')
  })

  it('resets the local threshold to 20 without a settings request', async () => {
    localStorage.setItem('aklab-focus-filters', JSON.stringify({ threshold: 75 }))
    const wrapper = mountFocus([baseItem])
    await flushPromises()

    await wrapper.findAll('button').find(button => button.text() === 'Сбросить фильтры')!.trigger('click')
    await flushPromises()

    expect(mockedApi.get.mock.calls.map(([url]) => url)).not.toContain('/setting')
    const thresholdInput = wrapper.find('input[type="number"]')
    expect((thresholdInput.element as HTMLInputElement).value).toBe('20')
  })
})
