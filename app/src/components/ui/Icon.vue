<template>
  <component :is="iconComponent" :size="size" :stroke-width="strokeWidth" />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import * as icons from 'lucide-vue-next'

const props = defineProps<{
  name: string
  size?: number
  strokeWidth?: number
}>()

const iconComponent = computed(() => {
  // Convert kebab-case or snake_case to PascalCase
  const pascal = props.name
    .split(/[-_]/)
    .map(s => s.charAt(0).toUpperCase() + s.slice(1))
    .join('')
  return (icons as any)[pascal] || icons.Circle
})
</script>
