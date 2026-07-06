<template>
  <div class="rounded-xl border border-theme overflow-hidden">
    <div class="overflow-x-auto">
      <table class="w-full text-sm border-collapse" style="min-width: 640px">
        <thead class="sticky top-0 z-10 bg-surface-elevated">
          <!-- Header row 1: full-width sortable title bar (mirrors title row of each item) -->
          <tr>
            <th
              colspan="20"
              class="text-left px-3 pt-3 pb-1 font-semibold whitespace-nowrap cursor-pointer text-content-muted"
              @click="$emit('sort', 'title')"
            >
              Название
              <template v-if="sortField === 'title'">
                <Icon v-if="sortDirection === 'asc'" name="chevron-up" :size="12" />
                <Icon v-else name="chevron-down" :size="12" />
              </template>
              <Icon v-else name="arrow-up-down" :size="12" class="opacity-30" />
            </th>
          </tr>
          <!-- Header row 2: detail columns (mirror detail row of each item) -->
          <tr>
            <th v-if="variant === 'focus'" class="text-center px-2 pb-3 w-8 bg-surface-elevated">
              <input type="checkbox" :checked="allSelected" @change="$emit('toggle-all')" style="accent-color: var(--accent)" />
            </th>
            <th class="text-left px-3 pb-3 font-semibold whitespace-nowrap hidden md:table-cell text-content-muted">Адрес</th>
            <th class="text-left px-3 pb-3 font-semibold whitespace-nowrap text-content-muted">Город</th>
            <th class="text-left px-3 pb-3 font-semibold whitespace-nowrap hidden sm:table-cell text-content-muted">Тип</th>
            <th class="text-right px-3 pb-3 font-semibold whitespace-nowrap cursor-pointer text-content-muted" @click="$emit('sort', 'area_sqm')">
              Площадь
              <template v-if="sortField === 'area_sqm'">
                <Icon v-if="sortDirection === 'asc'" name="chevron-up" :size="12" />
                <Icon v-else name="chevron-down" :size="12" />
              </template>
              <Icon v-else name="arrow-up-down" :size="12" class="opacity-30" />
            </th>
            <th class="text-right px-3 pb-3 font-semibold whitespace-nowrap cursor-pointer text-content-muted" @click="$emit('sort', 'price')">
              Цена
              <template v-if="sortField === 'price'">
                <Icon v-if="sortDirection === 'asc'" name="chevron-up" :size="12" />
                <Icon v-else name="chevron-down" :size="12" />
              </template>
              <Icon v-else name="arrow-up-down" :size="12" class="opacity-30" />
            </th>
            <th class="text-right px-3 pb-3 font-semibold whitespace-nowrap hidden lg:table-cell cursor-pointer text-content-muted" @click="$emit('sort', 'price_per_sqm')">
              ₽/м²
              <template v-if="sortField === 'price_per_sqm'">
                <Icon v-if="sortDirection === 'asc'" name="chevron-up" :size="12" />
                <Icon v-else name="chevron-down" :size="12" />
              </template>
              <Icon v-else name="arrow-up-down" :size="12" class="opacity-30" />
            </th>
            <template v-if="variant === 'focus'">
              <th class="text-right px-3 pb-3 font-semibold whitespace-nowrap cursor-pointer text-content-muted" @click="$emit('sort', 'focus_score')">
                Скор
                <template v-if="sortField === 'focus_score'">
                  <Icon v-if="sortDirection === 'asc'" name="chevron-up" :size="12" />
                  <Icon v-else name="chevron-down" :size="12" />
                </template>
                <Icon v-else name="arrow-up-down" :size="12" class="opacity-30" />
              </th>
              <th class="text-right px-3 pb-3 font-semibold whitespace-nowrap hidden md:table-cell text-content-muted">Отклонение</th>
              <th class="text-left px-3 pb-3 font-semibold whitespace-nowrap hidden lg:table-cell text-content-muted">Теги</th>
            </template>
            <template v-else>
              <th class="text-left px-3 pb-3 font-semibold whitespace-nowrap hidden md:table-cell text-content-muted">Источник</th>
              <th class="text-center px-3 pb-3 font-semibold whitespace-nowrap text-content-muted">Статус</th>
            </template>
          </tr>
        </thead>
        <tbody>
          <template v-for="(item, idx) in items" :key="item.id">
            <!-- Title row: full width, never truncated -->
            <tr
              class="border-t border-theme cursor-pointer transition-colors hover:opacity-90"
              :class="idx % 2 === 1 ? 'bg-surface-alt' : ''"
              tabindex="0"
              @click="$emit('open', item)"
              @keydown.enter="$emit('open', item)"
              @keydown.space.prevent="$emit('open', item)"
            >
              <td v-if="variant === 'focus'" rowspan="2" class="text-center px-2 pt-3 align-top" @click.stop>
                <input type="checkbox" :checked="isSelected(item.id)" @change="$emit('toggle-select', item.id)" style="accent-color: var(--accent)" />
              </td>
              <td colspan="20" class="px-3 pt-3 pb-1 font-semibold" style="color: var(--text-main)">
                {{ item.title }}
              </td>
            </tr>
            <!-- Detail row: all other fields -->
            <tr
              class="cursor-pointer transition-colors hover:opacity-90"
              :class="idx % 2 === 1 ? 'bg-surface-alt' : ''"
              tabindex="0"
              @click="$emit('open', item)"
              @keydown.enter="$emit('open', item)"
              @keydown.space.prevent="$emit('open', item)"
            >
              <td class="px-3 pb-3 pt-0 max-w-[220px] truncate hidden md:table-cell text-content-muted">{{ item.address || '—' }}</td>
              <td class="px-3 pb-3 pt-0 whitespace-nowrap text-content-muted">{{ cityLabel(item.city) }}</td>
              <td class="px-3 pb-3 pt-0 whitespace-nowrap hidden sm:table-cell text-content-muted">{{ typeLabel(item.property_type) }}</td>
              <td class="px-3 pb-3 pt-0 text-right font-mono whitespace-nowrap" style="color: var(--text-main)">{{ item.area_sqm ? `${item.area_sqm} м²` : '—' }}</td>
              <td class="px-3 pb-3 pt-0 text-right font-mono whitespace-nowrap" style="color: var(--text-main)">{{ formatPriceShort(item.price) }}</td>
              <td class="px-3 pb-3 pt-0 text-right font-mono whitespace-nowrap hidden lg:table-cell" style="color: var(--text-main)">{{ formatPriceShort(item.price_per_sqm) }}</td>
              <template v-if="variant === 'focus'">
                <td class="px-3 pb-3 pt-0 text-right font-mono font-semibold whitespace-nowrap" style="color: var(--text-main)">{{ item.focus_score ?? '—' }}</td>
                <td class="px-3 pb-3 pt-0 text-right whitespace-nowrap hidden md:table-cell">
                  <span v-if="item.deviation_percent != null" class="text-xs px-2 py-0.5 rounded-full font-semibold" :style="deviationStyle(Number(item.deviation_percent))">{{ item.deviation_percent }}%</span>
                  <span v-else class="text-content-muted">—</span>
                </td>
                <td class="px-3 pb-3 pt-0 hidden lg:table-cell">
                  <div class="flex flex-wrap gap-1">
                    <span v-for="tag in (item.tags || []).slice(0, 2)" :key="tag" class="text-xs px-1.5 py-0.5 rounded-full whitespace-nowrap" :style="tagStyle(tag)">{{ tagLabel(tag) }}</span>
                  </div>
                </td>
              </template>
              <template v-else>
                <td class="px-3 pb-3 pt-0 whitespace-nowrap hidden md:table-cell text-content-muted">{{ item.source || '—' }}</td>
                <td class="px-3 pb-3 pt-0 text-center whitespace-nowrap">
                  <span class="text-xs px-2 py-0.5 rounded-full" :style="statusStyle(item.status || 'unknown')">{{ statusLabel(item.status || 'unknown') }}</span>
                </td>
              </template>
            </tr>
          </template>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Property } from '@/composables/usePropertyData'
import { cityLabel, typeLabel, statusLabel, statusStyle, formatPriceShort } from '@/utils/formatters'
import { tagStyle, tagLabel, deviationStyle } from '@/utils/styleHelpers'
import Icon from '@/components/ui/Icon.vue'

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
</script>
