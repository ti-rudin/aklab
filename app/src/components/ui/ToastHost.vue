<template>
  <div
    class="fixed top-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none"
    style="max-width: 420px; width: 100%"
  >
    <TransitionGroup name="toast-slide">
      <div
        v-for="toast in toasts"
        :key="toast.id"
        class="pointer-events-auto rounded-lg shadow-lg px-4 py-3 flex items-start gap-3 backdrop-blur-sm toast-item"
        :style="toastStyle(toast.type)"
        role="alert"
        :aria-label="toast.message"
      >
        <!-- Icon -->
        <span class="flex-shrink-0 mt-0.5">
          <!-- success -->
          <svg v-if="toast.type === 'success'" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <!-- error -->
          <svg v-else-if="toast.type === 'error'" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <!-- info -->
          <svg v-else class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </span>

        <!-- Message -->
        <p class="text-sm font-medium flex-grow" style="color: var(--text)">
          {{ toast.message }}
        </p>

        <!-- Close button -->
        <button
          @click="dismiss(toast.id)"
          class="flex-shrink-0 p-1 rounded-md transition-opacity hover:opacity-70"
          style="color: var(--text-muted)"
          aria-label="Закрыть"
        >
          <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <!-- Progress bar -->
        <div
          v-if="toast.duration && toast.duration > 0"
          class="absolute bottom-0 left-0 right-0 h-1 rounded-b-lg overflow-hidden"
        >
          <div
            class="h-full toast-progress"
            :style="progressStyle(toast)"
          />
        </div>
      </div>
    </TransitionGroup>
  </div>
</template>

<script setup lang="ts">
import { useToast, type Toast } from '@/composables/useToast'

const { toasts, dismiss } = useToast()

function toastStyle(type: Toast['type']) {
  const colorMap = {
    success: 'var(--success, #10b981)',
    error: 'var(--danger, #ef4444)',
    info: 'var(--info, #3b82f6)',
  }
  const bgOpacity = '1a' // ~10% opacity in hex
  return {
    background: `var(--bg-elevated, #1e293b)`,
    border: `1px solid ${colorMap[type]}40`,
    position: 'relative' as const,
    overflow: 'hidden',
  }
}

function progressStyle(toast: Toast) {
  const colorMap = {
    success: 'var(--success, #10b981)',
    error: 'var(--danger, #ef4444)',
    info: 'var(--info, #3b82f6)',
  }
  return {
    background: colorMap[toast.type],
    animation: `shrink ${toast.duration}ms linear forwards`,
  }
}
</script>

<style scoped>
.toast-slide-enter-active {
  transition: all 0.3s ease-out;
}
.toast-slide-leave-active {
  transition: all 0.2s ease-in;
  position: absolute;
}
.toast-slide-enter-from {
  opacity: 0;
  transform: translateX(100%);
}
.toast-slide-leave-to {
  opacity: 0;
  transform: translateX(100%);
}

.toast-item {
  backdrop-filter: blur(8px);
}

@keyframes shrink {
  from { width: 100%; }
  to { width: 0%; }
}
</style>
