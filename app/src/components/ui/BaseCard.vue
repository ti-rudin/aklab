<template>
  <div
    :class="[paddingClass, { 'card-interactive': interactive }]"
    class="rounded-xl border"
    style="background: var(--bg-elevated); border-color: var(--border-subtle); box-shadow: var(--shadow-card);"
  >
    <slot />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  interactive?: boolean
  padding?: 'sm' | 'md' | 'lg'
}>(), {
  interactive: false,
  padding: 'md',
})

const paddingMap: Record<string, string> = {
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-6',
}

const paddingClass = computed(() => paddingMap[props.padding] ?? 'p-4')
</script>
