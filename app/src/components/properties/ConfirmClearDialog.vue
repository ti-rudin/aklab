<template>
  <div v-if="visible"
    class="fixed inset-0 z-50 flex items-center justify-center"
    style="background: rgba(0,0,0,0.5)">
    <div class="rounded-xl p-6 border max-w-md w-full mx-4 shadow-2xl"
      style="background: var(--bg-elevated); border-color: var(--border-subtle)">
      <h3 class="text-lg font-semibold mb-3" style="color: var(--text-main)">Подтверждение</h3>
      <p class="text-sm mb-6" style="color: var(--text-muted)">
        Вы уверены, что хотите удалить все объекты кроме «В работе»? Это действие нельзя отменить.
      </p>
      <div class="flex justify-end gap-3">
        <button @click="$emit('cancel')"
          class="px-4 py-2 rounded-lg text-sm font-medium transition-colors hover:opacity-80"
          style="background: var(--bg-main); border: 1px solid var(--border-subtle); color: var(--text-main)">
          Отмена
        </button>
        <button @click="$emit('confirm')"
          class="px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors hover:opacity-90"
          style="background: #ef4444">
          Очистить
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  visible: boolean
}>()

defineEmits<{
  confirm: []
  cancel: []
}>()
</script>
