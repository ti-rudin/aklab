/**
 * Composable for focus-tab UI state: filters, sorting, selection, pagination, tag helpers.
 * Extracted from PropertyListView.vue.
 * Does NOT include data fetching (see usePropertyData) or CSV/bulk actions.
 */
import { ref, reactive, computed, watch, type Ref } from 'vue'

export const FOCUS_AVAILABLE_TAGS = [
  { value: 'undervalued', label: 'Недооценён', bgColor: 'rgba(251,191,36,0.15)', textColor: '#f59e0b' },
  { value: 'has_minimum_price', label: 'Торги', bgColor: 'rgba(79,140,255,0.15)', textColor: '#4f8cff' },
  { value: 'new', label: 'Новый', bgColor: 'rgba(16,185,129,0.15)', textColor: '#10b981' },
  { value: 'large_area', label: 'Большая пл.', bgColor: 'rgba(168,85,247,0.15)', textColor: '#a855f7' },
  { value: 'moscow_mo', label: 'МСК/МО', bgColor: 'rgba(20,184,166,0.15)', textColor: '#14b8a6' },
]

export function useFocusTab(
  onFilterChange: () => void,
  focusTotal: Ref<number>,
  focusItems: Ref<{ id: number }[]>,
) {
  // ========================
  // Tab state
  // ========================
  const activeTab = ref<'all' | 'focus'>('all')

  // ========================
  // Sort
  // ========================
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

  // ========================
  // Filters
  // ========================
  const focusFilters = reactive({
    threshold: 20,
    cities: { moscow: true, mo: true, other: true },
    property_type: '',
    tags: [] as string[],
    priceFrom: '',
    priceTo: '',
  })

  // Load from localStorage
  try {
    const saved = localStorage.getItem('aklab-focus-filters')
    if (saved) {
      const parsed = JSON.parse(saved)
      if (parsed.threshold != null) focusFilters.threshold = parsed.threshold
      if (parsed.cities) Object.assign(focusFilters.cities, parsed.cities)
      if (parsed.property_type) focusFilters.property_type = parsed.property_type
      if (parsed.tags) focusFilters.tags = parsed.tags
      if (parsed.priceFrom) focusFilters.priceFrom = parsed.priceFrom
      if (parsed.priceTo) focusFilters.priceTo = parsed.priceTo
    }
  } catch {}

  // Save to localStorage on change
  watch(focusFilters, (val) => {
    try {
      localStorage.setItem('aklab-focus-filters', JSON.stringify(val))
    } catch {}
  }, { deep: true })

  function resetFocusFilters() {
    focusFilters.threshold = 20
    focusFilters.cities.moscow = true
    focusFilters.cities.mo = true
    focusFilters.cities.other = true
    focusFilters.property_type = ''
    focusFilters.tags = []
    focusFilters.priceFrom = ''
    focusFilters.priceTo = ''
  }

  // ========================
  // Pagination
  // ========================
  const focusPage = ref(1)
  const focusPageSize = 20
  const focusTotalPages = computed(() => Math.ceil(focusTotal.value / focusPageSize))

  // ========================
  // Selection
  // ========================
  const focusSelected = reactive(new Set<number>())
  const allFocusChecked = computed(() => {
    if (focusItems.value.length === 0) return false
    return focusItems.value.every(item => focusSelected.has(item.id))
  })

  function toggleFocusSelect(id: number) {
    if (focusSelected.has(id)) {
      focusSelected.delete(id)
    } else {
      focusSelected.add(id)
    }
  }

  function toggleAllFocus() {
    if (allFocusChecked.value) {
      focusSelected.clear()
    } else {
      focusItems.value.forEach(item => focusSelected.add(item.id))
    }
  }

  // ========================
  // Tag / deviation helpers
  // ========================
  function tagStyle(tag: string) {
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

  function tagLabel(tag: string) {
    const map: Record<string, string> = {
      undervalued: 'Недооценён',
      has_minimum_price: 'Торги',
      new: 'Новый',
      large_area: 'Большая пл.',
      moscow_mo: 'МСК/МО',
    }
    return map[tag] || tag
  }

  function deviationStyle(pct: number) {
    if (pct <= -50) return { background: 'rgba(239,68,68,0.15)', color: '#ef4444' }
    if (pct <= -30) return { background: 'rgba(249,115,22,0.15)', color: '#f97316' }
    if (pct <= -20) return { background: 'rgba(251,191,36,0.15)', color: '#f59e0b' }
    return { background: 'rgba(107,114,128,0.15)', color: '#6b7280' }
  }

  // ========================
  // Switch to focus tab
  // ========================
  function switchToFocus() {
    activeTab.value = 'focus'
    focusPage.value = 1
    onFilterChange()
  }

  // ========================
  // Watchers — auto-refresh on filter/sort/page changes
  // ========================
  watch(
    [
      () => focusFilters.threshold,
      () => focusFilters.cities,
      () => focusFilters.property_type,
      () => focusFilters.tags,
      () => focusFilters.priceFrom,
      () => focusFilters.priceTo,
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
    if (activeTab.value === 'focus') {
      onFilterChange()
    }
  })

  return {
    activeTab,
    // Sort
    focusSort,
    toggleFocusSort,
    // Filters
    focusFilters,
    resetFocusFilters,
    availableTags: FOCUS_AVAILABLE_TAGS,
    // Pagination
    focusPage,
    focusPageSize,
    focusTotalPages,
    // Selection
    focusSelected,
    allFocusChecked,
    toggleFocusSelect,
    toggleAllFocus,
    // Helpers
    tagStyle,
    tagLabel,
    deviationStyle,
    // Actions
    switchToFocus,
  }
}
