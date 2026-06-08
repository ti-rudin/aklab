<template>
  <div class="max-w-screen-xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
    <div class="flex justify-between items-center mb-6">
      <h1 class="text-2xl font-bold" style="color: var(--text-main)">Объекты</h1>
      <span class="text-sm" style="color: var(--text-muted)">{{ total }} шт.</span>
    </div>

    <!-- Фильтры -->
    <div class="rounded-xl p-4 border mb-6 flex flex-wrap gap-3 items-end" style="background: var(--bg-elevated); border-color: var(--border-subtle)">
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
    <div v-if="loading" class="text-center py-16">
      <p style="color: var(--text-muted)">Загрузка…</p>
    </div>

    <!-- Пусто -->
    <div v-else-if="items.length === 0" class="text-center py-16">
      <p class="text-lg mb-2" style="color: var(--text-muted)">Нет объектов</p>
      <p class="text-sm" style="color: var(--text-muted)">Парсеры ещё не нашли подходящих объектов</p>
    </div>

    <!-- Таблица -->
    <div v-else class="rounded-xl border overflow-x-auto" style="border-color: var(--border-subtle)">
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

    <!-- Пагинация -->
    <div v-if="totalPages > 1" class="flex justify-center gap-2 mt-6">
      <button v-for="p in totalPages" :key="p"
        @click="page = p"
        class="px-3 py-1 rounded-lg text-sm"
        :style="{ background: p === page ? 'var(--accent)' : 'var(--bg-elevated)', color: p === page ? 'white' : 'var(--text-main)', border: '1px solid var(--border-subtle)' }">
        {{ p }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
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

watch([filters, page], () => {
  page.value = 1 // сброс страницы при смене фильтров (кроме самого page)
  fetchItems()
}, { deep: true })

watch(page, fetchItems)

onMounted(fetchItems)
</script>
