import { describe, it, expect } from 'vitest'
import { buildFocusParams } from '../useFocusParams'

const baseFilters = () => ({
  threshold: 20,
  cities: { moscow: true, mo: true, tver: true, tver_oblast: true, other: true },
  property_type: [] as string[],
  status: '',
  // Legacy/unsupported inputs must never leak into the request.
  tags: ['undervalued'],
  priceFrom: '100000',
  priceTo: '500000',
})

const baseSort = (field = 'focus_score', direction: 'asc' | 'desc' = 'desc') => ({
  field,
  direction,
})

describe('buildFocusParams', () => {
  it('emits only the supported flat focus query keys', () => {
    const filters = {
      ...baseFilters(),
      cities: { moscow: true, mo: false, tver: false, tver_oblast: false, other: false },
      property_type: ['office', 'warehouse'],
      status: 'viewed',
    }

    const params = buildFocusParams(filters, baseSort(), 2, 25, '  офис  ')

    expect(params).toEqual({
      threshold: 20,
      city: 'moscow',
      property_type: 'office,warehouse',
      status: 'viewed',
      search: 'офис',
      sort: '-focus_score',
      page: 2,
      pageSize: 25,
    })
    expect(params).not.toHaveProperty('tags')
    expect(params).not.toHaveProperty('priceFrom')
    expect(params).not.toHaveProperty('priceTo')
  })

  it('omits city when all supported cities are selected', () => {
    const params = buildFocusParams(baseFilters(), baseSort(), 1, 20)

    expect(params).not.toHaveProperty('city')
  })

  it('serializes Tver city and Tver Oblast as separate canonical filters', () => {
    const filters = {
      ...baseFilters(),
      cities: { moscow: false, mo: false, tver: true, tver_oblast: true, other: false },
    }

    expect(buildFocusParams(filters, baseSort(), 1, 20)).toHaveProperty('city', 'tver,tver_oblast')
  })

  it('omits empty optional filters', () => {
    const filters = {
      ...baseFilters(),
      cities: { moscow: false, mo: false, tver: false, tver_oblast: false, other: false },
      property_type: [],
      status: '',
    }
    const params = buildFocusParams(filters, baseSort(), 1, 20, '   ')

    expect(params).toEqual({
      threshold: 20,
      sort: '-focus_score',
      page: 1,
      pageSize: 20,
    })
  })

  it('bounds pageSize to the backend maximum of 100', () => {
    expect(buildFocusParams(baseFilters(), baseSort(), 1, 1000).pageSize).toBe(100)
    expect(buildFocusParams(baseFilters(), baseSort(), 1, 0).pageSize).toBe(1)
  })

  it('serializes ascending and descending supported sort values', () => {
    expect(buildFocusParams(baseFilters(), baseSort('price', 'desc'), 1, 20).sort).toBe('-price')
    expect(buildFocusParams(baseFilters(), baseSort('price', 'asc'), 1, 20).sort).toBe('price')
  })
})
