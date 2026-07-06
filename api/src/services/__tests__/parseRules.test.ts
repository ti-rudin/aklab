import { describe, it, expect } from 'vitest'
import { buildParseRules } from '../parseRules'

describe('buildParseRules', () => {
  it('returns empty rules when setting is null', () => {
    const rules = buildParseRules(null)
    expect(rules.stopWords).toBeUndefined()
    expect(rules.priceFrom).toBeUndefined()
    expect(rules.priceTo).toBeUndefined()
    expect(rules.areaFrom).toBeUndefined()
    expect(rules.areaTo).toBeUndefined()
    expect(rules.cities).toBeUndefined()
  })

  it('returns empty rules when setting is undefined', () => {
    const rules = buildParseRules(undefined)
    expect(rules.stopWords).toBeUndefined()
    expect(rules.priceFrom).toBeUndefined()
    expect(rules.priceTo).toBeUndefined()
    expect(rules.areaFrom).toBeUndefined()
    expect(rules.areaTo).toBeUndefined()
    expect(rules.cities).toBeUndefined()
  })

  it('maps stop_words from setting', () => {
    const rules = buildParseRules({ stop_words: ['земельный участок', 'участок'] })
    expect(rules.stopWords).toEqual(['земельный участок', 'участок'])
  })

  it('returns undefined for empty stop_words', () => {
    const rules = buildParseRules({ stop_words: [] })
    expect(rules.stopWords).toBeUndefined()
  })

  it('maps price_from/price_to as numbers', () => {
    const rules = buildParseRules({ price_from: '100000', price_to: '5000000' })
    expect(rules.priceFrom).toBe(100000)
    expect(rules.priceTo).toBe(5000000)
  })

  it('maps area_from/area_to as numbers', () => {
    const rules = buildParseRules({ area_from: '50', area_to: '1000' })
    expect(rules.areaFrom).toBe(50)
    expect(rules.areaTo).toBe(1000)
  })

  it('maps monitored_regions to cities', () => {
    const rules = buildParseRules({ monitored_regions: ['moscow', 'mo'] })
    expect(rules.cities).toEqual(['moscow', 'mo'])
  })

  it('returns undefined for null price/area values', () => {
    const rules = buildParseRules({ price_from: null, price_to: null, area_from: null, area_to: null })
    expect(rules.priceFrom).toBeUndefined()
    expect(rules.priceTo).toBeUndefined()
    expect(rules.areaFrom).toBeUndefined()
    expect(rules.areaTo).toBeUndefined()
  })

  it('returns undefined for empty monitored_regions', () => {
    const rules = buildParseRules({ monitored_regions: [] })
    expect(rules.cities).toBeUndefined()
  })

  it('handles zero price/area values as falsy but valid', () => {
    const rules = buildParseRules({ price_from: 0, price_to: 0, area_from: 0, area_to: 0 })
    // 0 != null is true, so Number(0) = 0
    expect(rules.priceFrom).toBe(0)
    expect(rules.priceTo).toBe(0)
    expect(rules.areaFrom).toBe(0)
    expect(rules.areaTo).toBe(0)
  })

  it('handles numeric inputs without string conversion', () => {
    const rules = buildParseRules({ price_from: 100000, price_to: 5000000, area_from: 50, area_to: 1000 })
    expect(rules.priceFrom).toBe(100000)
    expect(rules.priceTo).toBe(5000000)
    expect(rules.areaFrom).toBe(50)
    expect(rules.areaTo).toBe(1000)
  })

  it('handles full setting object', () => {
    const setting = {
      stop_words: ['земельный участок'],
      price_from: 100000,
      price_to: 10000000,
      area_from: 20,
      area_to: 5000,
      monitored_regions: ['moscow', 'mo', 'other'],
    }
    const rules = buildParseRules(setting)
    expect(rules.stopWords).toEqual(['земельный участок'])
    expect(rules.priceFrom).toBe(100000)
    expect(rules.priceTo).toBe(10000000)
    expect(rules.areaFrom).toBe(20)
    expect(rules.areaTo).toBe(5000)
    expect(rules.cities).toEqual(['moscow', 'mo', 'other'])
  })

  it('handles partial setting (only stop_words)', () => {
    const rules = buildParseRules({ stop_words: ['keyword'] })
    expect(rules.stopWords).toEqual(['keyword'])
    expect(rules.priceFrom).toBeUndefined()
    expect(rules.priceTo).toBeUndefined()
    expect(rules.areaFrom).toBeUndefined()
    expect(rules.areaTo).toBeUndefined()
    expect(rules.cities).toBeUndefined()
  })

  it('handles empty object', () => {
    const rules = buildParseRules({})
    expect(rules.stopWords).toBeUndefined()
    expect(rules.priceFrom).toBeUndefined()
    expect(rules.priceTo).toBeUndefined()
    expect(rules.areaFrom).toBeUndefined()
    expect(rules.areaTo).toBeUndefined()
    expect(rules.cities).toBeUndefined()
  })
})
