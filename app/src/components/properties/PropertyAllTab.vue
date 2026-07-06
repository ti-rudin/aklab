<template>
  <!-- Фильтры -->
  <div class="radius-lg p-3 sm:p-4 border mb-6 space-y-3" style="background: var(--bg-elevated); border-color: var(--border-subtle)">
    <!-- Поиск + переключатель вида -->
    <div class="flex gap-2 items-center">
      <div class="relative flex-1">
        <span class="absolute left-3 top-1/2 -translate-y-1/2 text-sm" style="color: var(--text-muted)">🔍</span>
        <input v-model="searchQuery" @input="onSearchInput" type="text" placeholder="Поиск по названию или адресу..."
          class="w-full pl-9 pr-3 py-2 radius-md border text-sm"
          style="background: var(--bg-main); border-color: var(--border-subtle); color: var(--text-main)" />
      </div>
      <ViewToggle v-model="viewMode" />
    </div>
    <!-- Мобильный тоггл фильтров -->
    <button @click="filtersOpen = !filtersOpen"
      class="sm:hidden flex items-center gap-2 text-sm w-full py-1"
      style="color: var(--text-muted)">
      <span>{{ filtersOpen ? '▼' : '▶' }}</span>
      <span>Фильтры</span>
    </button>
    <!-- Фильтры -->
    <div class="flex-wrap gap-x-4 gap-y-3 items-end" :class="filtersOpen ? 'flex' : 'hidden sm:flex'">
      <div>
        <label class="block text-xs mb-1" style="color: var(--text-muted)">Город</label>
        <FilterChips v-model="filters.city" :options="cityOptions" />
      </div>
      <div>
        <label class="block text-xs mb-1" style="color: var(--text-muted)">Тип</label>
        <FilterChips v-model="filters.property_type" :options="typeOptions" />
      </div>
      <div v-if="status !== 'in_progress'">
        <label class="block text-xs mb-1" style="color: var(--text-muted)">Статус</label>
        <select v-model="filters.status" class="px-2 py-1.5 radius-md border text-sm" style="background: var(--bg-main); border-color: var(--border-subtle); color: var(--text-main)">
          <option value="">Все</option>
          <option value="new">Новый</option>
          <option value="viewed">Просмотрен</option>
          <option value="rejected">Отклонён</option>
        </select>
      </div>
      <div>
        <label class="block text-xs mb-1" style="color: var(--text-muted)">Источник</label>
        <select v-model="filters.source" class="px-2 py-1.5 radius-md border text-sm" style="background: var(--bg-main); border-color: var(--border-subtle); color: var(--text-main)">
          <option value="">Все</option>
          <option v-for="s in sources" :key="s" :value="s">{{ s }}</option>
        </select>
      </div>
      <div>
        <label class="block text-xs mb-1" style="color: var(--text-muted)">Цена (₽)</label>
        <div class="flex gap-1 items-center">
          <input v-model.number="filters.priceFrom" type="number" placeholder="от" min="0"
            class="w-24 px-2 py-1.5 radius-md border text-sm"
            style="background: var(--bg-main); border-color: var(--border-subtle); color: var(--text-main)" />
          <span class="text-xs" style="color: var(--text-muted)">—</span>
          <input v-model.number="filters.priceTo" type="number" placeholder="до" min="0"
            class="w-24 px-2 py-1.5 radius-md border text-sm"
            style="background: var(--bg-main); border-color: var(--border-subtle); color: var(--text-main)" />
        </div>
      </div>
      <button @click="handleResetFilters" class="px-3 py-1.5 radius-md border text-sm hover:opacity-80 self-end" style="border-color: var(--border-subtle); color: var(--text-muted)">Сбросить</button>
    </div>
  </div>

  <!-- Loading -->
  <SkeletonTable v-if="loading" :rows="6" />

  <!-- Пусто -->
  <div v-else-if="items.length === 0" class="text-center py-16">
    <p class="text-lg mb-2" style="color: var(--text-muted)">Нет объектов</p>
    <p class="text-sm" style="color: var(--text-muted)">Парсеры ещё не нашли подходящих объектов</p>
  </div>

  <!-- Карточки -->
  <div v-else-if="viewMode === 'cards'" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
    <PropertyCard
      v-for="(item, idx) in items"
      :key="item.id"
      :item="item"
      variant="default"
      class="stagger-item"
      :style="{ '--i': idx }"

    />
  </div>

  <!-- Таблица -->
  <PropertyTable
    v-else
    :items="items"
    variant="default"
    :sort-field="sort.field"
    :sort-direction="sort.direction"
    @open="openProperty"
    @sort="toggleSort"
  />

  <!-- Пагинация -->
  <div v-if="totalPages > 1" class="flex justify-center items-center gap-1 sm:gap-2 mt-6">
    <button @click="page > 1 && page--" :disabled="page <= 1"
      class="px-2 py-1 sm:px-3 radius-md text-sm disabled:opacity-40"
      :style="{ background: 'var(--bg-elevated)', color: 'var(--text-main)', border: '1px solid var(--border-subtle)' }">
      ‹
    </button>
    <template v-for="p in visiblePages" :key="String(p)">
      <span v-if="p === '...'" class="px-1 text-sm hidden sm:inline" style="color: var(--text-muted)">…</span>
      <button v-else @click="page = Number(p)"
        class="px-2 py-1 sm:px-3 radius-md text-xs sm:text-sm hidden sm:inline-block"
        :style="{ background: p === page ? 'var(--accent)' : 'var(--bg-elevated)', color: p === page ? 'white' : 'var(--text-main)', border: '1px solid var(--border-subtle)' }">
        {{ p }}
      </button>
    </template>
    <span class="sm:hidden text-xs px-2" style="color: var(--text-muted)">{{ page }} / {{ totalPages }}</span>
    <button @click="page < totalPages && page++" :disabled="page >= totalPages"
      class="px-2 py-1 sm:px-3 radius-md text-sm disabled:opacity-40"
      :style="{ background: 'var(--bg-elevated)', color: 'var(--text-main)', border: '1px solid var(--border-subtle)' }">
      ›
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import SkeletonTable from '@/components/SkeletonTable.vue'
import PropertyCard from '@/components/properties/PropertyCard.vue'
import PropertyTable from '@/components/properties/PropertyTable.vue'
import ViewToggle from '@/components/properties/ViewToggle.vue'
import FilterChips from '@/components/properties/FilterChips.vue'
import { usePropertyData } from '@/composables/usePropertyData'
import { usePropertyFilters } from '@/composables/usePropertyFilters'

const props = defineProps<{
  status: 'new' | 'in_progress'
}>()

const router = useRouter()
const route = useRoute()

const { properties: items, loading, total, fetchProperties } = usePropertyData()
const { filters, searchQuery, resetFilters } = usePropertyFilters()

// ========================
// View mode (persisted)
// ========================
const viewMode = ref<'cards' | 'table'>((localStorage.getItem('aklab-view-mode') as 'cards' | 'table') || 'cards')
watch(viewMode, (v) => {
  try { localStorage.setItem('aklab-view-mode', v) } catch {}
})

// ========================
// Static options
// ========================
const sources = ['fedresurs', 'aggregator-bankrot', 'torgi-gov', 'investmoscow', 'invest-mosreg', 'roseltorg', 'fabrikant', 'alfalot', 'etprf', 'sberbank-ast', 'm-ets']

const typeOptions = [
  { value: 'office', label: 'Офис' },
  { value: 'warehouse', label: 'Склад' },
  { value: 'retail', label: 'Торговля' },
  { value: 'free_purpose', label: 'Св. назн.' },
  { value: 'apartment', label: 'Квартира' },
  { value: 'land', label: 'Участок' },
  { value: 'other', label: 'Другое' },
]

const cityOptions = [
  { value: 'moscow', label: 'Москва' },
  { value: 'mo', label: 'МО' },
  { value: 'other', label: 'Другой' },
]

// ========================
// Sort
// ========================
const sort = reactive({
  field: 'createdAt' as string,
  direction: 'desc' as 'asc' | 'desc',
})

function toggleSort(field: string) {
  if (sort.field === field) {
    sort.direction = sort.direction === 'asc' ? 'desc' : 'asc'
  } else {
    sort.field = field
    sort.direction = 'desc'
  }
}

// ========================
// Mobile filter toggle
// ========================
const filtersOpen = ref(false)

// ========================
// Search debounce
// ========================
let searchDebounce: ReturnType<typeof setTimeout> | null = null

function onSearchInput() {
  if (searchDebounce) clearTimeout(searchDebounce)
  searchDebounce = setTimeout(() => {
    page.value = 1
    fetchItems()
  }, 400)
}

// ========================
// Pagination
// ========================
const pageSize = 25
const page = ref(1)
const totalPages = computed(() => Math.ceil(total.value / pageSize))

const visiblePages = computed(() => {
  const t = totalPages.value
  const current = page.value
  const pages: (number | string)[] = []
  if (t <= 7) {
    for (let i = 1; i <= t; i++) pages.push(i)
    return pages
  }
  pages.push(1)
  if (current > 3) pages.push('...')
  const start = Math.max(2, current - 1)
  const end = Math.min(t - 1, current + 1)
  for (let i = start; i <= end; i++) pages.push(i)
  if (current < t - 2) pages.push('...')
  pages.push(t)
  return pages
})

// ========================
// Fetch
// ========================
async function fetchItems() {
  const params: any = {
    sort: `${sort.field}:${sort.direction}`,
    pagination: { page: page.value, pageSize },
  }
  const f: any = {}
  // Base filter: hide in_progress on "Все объекты", show only in_progress on "В работе"
  if (props.status === 'in_progress') {
    f.status = { $eq: 'in_progress' }
  } else {
    f.status = { $ne: 'in_progress' }
  }
  if (filters.city.length) f.city = { $in: filters.city }
  if (filters.status) f.status = { $eq: filters.status }
  if (filters.source) f.source = { $eq: filters.source }
  if (filters.property_type.length) f.property_type = { $in: filters.property_type }
  if (filters.priceFrom) f.price = { ...f.price, $gte: filters.priceFrom }
  if (filters.priceTo) f.price = { ...f.price, $lte: filters.priceTo }
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.trim()
    f.$or = [
      { title: { $containsi: q } },
      { address: { $containsi: q } },
    ]
  }
  if (Object.keys(f).length) params.filters = f
  await fetchProperties(params)
}

function handleResetFilters() {
  resetFilters()
  sort.field = 'createdAt'
  sort.direction = 'desc'
  page.value = 1
}

// ========================
// Watchers
// ========================
watch([filters, page, sort], ([, newPage], [, oldPage]) => {
  if (newPage === oldPage) {
    if (page.value !== 1) {
      page.value = 1
    } else {
      fetchItems()
    }
    return
  }
  fetchItems()
}, { deep: true })

// ========================
// Navigation
// ========================
function openProperty(item: { documentId: string }) {
  router.push(`/properties/${item.documentId}`)
}

// ========================
// Expose for parent
// ========================
function refresh() {
  page.value = 1
  fetchItems()
}

defineExpose({ refresh, total })

// ========================
// Lifecycle
// ========================
onMounted(() => {
  // Read all query params from URL
  const q = route.query
  if (q.property_type) filters.property_type = Array.isArray(q.property_type) ? q.property_type as string[] : (q.property_type as string).split(',')
  if (q.city) filters.city = Array.isArray(q.city) ? q.city as string[] : (q.city as string).split(',')
  if (q.priceFrom) filters.priceFrom = Number(q.priceFrom)
  if (q.priceTo) filters.priceTo = Number(q.priceTo)
  if (q.source) filters.source = q.source as string
  fetchItems()
})

// ========================
// Sync filters to URL
// ========================
watch(filters, () => {
  const query: Record<string, string> = {}
  if (filters.property_type.length) query.property_type = filters.property_type.join(',')
  if (filters.city.length) query.city = filters.city.join(',')
  if (filters.priceFrom != null) query.priceFrom = String(filters.priceFrom)
  if (filters.priceTo != null) query.priceTo = String(filters.priceTo)
  if (filters.source) query.source = filters.source
  router.replace({ query })
}, { deep: true })
</script>
