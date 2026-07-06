<template>
  <button
    :class="[sizeClass, variantClass, { 'opacity-50 cursor-not-allowed': disabled }]"
    :disabled="disabled || loading"
    class="inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all duration-200 hover:opacity-90 active:scale-[0.98]"
  >
    <span v-if="loading" class="animate-spin h-4 w-4 border-2 border-current border-t-transparent rounded-full" />
    <slot />
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
  disabled?: boolean
  loading?: boolean
}>(), {
  variant: 'primary',
  size: 'md',
  disabled: false,
  loading: false,
})

const sizeClasses: Record<string, string> = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
}

const variantClasses: Record<string, string> = {
  primary: 'btn-v-primary',
  secondary: 'btn-v-secondary',
  ghost: 'btn-v-ghost',
  danger: 'btn-v-danger',
}

const sizeClass = computed(() => sizeClasses[props.size] ?? sizeClasses.md)
const variantClass = computed(() => variantClasses[props.variant] ?? variantClasses.primary)
</script>

<style scoped>
.btn-v-primary {
  background: var(--accent);
  color: #fff;
}

.btn-v-secondary {
  background: transparent;
  border: 1px solid var(--border-subtle);
  color: var(--text-main);
}

.btn-v-ghost {
  background: transparent;
  color: var(--text-muted);
}
.btn-v-ghost:hover:not(:disabled) {
  background: var(--bg-elevated);
}

.btn-v-danger {
  background: var(--danger);
  color: #fff;
}
</style>
