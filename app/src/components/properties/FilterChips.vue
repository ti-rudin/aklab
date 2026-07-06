<template>
  <div class="flex flex-wrap gap-1">
    <label v-for="opt in options" :key="opt.value"
      class="flex items-center gap-1 text-xs px-2 py-1 rounded-lg cursor-pointer select-none transition-colors"
      :style="modelValue.includes(opt.value)
        ? 'background: var(--accent-soft); color: var(--accent)'
        : 'background: var(--bg-main); color: var(--text-muted)'">
      <input type="checkbox" :value="opt.value" class="hidden"
        :checked="modelValue.includes(opt.value)"
        @change="toggle(opt.value)" />
      {{ opt.label }}
    </label>
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
