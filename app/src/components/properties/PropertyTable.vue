<template>
  <div class="rounded-xl border overflow-hidden" style="border-color: var(--border-subtle)">
    <div class="overflow-x-auto">
      <table class="w-full text-sm border-collapse" style="min-width: 720px">
        <thead>
          <tr style="background: var(--bg-elevated)">
            <th v-if="variant === 'focus'" class="text-center px-2 py-3 w-8 sticky left-0 z-10" style="background: var(--bg-elevated)">
              <input type="checkbox" :checked="allSelected" @change="$emit('toggle-all')" style="accent-color: var(--accent)" />
            </th>
            <th
              class="text-left px-3 py-3 font-semibold whitespace-nowrap cursor-pointer sticky z-10"
              :style="{ background: 'var(--bg-elevated)', color: 'var(--text-muted)', left: variant === 'focus' ? '2rem' : '0' }"
              @click="$emit('sort', 'title')"
            >
              Название {{ sortIndicator('title') }}
            </th>
            <th class="text-left px-3 py-3 font-semibold whitespace-nowrap hidden md:table-cell" style="color: var(--text-muted)">Адрес</th>
            <th class="text-left px-3 py-3 font-semibold whitespace-nowrap" style="color: var(--text-muted)">Город</th>
            <th class="text-left px-3 py-3 font-semibold whitespace-nowrap hidden sm:table-cell" style="color: var(--text-muted)">Тип</th>
            <th class="text-right px-3 py-3 font-semibold whitespace-nowrap cursor-pointer" style="color: var(--text-muted)" @click="$emit('sort', 'area_sqm')">
              Площадь {{ sortIndicator('area_sqm') }}
            </th>
            <th class="text-right px-3 py-3 font-semibold whitespace-nowrap cursor-pointer" style="color: var(--text-muted)" @click="$emit('sort', 'price')">
              Цена {{ sortIndicator('price') }}
            </th>
            <th class="text-right px-3 py-3 font-semibold whitespace-nowrap hidden lg:table-cell cursor-pointer" style="color: var(--text-muted)" @click="$emit('sort', 'price_per_sqm')">
              ₽/м² {{ sortIndicator('price_per_sqm') }}
            </th>
            <template v-if="variant === 'focus'">
              <th class="text-right px-3 py-3 font-semibold whitespace-nowrap cursor-pointer" style="color: var(--text-muted)" @click="$emit('sort', 'focus_score')">
                Скор {{ sortIndicator('focus_score') }}
              </th>
              <th class="text-right px-3 py-3 font-semibold whitespace-nowrap hidden md:table-cell" style="color: var(--text-muted)">Отклонение</th>
              <th class="text-left px-3 py-3 font-semibold whitespace-nowrap hidden lg:table-cell" style="color: var(--text-muted)">Теги</th>
            </template>
            <template v-else>
              <th class="text-left px-3 py-3 font-semibold whitespace-nowrap hidden md:table-cell" style="color: var(--text-muted)">Источник</th>
              <th class="text-center px-3 py-3 font-semibold whitespace-nowrap" style="color: var(--text-muted)">Статус</th>
            </template>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="item in items"
            :key="item.id"
            class="border-t cursor-pointer transition-colors hover:opacity-90"
            style="border-color: var(--border-subtle)"
            @click="$emit('open', item)"
          >
            <td v-if="variant === 'focus'" class="text-center px-2 py-3 sticky left-0 z-10" style="background: var(--bg-elevated)" @click.stop>
              <input type="checkbox" :checked="isSelected(item.id)" @change="$emit('toggle-select', item.id)" style="accent-color: var(--accent)" />
            </td>
            <td class="px-3 py-3 font-medium max-w-[220px] truncate sticky z-10"
              :style="{ background: 'var(--bg-elevated)', color: 'var(--text-main)', left: variant === 'focus' ? '2rem' : '0' }">
              {{ item.title }}
            </td>
            <td class="px-3 py-3 max-w-[200px] truncate hidden md:table-cell" style="color: var(--text-muted)">{{ item.address || '—' }}</td>
            <td class="px-3 py-3 whitespace-nowrap" style="color: var(--text-muted)">{{ cityLabel(item.city) }}</td>
            <td class="px-3 py-3 whitespace-nowrap hidden sm:table-cell" style="color: var(--text-muted)">{{ typeLabel(item.property_type) }}</td>
            <td class="px-3 py-3 text-right font-mono whitespace-nowrap" style="color: var(--text-main)">{{ item.area_sqm ? `${item.area_sqm} м²` : '—' }}</td>
            <td class="px-3 py-3 text-right font-mono whitespace-nowrap" style="color: var(--text-main)">{{ formatPriceShort(item.price) }}</td>
            <td class="px-3 py-3 text-right font-mono whitespace-nowrap hidden lg:table-cell" style="color: var(--text-main)">{{ formatPriceShort(item.price_per_sqm) }}</td>
            <template v-if="variant === 'focus'">
              <td class="px-3 py-3 text-right font-mono font-semibold whitespace-nowrap" style="color: var(--text-main)">{{ item.focus_score ?? '—' }}</td>
              <td class="px-3 py-3 text-right whitespace-nowrap hidden md:table-cell">
                <span v-if="item.deviation_percent != null" class="text-xs px-2 py-0.5 rounded-full font-semibold" :style="deviationStyle(Number(item.deviation_percent))">{{ item.deviation_percent }}%</span>
                <span v-else style="color: var(--text-muted)">—</span>
              </td>
              <td class="px-3 py-3 hidden lg:table-cell">
                <div class="flex flex-wrap gap-1">
                  <span v-for="tag in (item.tags || []).slice(0, 2)" :key="tag" class="text-xs px-1.5 py-0.5 rounded-full whitespace-nowrap" :style="tagStyle(tag)">{{ tagLabel(tag) }}</span>
                </div>
              </td>
            </template>
            <template v-else>
              <td class="px-3 py-3 whitespace-nowrap hidden md:table-cell" style="color: var(--text-muted)">{{ item.source || '—' }}</td>
              <td class="px-3 py-3 text-center whitespace-nowrap">
                <span class="text-xs px-2 py-0.5 rounded-full" :style="statusStyle(item.status || 'unknown')">{{ statusLabel(item.status || 'unknown') }}</span>
              </td>
            </template>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Property } from '@/composables/usePropertyData'
import { cityLabel, typeLabel, statusLabel, statusStyle, formatPriceShort } from '@/utils/formatters'
import { tagStyle, tagLabel, deviationStyle } from '@/composables/useFocusTab'

const props = withDefaults(defineProps<{
  items: Property[]
  variant?: 'default' | 'focus'
  selectedIds?: Set<number>
  allSelected?: boolean
  sortField?: string
  sortDirection?: 'asc' | 'desc'
}>(), {
  variant: 'default',
  selectedIds: () => new Set(),
  allSelected: false,
  sortField: '',
  sortDirection: 'desc',
})

defineEmits<{
  (e: 'open', item: Property): void
  (e: 'toggle-select', id: number): void
  (e: 'toggle-all'): void
  (e: 'sort', field: string): void
}>()

function isSelected(id: number) {
  return props.selectedIds?.has(id) ?? false
}

function sortIndicator(field: string) {
  if (props.sortField !== field) return ''
  return props.sortDirection === 'asc' ? '▲' : '▼'
}
</script>
