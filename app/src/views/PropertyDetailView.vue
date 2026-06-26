<template>
  <div class="max-w-screen-xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
    <!-- Навигация -->
    <router-link to="/properties" class="text-sm hover:underline mb-6 inline-block" style="color: var(--text-muted)">← К списку объектов</router-link>

    <!-- Loading -->
    <div v-if="loading" class="max-w-4xl mx-auto px-4 py-8">
      <div class="skeleton h-8 w-64 mb-4" />
      <div class="skeleton h-64 w-full mb-6" />
      <SkeletonLoader :lines="8" />
    </div>

    <!-- Не найден -->
    <div v-else-if="!property" class="text-center py-16">
      <p class="text-lg" style="color: var(--text-muted)">Объект не найден</p>
    </div>

    <!-- Карточка -->
    <div v-else>
      <div class="rounded-xl p-6 border mb-6" style="background: var(--bg-elevated); border-color: var(--border-subtle)">
        <!-- Заголовок + бейджи -->
        <div class="flex flex-wrap items-start gap-3 mb-4">
          <h1 class="text-xl font-bold flex-1" style="color: var(--text-main)">{{ property.title }}</h1>
          <span class="text-xs px-2 py-0.5 rounded-full" :style="statusStyle(property.status)">{{ statusLabel(property.status) }}</span>
          <span v-if="property.is_undervalued" class="text-xs px-2 py-0.5 rounded-full font-semibold" style="background: rgba(251,191,36,0.15); color: #f59e0b">
            ⚠️ Недооценён на {{ property.deviation_percent }}%
          </span>
        </div>

        <!-- Основные поля -->
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
          <div>
            <span class="block text-xs" style="color: var(--text-muted)">Адрес</span>
            <span style="color: var(--text-main)">{{ property.address || '—' }}</span>
          </div>
          <div>
            <span class="block text-xs" style="color: var(--text-muted)">Город</span>
            <span style="color: var(--text-main)">{{ cityLabel(property.city) }}</span>
          </div>
          <div>
            <span class="block text-xs" style="color: var(--text-muted)">Тип недвижимости</span>
            <span style="color: var(--text-main)">{{ typeLabel(property.property_type) }}</span>
          </div>
          <div>
            <span class="block text-xs" style="color: var(--text-muted)">Площадь</span>
            <span class="font-mono" style="color: var(--text-main)">{{ property.area_sqm ? `${property.area_sqm} м²` : '—' }}</span>
          </div>
          <div>
            <span class="block text-xs" style="color: var(--text-muted)">Цена</span>
            <span class="font-mono" style="color: var(--text-main)">{{ property.price ? `${formatPrice(property.price)} ₽` : '—' }}</span>
          </div>
          <div>
            <span class="block text-xs" style="color: var(--text-muted)">Цена за м²</span>
            <span class="font-mono" style="color: var(--text-main)">{{ property.price_per_sqm ? `${formatPrice(property.price_per_sqm)} ₽/м²` : '—' }}</span>
          </div>
          <div>
            <span class="block text-xs" style="color: var(--text-muted)">Источник</span>
            <span style="color: var(--text-main)">{{ property.source }}</span>
          </div>
          <div>
            <span class="block text-xs" style="color: var(--text-muted)">Тип торгов</span>
            <span style="color: var(--text-main)">{{ auctionLabel(property.auction_type) }}</span>
          </div>
          <div v-if="property.is_undervalued && property.manual_price_per_sqm">
            <span class="block text-xs" style="color: var(--text-muted)">Эталон ₽/м²</span>
            <span class="font-mono" style="color: var(--text-main)">{{ formatPrice(property.manual_price_per_sqm) }} ₽/м²</span>
          </div>
        </div>

        <!-- Ссылка на источник -->
        <div v-if="property.url" class="mb-4">
          <a :href="property.url" target="_blank" rel="noopener" class="text-sm hover:underline" style="color: var(--accent)">Открыть на источнике →</a>
        </div>

        <!-- Описание -->
        <div v-if="property.description" class="mb-4">
          <span class="block text-xs mb-1" style="color: var(--text-muted)">Описание</span>
          <p class="text-sm whitespace-pre-wrap" style="color: var(--text-main)">{{ property.description }}</p>
        </div>

        <!-- Контакты -->
        <div v-if="property.contacts" class="mb-4">
          <span class="block text-xs mb-1" style="color: var(--text-muted)">Контакты</span>
          <p class="text-sm" style="color: var(--text-main)">{{ property.contacts }}</p>
        </div>
      </div>

      <!-- Фотогалерея (только для недооценённых) -->
      <div v-if="property.is_undervalued && property.photos?.length" class="rounded-xl p-6 border mb-6" style="background: var(--bg-elevated); border-color: var(--border-subtle)">
        <h2 class="text-lg font-semibold mb-4" style="color: var(--text-main)">📸 Фотографии</h2>
        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          <div v-for="(photo, idx) in property.photos" :key="idx"
            class="aspect-square rounded-lg overflow-hidden cursor-pointer hover:opacity-80 transition-opacity"
            @click="openLightbox(idx)">
            <img :src="photoUrl(photo)" :alt="`Фото ${idx + 1}`"
              class="w-full h-full object-cover" />
          </div>
        </div>
        <!-- Lightbox -->
        <div v-if="lightbox.open" class="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
          @click.self="lightbox.open = false">
          <button @click="lightbox.open = false" class="absolute top-4 right-4 text-white text-2xl">✕</button>
          <button @click="prevPhoto" class="absolute left-4 text-white text-3xl">‹</button>
          <img v-if="property.photos[lightbox.idx]" :src="photoUrl(String(property.photos[lightbox.idx]))" class="max-h-[80vh] max-w-[90vw] object-contain" />
          <button @click="nextPhoto" class="absolute right-4 text-white text-3xl">›</button>
          <div class="absolute bottom-4 text-white text-sm">{{ lightbox.idx + 1 }} / {{ property.photos.length }}</div>
        </div>
      </div>

      <!-- Действия -->
      <div class="rounded-xl p-6 border mb-6" style="background: var(--bg-elevated); border-color: var(--border-subtle)">
        <h2 class="text-lg font-semibold mb-4" style="color: var(--text-main)">Действия</h2>
        <div class="flex flex-wrap gap-3 mb-4">
          <button v-for="s in statuses" :key="s.value"
            @click="changeStatus(s.value)"
            :disabled="saving || property.status === s.value"
            class="px-4 py-2 rounded-xl text-sm font-semibold border transition-all duration-200 hover:opacity-80 disabled:opacity-40"
            :style="{ borderColor: s.color + '40', color: s.color, background: property.status === s.value ? s.color + '20' : 'transparent' }">
            {{ s.label }}
          </button>
        </div>

        <!-- Комментарий -->
        <div>
          <label class="block text-sm mb-2" style="color: var(--text-muted)">Добавить комментарий</label>
          <div class="flex gap-2">
            <input v-model="comment" type="text" placeholder="Ваш комментарий…"
              class="flex-1 px-3 py-2 rounded-lg border text-sm"
              style="background: var(--bg-main); border-color: var(--border-subtle); color: var(--text-main)"
              @keyup.enter="addComment" />
            <button @click="addComment" :disabled="!comment.trim() || saving"
              class="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-40"
              style="background: var(--accent)">
              Добавить
            </button>
          </div>
        </div>
      </div>

      <!-- Комментарии -->
      <div v-if="comments.length" class="rounded-xl p-6 border" style="background: var(--bg-elevated); border-color: var(--border-subtle)">
        <h2 class="text-lg font-semibold mb-4" style="color: var(--text-main)">Комментарии ({{ comments.length }})</h2>
        <div class="space-y-3">
          <div v-for="c in comments" :key="c.id" class="py-2 border-b last:border-b-0" style="border-color: var(--border-subtle)">
            <p class="text-sm" style="color: var(--text-main)">{{ c.text }}</p>
            <p class="text-xs mt-1" style="color: var(--text-muted)">{{ formatDate(c.createdAt) }}</p>
          </div>
        </div>
      </div>

      <!-- История событий -->
      <div v-if="events.length" class="rounded-xl p-6 border mb-6" style="background: var(--bg-elevated); border-color: var(--border-subtle)">
        <h2 class="text-lg font-semibold mb-4" style="color: var(--text-main)">📋 История</h2>
        <div class="space-y-3">
          <div v-for="evt in events" :key="evt.documentId"
            class="flex items-start gap-3 pb-3 border-b last:border-b-0"
            style="border-color: var(--border-subtle)">
            <div class="w-2.5 h-2.5 rounded-full mt-1.5 flex-shrink-0"
              :style="{ background: eventTypeColor[evt.event_type] || '#6b7280' }" />
            <div class="flex-1">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="text-sm font-medium" style="color: var(--text-main)">{{ eventTypeLabel[evt.event_type] || evt.event_type }}</span>
                <span v-if="evt.old_value" class="text-xs px-1.5 py-0.5 rounded" style="background: var(--bg-main); color: var(--text-muted)">{{ evt.old_value }}</span>
                <span v-if="evt.new_value" class="text-xs" style="color: var(--text-muted)">→</span>
                <span v-if="evt.new_value" class="text-xs px-1.5 py-0.5 rounded font-medium" style="background: var(--accent-soft); color: var(--accent)">{{ evt.new_value }}</span>
              </div>
              <p class="text-xs mt-0.5" style="color: var(--text-muted)">{{ formatDate(evt.createdAt) }}</p>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Ошибка -->
    <p v-if="error" class="mt-4 text-sm text-center" style="color: #fca5a5">{{ error }}</p>
  </div>
</template>

<script setup lang="ts">
import SkeletonLoader from '@/components/SkeletonLoader.vue'
import { ref, reactive, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import api from '@/api/strapi'

const route = useRoute()

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
  manual_price_per_sqm: string | null
  source: string
  auction_type: string
  url: string | null
  description: string | null
  contacts: string | null
  comments?: Comment[]
  photos?: string[]
  photos_downloaded?: boolean
  photo_urls?: string[]
}

interface Comment {
  id: number
  text: string
  createdAt: string
}

const property = ref<Property | null>(null)
const comments = ref<Comment[]>([])
const events = ref<any[]>([])
const loading = ref(true)
const saving = ref(false)
const error = ref('')
const comment = ref('')

const statuses = [
  { value: 'new', label: 'Новый', color: '#4f8cff' },
  { value: 'in_progress', label: 'В работу', color: '#f59e0b' },
  { value: 'viewed', label: 'Просмотрено', color: '#10b981' },
  { value: 'rejected', label: 'Отклонено', color: '#ef4444' },
]

const cityLabel = (v: string) => ({ moscow: 'Москва', mo: 'МО', other: 'Другой' })[v] || v
const typeLabel = (v: string) => ({
  office: 'Офис', warehouse: 'Склад', retail: 'Торговля',
  production: 'Производство', free_purpose: 'Свободного назначения', other: 'Другое'
})[v] || v
const statusLabel = (v: string) => ({
  new: 'Новый', in_progress: 'В работе', viewed: 'Просмотрен', rejected: 'Отклонён'
})[v] || v
const auctionLabel = (v: string) => ({
  bankruptcy: 'Банкротство', privatization: 'Приватизация', marketplace: 'Торговая площадка'
})[v] || v

const statusStyle = (s: string) => ({
  new: { background: 'rgba(79,140,255,0.15)', color: '#4f8cff' },
  in_progress: { background: 'rgba(251,191,36,0.15)', color: '#f59e0b' },
  viewed: { background: 'rgba(16,185,129,0.15)', color: '#10b981' },
  rejected: { background: 'rgba(239,68,68,0.15)', color: '#ef4444' },
})[s] || {}

const formatPrice = (v: string | number) => Number(v).toLocaleString('ru-RU')
const formatDate = (d: string) => new Date(d).toLocaleString('ru-RU')

// Photo gallery
const lightbox = reactive({ open: false, idx: 0 })

function photoUrl(path: string) {
  return `${api.defaults.baseURL}${path}`
}

function openLightbox(idx: number) {
  lightbox.idx = idx
  lightbox.open = true
}
function nextPhoto() {
  if (property.value && lightbox.idx < property.value.photos!.length - 1) lightbox.idx++
}
function prevPhoto() {
  if (lightbox.idx > 0) lightbox.idx--
}

async function fetchProperty() {
  loading.value = true
  try {
    const docId = route.params.id as string
    const { data } = await api.get(`/properties/${docId}`, {
      params: { populate: 'comments' }
    })
    property.value = data.data
    comments.value = data.data?.comments || []
  } catch (e: any) {
    error.value = e.response?.data?.error?.message || 'Ошибка загрузки'
  } finally {
    loading.value = false
  }
}

async function fetchEvents() {
  if (!property.value) return
  try {
    const { data } = await api.get('/property-events', {
      params: {
        'filters[property][documentId][$eq]': property.value.documentId,
        'sort': 'createdAt:desc',
        'pagination[pageSize]': 50,
      }
    })
    events.value = data.data || []
  } catch { /* ignore */ }
}

const eventTypeLabel: Record<string, string> = {
  created: 'Создан',
  entered_focus: 'Вошёл в фокус',
  left_focus: 'Вышел из фокуса',
  score_changed: 'Скор изменён',
  status_changed: 'Статус изменён',
  price_changed: 'Цена изменена',
}

const eventTypeColor: Record<string, string> = {
  created: '#10b981',
  entered_focus: '#4f8cff',
  left_focus: '#6b7280',
  score_changed: '#f59e0b',
  status_changed: '#8b5cf6',
  price_changed: '#ef4444',
}

async function changeStatus(status: string) {
  if (!property.value) return
  saving.value = true
  error.value = ''
  try {
    await api.put(`/properties/${property.value.documentId}`, {
      data: { status }
    })
    property.value.status = status
  } catch (e: any) {
    error.value = e.response?.data?.error?.message || 'Ошибка обновления'
  } finally {
    saving.value = false
  }
}

async function addComment() {
  if (!property.value || !comment.value.trim()) return
  saving.value = true
  error.value = ''
  try {
    await api.post('/user-comments', {
      data: {
        text: comment.value.trim(),
        property: property.value.id,
      }
    })
    comment.value = ''
    // Перезагружаем комментарии
    const { data } = await api.get(`/properties/${property.value.documentId}`, {
      params: { populate: 'comments' }
    })
    comments.value = data.data?.comments || []
  } catch (e: any) {
    error.value = e.response?.data?.error?.message || 'Ошибка добавления комментария'
  } finally {
    saving.value = false
  }
}

onMounted(async () => {
  await fetchProperty()
  await fetchEvents()
})
</script>
