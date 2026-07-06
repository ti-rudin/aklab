import type { Ref } from 'vue'

interface FocusFilters {
  threshold: number
  cities: { moscow: boolean; mo: boolean; other: boolean }
  property_type: string[]
  tags: string[]
  priceFrom: string | number | null
  priceTo: string | number | null
}

interface FocusSort {
  field: string
  direction: 'asc' | 'desc'
}

export function buildFocusParams(
  filters: FocusFilters,
  sort: FocusSort,
  page: number,
  pageSize: number,
  searchQuery?: string,
): Record<string, any> {
  const sortParam = `${sort.direction === 'desc' ? '-' : ''}${sort.field}`
  const cityList: string[] = []
  if (filters.cities.moscow) cityList.push('moscow')
  if (filters.cities.mo) cityList.push('mo')
  if (filters.cities.other) cityList.push('other')

  const params: Record<string, any> = {
    threshold: filters.threshold,
    sort: sortParam,
    page,
    pageSize,
  }
  if (cityList.length > 0 && cityList.length < 3) params.city = cityList.join(',')
  if (filters.property_type.length) params.property_type = filters.property_type.join(',')
  if (filters.tags.length > 0) params.tags = filters.tags.join(',')
  if (filters.priceFrom) params.priceFrom = filters.priceFrom
  if (filters.priceTo) params.priceTo = filters.priceTo
  if (searchQuery?.trim()) params.search = searchQuery.trim()
  return params
}

export function buildAnalyzeBody(
  filters: FocusFilters,
  options?: { force?: boolean; threshold?: number },
): Record<string, any> {
  const cityList: string[] = []
  if (filters.cities.moscow) cityList.push('moscow')
  if (filters.cities.mo) cityList.push('mo')
  if (filters.cities.other) cityList.push('other')

  const body: Record<string, any> = { ...options }
  if (cityList.length > 0 && cityList.length < 3) body.city = cityList
  if (filters.priceFrom) body.priceFrom = Number(filters.priceFrom)
  if (filters.priceTo) body.priceTo = Number(filters.priceTo)
  if (options?.threshold ?? filters.threshold) body.threshold = options?.threshold ?? filters.threshold
  return body
}
