<template>
  <div class="space-y-4">
    <!-- Заголовок-скелетон -->
    <div class="flex justify-between items-center">
      <div class="skeleton h-8 w-48" />
      <div class="skeleton h-5 w-16" />
    </div>
    <!-- Фильтры-скелетон -->
    <div class="skeleton h-20 w-full" />
    <!-- Строки-скелетон -->
    <div class="rounded-xl border overflow-hidden" style="border-color: var(--border-subtle)">
      <div v-for="i in rows" :key="i" class="flex gap-4 p-4 border-b" style="border-color: var(--border-subtle)">
        <div class="skeleton h-4 flex-1" />
        <div class="skeleton h-4 w-24" />
        <div class="skeleton h-4 w-20" />
        <div class="skeleton h-4 w-16" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  rows?: number
}>(), {
  rows: 6,
})
</script>
