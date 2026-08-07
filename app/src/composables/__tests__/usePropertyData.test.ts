import { describe, it, expect, beforeEach, vi } from 'vitest'
import { nextTick } from 'vue'

vi.mock('@/api/strapi', () => ({
  default: {
    get: vi.fn(),
  },
}))

import api from '@/api/strapi'
import { usePropertyData, type PropertyQuery } from '../usePropertyData'

const mockedApi = vi.mocked(api)

const flatParams: PropertyQuery = {
  city: 'moscow,mo',
  property_type: 'office,warehouse',
  search: 'центр',
  sort: '-createdAt',
  page: 2,
  pageSize: 25,
}

describe('usePropertyData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('requires documentId as the canonical property identity without requiring numeric id', () => {
    mockedApi.get.mockResolvedValueOnce({
      data: { data: [{ documentId: 'doc-1', title: 'Офис' }], meta: { page: 1, pageSize: 25, total: 1, totalPages: 1 } },
    })

    const { properties, fetchProperties } = usePropertyData()

    return fetchProperties({ page: 1, pageSize: 25 }).then(() => {
      expect(properties.value[0].documentId).toBe('doc-1')
      expect(properties.value[0]).not.toHaveProperty('id')
    })
  })

  describe('buildPropertyQuery', () => {
    it('keeps only supported flat keys and clamps pageSize to 100', async () => {
      mockedApi.get.mockResolvedValueOnce({
        data: {
          data: [],
          meta: { page: 1, pageSize: 100, total: 0, totalPages: 0 },
        },
      })

      const { fetchProperties } = usePropertyData()
      await fetchProperties({
        ...flatParams,
        pageSize: 500,
        source: 'legacy-source',
        priceFrom: 1,
        newSince: '24h',
        filters: { city: { $in: ['moscow'] } },
      } as PropertyQuery & Record<string, unknown>)

      expect(mockedApi.get).toHaveBeenCalledWith('/properties', {
        params: {
          ...flatParams,
          pageSize: 100,
        },
      })
      expect(mockedApi.get.mock.calls[0][1]?.params).not.toHaveProperty('source')
      expect(mockedApi.get.mock.calls[0][1]?.params).not.toHaveProperty('priceFrom')
      expect(mockedApi.get.mock.calls[0][1]?.params).not.toHaveProperty('newSince')
      expect(mockedApi.get.mock.calls[0][1]?.params).not.toHaveProperty('filters')
    })
  })

  describe('fetchProperties', () => {
    it('uses the flat query and reads totals from direct meta', async () => {
      const response = {
        data: [
          { documentId: 'doc-1', title: 'Офис' },
          { documentId: 'doc-2', title: 'Склад' },
        ],
        meta: { page: 2, pageSize: 25, total: 42, totalPages: 2 },
      }
      mockedApi.get.mockResolvedValueOnce({ data: response })

      const { properties, total, loading, error, fetchProperties } = usePropertyData()
      await fetchProperties(flatParams)
      await nextTick()

      expect(mockedApi.get).toHaveBeenCalledWith('/properties', { params: flatParams })
      expect(properties.value).toEqual(response.data)
      expect(total.value).toBe(42)
      expect(loading.value).toBe(false)
      expect(error.value).toBeNull()
    })

    it('sets error and clears loading on failure', async () => {
      mockedApi.get.mockRejectedValueOnce(new Error('Network down'))

      const { error, loading, fetchProperties } = usePropertyData()
      await fetchProperties(flatParams)
      await nextTick()

      expect(error.value).toBe('Network down')
      expect(loading.value).toBe(false)
    })

    it('sets loading=true before request and false after request', async () => {
      let resolveRequest!: (value: unknown) => void
      mockedApi.get.mockReturnValueOnce(new Promise((resolve) => { resolveRequest = resolve }))

      const { loading, fetchProperties } = usePropertyData()
      const request = fetchProperties(flatParams)
      expect(loading.value).toBe(true)

      resolveRequest({ data: { data: [], meta: { page: 1, pageSize: 25, total: 0, totalPages: 0 } } })
      await request

      expect(loading.value).toBe(false)
    })
  })

  describe('fetchFocusProperties', () => {
    it('uses the same flat meta contract and does not consume avgScore', async () => {
      const response = {
        data: [{ documentId: 'focus-1', title: 'Горячий объект' }],
        meta: { page: 1, pageSize: 5, total: 5, totalPages: 1 },
      }
      mockedApi.get.mockResolvedValueOnce({ data: response })

      const { focusProperties, focusTotal, focusAvgScore, focusLoading, error, fetchFocusProperties } = usePropertyData()
      await fetchFocusProperties({ page: 1, pageSize: 5, sort: '-focus_score' })
      await nextTick()

      expect(mockedApi.get).toHaveBeenCalledWith('/properties/focus', {
        params: { page: 1, pageSize: 5, sort: '-focus_score' },
      })
      expect(focusProperties.value).toEqual(response.data)
      expect(focusTotal.value).toBe(5)
      expect(focusAvgScore.value).toBeNull()
      expect(focusLoading.value).toBe(false)
      expect(error.value).toBeNull()
    })

    it('clears focus data and sets error on failure', async () => {
      mockedApi.get.mockRejectedValueOnce(new Error('Server error'))

      const { focusProperties, focusTotal, focusAvgScore, focusLoading, error, fetchFocusProperties } = usePropertyData()
      await fetchFocusProperties({ page: 1, pageSize: 5 })
      await nextTick()

      expect(error.value).toBe('Server error')
      expect(focusProperties.value).toEqual([])
      expect(focusTotal.value).toBe(0)
      expect(focusAvgScore.value).toBeNull()
      expect(focusLoading.value).toBe(false)
    })
  })
})
