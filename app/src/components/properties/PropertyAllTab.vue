<template>
  <!-- Supported flat filters only -->
  <div class="radius-lg p-3 sm:p-4 border mb-6 space-y-3" style="background: var(--bg-elevated); border-color: var(--border-subtle)">
    <div class="flex gap-2 items-center">
      <div class="relative flex-1">
        <span class="absolute left-3 top-1/2 -translate-y-1/2 text-sm" style="color: var(--text-muted)">🔍</span>
        <input v-model="searchQuery" @input="onSearchInput" type="text" placeholder="Поиск по названию или адресу..."
          class="w-full pl-9 pr-3 py-2 radius-md border text-sm"
          style="background: var(--bg-main); border-color: var(--border-subtle); color: var(--text-main)" />
      </div>
      <ViewToggle v-model="viewMode" />
    </div>
    <button @click="filtersOpen = !filtersOpen"
      class="sm:hidden flex items-center gap-2 text-sm w-full py-1"
      style="color: var(--text-muted)">
      <span>{{ filtersOpen ? '▼' : '▶' }}</span>
      <span>Фильтры</span>
    </button>
    <div class="flex-wrap gap-x-4 gap-y-3 items-end" :class="filtersOpen ? 'flex' : 'hidden sm:flex'">
      <div>
        <label class="block text-xs mb-1" style="color: var(--text-muted)">Город</label>
        <FilterChips v-model="filters.city" :options="cityOptions" />
      </div>
      <div>
        <label class="block text-xs mb-1" style="color: var(--text-muted)">Тип</label>
        <FilterChips v-model="filters.property_type" :options="typeOptions" />
      </div>
      <button @click="handleResetFilters" class="px-3 py-1.5 radius-md border text-sm hover:opacity-80 self-end" style="border-color: var(--border-subtle); color: var(--text-muted)">Сбросить</button>
    </div>
  </div>

  <SkeletonTable v-if="loading" :rows="6" />

  <div v-else-if="items.length === 0" class="text-center py-16">
    <p class="text-lg mb-2" style="color: var(--text-muted)">Нет объектов</p>
    <p class="text-sm" style="color: var(--text-muted)">Парсеры ещё не нашли подходящих объектов</p>
  </div>

  <div v-else-if="viewMode === 'cards'" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
    <PropertyCard
      v-for="(item, idx) in items"
      :key="item.documentId"
      :item="item"
      variant="default"
      class="stagger-item"
      :style="{ '--i': idx }"
    />
  </div>

  <PropertyTable
    v-else
    :items="items"
    variant="default"
    :sort-field="sort.field"
    :sort-direction="sort.direction"
    @open="openProperty"
    @sort="toggleSort"
  />

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
import { REGION_OPTIONS } from '@/constants/regions'
import { usePropertyData, type PropertyQuery } from '@/composables/usePropertyData'
import { usePropertyFilters } from '@/composables/usePropertyFilters'

const props = defineProps<{
  /** Omitted for the literal all view; work emits the only status shortcut. */
  status?: 'in_progress'
}>()

const router = useRouter()
const route = useRoute()
const { properties: items, loading, total, fetchProperties } = usePropertyData()
const { filters, searchQuery, resetFilters } = usePropertyFilters()

const viewMode = ref<'cards' | 'table'>((localStorage.getItem('aklab-view-mode') as 'cards' | 'table') || 'cards')
watch(viewMode, (value) => {
  try { localStorage.setItem('aklab-view-mode', value) } catch {}
})

const typeOptions = [
  { value: 'office', label: 'Офис' },
  { value: 'warehouse', label: 'Склад' },
  { value: 'retail', label: 'Торговля' },
  { value: 'free_purpose', label: 'Св. назн.' },
  { value: 'apartment', label: 'Квартира' },
  { value: 'land', label: 'Участок' },
  { value: 'other', label: 'Другое' },
]

const cityOptions = [...REGION_OPTIONS]

const sort = reactive({
  field: 'createdAt',
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

const filtersOpen = ref(false)
const pageSize = 25
const page = ref(1)
const ready = ref(false)
const totalPages = computed(() => Math.ceil(total.value / pageSize))

const visiblePages = computed(() => {
  const pages: (number | string)[] = []
  const totalPageCount = totalPages.value
  const current = page.value
  if (totalPageCount <= 7) {
    for (let i = 1; i <= totalPageCount; i++) pages.push(i)
    return pages
  }
  pages.push(1)
  if (current > 3) pages.push('...')
  for (let i = Math.max(2, current - 1); i <= Math.min(totalPageCount - 1, current + 1); i++) pages.push(i)
  if (current < totalPageCount - 2) pages.push('...')
  pages.push(totalPageCount)
  return pages
})

let searchDebounce: ReturnType<typeof setTimeout> | null = null
function onSearchInput() {
  if (searchDebounce) clearTimeout(searchDebounce)
  searchDebounce = setTimeout(() => {
    page.value = 1
    fetchItems()
  }, 400)
}

function queryList(value: unknown): string[] {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : []
  return values.filter((item): item is string => typeof item === 'string')
    .flatMap(item => item.split(','))
    .map(item => item.trim())
    .filter(Boolean)
}

function queryText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function fetchItems() {
  const params: PropertyQuery = {
    sort: sort.direction === 'desc' ? `-${sort.field}` : sort.field,
    page: page.value,
    pageSize,
  }

  // "Все объекты" is literal all: no status parameter. Work is a shortcut.
  if (props.status === 'in_progress') params.status = 'in_progress'
  if (filters.city.length) params.city = filters.city.join(',')
  if (filters.property_type.length) params.property_type = filters.property_type.join(',')
  const search = searchQuery.value.trim()
  if (search) params.search = search

  void fetchProperties(params)
}

function handleResetFilters() {
  resetFilters()
  sort.field = 'createdAt'
  sort.direction = 'desc'
  page.value = 1
}

watch(filters, () => {
  if (!ready.value) return
  page.value = 1
  fetchItems()
}, { deep: true })

watch(page, () => {
  if (ready.value) fetchItems()
})

watch(sort, () => {
  if (!ready.value) return
  page.value = 1
  fetchItems()
}, { deep: true })

function openProperty(item: { documentId: string }) {
  router.push(`/properties/${item.documentId}`)
}

function refresh() {
  page.value = 1
  fetchItems()
}

defineExpose({ refresh, total })

onMounted(() => {
  const query = route.query ?? {}
  filters.city = queryList(query.city)
  filters.property_type = queryList(query.property_type)
  searchQuery.value = queryText(query.search)
  ready.value = true
  fetchItems()
})

watch([filters, searchQuery], () => {
  if (!ready.value) return
  const query: Record<string, string> = {}
  if (filters.city.length) query.city = filters.city.join(',')
  if (filters.property_type.length) query.property_type = filters.property_type.join(',')
  if (searchQuery.value.trim()) query.search = searchQuery.value.trim()
  router.replace({ query })
}, { deep: true })
</script>
