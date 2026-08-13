<template>
  <section data-testid="admin-maintenance" class="max-w-3xl space-y-5" aria-labelledby="catalog-maintenance-title">
    <header>
      <h2 id="catalog-maintenance-title" class="text-xl font-semibold" style="color: var(--text-main)">
        Обслуживание каталога
      </h2>
      <p class="mt-2 text-sm" style="color: var(--text-muted)">
        Полностью удаляет каталог объектов, пользовательские состояния объектов, комментарии,
        события и приватные фото. Пользователи, профили, настройки, источники, правила и эталоны
        остаются без изменений.
      </p>
    </header>

    <div
      role="alert"
      class="rounded-lg border p-4 text-sm"
      style="border-color: var(--danger, #dc2626); color: var(--text-main); background: color-mix(in srgb, var(--danger, #dc2626) 8%, transparent)"
    >
      <strong>Необратимое действие.</strong>
      Pipeline должен быть остановлен, а очереди — пусты. Полный повторный парсинг запускается отдельно.
    </div>

    <label class="block space-y-2" for="catalog-cleanup-confirmation">
      <span class="text-sm font-medium" style="color: var(--text-main)">
        Для подтверждения введите <code>{{ CONFIRMATION }}</code>
      </span>
      <input
        id="catalog-cleanup-confirmation"
        v-model="confirmation"
        data-testid="catalog-cleanup-confirmation"
        type="text"
        autocomplete="off"
        :spellcheck="false"
        class="w-full rounded-lg border px-3 py-2 text-sm"
        style="border-color: var(--border-subtle); color: var(--text-main); background: var(--bg-card)"
      >
    </label>

    <button
      data-testid="catalog-cleanup-submit"
      type="button"
      class="rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
      style="background: var(--danger, #dc2626)"
      :disabled="!confirmed || loading"
      @click="clearCatalog"
    >
      {{ loading ? 'Очистка…' : 'Полностью очистить каталог объектов' }}
    </button>

    <p v-if="errorMessage" role="alert" class="text-sm" style="color: var(--danger, #dc2626)">
      {{ errorMessage }}
    </p>

    <div v-if="result" role="status" class="rounded-lg border p-4 text-sm space-y-1" style="border-color: var(--border-subtle); color: var(--text-main)">
      <p><strong>Очистка завершена.</strong></p>
      <p>Удалено объектов: {{ result.deleted.properties }}</p>
      <p>Удалено пользовательских состояний: {{ result.deleted.user_property_states }}</p>
      <p>Удалено комментариев: {{ result.deleted.user_comments }}</p>
      <p>Удалено событий: {{ result.deleted.property_events }}</p>
      <p>Фото-каталогов удалено: {{ result.photos.deleted }} из {{ result.photos.attempted }}</p>
      <p v-if="result.photos.failed > 0">Ошибок удаления фото-каталогов: {{ result.photos.failed }}</p>
      <p>Полный повторный парсинг запускается отдельно.</p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import api from '@/api/strapi'

const CONFIRMATION = 'CLEAR_ALL_PROPERTIES'

type CountMap = Record<string, number>

interface CleanupResult {
  deleted: {
    user_property_states: number
    user_comments: number
    property_events: number
    properties: number
  }
  protected_before: CountMap
  protected_after: CountMap
  photos: {
    attempted: number
    deleted: number
    failed: number
  }
}

const confirmation = ref('')
const loading = ref(false)
const errorMessage = ref('')
const result = ref<CleanupResult | null>(null)
const confirmed = computed(() => confirmation.value === CONFIRMATION)

function statusOf(error: unknown): number | undefined {
  return (error as { response?: { status?: number } })?.response?.status
}

async function clearCatalog() {
  if (!confirmed.value || loading.value) return
  loading.value = true
  errorMessage.value = ''
  result.value = null
  try {
    const response = await api.post('/properties/clear-new', { confirmation: CONFIRMATION })
    result.value = response.data?.data as CleanupResult
    confirmation.value = ''
  } catch (error: unknown) {
    errorMessage.value = statusOf(error) === 409
      ? 'Очистка недоступна: остановите pipeline и дождитесь пустых очередей.'
      : 'Не удалось очистить каталог. Проверьте состояние системы и повторите попытку.'
  } finally {
    loading.value = false
  }
}
</script>
