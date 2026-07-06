<template>
  <!-- Stats header -->
  <div class="mb-4 text-sm font-medium" style="color: var(--text-main)">
    В фокусе: <span class="font-bold">{{ focusTotal }}</span> объектов
    <template v-if="focusAvgScore !== null"> · Средний скор: <span class="font-bold">{{ focusAvgScore }}</span></template>
  </div>

  <!-- Action buttons -->
  <div class="flex flex-col sm:flex-row gap-2 sm:gap-3 mb-4">
    <button
      @click="recalculateScore"
      :disabled="scoringLoading"
      class="w-full sm:w-auto px-4 py-2.5 sm:py-2 rounded-lg text-sm font-semibold transition-all duration-200 hover:opacity-90 disabled:opacity-50"
      style="background: var(--bg-elevated); border: 1px solid var(--border-subtle); color: var(--text-main)"
    >
      {{ scoringLoading ? 'Пересчёт...' : '🔄 Пересчитать' }}
    </button>

    <!-- Прогресс анализа -->
    <div v-if="analyzeProgress && !analyzeProgress.done" class="flex items-center gap-3 text-sm" style="color: var(--text-muted)">
      <div class="flex-1 max-w-xs h-2 rounded-full overflow-hidden" style="background: var(--bg-elevated)">
        <div class="h-full rounded-full transition-all duration-500" style="background: #f59e0b"
          :style="{ width: Math.round(analyzeProgress.analyzed / analyzeProgress.total * 100) + '%' }"></div>
      </div>
      <span class="font-mono whitespace-nowrap">{{ analyzeProgress.analyzed }} / {{ analyzeProgress.total }}</span>
    </div>
    <div v-if="analyzeProgress?.done" class="flex items-center gap-2 text-sm" style="color: #22c55e">
      ✓ Проанализировано: {{ analyzeProgress.analyzed }}, недооценённых: {{ analyzeProgress.undervalued }}
    </div>

    <button
      @click="exportCSV"
      class="w-full sm:w-auto px-4 py-2.5 sm:py-2 rounded-lg text-sm font-semibold transition-all duration-200 hover:opacity-90"
      style="background: var(--bg-elevated); border: 1px solid var(--border-subtle); color: var(--text-main)"
    >
      📥 Экспорт CSV
    </button>

    <ViewToggle v-model="viewMode" class="sm:ml-auto" />
  </div>

  <!-- Focus filters -->
  <div class="rounded-xl p-3 sm:p-4 border mb-6 space-y-3" style="background: var(--bg-elevated); border-color: var(--border-subtle)">
    <!-- Поиск -->
    <div class="relative">
      <span class="absolute left-3 top-1/2 -translate-y-1/2 text-sm" style="color: var(--text-muted)">🔍</span>
      <input v-model="searchQuery" type="text" placeholder="Поиск по названию или адресу..."
        class="w-full pl-9 pr-3 py-2 rounded-lg border text-sm"
        style="background: var(--bg-main); border-color: var(--border-subtle); color: var(--text-main)" />
    </div>
    <!-- Мобильный тоггл фильтров -->
    <button @click="focusFiltersOpen = !focusFiltersOpen"
      class="sm:hidden flex items-center gap-2 text-sm w-full py-1"
      style="color: var(--text-muted)">
      <span>{{ focusFiltersOpen ? '▼' : '▶' }}</span>
      <span>Фильтры</span>
    </button>
    <div class="grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" :class="focusFiltersOpen ? 'grid' : 'hidden sm:grid'">
      <!-- Порог (threshold) -->
      <div>
        <label class="block text-xs font-medium mb-2" style="color: var(--text-muted)">
          Порог: <span class="font-semibold" style="color: var(--text-main)">{{ focusFilters.threshold }}</span>
        </label>
        <div class="flex items-center gap-3">
          <input v-model.number="focusFilters.threshold" type="range" min="0" max="100" step="1"
            class="flex-1 min-w-0" style="accent-color: var(--accent)" />
          <input v-model.number="focusFilters.threshold" type="number" min="0" max="100"
            class="w-16 flex-shrink-0 px-2 py-1 rounded-lg border text-sm text-center"
            style="background: var(--bg-main); border-color: var(--border-subtle); color: var(--text-main)" />
        </div>
      </div>

      <!-- Город (checkboxes) -->
      <div>
        <label class="block text-xs font-medium mb-2" style="color: var(--text-muted)">Город</label>
        <div class="flex flex-wrap gap-3">
          <label class="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" v-model="focusFilters.cities.moscow" class="rounded" style="accent-color: var(--accent)" />
            <span class="text-sm" style="color: var(--text-main)">Москва</span>
          </label>
          <label class="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" v-model="focusFilters.cities.mo" class="rounded" style="accent-color: var(--accent)" />
            <span class="text-sm" style="color: var(--text-main)">МО</span>
          </label>
          <label class="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" v-model="focusFilters.cities.other" class="rounded" style="accent-color: var(--accent)" />
            <span class="text-sm" style="color: var(--text-main)">Другие</span>
          </label>
        </div>
      </div>

      <!-- Тип недвижимости -->
      <div>
        <label class="block text-xs font-medium mb-2" style="color: var(--text-muted)">Тип недвижимости</label>
        <FilterChips v-model="focusFilters.property_type" :options="typeOptions" />
      </div>

      <!-- Теги -->
      <div class="sm:col-span-2 lg:col-span-1">
        <label class="block text-xs font-medium mb-2" style="color: var(--text-muted)">Теги</label>
        <div class="flex flex-wrap gap-2">
          <label v-for="tag in availableTags" :key="tag.value" class="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" :value="tag.value" v-model="focusFilters.tags" class="rounded" style="accent-color: var(--accent)" />
            <span class="text-xs px-1.5 py-0.5 rounded-full" :style="{ background: tag.bgColor, color: tag.textColor }">{{ tag.label }}</span>
          </label>
        </div>
      </div>

      <!-- Цена -->
      <div>
        <label class="block text-xs font-medium mb-2" style="color: var(--text-muted)">Цена (₽)</label>
        <div class="flex gap-2 items-center">
          <input v-model="focusFilters.priceFrom" type="number" placeholder="от" min="0"
            class="w-full px-2 py-1.5 rounded-lg border text-sm"
            style="background: var(--bg-main); border-color: var(--border-subtle); color: var(--text-main)" />
          <span class="text-sm" style="color: var(--text-muted)">—</span>
          <input v-model="focusFilters.priceTo" type="number" placeholder="до" min="0"
            class="w-full px-2 py-1.5 rounded-lg border text-sm"
            style="background: var(--bg-main); border-color: var(--border-subtle); color: var(--text-main)" />
        </div>
      </div>
    </div>

    <!-- Reset -->
    <div class="mt-3 pt-2 border-t flex justify-end" style="border-color: var(--border-subtle)">
      <button @click="resetFocusFilters" class="text-sm px-3 py-1.5 rounded-lg hover:opacity-80"
        style="color: var(--text-muted)">Сбросить фильтры</button>
    </div>
  </div>

  <!-- Loading -->
  <SkeletonTable v-if="focusLoading" :rows="6" />

  <!-- Пусто -->
  <div v-else-if="filteredFocusItems.length === 0" class="text-center py-16">
    <p class="text-lg mb-2" style="color: var(--text-muted)">Нет объектов в фокусе</p>
    <p class="text-sm" style="color: var(--text-muted)">Запустите пересчёт скоров или измените фильтры</p>
  </div>

  <!-- Focus Карточки -->
  <div v-else-if="viewMode === 'cards'" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
    <PropertyCard
      v-for="item in filteredFocusItems"
      :key="item.id"
      :item="item"
      variant="focus"
      :selected="focusSelected.has(item.id)"

      @toggle-select="toggleFocusSelect(item.id)"
      @bulk-status="bulkSetStatus"
      @bulk-csv="bulkExportCSV"
    />
  </div>

  <!-- Focus Таблица -->
  <PropertyTable
    v-else
    :items="filteredFocusItems"
    variant="focus"
    :selected-ids="focusSelected"
    :all-selected="allFocusChecked"
    :sort-field="focusSort.field"
    :sort-direction="focusSort.direction"
    @open="openProperty"
    @toggle-select="toggleFocusSelect"
    @toggle-all="toggleAllFocus"
    @sort="toggleFocusSort"
  />

  <!-- Focus Pagination -->
  <div v-if="focusTotalPages > 1" class="flex justify-between items-center mt-6">
    <span class="text-xs" style="color: var(--text-muted)">
      Показано {{ (focusPage - 1) * focusPageSize + 1 }}-{{ Math.min(focusPage * focusPageSize, focusTotal) }} из {{ focusTotal }}
    </span>
    <div class="flex gap-2">
      <button @click="focusPage > 1 && focusPage--" :disabled="focusPage <= 1"
        class="px-3 py-1 rounded-lg text-sm disabled:opacity-40"
        :style="{ background: 'var(--bg-elevated)', color: 'var(--text-main)', border: '1px solid var(--border-subtle)' }">
        ‹ Назад
      </button>
      <button @click="focusPage < focusTotalPages && focusPage++" :disabled="focusPage >= focusTotalPages"
        class="px-3 py-1 rounded-lg text-sm disabled:opacity-40"
        :style="{ background: 'var(--bg-elevated)', color: 'var(--text-main)', border: '1px solid var(--border-subtle)' }">
        Вперёд ›
      </button>
    </div>
  </div>

  <!-- Bulk action bar (floating) -->
  <div v-if="focusSelected.size > 0"
    class="fixed bottom-6 left-1/2 -translate-x-1/2 px-5 py-3 rounded-2xl shadow-2xl flex items-center gap-4 z-50"
    style="background: var(--bg-elevated); border: 1px solid var(--border-subtle)"
    role="toolbar" aria-label="Действия с выбранными объектами">
    <span class="text-sm font-medium" style="color: var(--text-main)" aria-live="polite">Выбрано: {{ focusSelected.size }}</span>
    <div class="flex gap-2">
      <button @click="bulkSetStatus('viewed')" class="text-xs px-3 py-1.5 rounded-lg hover:opacity-80" style="background: rgba(16,185,129,0.15); color: #10b981" aria-label="Отметить как просмотрено">Просмотрено</button>
      <button @click="bulkSetStatus('rejected')" class="text-xs px-3 py-1.5 rounded-lg hover:opacity-80" style="background: rgba(239,68,68,0.15); color: #ef4444" aria-label="Отметить как отклонённые">Отклонён</button>
      <button @click="bulkExportCSV" class="text-xs px-3 py-1.5 rounded-lg hover:opacity-80" style="background: rgba(79,140,255,0.15); color: #4f8cff" aria-label="Экспорт выбранных в CSV">CSV</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import api from '@/api/strapi'
import SkeletonTable from '@/components/SkeletonTable.vue'
import PropertyCard from '@/components/properties/PropertyCard.vue'
import PropertyTable from '@/components/properties/PropertyTable.vue'
import ViewToggle from '@/components/properties/ViewToggle.vue'
import FilterChips from '@/components/properties/FilterChips.vue'
import { usePropertyData } from '@/composables/usePropertyData'
import { useFocusTab } from '@/composables/useFocusTab'
import { cityLabel, typeLabel } from '@/utils/formatters'
import { useToast } from '@/composables/useToast'

const router = useRouter()
const toast = useToast()

const {
  focusProperties: focusItems,
  focusLoading,
  focusTotal,
  focusAvgScore,
  fetchFocusProperties,
} = usePropertyData()

// ========================
// Focus tab composable
// ========================
let doFetchFocus: () => void = () => {}

const {
  activeTab,
  focusSort,
  toggleFocusSort,
  focusFilters,
  resetFocusFilters,
  availableTags,
  focusPage,
  focusPageSize,
  focusTotalPages,
  focusSelected,
  allFocusChecked,
  toggleFocusSelect,
  toggleAllFocus,
} = useFocusTab(() => doFetchFocus(), focusTotal, focusItems)

// ========================
// Options
// ========================
const typeOptions = [
  { value: 'office', label: 'Офис' },
  { value: 'warehouse', label: 'Склад' },
  { value: 'retail', label: 'Торговля' },
  { value: 'free_purpose', label: 'Св. назн.' },
  { value: 'apartment', label: 'Квартира' },
  { value: 'land', label: 'Участок' },
  { value: 'other', label: 'Другое' },
]

// ========================
// View mode (persisted)
// ========================
const viewMode = ref<'cards' | 'table'>((localStorage.getItem('aklab-view-mode') as 'cards' | 'table') || 'cards')

// ========================
// Mobile filter toggle
// ========================
const focusFiltersOpen = ref(false)

// ========================
// Search (server-side, debounce)
// ========================
const searchQuery = ref('')
const filteredFocusItems = computed(() => focusItems.value)

let searchDebounce: ReturnType<typeof setTimeout> | null = null
watch(searchQuery, () => {
  if (searchDebounce) clearTimeout(searchDebounce)
  searchDebounce = setTimeout(() => {
    focusPage.value = 1
    fetchFocusItems()
  }, 300)
})

// ========================
// Fetch
// ========================
function fetchFocusItems() {
  const sortParam = `${focusSort.direction === 'desc' ? '-' : ''}${focusSort.field}`

  const cityList: string[] = []
  if (focusFilters.cities.moscow) cityList.push('moscow')
  if (focusFilters.cities.mo) cityList.push('mo')
  if (focusFilters.cities.other) cityList.push('other')

  const params: any = {
    threshold: focusFilters.threshold,
    sort: sortParam,
    page: focusPage.value,
    pageSize: focusPageSize,
  }
  if (cityList.length > 0 && cityList.length < 3) params.city = cityList.join(',')
  if (focusFilters.property_type.length) params.property_type = focusFilters.property_type.join(',')
  if (focusFilters.tags.length > 0) params.tags = focusFilters.tags.join(',')
  if (focusFilters.priceFrom) params.priceFrom = focusFilters.priceFrom
  if (focusFilters.priceTo) params.priceTo = focusFilters.priceTo
  if (searchQuery.value.trim()) params.search = searchQuery.value.trim()

  fetchFocusProperties(params)
}

doFetchFocus = fetchFocusItems

// ========================
// Recalculate scoring
// ========================
const scoringLoading = ref(false)
const analyzeProgress = ref<{ total: number; analyzed: number; remaining: number; undervalued: number; done: boolean } | null>(null)

async function recalculateScore() {
  scoringLoading.value = true
  analyzeProgress.value = null
  try {
    const cityList: string[] = []
    if (focusFilters.cities.moscow) cityList.push('moscow')
    if (focusFilters.cities.mo) cityList.push('mo')
    if (focusFilters.cities.other) cityList.push('other')

    // Шаг 1: Анализ (deviation от эталонов) — force=true для пересчёта
    const analyzeBody: any = { force: true }
    if (cityList.length > 0 && cityList.length < 3) analyzeBody.city = cityList
    if (focusFilters.priceFrom) analyzeBody.priceFrom = Number(focusFilters.priceFrom)
    if (focusFilters.priceTo) analyzeBody.priceTo = Number(focusFilters.priceTo)
    if (focusFilters.threshold) analyzeBody.threshold = focusFilters.threshold
    await api.post('/cron/analyze', analyzeBody)

    // Поллинг прогресса анализа
    for (let i = 0; i < 120; i++) { // макс 2 мин (120 × 1с)
      await new Promise(r => setTimeout(r, 1000))
      try {
        const { data } = await api.get('/cron/analyze-progress')
        analyzeProgress.value = data
        if (data.done) break
      } catch { /* DB может быть занят — retry */ }
    }

    // Шаг 2: Scoring (focus_score + tags)
    const scoreBody: any = { threshold: focusFilters.threshold }
    if (cityList.length > 0 && cityList.length < 3) scoreBody.city = cityList
    if (focusFilters.priceFrom) scoreBody.priceFrom = Number(focusFilters.priceFrom)
    if (focusFilters.priceTo) scoreBody.priceTo = Number(focusFilters.priceTo)
    await api.post('/cron/score', scoreBody)

    // Обновляем список
    await fetchFocusItems()
  } catch (e: any) {
    toast.error('Ошибка пересчёта: ' + (e.response?.data?.error?.message || e.message))
  } finally {
    scoringLoading.value = false
  }
}

// ========================
// CSV Export
// ========================
async function exportCSV() {
  try {
    const cityList: string[] = []
    if (focusFilters.cities.moscow) cityList.push('moscow')
    if (focusFilters.cities.mo) cityList.push('mo')
    if (focusFilters.cities.other) cityList.push('other')

    const sortParam = `${focusSort.direction === 'desc' ? '-' : ''}${focusSort.field}`

    const params: any = {
      threshold: focusFilters.threshold,
      sort: sortParam,
      page: 1,
      pageSize: 1000,
    }
    if (cityList.length > 0 && cityList.length < 3) params.city = cityList.join(',')
    if (focusFilters.property_type.length) params.property_type = focusFilters.property_type.join(',')
    if (focusFilters.tags.length > 0) params.tags = focusFilters.tags.join(',')
    if (focusFilters.priceFrom) params.priceFrom = focusFilters.priceFrom
    if (focusFilters.priceTo) params.priceTo = focusFilters.priceTo

    const { data } = await api.get('/properties/focus', { params })
    const rows = data.data || []

    generateCSV(rows)
  } catch (e: any) {
    toast.error('Ошибка экспорта: ' + (e.response?.data?.error?.message || e.message))
  }
}

function generateCSV(rows: any[]) {
  const header = ['Название', 'Адрес', 'Город', 'Тип', 'Площадь', 'Цена', '₽/м²', 'Скор', 'Теги', 'Ссылка']
  const csvRows = [header.join(';')]

  for (const row of rows) {
    const link = `${window.location.origin}/properties/${row.documentId}`
    const values = [
      escapeCSV(row.title),
      escapeCSV(row.address || ''),
      escapeCSV(cityLabel(row.city)),
      escapeCSV(typeLabel(row.property_type)),
      row.area_sqm || '',
      row.price || '',
      row.price_per_sqm || '',
      row.focus_score ?? '',
      escapeCSV((row.tags || []).join(', ')),
      link,
    ]
    csvRows.push(values.join(';'))
  }

  const BOM = '\uFEFF'
  const blob = new Blob([BOM + csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `focus_export_${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function escapeCSV(val: string): string {
  if (!val) return ''
  if (val.includes(';') || val.includes('"') || val.includes('\n')) {
    return `"${val.replace(/"/g, '""')}"`
  }
  return val
}

// ========================
// Bulk actions
// ========================
async function bulkSetStatus(status: string) {
  const ids = Array.from(focusSelected)
  try {
    await Promise.all(ids.map(id => {
      const item = focusItems.value.find(i => i.id === id)
      if (!item) return Promise.resolve()
      return api.put(`/properties/${item.documentId}`, { data: { status } })
    }))
    focusSelected.clear()
    await fetchFocusItems()
  } catch (e: any) {
    toast.error('Ошибка: ' + (e.response?.data?.error?.message || e.message))
  }
}

async function bulkExportCSV() {
  const ids = Array.from(focusSelected)
  const rows = focusItems.value.filter(i => ids.includes(i.id))
  generateCSV(rows)
}

// ========================
// Navigation
// ========================
function openProperty(item: { documentId: string }) {
  router.push(`/properties/${item.documentId}`)
}

// ========================
// Expose for parent
// ========================
defineExpose({ total: focusTotal })

// ========================
// Lifecycle
// ========================
onMounted(() => {
  activeTab.value = 'focus'
  fetchFocusItems()
})
</script>
