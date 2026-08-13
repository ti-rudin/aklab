import { REGIONS, selectedRegions, type RegionSelection } from '@/constants/regions'

export interface FocusFilters {
  threshold: number
  cities: RegionSelection
  property_type: string[]
  status: string
}

export interface FocusSort {
  field: string
  direction: 'asc' | 'desc'
}

export const FOCUS_PAGE_SIZE_MAX = 100

/** Build the allowlisted, flat query accepted by GET /properties/focus. */
export function buildFocusParams(
  filters: FocusFilters,
  sort: FocusSort,
  page: number,
  pageSize: number,
  searchQuery?: string,
): Record<string, string | number> {
  const sortParam = `${sort.direction === 'desc' ? '-' : ''}${sort.field}`
  const cityList = selectedRegions(filters.cities)

  const params: Record<string, string | number> = {
    threshold: filters.threshold,
    sort: sortParam,
    page: Number.isFinite(page) ? Math.max(1, Math.trunc(page)) : 1,
    pageSize: Number.isFinite(pageSize)
      ? Math.min(FOCUS_PAGE_SIZE_MAX, Math.max(1, Math.trunc(pageSize)))
      : FOCUS_PAGE_SIZE_MAX,
  }

  if (cityList.length > 0 && cityList.length < REGIONS.length) params.city = cityList.join(',')
  if (filters.property_type.length > 0) params.property_type = filters.property_type.join(',')
  if (filters.status.trim()) params.status = filters.status.trim()
  if (searchQuery?.trim()) params.search = searchQuery.trim()

  return params
}
