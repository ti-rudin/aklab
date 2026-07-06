<template>
  <component
    :is="to ? 'router-link' : 'div'"
    :to="to"
    class="stat-card block"
    :class="{ clickable: !!to }"
  >
    <BaseCard padding="md">
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0 flex-1">
          <p class="stat-label">{{ title }}</p>
          <p class="stat-value" :style="accentStyle">{{ displayValue }}</p>
        </div>
        <span v-if="icon" class="stat-icon">{{ icon }}</span>
        <slot v-else name="icon" />
      </div>
      <div v-if="delta" class="mt-2">
        <BaseBadge variant="info" size="sm">{{ delta }}</BaseBadge>
      </div>
    </BaseCard>
  </component>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import BaseCard from './BaseCard.vue'
import BaseBadge from './BaseBadge.vue'

const props = withDefaults(defineProps<{
  title: string
  value: number | string
  icon?: string
  delta?: string
  to?: string
  color?: string
}>(), {
  icon: '',
  delta: '',
  to: '',
  color: '',
})

const displayValue = computed(() =>
  typeof props.value === 'number' ? props.value.toLocaleString('ru-RU') : props.value
)

const accentStyle = computed(() =>
  props.color ? { color: props.color } : {}
)
</script>

<style scoped>
.stat-card.clickable {
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
  text-decoration: none;
}
.stat-card.clickable:hover {
  transform: scale(1.02);
}

.stat-label {
  font-size: 0.75rem;
  line-height: 1rem;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.stat-value {
  font-size: clamp(1.25rem, 4vw, 1.875rem);
  font-weight: 700;
  color: var(--text-main);
  margin-top: 0.125rem;
  white-space: nowrap;
}

.stat-icon {
  font-size: 1.5rem;
  line-height: 1;
  flex-shrink: 0;
  margin-top: 0.125rem;
}
</style>
