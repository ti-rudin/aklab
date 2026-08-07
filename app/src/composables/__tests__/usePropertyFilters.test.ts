import { describe, it, expect, beforeEach, vi } from 'vitest'
import { nextTick } from 'vue'
import { usePropertyFilters } from '../usePropertyFilters'

const STORAGE_KEY = 'aklab-property-filters'

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
})

describe('usePropertyFilters', () => {
  it('exposes only supported catalog filters by default', () => {
    const { filters, searchQuery } = usePropertyFilters()

    expect(filters.city).toEqual([])
    expect(filters.property_type).toEqual([])
    expect(searchQuery.value).toBe('')
    expect(Object.keys(filters)).toEqual(['city', 'property_type'])
  })

  it('ignores legacy source, price and status values from localStorage', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      city: ['moscow'],
      property_type: ['office'],
      source: 'legacy-source',
      priceFrom: 1,
      priceTo: 2,
      status: 'viewed',
    }))

    const { filters } = usePropertyFilters()

    expect(filters.city).toEqual(['moscow'])
    expect(filters.property_type).toEqual(['office'])
    expect(filters).not.toHaveProperty('source')
    expect(filters).not.toHaveProperty('priceFrom')
    expect(filters).not.toHaveProperty('priceTo')
    expect(filters).not.toHaveProperty('status')
  })

  it('persists only supported filters', async () => {
    const { filters, searchQuery } = usePropertyFilters()
    filters.city = ['moscow', 'mo']
    filters.property_type = ['office']
    searchQuery.value = 'центр'
    await nextTick()

    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    expect(saved).toEqual({ city: ['moscow', 'mo'], property_type: ['office'] })
    expect(JSON.stringify(saved)).not.toContain('source')
    expect(JSON.stringify(saved)).not.toContain('price')
    expect(JSON.stringify(saved)).not.toContain('status')
  })

  it('resets supported filters and search', () => {
    const { filters, searchQuery, resetFilters } = usePropertyFilters()
    filters.city = ['moscow']
    filters.property_type = ['warehouse']
    searchQuery.value = 'склад'

    resetFilters()

    expect(filters.city).toEqual([])
    expect(filters.property_type).toEqual([])
    expect(searchQuery.value).toBe('')
  })

  it('handles malformed localStorage without throwing', () => {
    localStorage.setItem(STORAGE_KEY, '{not-json')

    expect(() => usePropertyFilters()).not.toThrow()
  })
})
