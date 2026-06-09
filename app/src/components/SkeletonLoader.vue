<template>
  <div class="space-y-3">
    <div v-for="i in lines" :key="i" class="skeleton" :style="{ height: height, width: i === lines ? '60%' : '100%' }" />
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  lines?: number
  height?: string
}>(), {
  lines: 5,
  height: '1rem',
})
</script>
