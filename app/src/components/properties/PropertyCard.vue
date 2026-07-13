<template>
  <router-link
    :to="`/properties/${item.documentId}`"
    class="block rounded-xl border p-4 cursor-pointer transition-all hover:shadow-lg"
    style="background: var(--bg-elevated); border-color: var(--border-subtle)"
  >
    <!-- Row 1: Title (always fully visible, wraps if needed) -->
    <div class="flex items-start gap-2 mb-1">
      <input v-if="variant === 'focus'" type="checkbox" :checked="selected" @change="$emit('toggle-select')" @click.prevent.stop
        class="rounded mt-0.5 flex-shrink-0" style="accent-color: var(--accent)" />
      <h3 class="font-semibold text-sm flex-1" style="color: var(--text-main)">{{ item.title }}</h3>
    </div>

    <!-- Row 2: badges + meta line -->
    <div class="flex items-start justify-between gap-2 mb-3 flex-wrap">
      <div class="text-xs truncate flex-1 min-w-0" style="color: var(--text-muted)">
        <span v-if="item.address">{{ item.address }}</span>
        <span v-if="item.address && (item.city || item.property_type)"> · </span>
        <span v-if="item.city">{{ cityLabel(item.city) }}</span>
        <span v-if="item.city && item.property_type"> · </span>
        <span v-if="item.property_type">{{ typeLabel(item.property_type) }}</span>
        <span v-if="item.source"> · {{ item.source }}</span>
      </div>
      <div class="flex items-center gap-1.5 shrink-0">
        <template v-if="variant === 'focus'">
          <span v-if="item.has_minimum_price" class="text-xs px-1.5 py-0.5 rounded-full font-semibold whitespace-nowrap" style="background: rgba(79,140,255,0.15); color: #4f8cff">Торги</span>
          <span v-if="item.deviation_percent != null" class="text-xs px-2 py-0.5 rounded-full font-semibold whitespace-nowrap" :style="deviationStyle(Number(item.deviation_percent))">{{ item.deviation_percent }}%</span>
        </template>
        <template v-else>
          <span class="text-xs px-2 py-0.5 rounded-full whitespace-nowrap" :style="statusStyle(item.status || 'unknown')">{{ statusLabel(item.status || 'unknown') }}</span>
          <span v-if="item.is_undervalued" class="text-xs px-2 py-0.5 rounded-full font-semibold whitespace-nowrap" style="background: rgba(251,191,36,0.15); color: #f59e0b">⚠ {{ item.deviation_percent }}%</span>
        </template>
      </div>
    </div>

    <!-- Zone 3: Metric tiles -->
    <div class="grid gap-3" :class="variant === 'focus' ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3'">
      <div>
        <div class="text-xs" style="color: var(--text-muted)">Площадь</div>
        <div class="text-sm font-mono font-medium" style="color: var(--text-main)">{{ item.area_sqm ? `${item.area_sqm} м²` : '—' }}</div>
      </div>
      <div>
        <div class="text-xs" style="color: var(--text-muted)">Цена</div>
        <div class="text-sm font-mono font-medium" style="color: var(--text-main)">{{ formatPriceShort(item.price) }}</div>
      </div>
      <div>
        <div class="text-xs" style="color: var(--text-muted)">₽/м²</div>
        <div class="text-sm font-mono font-medium" style="color: var(--text-main)">{{ formatPriceShort(item.price_per_sqm) }}</div>
      </div>
      <div v-if="variant === 'focus'">
        <div class="text-xs" style="color: var(--text-muted)">Скор</div>
        <div class="text-sm font-mono font-semibold" style="color: var(--text-main)">{{ item.focus_score ?? '—' }}</div>
      </div>
    </div>

    <!-- Zone 4 (focus only): Tags + quick actions -->
    <div v-if="variant === 'focus'" class="mt-2 pt-2 border-t flex flex-wrap items-center gap-2" style="border-color: var(--border-subtle)">
      <div class="flex flex-wrap gap-1 flex-1">
        <span v-for="tag in (item.tags || []).filter(t => !HIDDEN_TAGS.includes(t))" :key="tag" class="text-xs px-1.5 py-0.5 rounded-full whitespace-nowrap" :style="tagStyle(tag)">{{ tagLabel(tag) }}</span>
      </div>
      <div class="flex gap-1 shrink-0">
        <button @click.stop.prevent="$emit('quick-reject')" class="text-xs px-2 py-1 rounded-lg hover:opacity-80" style="background: rgba(239,68,68,0.15); color: #ef4444">Отклонить</button>
        <template v-if="selected">
          <button @click.stop.prevent="$emit('bulk-status', 'viewed')" class="text-xs px-2 py-1 rounded-lg hover:opacity-80" style="background: rgba(16,185,129,0.15); color: #10b981">Просмотрено</button>
          <button @click.stop.prevent="$emit('bulk-csv')" class="text-xs px-2 py-1 rounded-lg hover:opacity-80" style="background: rgba(79,140,255,0.15); color: #4f8cff">CSV</button>
        </template>
      </div>
    </div>
  </router-link>
</template>

<script setup lang="ts">
import type { Property } from '@/composables/usePropertyData'
import { cityLabel, typeLabel, statusLabel, statusStyle, formatPriceShort } from '@/utils/formatters'
import { tagStyle, tagLabel, deviationStyle, HIDDEN_TAGS } from '@/composables/useFocusTab'

withDefaults(defineProps<{
  item: Property
  variant?: 'default' | 'focus'
  selected?: boolean
}>(), {
  variant: 'default',
  selected: false,
})

defineEmits<{
  (e: 'open'): void
  (e: 'toggle-select'): void
  (e: 'quick-reject'): void
  (e: 'bulk-status', status: string): void
  (e: 'bulk-csv'): void
}>()
</script>
