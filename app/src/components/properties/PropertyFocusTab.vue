<template>
  <!-- Stats header -->
  <div class="mb-4 text-sm font-medium" style="color: var(--text-main)">
    В фокусе: <span class="font-bold">{{ focusTotal }}</span> объектов
  </div>

  <!-- Actions -->
  <div class="flex flex-col sm:flex-row gap-2 sm:gap-3 mb-4">
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
    <!-- Search -->
    <div class="relative">
      <span class="absolute left-3 top-1/2 -translate-y-1/2 text-sm" style="color: var(--text-muted)">🔍</span>
      <input v-model="searchQuery" type="text" placeholder="Поиск по названию или адресу..."
        class="w-full pl-9 pr-3 py-2 rounded-lg border text-sm"
        style="background: var(--bg-main); border-color: var(--border-subtle); color: var(--text-main)" />
    </div>

    <button @click="focusFiltersOpen = !focusFiltersOpen"
      class="sm:hidden flex items-center gap-2 text-sm w-full py-1"
      style="color: var(--text-muted)">
      <span>{{ focusFiltersOpen ? '▼' : '▶' }}</span>
      <span>Фильтры</span>
    </button>

    <div class="grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" :class="focusFiltersOpen ? 'grid' : 'hidden sm:grid'">
      <!-- Threshold -->
      <div>
        <label class="block text-xs font-medium mb-2" style="color: var(--text-muted)">
          Порог: <span class="font-semibold" style="color: var(--text-main)">{{ focusFilters.threshold }}</span>
        </label>
        <div class="flex items-center gap-3">
          <input v-model.number="focusFilters.threshold" type="range" min="1" max="100" step="1"
            class="flex-1 min-w-0" style="accent-color: var(--accent)" />
          <input v-model.number="focusFilters.threshold" type="number" min="1" max="100"
            class="w-16 flex-shrink-0 px-2 py-1 rounded-lg border text-sm text-center"
            style="background: var(--bg-main); border-color: var(--border-subtle); color: var(--text-main)" />
        </div>
      </div>

      <!-- City -->
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

      <!-- Property type -->
      <div>
        <label class="block text-xs font-medium mb-2" style="color: var(--text-muted)">Тип недвижимости</label>
        <FilterChips v-model="focusFilters.property_type" :options="typeOptions" />
      </div>

      <!-- Personal status -->
      <div>
        <label class="block text-xs font-medium mb-2" style="color: var(--text-muted)">Личный статус</label>
        <select v-model="focusFilters.status" data-testid="focus-status"
          class="w-full px-2 py-1.5 rounded-lg border text-sm"
          style="background: var(--bg-main); border-color: var(--border-subtle); color: var(--text-main)">
          <option value="">Все</option>
          <option value="new">Новый</option>
          <option value="in_progress">В работе</option>
          <option value="viewed">Просмотрен</option>
          <option value="rejected">Отклонён</option>
        </select>
      </div>
    </div>

    <div class="mt-3 pt-2 border-t flex justify-end" style="border-color: var(--border-subtle)">
      <button @click="resetFocusFilters" class="text-sm px-3 py-1.5 rounded-lg hover:opacity-80"
        style="color: var(--text-muted)">Сбросить фильтры</button>
    </div>
  </div>

  <!-- Loading -->
  <SkeletonTable v-if="focusLoading" :rows="6" />

  <!-- Empty -->
  <div v-else-if="filteredFocusItems.length === 0" class="text-center py-16">
    <p class="text-lg mb-2" style="color: var(--text-muted)">Нет объектов в фокусе</p>
    <p class="text-sm" style="color: var(--text-muted)">Измените фильтры или дождитесь новых объектов</p>
  </div>

  <!-- Focus cards -->
  <div v-else-if="viewMode === 'cards'" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
    <PropertyCard
      v-for="item in filteredFocusItems"
      :key="item.documentId"
      :item="item"
      variant="focus"
      :selected="focusSelected.has(item.documentId)"
      @toggle-select="toggleFocusSelect(item.documentId)"
      @quick-reject="quickReject(item)"
      @bulk-status="bulkSetStatus"
      @bulk-csv="bulkExportCSV"
    />
  </div>

  <!-- Focus table -->
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
    @quick-reject="quickReject"
  />

  <!-- Pagination -->
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

  <!-- Bulk action bar -->
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
import { useRouter, useRoute } from 'vue-router'
import api from '@/api/strapi'
import SkeletonTable from '@/components/SkeletonTable.vue'
import PropertyCard from '@/components/properties/PropertyCard.vue'
import PropertyTable from '@/components/properties/PropertyTable.vue'
import ViewToggle from '@/components/properties/ViewToggle.vue'
import FilterChips from '@/components/properties/FilterChips.vue'
import { usePropertyData, type Property } from '@/composables/usePropertyData'
import { useFocusTab } from '@/composables/useFocusTab'
import { cityLabel, typeLabel } from '@/utils/formatters'
import { useToast } from '@/composables/useToast'
import { buildFocusParams, FOCUS_PAGE_SIZE_MAX } from '@/composables/useFocusParams'

const CSV_MAX_ROWS = 100_000
const CSV_PAGE_SIZE = FOCUS_PAGE_SIZE_MAX

const router = useRouter()
const route = useRoute()
const toast = useToast()

const {
  focusProperties: focusItems,
  focusLoading,
  focusTotal,
  fetchFocusProperties,
} = usePropertyData()

let doFetchFocus: () => void = () => {}

const {
  activeTab,
  focusSort,
  toggleFocusSort,
  focusFilters,
  resetFocusFilters,
  focusPage,
  focusPageSize,
  focusTotalPages,
  focusSelected,
  allFocusChecked,
  toggleFocusSelect,
  toggleAllFocus,
} = useFocusTab(() => doFetchFocus(), focusTotal, focusItems)

const typeOptions = [
  { value: 'office', label: 'Офис' },
  { value: 'warehouse', label: 'Склад' },
  { value: 'retail', label: 'Торговля' },
  { value: 'free_purpose', label: 'Св. назн.' },
  { value: 'apartment', label: 'Квартира' },
  { value: 'land', label: 'Участок' },
  { value: 'other', label: 'Другое' },
]

const viewMode = ref<'cards' | 'table'>((localStorage.getItem('aklab-view-mode') as 'cards' | 'table') || 'cards')
const focusFiltersOpen = ref(false)
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

function fetchFocusItems() {
  const params = buildFocusParams(focusFilters, focusSort, focusPage.value, focusPageSize, searchQuery.value)
  void fetchFocusProperties(params)
}

doFetchFocus = fetchFocusItems

async function fetchCsvRows(): Promise<Property[]> {
  const rows: Property[] = []
  let page = 1
  let totalPages = 1

  while (page <= totalPages && rows.length < CSV_MAX_ROWS) {
    const params = buildFocusParams(focusFilters, focusSort, page, CSV_PAGE_SIZE, searchQuery.value)
    const { data } = await api.get('/properties/focus', { params })
    const pageRows = Array.isArray(data?.data) ? data.data as Property[] : []
    const remaining = CSV_MAX_ROWS - rows.length
    rows.push(...pageRows.slice(0, remaining))

    const reportedPages = Number(data?.meta?.totalPages)
    const reportedTotal = Number(data?.meta?.total)
    if (Number.isFinite(reportedPages) && reportedPages > 0) {
      totalPages = Math.trunc(reportedPages)
    } else if (Number.isFinite(reportedTotal) && reportedTotal > 0) {
      totalPages = Math.ceil(reportedTotal / CSV_PAGE_SIZE)
    } else if (pageRows.length < CSV_PAGE_SIZE) {
      totalPages = page
    } else {
      totalPages = page + 1
    }

    if (pageRows.length === 0) break
    page += 1
  }

  return rows
}

async function exportCSV() {
  try {
    const rows = await fetchCsvRows()
    generateCSV(rows)
  } catch (e: any) {
    toast.error('Ошибка экспорта: ' + (e.response?.data?.error?.message || e.message))
  }
}

function generateCSV(rows: Property[]) {
  const header = ['Название', 'Адрес', 'Город', 'Тип', 'Площадь', 'Цена', '₽/м²', 'Скор', 'Теги', 'Ссылка']
  const csvRows = [header.join(';')]

  for (const row of rows) {
    const link = `${window.location.origin}/properties/${row.documentId}`
    const values = [
      row.title,
      row.address || '',
      cityLabel(row.city),
      typeLabel(row.property_type),
      row.area_sqm || '',
      row.price || '',
      row.price_per_sqm || '',
      row.focus_score ?? '',
      (row.tags || []).join(', '),
      link,
    ]
    csvRows.push(values.map(value => escapeCSV(String(value))).join(';'))
  }

  const blob = new Blob(['\uFEFF' + csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const anchor = document.createElement('a')
  let url: string | null = null
  try {
    url = URL.createObjectURL(blob)
    anchor.href = url
    anchor.download = `focus_export_${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(anchor)
    anchor.click()
  } finally {
    if (anchor.parentNode) anchor.parentNode.removeChild(anchor)
    if (url) URL.revokeObjectURL(url)
  }
}

function escapeCSV(value: string): string {
  if (!value) return ''
  // Spreadsheet applications execute cells beginning with formula sigils.
  // Every exported value may originate in scraped content, including prices.
  const safeValue = /^\s*[=+\-@\t\r]/.test(value) ? `'${value}` : value
  if (safeValue.includes(';') || safeValue.includes('"') || safeValue.includes('\n')) {
    return `"${safeValue.replace(/"/g, '""')}"`
  }
  return safeValue
}

function updateLocalStatus(documentId: string, status: string) {
  const item = focusItems.value.find(candidate => candidate.documentId === documentId)
  if (item) item.status = status
}

function removeRejectedFromFocus(): void {
  const before = focusItems.value.length
  focusItems.value = focusItems.value.filter(item => item.status !== 'rejected')
  const removed = before - focusItems.value.length
  if (removed > 0) focusTotal.value = Math.max(0, focusTotal.value - removed)
}

async function bulkSetStatus(status: string) {
  const documentIds = Array.from(focusSelected)
  if (documentIds.length === 0) return

  try {
    for (let offset = 0; offset < documentIds.length; offset += 100) {
      const chunk = documentIds.slice(offset, offset + 100)
      await api.put('/me/properties/statuses', {
        data: { items: chunk.map(documentId => ({ documentId, status })) },
      })
      for (const documentId of chunk) {
        updateLocalStatus(documentId, status)
        focusSelected.delete(documentId)
      }
    }
  } catch (e: any) {
    toast.error('Ошибка: ' + (e.response?.data?.error?.message || e.message))
  }
}

async function quickReject(item: Pick<Property, 'documentId'>) {
  try {
    await api.put(`/me/properties/${item.documentId}/status`, { data: { status: 'rejected' } })
    updateLocalStatus(item.documentId, 'rejected')
    removeRejectedFromFocus()
    focusSelected.delete(item.documentId)
    toast.success('Объект отклонён')
  } catch (e: any) {
    toast.error('Ошибка: ' + (e.response?.data?.error?.message || e.message))
  }
}

function bulkExportCSV() {
  const selectedIds = new Set(focusSelected)
  const rows = focusItems.value.filter(item => selectedIds.has(item.documentId))
  generateCSV(rows)
}

function openProperty(item: Pick<Property, 'documentId'>) {
  router.push({ path: `/properties/${item.documentId}`, query: { tab: 'focus' } })
}

defineExpose({ total: focusTotal })

onMounted(() => {
  const threshold = Number(route.query.threshold)
  if (Number.isFinite(threshold) && threshold >= 1 && threshold <= 100) {
    focusFilters.threshold = threshold
  }
  activeTab.value = 'focus'
  fetchFocusItems()
})
</script>
