import { describe, it, expect, beforeEach, vi } from 'vitest'
import { nextTick } from 'vue'

// Mock the api module BEFORE importing the composable
vi.mock('@/api/strapi', () => ({
  default: {
    get: vi.fn(),
  },
}))

import api from '@/api/strapi'
import { usePropertyData } from '../usePropertyData'

const mockedApi = vi.mocked(api)

describe('usePropertyData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── initial state ──────────────────────────────────────────────
  it('has correct initial state', () => {
    const { properties, focusProperties, loading, focusLoading, error, total, focusTotal, focusAvgScore } = usePropertyData()

    expect(properties.value).toEqual([])
    expect(focusProperties.value).toEqual([])
    expect(loading.value).toBe(true)
    expect(focusLoading.value).toBe(false)
    expect(error.value).toBeNull()
    expect(total.value).toBe(0)
    expect(focusTotal.value).toBe(0)
    expect(focusAvgScore.value).toBeNull()
  })

  // ── fetchProperties ────────────────────────────────────────────
  describe('fetchProperties', () => {
    const params = { sort: 'price:asc', page: 1, pageSize: 20 }

    it('happy path — populates properties and total', async () => {
      const fakeData = {
        data: [{ id: 1, title: 'Flat A' }, { id: 2, title: 'Flat B' }],
        meta: { pagination: { total: 42 } },
      }
      mockedApi.get.mockResolvedValueOnce({ data: fakeData })

      const { properties, total, loading, error, fetchProperties } = usePropertyData()

      await fetchProperties(params)
      await nextTick()

      expect(mockedApi.get).toHaveBeenCalledWith('/properties', { params })
      expect(properties.value).toEqual(fakeData.data)
      expect(total.value).toBe(42)
      expect(loading.value).toBe(false)
      expect(error.value).toBeNull()
    })

    it('error path — sets error and clears loading', async () => {
      mockedApi.get.mockRejectedValueOnce(new Error('Network down'))

      const { error, loading, fetchProperties } = usePropertyData()

      await fetchProperties(params)
      await nextTick()

      expect(error.value).toBe('Network down')
      expect(loading.value).toBe(false)
    })

    it('sets loading=true before request, false after', async () => {
      let resolveRequest!: (v: any) => void
      mockedApi.get.mockReturnValueOnce(new Promise((r) => { resolveRequest = r }))

      const { loading, fetchProperties } = usePropertyData()

      const promise = fetchProperties(params)
      // still loading
      expect(loading.value).toBe(true)

      resolveRequest({ data: { data: [], meta: {} } })
      await promise

      expect(loading.value).toBe(false)
    })

    it('defaults total to 0 when meta.pagination is missing', async () => {
      mockedApi.get.mockResolvedValueOnce({ data: { data: [] } })

      const { total, fetchProperties } = usePropertyData()

      await fetchProperties(params)

      expect(total.value).toBe(0)
    })
  })

  // ── fetchFocusProperties ───────────────────────────────────────
  describe('fetchFocusProperties', () => {
    const params = { threshold: 20 }

    it('happy path — populates focus properties, total and avgScore', async () => {
      const fakeData = {
        data: [{ id: 10, title: 'Focus 1' }],
        meta: { total: 5, avgScore: 85.3 },
      }
      mockedApi.get.mockResolvedValueOnce({ data: fakeData })

      const { focusProperties, focusTotal, focusAvgScore, focusLoading, error, fetchFocusProperties } = usePropertyData()

      await fetchFocusProperties(params)
      await nextTick()

      expect(mockedApi.get).toHaveBeenCalledWith('/properties/focus', { params })
      expect(focusProperties.value).toEqual(fakeData.data)
      expect(focusTotal.value).toBe(5)
      expect(focusAvgScore.value).toBe(85.3)
      expect(focusLoading.value).toBe(false)
      expect(error.value).toBeNull()
    })

    it('error path — clears focus data and sets error', async () => {
      mockedApi.get.mockRejectedValueOnce(new Error('Server error'))

      const { focusProperties, focusTotal, focusAvgScore, focusLoading, error, fetchFocusProperties } = usePropertyData()

      await fetchFocusProperties(params)
      await nextTick()

      expect(error.value).toBe('Server error')
      expect(focusProperties.value).toEqual([])
      expect(focusTotal.value).toBe(0)
      expect(focusAvgScore.value).toBeNull()
      expect(focusLoading.value).toBe(false)
    })

    it('sets focusLoading=true before request, false after', async () => {
      let resolveRequest!: (v: any) => void
      mockedApi.get.mockReturnValueOnce(new Promise((r) => { resolveRequest = r }))

      const { focusLoading, fetchFocusProperties } = usePropertyData()

      const promise = fetchFocusProperties(params)
      expect(focusLoading.value).toBe(true)

      resolveRequest({ data: { data: [], meta: {} } })
      await promise

      expect(focusLoading.value).toBe(false)
    })

    it('handles missing data gracefully (data.data undefined)', async () => {
      mockedApi.get.mockResolvedValueOnce({ data: { meta: {} } })

      const { focusProperties, fetchFocusProperties } = usePropertyData()

      await fetchFocusProperties(params)

      expect(focusProperties.value).toEqual([])
    })

    it('sets focusAvgScore to null when meta.avgScore is absent', async () => {
      mockedApi.get.mockResolvedValueOnce({ data: { data: [], meta: { total: 0 } } })

      const { focusAvgScore, fetchFocusProperties } = usePropertyData()

      await fetchFocusProperties(params)

      expect(focusAvgScore.value).toBeNull()
    })
  })
})
