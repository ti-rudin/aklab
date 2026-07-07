import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref, nextTick, type Ref } from 'vue'
import {
  tagStyle,
  tagLabel,
  deviationStyle,
  FOCUS_AVAILABLE_TAGS,
  useFocusTab,
} from '../useFocusTab'

describe('tagStyle', () => {
  it('returns correct CSS for "undervalued"', () => {
    const s = tagStyle('undervalued')
    expect(s.background).toBe('rgba(251,191,36,0.15)')
    expect(s.color).toBe('#f59e0b')
  })

  it('returns correct CSS for "has_minimum_price"', () => {
    const s = tagStyle('has_minimum_price')
    expect(s.background).toBe('rgba(79,140,255,0.15)')
    expect(s.color).toBe('#4f8cff')
  })

  it('returns correct CSS for "new"', () => {
    const s = tagStyle('new')
    expect(s.background).toBe('rgba(16,185,129,0.15)')
    expect(s.color).toBe('#10b981')
  })

  it('returns correct CSS for "large_area"', () => {
    const s = tagStyle('large_area')
    expect(s.background).toBe('rgba(168,85,247,0.15)')
    expect(s.color).toBe('#a855f7')
  })

  it('returns correct CSS for "moscow_mo"', () => {
    const s = tagStyle('moscow_mo')
    expect(s.background).toBe('rgba(20,184,166,0.15)')
    expect(s.color).toBe('#14b8a6')
  })

  it('returns fallback grey for unknown tag', () => {
    const s = tagStyle('unknown')
    expect(s.background).toBe('rgba(107,114,128,0.15)')
    expect(s.color).toBe('#6b7280')
  })
})

describe('tagLabel', () => {
  it.each([
    ['undervalued', 'Недооценён'],
    ['has_minimum_price', 'Торги'],
    ['new', 'Новый'],
    ['large_area', 'Большая пл.'],
    ['moscow_mo', 'МСК/МО'],
  ])('returns "%s" → "%s"', (tag, expected) => {
    expect(tagLabel(tag)).toBe(expected)
  })

  it('returns the raw tag string for unknown tags', () => {
    expect(tagLabel('magic')).toBe('magic')
  })
})

describe('deviationStyle', () => {
  it('returns red for deviation ≤ -50', () => {
    const s = deviationStyle(-50)
    expect(s.color).toBe('#ef4444')
  })

  it('returns red for very negative deviation', () => {
    const s = deviationStyle(-80)
    expect(s.color).toBe('#ef4444')
  })

  it('returns orange for deviation between -50 and -30', () => {
    const s = deviationStyle(-30)
    expect(s.color).toBe('#f97316')
  })

  it('returns yellow for deviation between -30 and -20', () => {
    const s = deviationStyle(-20)
    expect(s.color).toBe('#f59e0b')
  })

  it('returns grey for deviation > -20', () => {
    const s = deviationStyle(-10)
    expect(s.color).toBe('#6b7280')
  })

  it('returns grey for zero deviation', () => {
    const s = deviationStyle(0)
    expect(s.color).toBe('#6b7280')
  })

  it('returns grey for positive deviation', () => {
    const s = deviationStyle(5)
    expect(s.color).toBe('#6b7280')
  })
})

describe('FOCUS_AVAILABLE_TAGS', () => {
  it('contains 4 tags', () => {
    expect(FOCUS_AVAILABLE_TAGS).toHaveLength(4)
  })

  it('each tag has value, label, bgColor, textColor', () => {
    for (const tag of FOCUS_AVAILABLE_TAGS) {
      expect(tag).toHaveProperty('value')
      expect(tag).toHaveProperty('label')
      expect(tag).toHaveProperty('bgColor')
      expect(tag).toHaveProperty('textColor')
    }
  })
})

// ─────────────────────────────────────────────────────────────────
// useFocusTab composable
// ─────────────────────────────────────────────────────────────────
describe('useFocusTab', () => {
  const noop = () => {}
  let focusTotal: Ref<number>
  let focusItems: Ref<{ id: number }[]>

  beforeEach(() => {
    localStorage.clear()
    focusTotal = ref(0)
    focusItems = ref([])
  })

  function createSut(onFilterChange: () => void = noop) {
    return useFocusTab(onFilterChange, focusTotal, focusItems)
  }

  // ── initial state ──────────────────────────────────────────────
  it('starts with activeTab "all"', () => {
    const { activeTab } = createSut()
    expect(activeTab.value).toBe('all')
  })

  it('starts with default focusSort (focus_score / desc)', () => {
    const { focusSort } = createSut()
    expect(focusSort.field).toBe('focus_score')
    expect(focusSort.direction).toBe('desc')
  })

  it('starts with default filters (threshold=20, all cities on)', () => {
    const { focusFilters } = createSut()
    expect(focusFilters.threshold).toBe(20)
    expect(focusFilters.cities.moscow).toBe(true)
    expect(focusFilters.cities.mo).toBe(true)
    expect(focusFilters.cities.other).toBe(true)
    expect(focusFilters.property_type).toEqual([])
    expect(focusFilters.tags).toEqual([])
  })

  it('starts with empty selection', () => {
    const { focusSelected, allFocusChecked } = createSut()
    expect(focusSelected.size).toBe(0)
    expect(allFocusChecked.value).toBe(false)
  })

  // ── toggleFocusSort ────────────────────────────────────────────
  describe('toggleFocusSort', () => {
    it('toggles direction when same field', () => {
      const { focusSort, toggleFocusSort } = createSut()
      expect(focusSort.direction).toBe('desc')
      toggleFocusSort('focus_score')
      expect(focusSort.direction).toBe('asc')
      toggleFocusSort('focus_score')
      expect(focusSort.direction).toBe('desc')
    })

    it('switches field and resets direction to desc', () => {
      const { focusSort, toggleFocusSort } = createSut()
      focusSort.direction = 'asc'
      toggleFocusSort('price')
      expect(focusSort.field).toBe('price')
      expect(focusSort.direction).toBe('desc')
    })
  })

  // ── switchToFocus ──────────────────────────────────────────────
  describe('switchToFocus', () => {
    it('sets activeTab to "focus", resets page, calls onFilterChange', () => {
      const cb = vi.fn()
      const { activeTab, focusPage, switchToFocus } = createSut(cb)

      focusPage.value = 3
      switchToFocus()

      expect(activeTab.value).toBe('focus')
      expect(focusPage.value).toBe(1)
      expect(cb).toHaveBeenCalledTimes(1)
    })
  })

  // ── resetFocusFilters ──────────────────────────────────────────
  describe('resetFocusFilters', () => {
    it('resets filters to defaults', () => {
      const { focusFilters, resetFocusFilters } = createSut()

      focusFilters.threshold = 50
      focusFilters.cities.moscow = false
      focusFilters.property_type = ['apartment']
      focusFilters.tags = ['undervalued']
      focusFilters.priceFrom = '100'
      focusFilters.priceTo = '500'

      resetFocusFilters()

      expect(focusFilters.threshold).toBe(20)
      expect(focusFilters.cities.moscow).toBe(true)
      expect(focusFilters.cities.mo).toBe(true)
      expect(focusFilters.cities.other).toBe(true)
      expect(focusFilters.property_type).toEqual([])
      expect(focusFilters.tags).toEqual([])
      expect(focusFilters.priceFrom).toBe('')
      expect(focusFilters.priceTo).toBe('')
    })
  })

  // ── selection ──────────────────────────────────────────────────
  describe('selection', () => {
    it('toggleFocusSelect adds and removes id', () => {
      const { focusSelected, toggleFocusSelect } = createSut()

      toggleFocusSelect(1)
      expect(focusSelected.has(1)).toBe(true)

      toggleFocusSelect(1)
      expect(focusSelected.has(1)).toBe(false)
    })

    it('toggleAllFocus selects all items when none selected', () => {
      focusItems.value = [{ id: 1 }, { id: 2 }, { id: 3 }]
      const { focusSelected, toggleAllFocus } = createSut()

      toggleAllFocus()

      expect(focusSelected.size).toBe(3)
      expect(focusSelected.has(1)).toBe(true)
      expect(focusSelected.has(2)).toBe(true)
      expect(focusSelected.has(3)).toBe(true)
    })

    it('toggleAllFocus clears all when all selected', () => {
      focusItems.value = [{ id: 1 }, { id: 2 }]
      const { focusSelected, toggleAllFocus } = createSut()

      // select all first
      toggleAllFocus()
      expect(focusSelected.size).toBe(2)

      // toggle again → deselect all
      toggleAllFocus()
      expect(focusSelected.size).toBe(0)
    })

    it('allFocusChecked is true only when every item is selected', () => {
      focusItems.value = [{ id: 1 }, { id: 2 }]
      const { focusSelected, allFocusChecked, toggleFocusSelect } = createSut()

      toggleFocusSelect(1)
      expect(allFocusChecked.value).toBe(false)

      toggleFocusSelect(2)
      expect(allFocusChecked.value).toBe(true)
    })
  })

  // ── pagination ─────────────────────────────────────────────────
  describe('pagination', () => {
    it('focusTotalPages is computed from focusTotal and pageSize', () => {
      focusTotal.value = 45
      const { focusTotalPages, focusPageSize } = createSut()

      expect(focusPageSize).toBe(20)
      expect(focusTotalPages.value).toBe(3) // ceil(45/20)
    })

    it('focusTotalPages is 0 when focusTotal is 0', () => {
      const { focusTotalPages } = createSut()
      expect(focusTotalPages.value).toBe(0)
    })
  })

  // ── localStorage persistence ───────────────────────────────────
  describe('localStorage persistence', () => {
    it('restores filters from localStorage on init', () => {
      const saved = {
        threshold: 40,
        cities: { moscow: false, mo: true, other: false },
        property_type: ['house'],
        tags: ['undervalued', 'new'],
        priceFrom: '1000',
        priceTo: '5000',
      }
      localStorage.setItem('aklab-focus-filters', JSON.stringify(saved))

      const { focusFilters } = createSut()

      expect(focusFilters.threshold).toBe(40)
      expect(focusFilters.cities.moscow).toBe(false)
      expect(focusFilters.cities.mo).toBe(true)
      expect(focusFilters.cities.other).toBe(false)
      expect(focusFilters.property_type).toEqual(['house'])
      expect(focusFilters.tags).toEqual(['undervalued', 'new'])
      expect(focusFilters.priceFrom).toBe('1000')
      expect(focusFilters.priceTo).toBe('5000')
    })

    it('handles non-array property_type in localStorage (string)', () => {
      const saved = { threshold: 30, property_type: 'apartment' }
      localStorage.setItem('aklab-focus-filters', JSON.stringify(saved))

      const { focusFilters } = createSut()
      expect(focusFilters.property_type).toEqual(['apartment'])
    })

    it('saves filters to localStorage on change (via watch)', async () => {
      const { focusFilters } = createSut()

      focusFilters.threshold = 55
      await nextTick()
      // watch is async — flush
      await vi.waitFor(() => {
        const stored = JSON.parse(localStorage.getItem('aklab-focus-filters')!)
        expect(stored.threshold).toBe(55)
      })
    })

    it('uses defaults when localStorage has no saved filters', () => {
      const { focusFilters } = createSut()
      expect(focusFilters.threshold).toBe(20)
    })

    it('handles invalid JSON in localStorage gracefully', () => {
      localStorage.setItem('aklab-focus-filters', '{invalid json')

      // should not throw
      const { focusFilters } = createSut()
      expect(focusFilters.threshold).toBe(20)
    })
  })

  // ── watchers trigger onFilterChange ────────────────────────────
  describe('watchers', () => {
    it('filter change triggers onFilterChange when on focus tab', async () => {
      const cb = vi.fn()
      const { activeTab, switchToFocus, focusFilters } = createSut(cb)

      switchToFocus() // sets activeTab='focus' and calls cb once
      cb.mockClear()

      focusFilters.threshold = 50
      await nextTick()
      await nextTick() // extra tick for watch flush

      expect(cb).toHaveBeenCalled()
    })

    it('filter change does NOT trigger onFilterChange when on "all" tab', async () => {
      const cb = vi.fn()
      const { focusFilters } = createSut(cb)

      focusFilters.threshold = 50
      await nextTick()
      await nextTick()

      expect(cb).not.toHaveBeenCalled()
    })
  })
})
