<template>
  <div class="flex flex-wrap items-center gap-1.5">
    <label v-for="opt in options" :key="opt.value"
      class="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg cursor-pointer select-none transition-colors min-h-[44px]"
      :class="modelValue.includes(opt.value)
        ? 'bg-info-soft text-info'
        : 'bg-surface text-content-muted'">
      <input type="checkbox" :value="opt.value" class="hidden"
        :checked="modelValue.includes(opt.value)"
        @change="toggle(opt.value)" />
      {{ opt.label }}
    </label>
    <template v-if="modelValue.length > 0 && modelValue.length < options.length">
      <span class="text-xs text-content-muted ml-1">Выбрано: {{ modelValue.length }}</span>
      <button
        type="button"
        class="text-xs px-3 py-1.5 rounded-lg text-content-muted bg-surface hover:opacity-80 transition-opacity min-h-[44px]"
        @click="$emit('update:modelValue', [])"
      >Сбросить</button>
    </template>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  modelValue: string[]
  options: { value: string; label: string }[]
}>()
const emit = defineEmits<{
  (e: 'update:modelValue', value: string[]): void
}>()

function toggle(value: string) {
  const next = props.modelValue.includes(value)
    ? props.modelValue.filter(v => v !== value)
    : [...props.modelValue, value]
  emit('update:modelValue', next)
}
</script>
