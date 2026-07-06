<template>
  <div class="inline-flex rounded-lg border overflow-hidden shrink-0" style="border-color: var(--border-subtle)">
    <button
      type="button"
      @click="$emit('update:modelValue', 'cards')"
      class="flex items-center justify-center w-9 h-9 sm:w-8 sm:h-8 transition-colors"
      :style="modelValue === 'cards'
        ? 'background: var(--accent); color: white'
        : 'background: var(--bg-elevated); color: var(--text-muted)'"
      title="Карточки"
      aria-label="Вид: карточки"
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <rect x="1" y="1" width="6" height="6" rx="1" fill="currentColor" />
        <rect x="9" y="1" width="6" height="6" rx="1" fill="currentColor" />
        <rect x="1" y="9" width="6" height="6" rx="1" fill="currentColor" />
        <rect x="9" y="9" width="6" height="6" rx="1" fill="currentColor" />
      </svg>
    </button>
    <button
      type="button"
      @click="$emit('update:modelValue', 'table')"
      class="flex items-center justify-center w-9 h-9 sm:w-8 sm:h-8 transition-colors border-l"
      style="border-color: var(--border-subtle)"
      :style="modelValue === 'table'
        ? 'background: var(--accent); color: white'
        : 'background: var(--bg-elevated); color: var(--text-muted)'"
      title="Таблица"
      aria-label="Вид: таблица"
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <rect x="1" y="1" width="14" height="3" rx="0.5" fill="currentColor" />
        <rect x="1" y="6.5" width="14" height="3" rx="0.5" fill="currentColor" />
        <rect x="1" y="12" width="14" height="3" rx="0.5" fill="currentColor" />
      </svg>
    </button>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  modelValue: 'cards' | 'table'
}>()
defineEmits<{
  (e: 'update:modelValue', value: 'cards' | 'table'): void
}>()
</script>
