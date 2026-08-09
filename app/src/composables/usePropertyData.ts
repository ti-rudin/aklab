/**
 * Composable for fetching and holding property data (all + focus).
 *
 * The public catalog API intentionally uses a flat query and a direct meta
 * object. Keep the adapter here so views cannot accidentally reintroduce
 * Strapi's nested filters/pagination or legacy filter names.
 */
import { ref } from 'vue'
import api from '@/api/strapi'

export interface Property {
  /** Canonical public identity. Numeric persistence ids are never exposed. */
  documentId: string
  title: string
  address: string | null
  city: string
  property_type: string
  area_sqm: string | null
  price: string | null
  minimum_price?: string | null
  price_per_sqm: string | null
  status?: string
  is_undervalued?: boolean | null
  deviation_percent?: string | null
  source?: string | null
  focus_score?: number | null
  tags?: string[]
  has_minimum_price?: boolean
  /** Detail fields may be added by the scoped DTO without changing list code. */
  description?: string | null
  auction_type?: string | null
  published_at_source?: string | null
  first_seen_at?: string | null
  latitude?: number | null
  longitude?: number | null
  photo_urls?: string[]
  createdAt?: string | null
  updatedAt?: string | null
}

export interface PropertyMeta {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export interface PropertyQuery {
  city?: string
  property_type?: string
  status?: string
  search?: string
  sort?: string
  page?: number
  pageSize?: number
}

export interface FocusPropertyQuery extends PropertyQuery {
  threshold?: number
}

type PropertyQueryInput = PropertyQuery | FocusPropertyQuery | Record<string, unknown>

const TEXT_QUERY_KEYS = ['city', 'property_type', 'status', 'search', 'sort'] as const

function asFlatText(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const text = value.trim()
    return text || undefined
  }
  if (Array.isArray(value)) {
    const values = value.filter((item): item is string => typeof item === 'string')
      .map(item => item.trim())
      .filter(Boolean)
    return values.length ? values.join(',') : undefined
  }
  return undefined
}

/** Strip legacy/nested keys and enforce the API pagination boundary. */
export function buildPropertyQuery(input: PropertyQueryInput = {}): PropertyQuery {
  const query: PropertyQuery = {}
  const raw = input as Record<string, unknown>

  for (const key of TEXT_QUERY_KEYS) {
    const value = asFlatText(raw[key])
    if (value !== undefined) query[key] = value
  }

  if (Number.isFinite(raw.page as number)) {
    query.page = Math.max(1, Math.floor(Number(raw.page)))
  }
  if (Number.isFinite(raw.pageSize as number)) {
    query.pageSize = Math.min(100, Math.max(1, Math.floor(Number(raw.pageSize))))
  }

  return query
}

/** Build the strict focus-only query without widening the regular catalog API. */
export function buildFocusPropertyQuery(input: PropertyQueryInput = {}): FocusPropertyQuery {
  const query: FocusPropertyQuery = buildPropertyQuery(input)
  const threshold = (input as Record<string, unknown>).threshold
  if (typeof threshold === 'number' && Number.isFinite(threshold) && threshold >= 0) {
    query.threshold = threshold
  }
  return query
}

export function usePropertyData() {
  const properties = ref<Property[]>([])
  const focusProperties = ref<Property[]>([])
  const loading = ref(true)
  const focusLoading = ref(false)
  const error = ref<string | null>(null)
  const total = ref(0)
  const focusTotal = ref(0)
  // Kept as a compatibility ref for the existing focus component. The strict
  // scoped focus contract has no avgScore field, so it is never populated.
  const focusAvgScore = ref<number | null>(null)

  async function fetchProperties(params: PropertyQueryInput) {
    loading.value = true
    try {
      const query = buildPropertyQuery(params)
      const { data } = await api.get('/properties', { params: query })
      properties.value = (data.data || []) as Property[]
      total.value = data.meta?.total || 0
      error.value = null
    } catch (e: any) {
      console.error('Failed to fetch properties:', e)
      error.value = e.message
    } finally {
      loading.value = false
    }
  }

  async function fetchFocusProperties(params: PropertyQueryInput) {
    focusLoading.value = true
    try {
      const query = buildFocusPropertyQuery(params)
      const { data } = await api.get('/properties/focus', { params: query })
      focusProperties.value = (data.data || []) as Property[]
      focusTotal.value = data.meta?.total || 0
      focusAvgScore.value = null
      error.value = null
    } catch (e: any) {
      console.error('Failed to fetch focus items:', e)
      error.value = e.message
      focusProperties.value = []
      focusTotal.value = 0
      focusAvgScore.value = null
    } finally {
      focusLoading.value = false
    }
  }

  return {
    properties,
    focusProperties,
    loading,
    focusLoading,
    error,
    total,
    focusTotal,
    focusAvgScore,
    fetchProperties,
    fetchFocusProperties,
  }
}
