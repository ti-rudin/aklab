/**
 * Composable for property list filters (city, type, status, source, price range).
 * Provides reactive filters with localStorage persistence.
 */
import { reactive, ref, watch } from 'vue'

const STORAGE_KEY = 'aklab-property-filters'

export function usePropertyFilters() {
  const filters = reactive({
    city: [] as string[],
    status: '',
    source: '',
    property_type: [] as string[],
    priceFrom: null as number | null,
    priceTo: null as number | null,
  })

  const searchQuery = ref('')

  // Load from localStorage
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      const parsed = JSON.parse(saved)
      if (parsed.city) filters.city = parsed.city
      if (parsed.source) filters.source = parsed.source
      if (parsed.property_type) filters.property_type = parsed.property_type
      if (parsed.priceFrom != null) filters.priceFrom = parsed.priceFrom
      if (parsed.priceTo != null) filters.priceTo = parsed.priceTo
    }
  } catch {}

  // Save to localStorage on change
  watch(filters, (val) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(val))
    } catch {}
  }, { deep: true })

  function resetFilters() {
    searchQuery.value = ''
    filters.city = []
    filters.status = ''
    filters.source = ''
    filters.property_type = []
    filters.priceFrom = null
    filters.priceTo = null
  }

  return { filters, searchQuery, resetFilters }
}
