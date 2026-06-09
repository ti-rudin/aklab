<template>
  <div class="max-w-screen-xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
    <div class="flex justify-between items-center mb-6">
      <h1 class="text-2xl font-bold" style="color: var(--text-main)">Объекты</h1>
      <span class="text-sm" style="color: var(--text-muted)">{{ total }} шт.</span>
    </div>

    <!-- Фильтры -->
    <div class="rounded-xl p-4 border mb-6 flex flex-col sm:flex-row flex-wrap gap-3 items-end" style="background: var(--bg-elevated); border-color: var(--border-subtle)">
      <div>
        <label class="block text-xs mb-1" style="color: var(--text-muted)">Город</label>
        <select v-model="filters.city" class="px-2 py-1.5 rounded-lg border text-sm" style="background: var(--bg-main); border-color: var(--border-subtle); color: var(--text-main)">
          <option value="">Все</option>
          <option value="moscow">Москва</option>
          <option value="mo">МО</option>
          <option value="other">Другой</option>
        </select>
      </div>
      <div>
        <label class="block text-xs mb-1" style="color: var(--text-muted)">Статус</label>
        <select v-model="filters.status" class="px-2 py-1.5 rounded-lg border text-sm" style="background: var(--bg-main); border-color: var(--border-subtle); color: var(--text-main)">
          <option value="">Все</option>
          <option value="new">Новый</option>
          <option value="in_progress">В работе</option>
          <option value="viewed">Просмотрен</option>
          <option value="rejected">Отклонён</option>
        </select>
      </div>
      <div>
        <label class="block text-xs mb-1" style="color: var(--text-muted)">Источник</label>
        <select v-model="filters.source" class="px-2 py-1.5 rounded-lg border text-sm" style="background: var(--bg-main); border-color: var(--border-subtle); color: var(--text-main)">
          <option value="">Все</option>
          <option v-for="s in sources" :key="s" :value="s">{{ s }}</option>
        </select>
      </div>
      <div>
        <label class="block text-xs mb-1" style="color: var(--text-muted)">Тип</label>
        <select v-model="filters.property_type" class="px-2 py-1.5 rounded-lg border text-sm" style="background: var(--bg-main); border-color: var(--border-subtle); color: var(--text-main)">
          <option value="">Все</option>
          <option value="office">Офис</option>
          <option value="warehouse">Склад</option>
          <option value="retail">Торговля</option>
          <option value="production">Производство</option>
          <option value="free_purpose">Св. назначения</option>
          <option value="other">Другое</option>
        </select>
      </div>
      <label class="flex items-center gap-2 cursor-pointer px-2 py-1.5">
        <input type="checkbox" v-model="filters.undervalued" class="rounded" />
        <span class="text-sm" style="color: var(--text-muted)">Только недооценённые</span>
      </label>
      <button @click="resetFilters" class="px-3 py-1.5 rounded-lg border text-sm hover:opacity-80" style="border-color: var(--border-subtle); color: var(--text-muted)">Сбросить</button>
    </div>

    <!-- Loading -->
    <SkeletonTable v-if="loading" :rows="6" />

    <!-- Пусто -->
    <div v-else-if="items.length === 0" class="text-center py-16">
      <p class="text-lg mb-2" style="color: var(--text-muted)">Нет объектов</p>
      <p class="text-sm" style="color: var(--text-muted)">Парсеры ещё не нашли подходящих объектов</p>
    </div>

    <!-- Desktop: Таблица -->
    <div v-else class="hidden md:block rounded-xl border overflow-x-auto" style="border-color: var(--border-subtle)">
      <table class="w-full text-sm">
        <thead>
          <tr style="background: var(--bg-elevated)">
            <th class="text-left px-3 py-2 font-semibold whitespace-nowrap" style="color: var(--text-muted)">Название</th>
            <th class="text-left px-3 py-2 font-semibold" style="color: var(--text-muted)">Адрес</th>
            <th class="text-left px-3 py-2 font-semibold" style="color: var(--text-muted)">Город</th>
            <th class="text-left px-3 py-2 font-semibold" style="color: var(--text-muted)">Тип</th>
            <th class="text-right px-3 py-2 font-semibold" style="color: var(--text-muted)">Площадь</th>
            <th class="text-right px-3 py-2 font-semibold" style="color: var(--text-muted)">Цена</th>
            <th class="text-right px-3 py-2 font-semibold" style="color: var(--text-muted)">₽/м²</th>
            <th class="text-center px-3 py-2 font-semibold" style="color: var(--text-muted)">Статус</th>
            <th class="text-center px-3 py-2 font-semibold" style="color: var(--text-muted)">Оценка</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in items" :key="item.id"
            class="border-t cursor-pointer transition-colors hover:opacity-80"
            :style="{ borderColor: 'var(--border-subtle)' }"
            @click="router.push(`/properties/${item.documentId}`)">
            <td class="px-3 py-2 max-w-[200px] truncate font-medium" style="color: var(--text-main)">{{ item.title }}</td>
            <td class="px-3 py-2 max-w-[200px] truncate" style="color: var(--text-muted)">{{ item.address || '—' }}</td>
            <td class="px-3 py-2 whitespace-nowrap" style="color: var(--text-main)">{{ cityLabel(item.city) }}</td>
            <td class="px-3 py-2 whitespace-nowrap" style="color: var(--text-muted)">{{ typeLabel(item.property_type) }}</td>
            <td class="px-3 py-2 text-right font-mono" style="color: var(--text-main)">{{ item.area_sqm ? `${item.area_sqm} м²` : '—' }}</td>
            <td class="px-3 py-2 text-right font-mono" style="color: var(--text-main)">{{ item.price ? formatPrice(item.price) : '—' }}</td>
            <td class="px-3 py-2 text-right font-mono" style="color: var(--text-main)">{{ item.price_per_sqm ? formatPrice(item.price_per_sqm) : '—' }}</td>
            <td class="px-3 py-2 text-center">
              <span class="text-xs px-2 py-0.5 rounded-full" :style="statusStyle(item.status)">{{ statusLabel(item.status) }}</span>
            </td>
            <td class="px-3 py-2 text-center">
              <span v-if="item.is_undervalued" class="text-xs px-2 py-0.5 rounded-full font-semibold" style="background: rgba(251,191,36,0.15); color: #f59e0b">
                ⚠ {{ item.deviation_percent }}%
              </span>
              <span v-else class="text-xs" style="color: var(--text-muted)">—</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Mobile: Карточки -->
    <div v-if="!loading && items.length > 0" class="md:hidden space-y-3">
      <div
        v-for="item in items"
        :key="item.id"
        class="rounded-xl border p-4 cursor-pointer transition-all hover:shadow-lg"
        style="background: var(--bg-elevated); border-color: var(--border-subtle)"
        @click="router.push(`/properties/${item.documentId}`)"
      >
        <!-- Заголовок + badges -->
        <div class="flex items-start justify-between gap-2 mb-2">
          <h3 class="font-semibold text-sm truncate flex-1" style="color: var(--text-main)">{{ item.title }}</h3>
          <div class="flex items-center gap-1.5 shrink-0">
            <span class="text-xs px-2 py-0.5 rounded-full whitespace-nowrap" :style="statusStyle(item.status)">{{ statusLabel(item.status) }}</span>
            <span v-if="item.is_undervalued" class="text-xs px-2 py-0.5 rounded-full font-semibold whitespace-nowrap" style="background: rgba(251,191,36,0.15); color: #f59e0b">
              ⚠ {{ item.deviation_percent }}%
            </span>
          </div>
        </div>

        <!-- Адрес + город + тип -->
        <div class="text-xs mb-3" style="color: var(--text-muted)">
          <span v-if="item.address">{{ item.address }}</span>
          <span v-if="item.address && (item.city || item.property_type)"> · </span>
          <span v-if="item.city">{{ cityLabel(item.city) }}</span>
          <span v-if="item.city && item.property_type"> · </span>
          <span v-if="item.property_type">{{ typeLabel(item.property_type) }}</span>
        </div>

        <!-- Метрики -->
        <div class="grid grid-cols-3 gap-3">
          <div>
            <div class="text-xs" style="color: var(--text-muted)">Площадь</div>
            <div class="text-sm font-mono font-medium" style="color: var(--text-main)">{{ item.area_sqm ? `${item.area_sqm} м²` : '—' }}</div>
          </div>
          <div>
            <div class="text-xs" style="color: var(--text-muted)">Цена</div>
            <div class="text-sm font-mono font-medium" style="color: var(--text-main)">{{ item.price ? formatPrice(item.price) : '—' }}</div>
          </div>
          <div>
            <div class="text-xs" style="color: var(--text-muted)">₽/м²</div>
            <div class="text-sm font-mono font-medium" style="color: var(--text-main)">{{ item.price_per_sqm ? formatPrice(item.price_per_sqm) : '—' }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Пагинация -->
    <div v-if="totalPages > 1" class="flex justify-center items-center gap-1 sm:gap-2 mt-6">
      <button @click="page > 1 && page--" :disabled="page <= 1"
        class="px-2 py-1 sm:px-3 rounded-lg text-sm disabled:opacity-40"
        :style="{ background: 'var(--bg-elevated)', color: 'var(--text-main)', border: '1px solid var(--border-subtle)' }">
        ‹
      </button>
      <template v-for="p in visiblePages" :key="String(p)">
        <span v-if="p === '...'" class="px-1 text-sm hidden sm:inline" style="color: var(--text-muted)">…</span>
        <button v-else @click="page = Number(p)"
          class="px-2 py-1 sm:px-3 rounded-lg text-xs sm:text-sm hidden sm:inline-block"
          :style="{ background: p === page ? 'var(--accent)' : 'var(--bg-elevated)', color: p === page ? 'white' : 'var(--text-main)', border: '1px solid var(--border-subtle)' }">
          {{ p }}
        </button>
      </template>
      <span class="sm:hidden text-xs px-2" style="color: var(--text-muted)">{{ page }} / {{ totalPages }}</span>
      <button @click="page < totalPages && page++" :disabled="page >= totalPages"
        class="px-2 py-1 sm:px-3 rounded-lg text-sm disabled:opacity-40"
        :style="{ background: 'var(--bg-elevated)', color: 'var(--text-main)', border: '1px solid var(--border-subtle)' }">
        ›
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import SkeletonTable from '@/components/SkeletonTable.vue'
import { ref, reactive, computed, watch, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import api from '@/api/strapi'

const router = useRouter()

interface Property {
  id: number
  documentId: string
  title: string
  address: string | null
  city: string
  property_type: string
  area_sqm: string | null
  price: string | null
  price_per_sqm: string | null
  status: string
  is_undervalued: boolean | null
  deviation_percent: string | null
  source: string
}

const items = ref<Property[]>([])
const loading = ref(true)
const total = ref(0)
const page = ref(1)
const pageSize = 25

const sources = ['fedresurs', 'aggregator-bankrot', 'torgi-gov', 'investmoscow', 'invest-mosreg', 'roseltorg', 'fabrikant', 'alfalot', 'etprf', 'sberbank-ast', 'm-ets']

const filters = reactive({
  city: '',
  status: '',
  source: '',
  property_type: '',
  undervalued: false,
})

const totalPages = computed(() => Math.ceil(total.value / pageSize))

const visiblePages = computed(() => {
  const total = totalPages.value
  const current = page.value
  const pages: (number | string)[] = []
  if (total <= 7) {
    for (let i = 1; i <= total; i++) pages.push(i)
    return pages
  }
  pages.push(1)
  if (current > 3) pages.push('...')
  const start = Math.max(2, current - 1)
  const end = Math.min(total - 1, current + 1)
  for (let i = start; i <= end; i++) pages.push(i)
  if (current < total - 2) pages.push('...')
  pages.push(total)
  return pages
})

const cityLabel = (v: string) => ({ moscow: 'Москва', mo: 'МО', other: 'Другой' })[v] || v
const typeLabel = (v: string) => ({
  office: 'Офис', warehouse: 'Склад', retail: 'Торговля',
  production: 'Производство', free_purpose: 'Св. назн.', other: 'Другое'
})[v] || v
const statusLabel = (v: string) => ({
  new: 'Новый', in_progress: 'В работе', viewed: 'Просмотрен', rejected: 'Отклонён'
})[v] || v

const statusStyle = (s: string) => ({
  new: { background: 'rgba(79,140,255,0.15)', color: '#4f8cff' },
  in_progress: { background: 'rgba(251,191,36,0.15)', color: '#f59e0b' },
  viewed: { background: 'rgba(16,185,129,0.15)', color: '#10b981' },
  rejected: { background: 'rgba(239,68,68,0.15)', color: '#ef4444' },
})[s] || {}

const formatPrice = (v: string | number) => Number(v).toLocaleString('ru-RU')

async function fetchItems() {
  loading.value = true
  try {
    const params: any = {
      sort: 'createdAt:desc',
      pagination: { page: page.value, pageSize },
    }
    // Фильтры
    const f: any = {}
    if (filters.city) f.city = { $eq: filters.city }
    if (filters.status) f.status = { $eq: filters.status }
    if (filters.source) f.source = { $eq: filters.source }
    if (filters.property_type) f.property_type = { $eq: filters.property_type }
    if (filters.undervalued) f.is_undervalued = { $eq: true }
    if (Object.keys(f).length) params.filters = f

    const { data } = await api.get('/properties', { params })
    items.value = data.data
    total.value = data.meta?.pagination?.total || 0
  } catch (e: any) {
    console.error('Failed to fetch properties:', e)
  } finally {
    loading.value = false
  }
}

function resetFilters() {
  filters.city = ''
  filters.status = ''
  filters.source = ''
  filters.property_type = ''
  filters.undervalued = false
  page.value = 1
}

watch([filters, page], ([, newPage], [, oldPage]) => {
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

onMounted(fetchItems)
</script>
