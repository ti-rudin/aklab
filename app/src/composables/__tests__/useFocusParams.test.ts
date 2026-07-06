import { describe, it, expect } from 'vitest'
import { buildFocusParams, buildAnalyzeBody } from '../useFocusParams'

// ── helpers ─────────────────────────────────────────────────────
const baseFilters = () => ({
  threshold: 20,
  cities: { moscow: true, mo: true, other: true },
  property_type: [] as string[],
  tags: [] as string[],
  priceFrom: null as string | number | null,
  priceTo: null as string | number | null,
})

const baseSort = (field = 'focus_score', direction: 'asc' | 'desc' = 'desc') => ({
  field,
  direction,
})

// ─────────────────────────────────────────────────────────────────
// buildFocusParams
// ─────────────────────────────────────────────────────────────────
describe('buildFocusParams', () => {
  // — базовые параметры —
  it('возвращает threshold, sort, page, pageSize', () => {
    const params = buildFocusParams(baseFilters(), baseSort(), 1, 20)
    expect(params.threshold).toBe(20)
    expect(params.sort).toBe('-focus_score')
    expect(params.page).toBe(1)
    expect(params.pageSize).toBe(20)
  })

  // — city filters: только москва —
  it('city=moscow когда выбран только moscow', () => {
    const filters = { ...baseFilters(), cities: { moscow: true, mo: false, other: false } }
    const params = buildFocusParams(filters, baseSort(), 1, 20)
    expect(params.city).toBe('moscow')
  })

  // — city filters: москва + мо —
  it('city=moscow,mo когда выбраны moscow и mo', () => {
    const filters = { ...baseFilters(), cities: { moscow: true, mo: true, other: false } }
    const params = buildFocusParams(filters, baseSort(), 1, 20)
    expect(params.city).toBe('moscow,mo')
  })

  // — city filters: все 3 → не передаёт city —
  it('не передаёт city когда выбраны все 3 региона', () => {
    const params = buildFocusParams(baseFilters(), baseSort(), 1, 20)
    expect(params).not.toHaveProperty('city')
  })

  // — property_type мультиселект —
  it('property_type через запятую', () => {
    const filters = { ...baseFilters(), property_type: ['office', 'warehouse'] }
    const params = buildFocusParams(filters, baseSort(), 1, 20)
    expect(params.property_type).toBe('office,warehouse')
  })

  it('не передаёт property_type если пустой массив', () => {
    const params = buildFocusParams(baseFilters(), baseSort(), 1, 20)
    expect(params).not.toHaveProperty('property_type')
  })

  // — tags —
  it('tags через запятую', () => {
    const filters = { ...baseFilters(), tags: ['undervalued', 'price_drop'] }
    const params = buildFocusParams(filters, baseSort(), 1, 20)
    expect(params.tags).toBe('undervalued,price_drop')
  })

  it('не передаёт tags если пустой массив', () => {
    const params = buildFocusParams(baseFilters(), baseSort(), 1, 20)
    expect(params).not.toHaveProperty('tags')
  })

  // — priceFrom/priceTo как строка —
  it('priceFrom/priceTo как строка', () => {
    const filters = { ...baseFilters(), priceFrom: '100000', priceTo: '500000' }
    const params = buildFocusParams(filters, baseSort(), 1, 20)
    expect(params.priceFrom).toBe('100000')
    expect(params.priceTo).toBe('500000')
  })

  // — priceFrom/priceTo как число —
  it('priceFrom/priceTo как число', () => {
    const filters = { ...baseFilters(), priceFrom: 100000, priceTo: 500000 }
    const params = buildFocusParams(filters, baseSort(), 1, 20)
    expect(params.priceFrom).toBe(100000)
    expect(params.priceTo).toBe(500000)
  })

  it('не передаёт priceFrom/priceTo если null', () => {
    const params = buildFocusParams(baseFilters(), baseSort(), 1, 20)
    expect(params).not.toHaveProperty('priceFrom')
    expect(params).not.toHaveProperty('priceTo')
  })

  // — searchQuery —
  it('searchQuery обрезает пробелы', () => {
    const params = buildFocusParams(baseFilters(), baseSort(), 1, 20, '  офис  ')
    expect(params.search).toBe('офис')
  })

  it('не передаёт search если пустой searchQuery', () => {
    const params = buildFocusParams(baseFilters(), baseSort(), 1, 20, '   ')
    expect(params).not.toHaveProperty('search')
  })

  it('не передаёт search если не передан', () => {
    const params = buildFocusParams(baseFilters(), baseSort(), 1, 20)
    expect(params).not.toHaveProperty('search')
  })

  // — sort asc/desc —
  it('sort desc → "-field"', () => {
    const params = buildFocusParams(baseFilters(), baseSort('price', 'desc'), 1, 20)
    expect(params.sort).toBe('-price')
  })

  it('sort asc → "field" без минуса', () => {
    const params = buildFocusParams(baseFilters(), baseSort('price', 'asc'), 1, 20)
    expect(params.sort).toBe('price')
  })
})

// ─────────────────────────────────────────────────────────────────
// buildAnalyzeBody
// ─────────────────────────────────────────────────────────────────
describe('buildAnalyzeBody', () => {
  // — force option —
  it('прокидывает force: true из options', () => {
    const body = buildAnalyzeBody(baseFilters(), { force: true })
    expect(body.force).toBe(true)
  })

  it('без options нет force', () => {
    const body = buildAnalyzeBody(baseFilters())
    expect(body).not.toHaveProperty('force')
  })

  // — city filters —
  it('city массив когда выбраны 2 региона', () => {
    const filters = { ...baseFilters(), cities: { moscow: true, mo: true, other: false } }
    const body = buildAnalyzeBody(filters)
    expect(body.city).toEqual(['moscow', 'mo'])
  })

  it('не передаёт city когда все 3 региона', () => {
    const body = buildAnalyzeBody(baseFilters())
    expect(body).not.toHaveProperty('city')
  })

  // — priceFrom/priceTo конвертирует в Number —
  it('конвертирует priceFrom/priceTo в Number', () => {
    const filters = { ...baseFilters(), priceFrom: '150000', priceTo: '700000' }
    const body = buildAnalyzeBody(filters)
    expect(body.priceFrom).toBe(150000)
    expect(body.priceTo).toBe(700000)
    expect(typeof body.priceFrom).toBe('number')
    expect(typeof body.priceTo).toBe('number')
  })

  it('не передаёт priceFrom/priceTo если null', () => {
    const body = buildAnalyzeBody(baseFilters())
    expect(body).not.toHaveProperty('priceFrom')
    expect(body).not.toHaveProperty('priceTo')
  })

  // — threshold из options —
  it('threshold из options приоритетнее filters', () => {
    const body = buildAnalyzeBody(baseFilters(), { threshold: 42 })
    expect(body.threshold).toBe(42)
  })

  it('threshold из filters если нет в options', () => {
    const body = buildAnalyzeBody(baseFilters())
    expect(body.threshold).toBe(20)
  })
})
