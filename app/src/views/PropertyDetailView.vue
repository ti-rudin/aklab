<template>
  <div class="max-w-screen-xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
    <!-- Навигация -->
    <router-link :to="returnToList" class="text-sm hover:underline mb-6 inline-block" style="color: var(--text-muted)">← К списку объектов</router-link>

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

    <!-- Основной контент -->
    <div v-else class="space-y-6">

      <!-- ==================== HERO BLOCK ==================== -->
      <div class="rounded-xl p-6 border" style="background: var(--bg-elevated); border-color: var(--border-subtle)">
        <!-- Цена + бейджи -->
        <div class="flex flex-wrap items-center gap-3 mb-2">
          <span class="text-3xl font-bold font-mono" style="color: var(--text-main)">
            {{ property.price ? formatPrice(property.price) : '—' }}
          </span>
          <span class="text-lg" style="color: var(--text-muted)">₽</span>
          <span v-if="property.price_per_sqm" class="text-sm font-mono" style="color: var(--text-muted)">
            ({{ formatPrice(property.price_per_sqm) }} ₽/м²)
          </span>
          <BaseBadge v-if="property.is_undervalued" variant="danger" size="sm">
            -{{ property.deviation_percent }}% к рынку
          </BaseBadge>
          <span v-if="property.focus_score" class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold"
            :style="{ background: scoreBg(property.focus_score), color: scoreColor(property.focus_score) }">
            ★ {{ property.focus_score }}
          </span>
        </div>

        <!-- Название + адрес -->
        <h1 class="text-xl font-bold mb-1" style="color: var(--text-main)">{{ property.title }}</h1>
        <p class="text-sm mb-4" style="color: var(--text-muted)">{{ property.address || 'Адрес не указан' }}</p>

        <!-- Ключевые метрики -->
        <div class="flex flex-wrap items-center gap-4 text-sm" style="color: var(--text-main)">
          <span v-if="property.area_sqm" class="inline-flex items-center gap-1">
            <span style="color: var(--text-muted)">Площадь:</span>
            <span class="font-mono">{{ property.area_sqm }} м²</span>
          </span>
          <span class="inline-flex items-center gap-1">
            <span style="color: var(--text-muted)">Тип:</span>
            <span>{{ typeLabel(property.property_type) }}</span>
          </span>
          <span class="inline-flex items-center gap-1">
            <span style="color: var(--text-muted)">Источник:</span>
            <span>{{ property.source }}</span>
          </span>
          <span class="inline-flex items-center gap-1">
            <span style="color: var(--text-muted)">Город:</span>
            <span>{{ cityLabel(property.city) }}</span>
          </span>
          <span class="text-xs px-2 py-0.5 rounded-full" :style="statusStyle(property.status)">
            {{ statusLabel(property.status) }}
          </span>
        </div>
      </div>

      <!-- ==================== ССЫЛКИ ==================== -->
      <div class="flex flex-wrap items-center gap-3">
        <a v-if="sourceUrl" :href="sourceUrl" target="_blank" rel="noopener"
          class="inline-flex items-center gap-1 text-sm hover:underline" style="color: var(--accent)">
          Открыть на источнике →
        </a>
        <span v-else class="text-sm" style="color: var(--text-muted)">Ссылка на источник недоступна</span>

        <span v-if="sourceUrl && cianUrl" class="text-sm" style="color: var(--text-muted)">·</span>

        <a v-if="cianUrl" :href="cianUrl" target="_blank" rel="noopener"
          class="inline-flex items-center gap-1 text-sm hover:underline" style="color: var(--accent)">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
          Посмотреть соседей на ЦИАН
        </a>
        <span v-else-if="geocoding" class="text-sm" style="color: var(--text-muted)">⏳ Определяем координаты…</span>
      </div>

      <!-- ==================== PROVENANCE ГЕОГРАФИИ ==================== -->
      <div
        v-if="property.property_location"
        data-testid="property-location"
        class="rounded-xl p-6 border"
        style="background: var(--bg-elevated); border-color: var(--border-subtle)"
      >
        <h2 class="text-lg font-semibold mb-4" style="color: var(--text-main)">Местоположение объекта</h2>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div>
            <span class="block text-xs" style="color: var(--text-muted)">Статус подтверждения</span>
            <span style="color: var(--text-main)">{{ locationStatusLabel(property.property_location.status) }}</span>
          </div>
          <div>
            <span class="block text-xs" style="color: var(--text-muted)">Источник</span>
            <span style="color: var(--text-main)">{{ sourceKindLabel(property.property_location.source_kind) }}</span>
          </div>
          <div v-if="property.property_location.address">
            <span class="block text-xs" style="color: var(--text-muted)">Адрес объекта</span>
            <span style="color: var(--text-main)">{{ property.property_location.address }}</span>
          </div>
          <div v-if="property.property_location.region">
            <span class="block text-xs" style="color: var(--text-muted)">Регион объекта</span>
            <span style="color: var(--text-main)">{{ property.property_location.region }}</span>
          </div>
          <div v-if="property.property_location.region_code">
            <span class="block text-xs" style="color: var(--text-muted)">Код региона</span>
            <span class="font-mono" style="color: var(--text-main)">{{ property.property_location.region_code }}</span>
          </div>
          <div v-if="property.property_location.latitude != null && property.property_location.longitude != null">
            <span class="block text-xs" style="color: var(--text-muted)">Координаты объекта</span>
            <span class="font-mono" style="color: var(--text-main)">
              {{ property.property_location.latitude }}, {{ property.property_location.longitude }}
            </span>
          </div>
        </div>
        <p class="mt-4 text-xs break-all" style="color: var(--text-muted)">
          Provenance: {{ property.property_location.source_path }}
        </p>
      </div>

      <!-- ==================== СТОРОНЫ (НЕ ГЕОГРАФИЯ ОБЪЕКТА) ==================== -->
      <div
        v-if="property.parties?.length"
        data-testid="property-parties"
        class="rounded-xl p-6 border"
        style="background: var(--bg-elevated); border-color: var(--border-subtle)"
      >
        <h2 class="text-lg font-semibold mb-1" style="color: var(--text-main)">Стороны и участники</h2>
        <p class="text-xs mb-4" style="color: var(--text-muted)">
          Адреса сторон не используются как местоположение объекта.
        </p>
        <div class="space-y-4">
          <article v-for="(party, index) in property.parties" :key="`${party.source_path}-${index}`" class="border-t pt-4 first:border-t-0 first:pt-0" style="border-color: var(--border-subtle)">
            <h3 class="font-medium" style="color: var(--text-main)">{{ party.name || 'Сторона без названия' }}</h3>
            <p class="text-xs mt-1" style="color: var(--text-muted)">
              {{ party.roles.map(partyRoleLabel).join(', ') }} · {{ sourceKindLabel(party.source_kind) }} · {{ party.source_path }}
            </p>
            <dl v-if="Object.keys(party.identifiers || {}).length" class="mt-2 text-sm space-y-1">
              <div v-for="(value, key) in party.identifiers" :key="key" class="flex gap-2">
                <dt class="uppercase" style="color: var(--text-muted)">{{ key }}:</dt>
                <dd style="color: var(--text-main)">{{ value }}</dd>
              </div>
            </dl>
            <div v-if="party.addresses?.length" class="mt-3 space-y-2">
              <div v-for="(address, addressIndex) in party.addresses" :key="`${address.kind}-${addressIndex}`">
                <span class="block text-xs" style="color: var(--text-muted)">{{ partyAddressLabel(address.kind) }}</span>
                <span class="text-sm" style="color: var(--text-main)">{{ address.value }}</span>
              </div>
            </div>
          </article>
        </div>
      </div>

      <!-- ==================== ФОТОГАЛЕРЕЯ (private blob media) ==================== -->
      <div class="rounded-xl p-6 border" style="background: var(--bg-elevated); border-color: var(--border-subtle)">
        <h2 class="text-lg font-semibold mb-4" style="color: var(--text-main)">📸 Фотографии</h2>
        <!-- Photos loaded as private blob ObjectURLs -->
        <div v-if="thumbnails.length" class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          <div v-for="(photo, idx) in thumbnails" :key="photo.path"
            class="aspect-square rounded-lg overflow-hidden cursor-pointer hover:opacity-80 transition-opacity"
            @click="openLightbox(idx)">
            <img :src="photo.url" :alt="`Фото ${idx + 1}`"
              class="w-full h-full object-cover" />
          </div>
        </div>
        <div v-if="Object.keys(mediaErrors).length" class="text-xs mt-3" style="color: var(--danger)">
          Некоторые фотографии недоступны и не были показаны.
        </div>
        <!-- Loading: queue polling or blob hydration -->
        <div v-else-if="photoLoading || mediaLoading" class="flex flex-col items-center gap-3 py-4">
          <div class="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin" style="border-color: var(--accent); border-top-color: transparent"></div>
          <span class="text-sm" style="color: var(--text-muted)">Загружаем фотографии…</span>
        </div>
        <!-- No photos after a terminal response -->
        <div v-else-if="property.photos_downloaded || photoTerminal === 'no_url'" class="text-sm py-4 text-center" style="color: var(--text-muted)">
          Фотографии не найдены
        </div>
        <!-- Not fetched yet -->
        <div v-else class="flex flex-col items-center gap-3 py-4">
          <span class="text-sm" style="color: var(--text-muted)">Фотографии ещё не загружены</span>
          <BaseButton variant="primary" size="sm" @click="triggerPhotoFetch">
            Загрузить фотографии
          </BaseButton>
        </div>
        <!-- Lightbox owns a separate ObjectURL; thumbnails remain valid when it closes. -->
        <Teleport to="body">
          <div v-if="lightbox.open && lightboxUrl" class="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
            role="dialog" aria-modal="true" aria-label="Просмотр фотографии" tabindex="-1"
            @click.self="closeLightbox">
            <button @click="closeLightbox" class="absolute top-4 right-4 text-white text-2xl" aria-label="Закрыть">✕</button>
            <button @click="prevPhoto" class="absolute left-4 text-white text-3xl" aria-label="Предыдущее фото">‹</button>
            <img :src="lightboxUrl" :alt="`Фото ${lightbox.idx + 1}`" class="max-h-[80vh] max-w-[90vw] object-contain" />
            <button @click="nextPhoto" class="absolute right-4 text-white text-3xl" aria-label="Следующее фото">›</button>
            <div class="absolute bottom-4 text-white text-sm">{{ lightbox.idx + 1 }} / {{ thumbnails.length }}</div>
          </div>
        </Teleport>
      </div>

      <!-- ==================== СВОРАЧИВАЕМЫЕ ДЕТАЛИ ==================== -->
      <div class="rounded-xl border" style="background: var(--bg-elevated); border-color: var(--border-subtle)">
        <button
          class="w-full flex items-center justify-between p-6 text-left"
          @click="detailsOpen = !detailsOpen"
        >
          <h2 class="text-lg font-semibold" style="color: var(--text-main)">📋 Детали</h2>
          <svg
            class="w-5 h-5 transition-transform duration-200"
            :class="{ 'rotate-180': detailsOpen }"
            style="color: var(--text-muted)"
            xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"
          >
            <path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clip-rule="evenodd" />
          </svg>
        </button>
        <div v-if="detailsOpen" class="px-6 pb-6 pt-0">
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div v-if="property.minimum_price">
              <span class="block text-xs" style="color: var(--text-muted)">Начальная цена</span>
              <span class="font-mono" style="color: var(--text-main)">{{ formatPrice(property.minimum_price) }} ₽</span>
            </div>
            <div v-if="property.manual_price_per_sqm">
              <span class="block text-xs" style="color: var(--text-muted)">Эталон ₽/м²</span>
              <span class="font-mono" style="color: var(--text-main)">{{ formatPrice(property.manual_price_per_sqm) }} ₽/м²</span>
            </div>
            <div>
              <span class="block text-xs" style="color: var(--text-muted)">Тип торгов</span>
              <span style="color: var(--text-main)">{{ auctionLabel(property.auction_type) }}</span>
            </div>
            <div v-if="property.published_at_source">
              <span class="block text-xs" style="color: var(--text-muted)">Дата публикации</span>
              <span style="color: var(--text-main)">{{ formatDate(property.published_at_source) }}</span>
            </div>
            <div v-if="property.first_seen_at">
              <span class="block text-xs" style="color: var(--text-muted)">Обнаружен</span>
              <span style="color: var(--text-main)">{{ formatDate(property.first_seen_at) }}</span>
            </div>

          </div>

          <!-- Описание -->
          <div v-if="property.description" class="mt-4 pt-4" style="border-top: 1px solid var(--border-subtle)">
            <span class="block text-xs mb-1" style="color: var(--text-muted)">Описание</span>
            <p class="text-sm whitespace-pre-wrap leading-relaxed" style="color: var(--text-main)"
              :class="{ 'line-clamp-4': !showFullDesc && property.description.length > 300 }">
              {{ property.description }}
            </p>
            <button v-if="property.description.length > 300"
              @click="showFullDesc = !showFullDesc"
              class="text-xs mt-1 hover:underline" style="color: var(--accent)">
              {{ showFullDesc ? 'Свернуть' : 'Показать полностью' }}
            </button>
          </div>

          <!-- Контакты -->
          <div v-if="property.contacts" class="mt-4 pt-4" style="border-top: 1px solid var(--border-subtle)">
            <span class="block text-xs mb-1" style="color: var(--text-muted)">Контакты</span>
            <p class="text-sm" style="color: var(--text-main)">{{ property.contacts }}</p>
          </div>
        </div>
      </div>

      <!-- ==================== ИНФОРМАЦИЯ О ТОРГАХ ==================== -->
      <BaseCard v-if="property.auction_type || property.minimum_price" padding="md">
        <h3 class="text-sm font-semibold mb-3" style="color: var(--text-main)">📋 Информация о торгах</h3>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <span class="block text-xs" style="color: var(--text-muted)">Тип торгов</span>
            <span class="text-sm font-medium" style="color: var(--text-main)">{{ auctionLabel(property.auction_type) }}</span>
          </div>
          <div v-if="property.minimum_price">
            <span class="block text-xs" style="color: var(--text-muted)">Начальная цена</span>
            <span class="text-sm font-mono font-medium" style="color: var(--text-main)">{{ formatPrice(property.minimum_price) }} ₽</span>
          </div>
          <div v-if="property.price">
            <span class="block text-xs" style="color: var(--text-muted)">Текущая цена</span>
            <span class="text-sm font-mono font-medium" style="color: var(--text-main)">{{ formatPrice(property.price) }} ₽</span>
          </div>
          <div v-if="property.published_at_source">
            <span class="block text-xs" style="color: var(--text-muted)">Дата размещения</span>
            <span class="text-sm" style="color: var(--text-main)">{{ formatDate(property.published_at_source) }}</span>
          </div>
        </div>
      </BaseCard>

      <!-- ==================== ДЕЙСТВИЯ ==================== -->
      <div class="rounded-xl p-6 border" style="background: var(--bg-elevated); border-color: var(--border-subtle)">
        <h2 class="text-lg font-semibold mb-4" style="color: var(--text-main)">Действия</h2>
        <div class="flex flex-wrap gap-3 mb-4">
          <BaseButton v-for="s in statuses" :key="s.value"
            :variant="property.status === s.value ? 'primary' : 'secondary'"
            :disabled="saving || property.status === s.value"
            @click="changeStatus(s.value)"
          >
            {{ s.label }}
          </BaseButton>
        </div>

        <!-- Комментарий -->
        <div>
          <label class="block text-sm mb-2" style="color: var(--text-muted)">Добавить комментарий</label>
          <div class="flex gap-2">
            <div class="flex-1">
              <BaseInput v-model="comment" placeholder="Ваш комментарий…" @keyup.enter="addComment" />
            </div>
            <BaseButton variant="primary" :disabled="!comment.trim() || saving" @click="addComment">
              Добавить
            </BaseButton>
          </div>
        </div>
      </div>

      <!-- ==================== КОММЕНТАРИИ ==================== -->
      <div v-if="comments.length" class="rounded-xl p-6 border" style="background: var(--bg-elevated); border-color: var(--border-subtle)">
        <h2 class="text-lg font-semibold mb-4" style="color: var(--text-main)">Комментарии ({{ comments.length }})</h2>
        <div class="space-y-3">
          <div v-for="c in comments" :key="c.id" class="py-2 border-b last:border-b-0" style="border-color: var(--border-subtle)">
            <p class="text-sm" style="color: var(--text-main)">{{ c.text }}</p>
            <p class="text-xs mt-1" style="color: var(--text-muted)">{{ formatDate(c.createdAt) }}</p>
          </div>
        </div>
      </div>

      <!-- ==================== ИСТОРИЯ СОБЫТИЙ ==================== -->
      <div v-if="events.length" class="rounded-xl p-6 border" style="background: var(--bg-elevated); border-color: var(--border-subtle)">
        <h2 class="text-lg font-semibold mb-4" style="color: var(--text-main)">📋 История</h2>
        <div class="space-y-3">
          <div v-for="evt in events" :key="evt.documentId"
            class="flex items-start gap-3 pb-3 border-b last:border-b-0"
            style="border-color: var(--border-subtle)">
            <div class="w-2.5 h-2.5 rounded-full mt-1.5 flex-shrink-0"
              :style="{ background: eventTypeColor[evt.event_type] || 'var(--text-muted)' }" />
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
    <p v-if="error" class="mt-4 text-sm text-center" style="color: var(--danger)">{{ error }}</p>
  </div>
</template>

<script setup lang="ts">
import SkeletonLoader from '@/components/SkeletonLoader.vue'
import BaseBadge from '@/components/ui/BaseBadge.vue'
import BaseCard from '@/components/ui/BaseCard.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import { ref, reactive, computed, onMounted, watch, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import api from '@/api/strapi'
import { cityLabel, typeLabel, statusLabel, statusStyle, formatPrice } from '@/utils/formatters'
import { scoreColor, scoreBg } from '@/utils/styleHelpers'
import { useToast } from '@/composables/useToast'
import { usePropertyMedia } from '@/composables/usePropertyMedia'

const route = useRoute()
const returnToList = computed(() => route.query?.tab === 'focus'
  ? { path: '/properties', query: { tab: 'focus' } }
  : '/properties')
const toast = useToast()
const {
  thumbnails,
  errors: mediaErrors,
  loading: mediaLoading,
  lightboxUrl,
  load: loadMedia,
  resetMedia,
  openLightbox: createLightboxUrl,
  closeLightbox: revokeLightbox,
  pollForPhotos,
  stopPolling,
} = usePropertyMedia()

interface Property {
  documentId: string
  title: string
  address: string | null
  city: string
  property_type: string
  area_sqm: string | null
  price: string | null
  minimum_price: string | null
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
  published_at_source: string | null
  first_seen_at: string | null
  focus_score: number | null
  tags: string[] | null
  photos?: string[] | null
  photos_downloaded?: boolean
  latitude?: number | null
  longitude?: number | null
  property_location?: PropertyLocation | null
  parties?: PropertyParty[]
}

interface PropertyLocation {
  address?: string
  region?: string
  region_code?: string
  latitude?: number
  longitude?: number
  status: 'confirmed_address' | 'confirmed_region_only' | 'missing'
  source_kind: 'api_field' | 'dom_field' | 'xml_field' | 'ssr_field'
  source_path: string
}

interface PartyAddress {
  kind: 'legal' | 'postal' | 'actual' | 'registration' | 'unknown'
  value: string
}

interface PropertyParty {
  name?: string
  roles: Array<'owner' | 'debtor' | 'pledgee' | 'organizer' | 'seller' | 'customer' | 'operator' | 'other'>
  identifiers?: Record<string, string>
  addresses?: PartyAddress[]
  confidence: 'structured' | 'explicit_text'
  source_kind: PropertyLocation['source_kind']
  source_path: string
}

interface Comment {
  id: number
  text: string
  createdAt: string
}

interface PropertyEvent {
  documentId: string
  event_type: string
  old_value: string | null
  new_value: string | null
  createdAt: string | null
  updatedAt?: string | null
}

const property = ref<Property | null>(null)
const comments = ref<Comment[]>([])
const events = ref<PropertyEvent[]>([])
const loading = ref(true)
const saving = ref(false)
const error = ref('')
const comment = ref('')
const showFullDesc = ref(false)
const photoLoading = ref(false)
const photoTerminal = ref<'no_url' | 'downloaded' | 'error' | null>(null)
const detailsOpen = ref(false)
let pageGeneration = 0

const statuses = [
  { value: 'new', label: 'Новый' },
  { value: 'in_progress', label: 'В работу' },
  { value: 'viewed', label: 'Просмотрено' },
  { value: 'rejected', label: 'Отклонено' },
]

const auctionLabel = (v: string) => ({
  bankruptcy: 'Банкротство', privatization: 'Приватизация', marketplace: 'Торговая площадка'
})[v] || v
const locationStatusLabel = (value: PropertyLocation['status']) => ({
  confirmed_address: 'Подтверждённый адрес',
  confirmed_region_only: 'Подтверждён только регион',
  missing: 'Структурированное местоположение не найдено',
})[value]
const sourceKindLabel = (value: PropertyLocation['source_kind']) => ({
  api_field: 'Поле API',
  dom_field: 'Поле страницы',
  xml_field: 'Поле XML',
  ssr_field: 'Поле SSR',
})[value]
const partyRoleLabel = (value: PropertyParty['roles'][number]) => ({
  owner: 'Собственник',
  debtor: 'Должник',
  pledgee: 'Залогодержатель',
  organizer: 'Организатор',
  seller: 'Продавец',
  customer: 'Заказчик',
  operator: 'Оператор',
  other: 'Другая роль',
})[value]
const partyAddressLabel = (value: PartyAddress['kind']) => ({
  legal: 'Юридический адрес стороны',
  postal: 'Почтовый адрес стороны',
  actual: 'Фактический адрес стороны',
  registration: 'Адрес регистрации стороны',
  unknown: 'Адрес стороны',
})[value]
const formatDate = (d: string | null) => d ? new Date(d).toLocaleString('ru-RU') : '—'

// Private blob gallery lifecycle
const lightbox = reactive({ open: false, idx: 0 })

function openLightbox(idx: number): void {
  if (createLightboxUrl(idx)) {
    lightbox.idx = idx
    lightbox.open = true
  }
}

function closeLightbox(): void {
  lightbox.open = false
  revokeLightbox()
}

function nextPhoto(): void {
  if (lightbox.idx < thumbnails.value.length - 1) {
    lightbox.idx += 1
    createLightboxUrl(lightbox.idx)
  }
}

function prevPhoto(): void {
  if (lightbox.idx > 0) {
    lightbox.idx -= 1
    createLightboxUrl(lightbox.idx)
  }
}

function onLightboxKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') closeLightbox()
  else if (e.key === 'ArrowLeft') prevPhoto()
  else if (e.key === 'ArrowRight') nextPhoto()
}

watch(() => lightbox.open, (open) => {
  if (open) {
    document.addEventListener('keydown', onLightboxKeydown)
    document.body.style.overflow = 'hidden'
  } else {
    document.removeEventListener('keydown', onLightboxKeydown)
    document.body.style.overflow = ''
  }
})

onUnmounted(() => {
  pageGeneration += 1
  stopPolling()
  closeLightbox()
  document.removeEventListener('keydown', onLightboxKeydown)
  document.body.style.overflow = ''
})

function isPropertyDetail(value: unknown): value is Property {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && typeof (value as Property).documentId === 'string'
}

async function applyPhotoDetail(detail: Record<string, unknown>, documentId: string): Promise<void> {
  if (
    !isPropertyDetail(detail)
    || detail.documentId !== documentId
    || property.value?.documentId !== documentId
  ) {
    throw new Error('Invalid scoped photo detail')
  }
  property.value = { ...property.value, ...detail }
  if (detail.photos_downloaded === true) {
    await loadMedia(documentId, detail.photos)
  }
}

async function refreshPhotoDetail(documentId: string): Promise<void> {
  const { data } = await api.get(`/properties/${documentId}`)
  if (!isPropertyDetail(data?.data)) throw new Error('Invalid property detail response')
  await applyPhotoDetail(data.data, documentId)
}

async function triggerPhotoFetch(): Promise<void> {
  const current = property.value
  if (!current || photoLoading.value) return
  const documentId = current.documentId
  const generation = pageGeneration
  const isCurrent = () => generation === pageGeneration && property.value?.documentId === documentId
  photoLoading.value = true
  photoTerminal.value = null
  try {
    const { data } = await api.post(`/properties/${documentId}/fetch-photos`)
    if (!isCurrent()) return
    if (data?.queued === true) {
      const result = await pollForPhotos(documentId, (detail) => applyPhotoDetail(detail, documentId))
      if (!isCurrent()) return
      if (result.status === 'downloaded') photoTerminal.value = 'downloaded'
      else if (result.status === 'error') {
        photoTerminal.value = 'error'
        throw new Error('Photo polling failed')
      }
      return
    }
    if (data?.queued === false && data.reason === 'already_downloaded') {
      await refreshPhotoDetail(documentId)
      photoTerminal.value = 'downloaded'
      return
    }
    if (data?.queued === false && data.reason === 'no_url') {
      photoTerminal.value = 'no_url'
      return
    }
    throw new Error('Invalid photo queue response')
  } catch {
    if (isCurrent()) {
      photoTerminal.value = 'error'
      toast.error('Не удалось загрузить фотографии')
    }
  } finally {
    if (isCurrent()) photoLoading.value = false
  }
}

const geocoding = ref(false)

const CIAN_MAP_BASE = import.meta.env.VITE_CIAN_MAP_URL || 'https://www.cian.ru/map/'

const cianUrl = computed(() => {
  if (!property.value?.latitude || !property.value?.longitude) return null
  const lat = property.value.latitude
  const lng = property.value.longitude
  return `${CIAN_MAP_BASE}?deal_type=sale&offer_type=commercial&object_type[0]=1&object_type[1]=2&object_type[2]=5&center=${lat},${lng}&zoom=16`
})

function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null
  } catch {
    return null
  }
}

const sourceUrl = computed(() => safeHttpUrl(property.value?.url))

async function geocodeAddress() {
  const current = property.value
  if (!current?.address || current.latitude) return
  const documentId = current.documentId
  const generation = pageGeneration
  geocoding.value = true
  try {
    const { data } = await api.get(`/properties/${documentId}/geocode`)
    if (
      generation === pageGeneration
      && property.value?.documentId === documentId
      && data.latitude
      && data.longitude
    ) {
      property.value.latitude = data.latitude
      property.value.longitude = data.longitude
    }
  } catch { /* geocode — non-critical, button won't show */ }
  finally {
    if (generation === pageGeneration) geocoding.value = false
  }
}

async function fetchProperty(): Promise<boolean> {
  const generation = ++pageGeneration
  const documentId = route.params.id as string
  loading.value = true
  error.value = ''
  property.value = null
  comments.value = []
  events.value = []
  photoLoading.value = false
  photoTerminal.value = null
  geocoding.value = false
  stopPolling()
  resetMedia()

  try {
    // Detail is the scope gate. It has no query and no dependent request can precede it.
    const { data } = await api.get(`/properties/${documentId}`)
    if (generation !== pageGeneration) return false
    if (!isPropertyDetail(data?.data) || data.data.documentId !== documentId) {
      error.value = 'Объект не найден'
      return false
    }

    property.value = data.data
    if (data.data.photos_downloaded === true) {
      await loadMedia(documentId, data.data.photos)
      if (generation !== pageGeneration) return false
    }

    const [commentsResult, eventsResult] = await Promise.allSettled([
      api.get(`/me/properties/${documentId}/comments`),
      api.get(`/me/properties/${documentId}/events`, { params: { page: 1, pageSize: 100 } }),
    ])
    if (generation !== pageGeneration) return false
    if (commentsResult.status === 'fulfilled') {
      comments.value = commentsResult.value.data?.data || []
    }
    if (eventsResult.status === 'fulfilled') {
      events.value = eventsResult.value.data?.data || []
    }
    return true
  } catch (e: any) {
    if (generation === pageGeneration) {
      property.value = null
      error.value = e.response?.data?.error?.message || 'Объект не найден'
    }
    return false
  } finally {
    if (generation === pageGeneration) loading.value = false
  }
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
  created: 'var(--success)',
  entered_focus: 'var(--accent)',
  left_focus: 'var(--text-muted)',
  score_changed: 'var(--warning)',
  status_changed: '#8b5cf6',
  price_changed: 'var(--danger)',
}

async function changeStatus(status: string): Promise<void> {
  if (!property.value) return
  saving.value = true
  error.value = ''
  try {
    const { data } = await api.put(`/me/properties/${property.value.documentId}/status`, {
      data: { status },
    })
    const acknowledgedStatus = data?.data?.status
    if (typeof acknowledgedStatus !== 'string' || !statuses.some((item) => item.value === acknowledgedStatus)) {
      throw new Error('Invalid status acknowledgement')
    }
    property.value = { ...property.value, status: acknowledgedStatus }
  } catch (e: any) {
    error.value = e.response?.data?.error?.message || 'Ошибка обновления'
  } finally {
    saving.value = false
  }
}

async function addComment(): Promise<void> {
  if (!property.value || !comment.value.trim()) return
  saving.value = true
  error.value = ''
  const draft = comment.value.trim()
  try {
    const { data } = await api.post(`/me/properties/${property.value.documentId}/comments`, {
      data: { text: draft },
    })
    const acknowledgedComment = data?.data
    if (!acknowledgedComment || typeof acknowledgedComment.text !== 'string') {
      throw new Error('Invalid comment acknowledgement')
    }
    comments.value = [...comments.value, acknowledgedComment]
    comment.value = ''
  } catch (e: any) {
    error.value = e.response?.data?.error?.message || 'Ошибка добавления комментария'
  } finally {
    saving.value = false
  }
}

async function loadPage(): Promise<void> {
  const loaded = await fetchProperty()
  if (!loaded || !property.value) return
  geocodeAddress() // scoped and non-critical
  if (!property.value.photos_downloaded) void triggerPhotoFetch()
}

onMounted(() => { void loadPage() })
watch(() => route.params.id, () => { void loadPage() })
</script>

<style scoped>
.line-clamp-4 {
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
