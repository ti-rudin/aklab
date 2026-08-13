import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref, nextTick, type Ref } from 'vue'

vi.mock('@/api/strapi', () => ({
  default: {
    get: vi.fn(),
  },
}))

import api from '@/api/strapi'
import {
  tagStyle,
  tagLabel,
  deviationStyle,
  FOCUS_AVAILABLE_TAGS,
  useFocusTab,
} from '../useFocusTab'

const mockedApi = vi.mocked(api)

describe('focus display helpers', () => {
  it('returns a style for known and unknown tags', () => {
    expect(tagStyle('undervalued')).toEqual({ background: 'rgba(251,191,36,0.15)', color: '#f59e0b' })
    expect(tagStyle('unknown')).toEqual({ background: 'rgba(107,114,128,0.15)', color: '#6b7280' })
  })

  it('returns translated labels and preserves unknown tags', () => {
    expect(tagLabel('new')).toBe('Новый')
    expect(tagLabel('magic')).toBe('magic')
  })

  it('styles negative deviation by severity', () => {
    expect(deviationStyle(-50).color).toBe('#ef4444')
    expect(deviationStyle(-30).color).toBe('#f97316')
    expect(deviationStyle(-20).color).toBe('#f59e0b')
    expect(deviationStyle(0).color).toBe('#6b7280')
  })

  it('keeps the read-only available tag metadata', () => {
    expect(FOCUS_AVAILABLE_TAGS).toHaveLength(4)
  })
})

describe('useFocusTab', () => {
  let focusTotal: Ref<number>
  let focusItems: Ref<{ documentId: string; status?: string }[]>

  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    focusTotal = ref(0)
    focusItems = ref([])
  })

  function createSut(onFilterChange: () => void = vi.fn()) {
    return useFocusTab(onFilterChange, focusTotal, focusItems)
  }

  it('starts with threshold 20 and only supported filter state', () => {
    const { focusFilters, focusPageSize } = createSut()

    expect(focusFilters.threshold).toBe(20)
    expect(focusFilters.status).toBe('')
    expect(focusFilters).not.toHaveProperty('tags')
    expect(focusFilters).not.toHaveProperty('priceFrom')
    expect(focusFilters).not.toHaveProperty('priceTo')
    expect(focusPageSize).toBeLessThanOrEqual(100)
    expect(mockedApi.get).not.toHaveBeenCalled()
  })

  it('resets threshold synchronously to exactly 20 without reading settings', () => {
    const { focusFilters, resetFocusFilters } = createSut()
    focusFilters.threshold = 75
    focusFilters.status = 'rejected'
    focusFilters.cities.moscow = false
    focusFilters.property_type = ['office']

    resetFocusFilters()

    expect(focusFilters.threshold).toBe(20)
    expect(focusFilters.status).toBe('')
    expect(focusFilters.cities).toEqual({
      moscow: true,
      mo: true,
      tver: true,
      tver_oblast: true,
      other: true,
    })
    expect(focusFilters.property_type).toEqual([])
    expect(mockedApi.get).not.toHaveBeenCalled()
  })

  it('selects and deselects string documentIds, never numeric ids', () => {
    const { focusSelected, toggleFocusSelect } = createSut()

    toggleFocusSelect('doc-a')
    expect(focusSelected.has('doc-a')).toBe(true)
    expect(focusSelected.has(1 as never)).toBe(false)

    toggleFocusSelect('doc-a')
    expect(focusSelected.has('doc-a')).toBe(false)
  })

  it('selects all visible documentIds and reports the checked state', () => {
    focusItems.value = [{ documentId: 'doc-a' }, { documentId: 'doc-b' }]
    const { focusSelected, allFocusChecked, toggleAllFocus } = createSut()

    toggleAllFocus()

    expect([...focusSelected]).toEqual(['doc-a', 'doc-b'])
    expect(allFocusChecked.value).toBe(true)

    toggleAllFocus()
    expect(focusSelected.size).toBe(0)
  })

  it('resets page and refreshes only after switching to focus', () => {
    const onFilterChange = vi.fn()
    const { activeTab, focusPage, switchToFocus } = createSut(onFilterChange)

    focusPage.value = 3
    switchToFocus()

    expect(activeTab.value).toBe('focus')
    expect(focusPage.value).toBe(1)
    expect(onFilterChange).toHaveBeenCalledTimes(1)
  })

  it('computes bounded pagination from the focus total', () => {
    focusTotal.value = 45
    const { focusTotalPages } = createSut()
    expect(focusTotalPages.value).toBe(3)
  })

  it('watches supported filters while the focus tab is active', async () => {
    const onFilterChange = vi.fn()
    const { focusFilters, switchToFocus } = createSut(onFilterChange)
    switchToFocus()
    onFilterChange.mockClear()

    focusFilters.status = 'viewed'
    await nextTick()
    await nextTick()

    expect(onFilterChange).toHaveBeenCalled()
  })
})
