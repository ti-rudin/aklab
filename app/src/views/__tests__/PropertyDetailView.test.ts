import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'

vi.mock('@/api/strapi', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
  },
}))

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { id: 'doc-1' } }),
}))

import api from '@/api/strapi'
import PropertyDetailView from '../PropertyDetailView.vue'

const mockedApi = vi.mocked(api)
let wrapper: VueWrapper | undefined

const property = {
  documentId: 'doc-1',
  title: 'Офис на Тверской',
  address: 'Москва, Тверская 1',
  city: 'moscow',
  property_type: 'office',
  area_sqm: '100',
  price: '1000000',
  minimum_price: null,
  price_per_sqm: '10000',
  manual_price_per_sqm: null,
  status: 'new',
  is_undervalued: false,
  deviation_percent: null,
  source: 'source-a',
  auction_type: 'bankruptcy',
  url: 'https://source.example/property/1',
  description: null,
  contacts: null,
  published_at_source: null,
  first_seen_at: null,
  focus_score: 10,
  tags: [],
  photos: [],
  photos_downloaded: false,
  latitude: null,
  longitude: null,
}

function setupApi() {
  mockedApi.get.mockImplementation(async (url: string) => {
    if (url === '/properties/doc-1') return { data: { data: { ...property } } }
    if (url === '/me/properties/doc-1/comments') return { data: { data: [] } }
    if (url === '/me/properties/doc-1/events') {
      return { data: { data: [], meta: { page: 1, pageSize: 100, hasNextPage: false } } }
    }
    throw new Error(`unexpected GET ${url}`)
  })
  mockedApi.post.mockImplementation(async (url: string) => {
    if (url === '/properties/doc-1/fetch-photos') {
      return { data: { queued: false, reason: 'no_url' } }
    }
    throw new Error(`unexpected POST ${url}`)
  })
}

async function mountReady() {
  setupApi()
  wrapper = mount(PropertyDetailView, {
    global: {
      stubs: {
        RouterLink: { template: '<a><slot /></a>' },
      },
    },
  })
  await flushPromises()
  return wrapper
}

describe('PropertyDetailView scoped contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    wrapper = undefined
  })

  afterEach(() => {
    wrapper?.unmount()
    vi.useRealTimers()
  })

  it('fetches detail without query and only then loads scoped comments/events in parallel', async () => {
    const mounted = await mountReady()

    expect(mockedApi.get.mock.calls[0]).toEqual(['/properties/doc-1'])
    expect(mockedApi.get).toHaveBeenCalledWith('/me/properties/doc-1/comments')
    expect(mockedApi.get).toHaveBeenCalledWith('/me/properties/doc-1/events', {
      params: { page: 1, pageSize: 100 },
    })
    expect(mockedApi.post).toHaveBeenCalledWith('/properties/doc-1/fetch-photos')
    expect(mounted.text()).toContain('Офис на Тверской')
  })

  it('does not perform dependent comments, events, media, or photo queue side effects after scoped detail 404', async () => {
    mockedApi.get.mockRejectedValueOnce({ response: { status: 404 } })
    wrapper = mount(PropertyDetailView, {
      global: {
        stubs: { RouterLink: { template: '<a><slot /></a>' } },
      },
    })

    await flushPromises()

    expect(mockedApi.get).toHaveBeenCalledTimes(1)
    expect(mockedApi.get).toHaveBeenCalledWith('/properties/doc-1')
    expect(mockedApi.post).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Объект не найден')
  })

  it('handles no_url as a terminal lazy-fetch response without starting detail polling', async () => {
    const mounted = await mountReady()

    expect(mockedApi.post).toHaveBeenCalledWith('/properties/doc-1/fetch-photos')
    expect(mockedApi.get.mock.calls.filter((call) => call[0] === '/properties/doc-1')).toHaveLength(1)
    expect(mounted.text()).toContain('Фотографии не найдены')
  })

  it('refreshes detail once for already_downloaded and does not start polling', async () => {
    let detailCalls = 0
    mockedApi.get.mockImplementation(async (url: string) => {
      if (url === '/properties/doc-1') {
        detailCalls += 1
        return { data: { data: { ...property, photos_downloaded: detailCalls > 1, photos: [] } } }
      }
      if (url === '/me/properties/doc-1/comments') return { data: { data: [] } }
      if (url === '/me/properties/doc-1/events') return { data: { data: [], meta: {} } }
      throw new Error(`unexpected GET ${url}`)
    })
    mockedApi.post.mockResolvedValueOnce({ data: { queued: false, reason: 'already_downloaded' } })

    wrapper = mount(PropertyDetailView, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    })
    await flushPromises()

    expect(mockedApi.post).toHaveBeenCalledWith('/properties/doc-1/fetch-photos')
    expect(detailCalls).toBe(2)
    expect(mockedApi.get.mock.calls.filter((call) => call[0] === '/properties/doc-1')).toHaveLength(2)
  })
  it('polls after queued response, refreshes detail, and stops at downloaded', async () => {
    vi.useFakeTimers()
    let detailCalls = 0
    mockedApi.get.mockImplementation(async (url: string) => {
      if (url === '/properties/doc-1') {
        detailCalls += 1
        return { data: { data: { ...property, photos_downloaded: detailCalls > 1, photos: [] } } }
      }
      if (url === '/me/properties/doc-1/comments') return { data: { data: [] } }
      if (url === '/me/properties/doc-1/events') return { data: { data: [], meta: {} } }
      throw new Error(`unexpected GET ${url}`)
    })
    mockedApi.post.mockResolvedValueOnce({ data: { queued: true } })

    wrapper = mount(PropertyDetailView, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    })
    await flushPromises()
    await vi.advanceTimersByTimeAsync(2_000)
    await flushPromises()

    expect(mockedApi.post).toHaveBeenCalledWith('/properties/doc-1/fetch-photos')
    expect(detailCalls).toBe(2)
    expect(mockedApi.get.mock.calls.filter((call) => call[0] === '/properties/doc-1')).toHaveLength(2)
  })
  it('writes status through the scoped endpoint and changes UI only from the acknowledged response', async () => {
    const mounted = await mountReady()
    mockedApi.put.mockResolvedValueOnce({ data: { data: { status: 'viewed' } } })

    const statusButton = mounted.findAll('button').find((button) => button.text().includes('Просмотрено'))
    expect(statusButton).toBeDefined()
    await statusButton!.trigger('click')
    await flushPromises()

    expect(mockedApi.put).toHaveBeenCalledWith('/me/properties/doc-1/status', {
      data: { status: 'viewed' },
    })
    expect(mounted.text()).toContain('Просмотрен')
  })

  it('keeps status and comment draft when a status write fails', async () => {
    const mounted = await mountReady()
    const input = mounted.find('input')
    await input.setValue('Черновик комментария')
    mockedApi.put.mockRejectedValueOnce({
      response: { data: { error: { message: 'Статус не сохранён' } } },
    })

    const statusButton = mounted.findAll('button').find((button) => button.text().includes('В работу'))
    await statusButton!.trigger('click')
    await flushPromises()

    expect(mounted.text()).toContain('Новый')
    expect((input.element as HTMLInputElement).value).toBe('Черновик комментария')
    expect(mounted.text()).toContain('Статус не сохранён')
  })

  it('creates a comment with the exact scoped body and appends only the acknowledged DTO', async () => {
    const mounted = await mountReady()
    mockedApi.post.mockImplementation(async (url: string, body?: unknown) => {
      if (url === '/properties/doc-1/fetch-photos') return { data: { queued: false, reason: 'no_url' } }
      if (url === '/me/properties/doc-1/comments') {
        expect(body).toEqual({ data: { text: 'Новый комментарий' } })
        return { data: { data: { id: 9, text: 'Новый комментарий', createdAt: '2026-08-07T10:00:00.000Z' } } }
      }
      throw new Error(`unexpected POST ${url}`)
    })

    const input = mounted.find('input')
    await input.setValue('  Новый комментарий  ')
    const addButton = mounted.findAll('button').find((button) => button.text().includes('Добавить'))
    await addButton!.trigger('click')
    await flushPromises()

    expect(mockedApi.post).toHaveBeenCalledWith('/me/properties/doc-1/comments', {
      data: { text: 'Новый комментарий' },
    })
    expect(mounted.text()).toContain('Новый комментарий')
    expect((input.element as HTMLInputElement).value).toBe('')
  })

  it('keeps the comment draft and error when scoped comment write fails', async () => {
    const mounted = await mountReady()
    mockedApi.post.mockImplementation(async (url: string) => {
      if (url === '/properties/doc-1/fetch-photos') return { data: { queued: false, reason: 'no_url' } }
      throw { response: { data: { error: { message: 'Комментарий не сохранён' } } } }
    })

    const input = mounted.find('input')
    await input.setValue('Черновик')
    const addButton = mounted.findAll('button').find((button) => button.text().includes('Добавить'))
    await addButton!.trigger('click')
    await flushPromises()

    expect((input.element as HTMLInputElement).value).toBe('Черновик')
    expect(mounted.text()).toContain('Комментарий не сохранён')
  })

  it('contains no legacy populate, generic comment/event CRUD, or direct media URL path', () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'PropertyDetailView.vue'), 'utf8')
    expect(source).not.toContain('populate')
    expect(source).not.toContain('/user-comments')
    expect(source).not.toContain('/property-events')
    expect(source).not.toContain('api.defaults.baseURL')
    expect(source).not.toContain(':src="photoUrl(')
  })
})
