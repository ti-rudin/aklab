<template>
  <section data-testid="admin-pipeline" class="rounded-2xl border p-4 sm:p-6" style="background: var(--bg-card); border-color: var(--border-subtle)">
    <h2 class="text-base font-semibold mb-1" style="color: var(--text-primary)">Pipeline</h2>
    <p class="text-xs mb-5" style="color: var(--text-muted)">
      Запуск выполняется по immutable snapshot выбранного пользовательского профиля.
    </p>

    <div v-if="listLoading" class="skeleton h-24 rounded-xl mb-4" />
    <form v-else class="grid gap-4 sm:grid-cols-[minmax(0,1fr)_140px_auto] sm:items-end" @submit.prevent="run">
      <label class="block">
        <span class="block text-xs font-medium mb-1" style="color: var(--text-muted)">Целевой профиль</span>
        <select
          data-testid="pipeline-target"
          v-model="targetValue"
          :disabled="isRunning"
          class="w-full px-3 py-2 rounded-lg border text-sm"
          style="background: var(--bg-main); border-color: var(--border-subtle); color: var(--text-main)"
        >
          <option value="">Выберите пользователя</option>
          <option v-for="profile in profiles" :key="profile.user_id" :value="String(profile.user_id)">
            {{ profileLabel(profile) }}
          </option>
        </select>
      </label>

      <label class="block">
        <span class="block text-xs font-medium mb-1" style="color: var(--text-muted)">Глубина</span>
        <input
          data-testid="pipeline-depth"
          v-model="depthValue"
          :disabled="isRunning"
          type="number"
          min="1"
          max="1000"
          step="1"
          class="w-full px-3 py-2 rounded-lg border text-sm"
          style="background: var(--bg-main); border-color: var(--border-subtle); color: var(--text-main)"
        />
      </label>

      <button
        data-testid="pipeline-start"
        type="submit"
        :disabled="isRunning || starting || listLoading"
        class="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
        style="background: var(--accent)"
      >
        {{ starting ? 'Запуск…' : 'Запустить' }}
      </button>
    </form>

    <p v-if="displayError" class="mt-3 text-sm" style="color: #fca5a5">{{ displayError }}</p>

    <div class="mt-6 rounded-xl border p-4" style="background: var(--bg-elevated); border-color: var(--border-subtle)">
      <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <div class="text-sm font-semibold" style="color: var(--text-primary)">{{ stageLabel }}</div>
          <div v-if="state.message" class="text-xs mt-1" style="color: var(--text-muted)">{{ state.message }}</div>
          <div v-if="state.run_id" class="text-xs mt-1 font-mono" style="color: var(--text-muted)">run: {{ state.run_id }}</div>
        </div>
        <div class="flex gap-2">
          <button
            v-if="isRunning"
            type="button"
            :disabled="actionPending"
            class="px-3 py-1.5 rounded-lg border text-xs disabled:opacity-50"
            style="border-color: var(--border-subtle); color: var(--text-main)"
            @click="cancelRun"
          >Отменить</button>
          <button
            v-else-if="state.stage !== 'idle'"
            type="button"
            :disabled="actionPending"
            class="px-3 py-1.5 rounded-lg border text-xs disabled:opacity-50"
            style="border-color: var(--border-subtle); color: var(--text-main)"
            @click="resetRun"
          >Сбросить состояние</button>
        </div>
      </div>

      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
        <div class="metric"><span>Источники</span><strong>{{ state.sources_done }} / {{ state.sources_total }}</strong></div>
        <div class="metric"><span>Детальные</span><strong>{{ state.details_fetched }} / {{ state.details_needed }}</strong></div>
        <div class="metric"><span>Анализ</span><strong>{{ state.analyze_done }} / {{ state.analyze_total }}</strong></div>
        <div class="metric"><span>Объекты</span><strong>{{ state.objects_created }}</strong></div>
        <div class="metric"><span>Недооценённые</span><strong>{{ state.undervalued_count }}</strong></div>
        <div class="metric"><span>Дайджесты</span><strong>{{ state.digest_sent }} / {{ state.digest_scheduled }}</strong></div>
        <div class="metric"><span>Пропущено</span><strong>{{ state.digest_skipped }}</strong></div>
        <div class="metric"><span>Ошибки доставки</span><strong>{{ state.digest_failed }}</strong></div>
      </div>

      <ul v-if="state.errors.length" class="mt-4 space-y-1 text-xs" style="color: #fca5a5">
        <li v-for="(item, index) in state.errors" :key="index">{{ item }}</li>
      </ul>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import api from '@/api/strapi'
import { usePipeline } from '@/composables/usePipeline'

interface ProfileOption {
  user_id: number
  regions: string[]
  property_types: string[]
}

const profiles = ref<ProfileOption[]>([])
const listLoading = ref(true)
const targetValue = ref('')
const depthValue = ref('20')
const starting = ref(false)
const actionPending = ref(false)
const error = ref('')

const {
  state,
  requestError,
  isRunning,
  start,
  cancel,
  reset,
  checkOnMount,
} = usePipeline()

const stageLabels: Record<string, string> = {
  idle: 'Pipeline не запущен',
  parsing_scan: 'Сканирование источников',
  parsing_scan_done: 'Сканирование завершено',
  parsing_details: 'Загрузка деталей',
  parsing_done: 'Парсинг завершён',
  analyzing: 'Анализ объектов',
  analyzing_skipped: 'Анализ пропущен',
  analyzing_done: 'Анализ завершён',
  digesting: 'Формирование дайджестов',
  digest_done: 'Дайджесты обработаны',
  done: 'Pipeline завершён',
  done_with_errors: 'Pipeline завершён с ошибками',
  cancelled: 'Pipeline отменён',
  error: 'Ошибка pipeline',
}

const stageLabel = computed(() => stageLabels[state.stage] || 'Pipeline')
const displayError = computed(() => error.value || requestError.value)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseProfile(value: unknown): ProfileOption | null {
  if (!isRecord(value) || !Number.isSafeInteger(value.user_id) || (value.user_id as number) <= 0) return null
  if (!Array.isArray(value.regions) || !value.regions.every(item => typeof item === 'string')) return null
  if (!Array.isArray(value.property_types) || !value.property_types.every(item => typeof item === 'string')) return null
  return {
    user_id: value.user_id as number,
    regions: [...value.regions] as string[],
    property_types: [...value.property_types] as string[],
  }
}

function profileLabel(profile: ProfileOption): string {
  const scope = [...profile.regions, ...profile.property_types].join(', ')
  return scope ? `#${profile.user_id} — ${scope}` : `#${profile.user_id}`
}

function safeError(cause: unknown, fallback: string): string {
  const responseMessage = (cause as { response?: { data?: { message?: unknown } } })?.response?.data?.message
  if (typeof responseMessage === 'string' && responseMessage.trim() !== '') return responseMessage
  return cause instanceof Error && cause.message ? cause.message : fallback
}

async function loadProfiles() {
  listLoading.value = true
  try {
    const response = await api.get('/admin/user-profiles?page=1&pageSize=100')
    const data = response.data?.data
    if (!Array.isArray(data)) throw new Error('Некорректный список профилей')
    const parsed = data.map(parseProfile)
    if (parsed.some(item => item === null)) throw new Error('Некорректный список профилей')
    profiles.value = parsed as ProfileOption[]
  } catch (cause) {
    profiles.value = []
    error.value = safeError(cause, 'Не удалось загрузить профили')
  } finally {
    listLoading.value = false
  }
}

async function run() {
  error.value = ''
  const targetUserId = Number(targetValue.value)
  const depth = Number(depthValue.value)
  if (!Number.isSafeInteger(targetUserId) || targetUserId <= 0) {
    error.value = 'Выберите целевого пользователя'
    return
  }
  if (!Number.isSafeInteger(depth) || depth < 1 || depth > 1000) {
    error.value = 'Глубина должна быть целым числом от 1 до 1000'
    return
  }
  starting.value = true
  try {
    await start(targetUserId, depth)
  } catch (cause) {
    error.value = safeError(cause, 'Не удалось запустить pipeline')
  } finally {
    starting.value = false
  }
}

async function cancelRun() {
  actionPending.value = true
  error.value = ''
  try {
    await cancel()
  } catch (cause) {
    error.value = safeError(cause, 'Не удалось отменить pipeline')
  } finally {
    actionPending.value = false
  }
}

async function resetRun() {
  actionPending.value = true
  error.value = ''
  try {
    await reset()
  } catch (cause) {
    error.value = safeError(cause, 'Не удалось сбросить pipeline')
  } finally {
    actionPending.value = false
  }
}

onMounted(() => {
  void loadProfiles()
  void checkOnMount()
})
</script>

<style scoped>
.metric {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.75rem;
  border-radius: 0.75rem;
  background: var(--bg-main);
  color: var(--text-muted);
}
.metric strong {
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}
</style>
