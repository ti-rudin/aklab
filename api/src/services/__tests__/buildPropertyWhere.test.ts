import { describe, it, expect } from 'vitest'
import { buildPropertyWhere } from '../buildPropertyWhere'

describe('buildPropertyWhere', () => {
  it('returns empty where when no filters', () => {
    expect(buildPropertyWhere()).toEqual({})
    expect(buildPropertyWhere(undefined)).toEqual({})
  })

  it('returns empty when filters is empty object', () => {
    expect(buildPropertyWhere({})).toEqual({})
  })

  it('builds city filter', () => {
    const where = buildPropertyWhere({ city: ['moscow', 'spb'] })
    expect(where).toEqual({ city: { $in: ['moscow', 'spb'] } })
  })

  it('ignores empty city array', () => {
    const where = buildPropertyWhere({ city: [] })
    expect(where).toEqual({})
  })

  it('builds price range', () => {
    const where = buildPropertyWhere({ priceFrom: 100000, priceTo: 5000000 })
    expect(where).toEqual({ price: { $gte: 100000, $lte: 5000000 } })
  })

  it('builds only priceFrom', () => {
    const where = buildPropertyWhere({ priceFrom: 50000 })
    expect(where).toEqual({ price: { $gte: 50000 } })
  })

  it('builds only priceTo', () => {
    const where = buildPropertyWhere({ priceTo: 999999 })
    expect(where).toEqual({ price: { $lte: 999999 } })
  })

  it('ignores NaN priceFrom', () => {
    const where = buildPropertyWhere({ priceFrom: NaN })
    expect(where).toEqual({})
  })

  it('ignores NaN priceTo', () => {
    const where = buildPropertyWhere({ priceTo: NaN })
    expect(where).toEqual({})
  })

  it('builds status filter', () => {
    const where = buildPropertyWhere({ status: 'new' })
    expect(where).toEqual({ status: 'new' })
  })

  it('builds propertyType filter', () => {
    const where = buildPropertyWhere({ propertyType: ['apartment', 'house'] })
    expect(where).toEqual({ property_type: { $in: ['apartment', 'house'] } })
  })

  it('ignores empty propertyType array', () => {
    const where = buildPropertyWhere({ propertyType: [] })
    expect(where).toEqual({})
  })

  it('combines all filters', () => {
    const where = buildPropertyWhere({
      status: 'new',
      city: ['moscow'],
      propertyType: ['apartment'],
      priceFrom: 1000000,
      priceTo: 10000000,
    })
    expect(where).toEqual({
      status: 'new',
      city: { $in: ['moscow'] },
      property_type: { $in: ['apartment'] },
      price: { $gte: 1000000, $lte: 10000000 },
    })
  })

  it('combines status + city + price only', () => {
    const where = buildPropertyWhere({
      status: 'new',
      city: ['moscow', 'spb'],
      priceFrom: 500000,
      priceTo: 5000000,
    })
    expect(where).toEqual({
      status: 'new',
      city: { $in: ['moscow', 'spb'] },
      price: { $gte: 500000, $lte: 5000000 },
    })
  })

  it('ignores priceFrom 0 (falsy but valid — check behavior)', () => {
    // 0 != null is true and !isNaN(0) is true, so 0 is accepted
    const where = buildPropertyWhere({ priceFrom: 0 })
    expect(where).toEqual({ price: { $gte: 0 } })
  })
})
