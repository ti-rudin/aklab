/**
 * Composable for focus-tab UI state: supported filters, sorting, selection and pagination.
 */
import { ref, reactive, computed, watch, type Ref } from 'vue'
import { createRegionSelection, type RegionSelection } from '@/constants/regions'

/** Tags hidden from UI — city is already shown separately */
export const HIDDEN_TAGS = ['moscow_mo']

export const FOCUS_AVAILABLE_TAGS = [
  { value: 'undervalued', label: 'Недооценён', bgColor: 'rgba(251,191,36,0.15)', textColor: '#f59e0b' },
  { value: 'has_minimum_price', label: 'Торги', bgColor: 'rgba(79,140,255,0.15)', textColor: '#4f8cff' },
  { value: 'new', label: 'Новый', bgColor: 'rgba(16,185,129,0.15)', textColor: '#10b981' },
  { value: 'large_area', label: 'Большая пл.', bgColor: 'rgba(168,85,247,0.15)', textColor: '#a855f7' },
]

export interface FocusItemIdentity {
  documentId: string
}

export interface FocusFilterState {
  threshold: number
  cities: RegionSelection
  property_type: string[]
  status: string
}

// ========================
// Standalone helpers (module-level exports for reuse in PropertyCard/PropertyTable)
// ========================
export function tagStyle(tag: string) {
  const map: Record<string, { bg: string; color: string }> = {
    undervalued: { bg: 'rgba(251,191,36,0.15)', color: '#f59e0b' },
    has_minimum_price: { bg: 'rgba(79,140,255,0.15)', color: '#4f8cff' },
    new: { bg: 'rgba(16,185,129,0.15)', color: '#10b981' },
    large_area: { bg: 'rgba(168,85,247,0.15)', color: '#a855f7' },
    moscow_mo: { bg: 'rgba(20,184,166,0.15)', color: '#14b8a6' },
  }
  const m = map[tag] || { bg: 'rgba(107,114,128,0.15)', color: '#6b7280' }
  return { background: m.bg, color: m.color }
}

export function tagLabel(tag: string) {
  const map: Record<string, string> = {
    undervalued: 'Недооценён',
    has_minimum_price: 'Торги',
    new: 'Новый',
    large_area: 'Большая пл.',
    moscow_mo: 'МСК/МО',
  }
  return map[tag] || tag
}

export function deviationStyle(pct: number) {
  if (pct <= -50) return { background: 'rgba(239,68,68,0.15)', color: '#ef4444' }
  if (pct <= -30) return { background: 'rgba(249,115,22,0.15)', color: '#f97316' }
  if (pct <= -20) return { background: 'rgba(251,191,36,0.15)', color: '#f59e0b' }
  return { background: 'rgba(107,114,128,0.15)', color: '#6b7280' }
}

export function useFocusTab<T extends FocusItemIdentity>(
  onFilterChange: () => void,
  focusTotal: Ref<number>,
  focusItems: Ref<T[]>,
) {
  const activeTab = ref<'all' | 'focus' | 'work'>('all')

  const focusSort = reactive({
    field: 'focus_score' as string,
    direction: 'desc' as 'asc' | 'desc',
  })

  function toggleFocusSort(field: string) {
    if (focusSort.field === field) {
      focusSort.direction = focusSort.direction === 'asc' ? 'desc' : 'asc'
    } else {
      focusSort.field = field
      focusSort.direction = 'desc'
    }
  }

  const focusFilters = reactive<FocusFilterState>({
    threshold: 20,
    cities: createRegionSelection(),
    property_type: [],
    status: '',
  })

  try {
    const saved = localStorage.getItem('aklab-focus-filters')
    if (saved) {
      const parsed = JSON.parse(saved)
      if (parsed.threshold != null) focusFilters.threshold = parsed.threshold
      if (parsed.cities) Object.assign(focusFilters.cities, parsed.cities)
      if (parsed.property_type) {
        focusFilters.property_type = Array.isArray(parsed.property_type)
          ? parsed.property_type
          : [parsed.property_type]
      }
      if (typeof parsed.status === 'string') focusFilters.status = parsed.status
    }
  } catch {
    // Invalid local storage is equivalent to no saved filters.
  }

  watch(focusFilters, (value) => {
    try {
      localStorage.setItem('aklab-focus-filters', JSON.stringify(value))
    } catch {
      // Persistence is best effort and must not block focus actions.
    }
  }, { deep: true })

  function resetFocusFilters() {
    focusFilters.threshold = 20
    Object.assign(focusFilters.cities, createRegionSelection())
    focusFilters.property_type = []
    focusFilters.status = ''
  }

  const focusPage = ref(1)
  const focusPageSize = 20
  const focusTotalPages = computed(() => Math.ceil(focusTotal.value / focusPageSize))

  const focusSelected = reactive(new Set<string>())
  const allFocusChecked = computed(() => {
    if (focusItems.value.length === 0) return false
    return focusItems.value.every(item => focusSelected.has(item.documentId))
  })

  function toggleFocusSelect(documentId: string) {
    if (focusSelected.has(documentId)) {
      focusSelected.delete(documentId)
    } else {
      focusSelected.add(documentId)
    }
  }

  function toggleAllFocus() {
    if (allFocusChecked.value) {
      focusSelected.clear()
    } else {
      focusItems.value.forEach(item => focusSelected.add(item.documentId))
    }
  }

  function switchToFocus() {
    activeTab.value = 'focus'
    focusPage.value = 1
    onFilterChange()
  }

  watch(
    [
      () => focusFilters.threshold,
      () => focusFilters.cities,
      () => focusFilters.property_type,
      () => focusFilters.status,
    ],
    () => {
      if (activeTab.value === 'focus') {
        focusPage.value = 1
        onFilterChange()
      }
    },
    { deep: true },
  )

  watch(focusSort, () => {
    if (activeTab.value === 'focus') {
      focusPage.value = 1
      onFilterChange()
    }
  })

  watch(focusPage, () => {
    if (activeTab.value === 'focus') onFilterChange()
  })

  return {
    activeTab,
    focusSort,
    toggleFocusSort,
    focusFilters,
    resetFocusFilters,
    availableTags: FOCUS_AVAILABLE_TAGS,
    focusPage,
    focusPageSize,
    focusTotalPages,
    focusSelected,
    allFocusChecked,
    toggleFocusSelect,
    toggleAllFocus,
    tagStyle,
    tagLabel,
    deviationStyle,
    switchToFocus,
  }
}
