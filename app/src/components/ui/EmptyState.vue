<template>
  <div class="flex flex-col items-center justify-center text-center py-12 px-4">
    <div v-if="icon || $slots.icon" class="text-4xl mb-4">
      <slot name="icon">{{ icon }}</slot>
    </div>
    <h3 class="text-lg font-semibold mb-2" style="color: var(--text-main);">
      {{ title }}
    </h3>
    <p v-if="description" class="text-sm mb-6 max-w-sm" style="color: var(--text-muted);">
      {{ description }}
    </p>
    <slot name="action">
      <router-link
        v-if="actionLabel && actionTo"
        :to="actionTo"
        class="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white transition-all duration-200 hover:opacity-90"
        style="background: var(--accent);"
      >
        {{ actionLabel }}
      </router-link>
    </slot>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  icon?: string
  title: string
  description?: string
  actionLabel?: string
  actionTo?: string
}>()
</script>
