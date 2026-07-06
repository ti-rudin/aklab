<template>
  <span
    :class="[variantClass, sizeClass]"
    class="inline-flex items-center rounded-full font-medium"
  >
    <slot />
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  variant?: 'success' | 'warning' | 'danger' | 'info' | 'neutral'
  size?: 'sm' | 'md'
}>(), {
  variant: 'neutral',
  size: 'md',
})

const variantMap: Record<string, string> = {
  success: 'badge-success',
  warning: 'badge-warning',
  danger: 'badge-danger',
  info: 'badge-info',
  neutral: 'badge-neutral',
}

const sizeMap: Record<string, string> = {
  sm: 'px-2 py-0.5 text-xs',
  md: 'px-2.5 py-1 text-xs',
}

const variantClass = computed(() => variantMap[props.variant] ?? variantMap.neutral)
const sizeClass = computed(() => sizeMap[props.size] ?? sizeMap.md)
</script>

<style scoped>
.badge-success {
  background: var(--success-soft);
  color: var(--success);
}

.badge-warning {
  background: var(--warning-soft);
  color: var(--warning);
}

.badge-danger {
  background: var(--danger-soft);
  color: var(--danger);
}

.badge-info {
  background: var(--accent-soft);
  color: var(--accent);
}

.badge-neutral {
  background: var(--bg-alt);
  color: var(--text-muted);
}
</style>
