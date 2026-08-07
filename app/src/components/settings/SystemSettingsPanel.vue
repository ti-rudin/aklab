<template>
  <section>
    <h2 class="text-lg font-semibold" style="color: var(--text-main)">Системные настройки</h2>
    <p class="text-xs mb-6" style="color: var(--text-muted)">Общие параметры расписания и глубины обработки. Персональные фильтры и получатели дайджеста находятся в профиле пользователя.</p>

    <div v-if="loading" class="space-y-4">
      <div v-for="line in 3" :key="line" class="skeleton h-16 rounded-xl" />
    </div>
    <form v-else @submit.prevent="submit" class="space-y-6 max-w-2xl">
      <div>
        <label class="block text-sm font-medium mb-1" style="color: var(--text-main)">Порог отклонения (%)</label>
        <p class="text-xs mb-2" style="color: var(--text-muted)">Допустимый диапазон: 0–100.</p>
        <input
          data-testid="system-threshold"
          type="number"
          min="0"
          max="100"
          step="any"
          :value="displayNumber(form.threshold_percent)"
          :disabled="saving || !loaded"
          class="w-full px-3 py-2 rounded-lg border text-sm"
          style="background: var(--bg-main); border-color: var(--border-subtle); color: var(--text-main)"
          @input="setNumber('threshold_percent', ($event.target as HTMLInputElement).value)"
        />
      </div>

      <div>
        <label class="block text-sm font-medium mb-1" style="color: var(--text-main)">Время дайджеста</label>
        <p class="text-xs mb-2" style="color: var(--text-muted)">Формат HH:MM.</p>
        <input
          data-testid="system-digest-time"
          type="time"
          :value="form.digest_time"
          :disabled="saving || !loaded"
          class="w-full px-3 py-2 rounded-lg border text-sm"
          style="background: var(--bg-main); border-color: var(--border-subtle); color: var(--text-main)"
          @input="form.digest_time = ($event.target as HTMLInputElement).value"
        />
      </div>

      <div>
        <label class="block text-sm font-medium mb-1" style="color: var(--text-main)">Глубина парсинга</label>
        <p class="text-xs mb-2" style="color: var(--text-muted)">Целое число от 1 до 5000.</p>
        <input
          data-testid="system-parse-depth"
          type="number"
          min="1"
          max="5000"
          step="1"
          :value="displayNumber(form.parse_depth)"
          :disabled="saving || !loaded"
          class="w-full px-3 py-2 rounded-lg border text-sm"
          style="background: var(--bg-main); border-color: var(--border-subtle); color: var(--text-main)"
          @input="setNumber('parse_depth', ($event.target as HTMLInputElement).value)"
        />
      </div>

      <div class="flex items-center gap-3">
        <button
          type="submit"
          :disabled="saving || !loaded"
          class="px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90 disabled:opacity-50"
          style="background: var(--accent)"
        >
          {{ saving ? 'Сохранение…' : 'Сохранить системные настройки' }}
        </button>
        <span v-if="saved" class="text-sm" style="color: var(--accent)">Сохранено</span>
      </div>
      <p v-if="error" class="text-sm" style="color: #fca5a5">{{ error }}</p>
    </form>
  </section>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import api from '@/api/strapi'

type SystemForm = {
  threshold_percent: number | null
  digest_time: string
  parse_depth: number | null
}

const form = reactive<SystemForm>({
  threshold_percent: null,
  digest_time: '',
  parse_depth: null,
})
const loading = ref(true)
const saving = ref(false)
const saved = ref(false)
const error = ref('')
const loaded = ref(false)

function setNumber(key: 'threshold_percent' | 'parse_depth', value: string) {
  form[key] = value.trim() === '' ? null : Number(value)
}

function displayNumber(value: number | null) {
  return value === null ? '' : value
}

function validate(): string | null {
  if (form.threshold_percent === null || !Number.isFinite(form.threshold_percent) || form.threshold_percent < 0 || form.threshold_percent > 100) {
    return 'Порог должен быть конечным числом от 0 до 100'
  }
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(form.digest_time)) return 'Время должно быть в формате HH:MM'
  if (form.parse_depth === null || !Number.isInteger(form.parse_depth) || form.parse_depth < 1 || form.parse_depth > 5000) {
    return 'Глубина должна быть целым числом от 1 до 5000'
  }
  return null
}

async function load() {
  loading.value = true
  loaded.value = false
  error.value = ''
  try {
    const response = await api.get('/setting')
    const data = response.data?.data || {}
    if (
      typeof data.threshold_percent !== 'number'
      || !Number.isFinite(data.threshold_percent)
      || data.threshold_percent < 0
      || data.threshold_percent > 100
      || typeof data.digest_time !== 'string'
      || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(data.digest_time)
      || typeof data.parse_depth !== 'number'
      || !Number.isInteger(data.parse_depth)
      || data.parse_depth < 1
      || data.parse_depth > 5000
    ) throw new Error('Некорректный ответ системных настроек')
    form.threshold_percent = data.threshold_percent
    form.digest_time = data.digest_time
    form.parse_depth = data.parse_depth
    loaded.value = true
  } catch (cause: any) {
    error.value = cause.response?.data?.error?.message || cause.message || 'Не удалось загрузить системные настройки'
  } finally {
    loading.value = false
  }
}

async function submit() {
  saved.value = false
  if (!loaded.value) {
    error.value = error.value || 'Системные настройки не загружены'
    return
  }
  error.value = validate() || ''
  if (error.value) return

  saving.value = true
  try {
    const response = await api.put('/setting', {
      data: {
        threshold_percent: form.threshold_percent,
        digest_time: form.digest_time,
        parse_depth: form.parse_depth,
      },
    })
    const updated = response.data?.data || {}
    if (
      typeof updated.threshold_percent !== 'number'
      || !Number.isFinite(updated.threshold_percent)
      || updated.threshold_percent < 0
      || updated.threshold_percent > 100
      || typeof updated.digest_time !== 'string'
      || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(updated.digest_time)
      || typeof updated.parse_depth !== 'number'
      || !Number.isInteger(updated.parse_depth)
      || updated.parse_depth < 1
      || updated.parse_depth > 5000
    ) throw new Error('Некорректный ответ системных настроек')
    form.threshold_percent = updated.threshold_percent
    form.digest_time = updated.digest_time
    form.parse_depth = updated.parse_depth
    saved.value = true
  } catch (cause: any) {
    error.value = cause.response?.data?.error?.message || cause.message || 'Ошибка сохранения системных настроек'
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>
