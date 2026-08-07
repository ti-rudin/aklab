/**
 * Supported catalog filters only.
 *
 * The scoped API does not expose source/price/newSince or nested filter
 * controls. Persist only the two flat multi-value filters; search is a
 * transient view concern.
 */
import { reactive, ref, watch } from 'vue'

const STORAGE_KEY = 'aklab-property-filters'

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
    .map(item => item.trim())
    .filter(Boolean)
}

export function usePropertyFilters() {
  const filters = reactive({
    city: [] as string[],
    property_type: [] as string[],
  })

  const searchQuery = ref('')

  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      const parsed = JSON.parse(saved)
      filters.city = stringArray(parsed.city)
      filters.property_type = stringArray(parsed.property_type)
    }
  } catch {
    // localStorage is optional (private browsing/corrupt legacy value).
  }

  watch(filters, (value) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        city: value.city,
        property_type: value.property_type,
      }))
    } catch {
      // Ignore storage quota/privacy errors; the in-memory filters remain valid.
    }
  }, { deep: true })

  function resetFilters() {
    searchQuery.value = ''
    filters.city = []
    filters.property_type = []
  }

  return { filters, searchQuery, resetFilters }
}
