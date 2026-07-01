/**
 * Composable for fetching and holding property data (all + focus).
 * Extracted from PropertyListView.vue.
 */
import { ref } from 'vue'
import api from '@/api/strapi'

export interface Property {
  id: number
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
  source?: string
  focus_score?: number | null
  tags?: string[]
  has_minimum_price?: boolean
}

export function usePropertyData() {
  const properties = ref<Property[]>([])
  const focusProperties = ref<Property[]>([])
  const loading = ref(true)
  const focusLoading = ref(false)
  const error = ref<string | null>(null)
  const total = ref(0)
  const focusTotal = ref(0)
  const focusAvgScore = ref<number | null>(null)

  async function fetchProperties(params: {
    sort: string
    page: number
    pageSize: number
    filters?: Record<string, any>
  }) {
    loading.value = true
    try {
      const { data } = await api.get('/properties', { params })
      properties.value = data.data
      total.value = data.meta?.pagination?.total || 0
    } catch (e: any) {
      console.error('Failed to fetch properties:', e)
      error.value = e.message
    } finally {
      loading.value = false
    }
  }

  async function fetchFocusProperties(params: Record<string, any>) {
    focusLoading.value = true
    try {
      const { data } = await api.get('/properties/focus', { params })
      focusProperties.value = data.data || []
      focusTotal.value = data.meta?.total || 0
      focusAvgScore.value = data.meta?.avgScore ?? null
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
