<template>
  <div class="max-w-2xl mx-auto px-4 py-8">
    <h1 class="text-2xl font-bold mb-6" style="color: var(--text-main)">Настройки</h1>

    <!-- Loading -->
    <div v-if="loading">
      <div class="skeleton h-8 w-40 mb-6" />
      <SkeletonLoader :lines="6" height="3.5rem" />
    </div>

    <!-- Error -->
    <div v-if="error" class="mb-4 p-3 rounded-lg text-sm" style="background: var(--error-bg, #fee); color: var(--error-text, #c00)">
      {{ error }}
    </div>

    <!-- Success -->
    <div v-if="saved" class="mb-4 p-3 rounded-lg text-sm" style="background: var(--success-bg, #efe); color: var(--success-text, #060)">
      Сохранено ✓
    </div>

    <form v-if="!loading" @submit.prevent="save" class="space-y-6">
      <!-- Порог отклонения -->
      <div>
        <label class="block text-sm font-medium mb-1" style="color: var(--text-main)">
          Порог отклонения (%)
        </label>
        <p class="text-xs mb-2" style="color: var(--text-muted)">
          Минимальное отклонение от рыночной цены для уведомления. По умолчанию 20%.
        </p>
        <input
          v-model.number="form.threshold_percent"
          type="number"
          min="1"
          max="99"
          class="w-full px-3 py-2 rounded-lg border text-sm"
          style="background: var(--bg-input, #fff); border-color: var(--border-subtle); color: var(--text-main)"
        />
      </div>

      <!-- Время дайджеста -->
      <div>
        <label class="block text-sm font-medium mb-1" style="color: var(--text-main)">
          Время утреннего дайджеста
        </label>
        <p class="text-xs mb-2" style="color: var(--text-muted)">
          Время отправки email-дайджеста (МСК). Формат: HH:MM
        </p>
        <input
          v-model="form.digest_time"
          type="time"
          class="w-full px-3 py-2 rounded-lg border text-sm"
          style="background: var(--bg-input, #fff); border-color: var(--border-subtle); color: var(--text-main)"
        />
      </div>

      <!-- Email получателя -->
      <div>
        <label class="block text-sm font-medium mb-1" style="color: var(--text-main)">
          Email для дайджеста
        </label>
        <p class="text-xs mb-2" style="color: var(--text-muted)">
          Куда отправлять утренний дайджест недооценённых объектов.
        </p>
        <input
          v-model="form.smtp_to"
          type="email"
          class="w-full px-3 py-2 rounded-lg border text-sm"
          style="background: var(--bg-input, #fff); border-color: var(--border-subtle); color: var(--text-main)"
          placeholder="email@example.com"
        />
      </div>

      <!-- Рабочее время -->
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium mb-1" style="color: var(--text-main)">
            Начало рабочего времени
          </label>
          <input
            v-model.number="form.work_hours_start"
            type="number"
            min="0"
            max="23"
            class="w-full px-3 py-2 rounded-lg border text-sm"
            style="background: var(--bg-input, #fff); border-color: var(--border-subtle); color: var(--text-main)"
          />
        </div>
        <div>
          <label class="block text-sm font-medium mb-1" style="color: var(--text-main)">
            Конец рабочего времени
          </label>
          <input
            v-model.number="form.work_hours_end"
            type="number"
            min="0"
            max="23"
            class="w-full px-3 py-2 rounded-lg border text-sm"
            style="background: var(--bg-input, #fff); border-color: var(--border-subtle); color: var(--text-main)"
          />
        </div>
      </div>

      <!-- Срок хранения -->
      <div>
        <label class="block text-sm font-medium mb-1" style="color: var(--text-main)">
          Срок хранения объектов (мес.)
        </label>
        <p class="text-xs mb-2" style="color: var(--text-muted)">
          Автоматическое удаление объектов старше N месяцев.
        </p>
        <input
          v-model.number="form.retention_months"
          type="number"
          min="1"
          max="24"
          class="w-full px-3 py-2 rounded-lg border text-sm"
          style="background: var(--bg-input, #fff); border-color: var(--border-subtle); color: var(--text-main)"
        />
      </div>

      <!-- Регионы мониторинга -->
      <div>
        <label class="block text-sm font-medium mb-1" style="color: var(--text-main)">
          Регионы мониторинга
        </label>
        <p class="text-xs mb-2" style="color: var(--text-muted)">
          Объекты из неотмеченных регионов не попадут в дайджест.
        </p>
        <div class="space-y-2">
          <label
            v-for="opt in regionOptions"
            :key="opt.value"
            class="flex items-center gap-2 cursor-pointer"
          >
            <input
              type="checkbox"
              :value="opt.value"
              v-model="regionChecked[opt.value]"
              class="rounded border-gray-300"
              style="accent-color: var(--accent)"
            />
            <span class="text-sm" style="color: var(--text-main)">{{ opt.label }}</span>
          </label>
        </div>
      </div>

      <!-- Кнопка -->
      <button
        type="submit"
        :disabled="saving"
        class="w-full px-4 py-2 rounded-lg text-sm font-semibold text-white transition-all duration-200 hover:opacity-90 disabled:opacity-50"
        style="background: var(--accent)"
      >
        {{ saving ? 'Сохранение...' : 'Сохранить' }}
      </button>
    </form>

    <!-- Ручной запуск -->
    <div class="mt-8 pt-6 border-t" style="border-color: var(--border-subtle)">
      <h2 class="text-lg font-semibold mb-2" style="color: var(--text-main)">Ручной запуск</h2>
      <p class="text-xs mb-4" style="color: var(--text-muted)">
        Полный цикл: парсинг всех активных источников → анализ цен → email-дайджест.
      </p>

      <!-- Прогресс -->
      <div v-if="pipelineStage !== 'idle'" class="mb-4 p-4 rounded-lg space-y-3" style="background: var(--bg-elevated); border: 1px solid var(--border-subtle)">
        <!-- Парсинг -->
        <div class="flex items-center gap-3">
          <span class="flex-shrink-0 w-5 text-center">
            <template v-if="pipelineStage === 'parsing'">⏳</template>
            <template v-else-if="parseDone">✓</template>
            <template v-else>○</template>
          </span>
          <div class="flex-1">
            <div class="text-sm font-medium" style="color: var(--text-primary)">Парсинг</div>
            <div class="text-xs" style="color: var(--text-muted)">
              <template v-if="pipelineStage === 'parsing'">
                {{ parseSourcesDone }}/{{ parseSourcesTotal }} источников обработано
              </template>
              <template v-else-if="parseDone">Завершён</template>
              <template v-else>Ожидание...</template>
            </div>
          </div>
        </div>

        <!-- Analyze -->
        <div class="flex items-center gap-3">
          <span class="flex-shrink-0 w-5 text-center">
            <template v-if="pipelineStage === 'analyzing'">⏳</template>
            <template v-else-if="analyzeDone">✓</template>
            <template v-else>○</template>
          </span>
          <div class="flex-1">
            <div class="text-sm font-medium" style="color: var(--text-primary)">Анализ</div>
            <div class="text-xs" style="color: var(--text-muted)">
              <template v-if="pipelineStage === 'analyzing'">
                {{ analyzePending }} объектов в очереди
              </template>
              <template v-else-if="analyzeDone">Завершён</template>
              <template v-else>Ожидание...</template>
            </div>
          </div>
        </div>

        <!-- Digest -->
        <div class="flex items-center gap-3">
          <span class="flex-shrink-0 w-5 text-center">
            <template v-if="pipelineStage === 'digesting'">⏳</template>
            <template v-else-if="digestDone">✓</template>
            <template v-else>○</template>
          </span>
          <div class="flex-1">
            <div class="text-sm font-medium" style="color: var(--text-primary)">Дайджест</div>
            <div class="text-xs" style="color: var(--text-muted)">
              <template v-if="pipelineStage === 'digesting'">Отправка email...</template>
              <template v-else-if="digestDone">Отправлен</template>
              <template v-else>Ожидание...</template>
            </div>
          </div>
        </div>

        <!-- Done -->
        <div v-if="pipelineStage === 'done'" class="pt-2 border-t text-sm font-medium text-center" style="border-color: var(--border-subtle); color: #059669">
          ✓ Пайплайн завершён
        </div>
      </div>

      <button
        @click="runPipeline"
        :disabled="pipelineStage !== 'idle'"
        class="w-full px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 hover:opacity-90 disabled:opacity-50"
        :style="{
          background: pipelineStage === 'done' ? '#059669' : 'var(--bg-elevated)',
          border: '1px solid var(--border-subtle)',
          color: pipelineStage === 'done' ? '#fff' : 'var(--text-main)',
        }"
      >
        <template v-if="pipelineStage === 'idle'">Ручной запуск</template>
        <template v-else-if="pipelineStage === 'done'">Готово — запустить ещё раз</template>
        <template v-else>Выполняется...</template>
      </button>
    </div>

    <!-- Ссылки -->
    <div class="mt-8 pt-6 border-t space-y-3" style="border-color: var(--border-subtle)">
      <router-link
        to="/market-references"
        class="flex items-center justify-between p-3 rounded-lg border transition-colors hover:opacity-80"
        style="border-color: var(--border-subtle); color: var(--text-main)"
      >
        <div>
          <div class="text-sm font-medium">Рыночные эталоны</div>
          <div class="text-xs" style="color: var(--text-muted)">Ручные цены за м² для сравнения</div>
        </div>
        <span style="color: var(--text-muted)">→</span>
      </router-link>
    </div>

    <!-- Выход -->
    <div class="mt-6">
      <button
        @click="handleLogout"
        class="w-full px-4 py-2 rounded-lg text-sm font-medium border transition-colors hover:opacity-80"
        style="border-color: var(--border-subtle); color: var(--text-muted)"
      >
        Выйти
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, watch, onMounted, onUnmounted } from 'vue'
import SkeletonLoader from '@/components/SkeletonLoader.vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import api from '@/api/strapi'

const router = useRouter()
const authStore = useAuthStore()

const loading = ref(true)
const saving = ref(false)
const saved = ref(false)
const error = ref('')
const documentId = ref('')

// Pipeline state
type PipelineStage = 'idle' | 'parsing' | 'analyzing' | 'digesting' | 'done' | 'error'
const pipelineStage = ref<PipelineStage>('idle')
const parseSourcesTotal = ref(0)
const parseSourcesDone = ref(0)
const parseDone = ref(false)
const analyzeDone = ref(false)
const analyzePending = ref(0)
const digestDone = ref(false)

const parseSlugs = ref<string[]>([])
let pollTimer: ReturnType<typeof setInterval> | null = null

const form = ref({
  threshold_percent: 20,
  digest_time: '09:00',
  smtp_to: '',
  work_hours_start: 9,
  work_hours_end: 21,
  retention_months: 6,
  monitored_regions: ['moscow', 'mo'] as string[],
})
const regionOptions = [
  { value: 'moscow', label: 'Москва' },
  { value: 'mo', label: 'Московская область' },
  { value: 'other', label: 'Другие регионы' },
]
const regionChecked = reactive<Record<string, boolean>>({
  moscow: true,
  mo: true,
  other: false,
})

// Sync regionChecked → form.monitored_regions
watch(regionChecked, (val) => {
  form.value.monitored_regions = Object.entries(val)
    .filter(([, v]) => v)
    .map(([k]) => k)
}, { deep: true })

onMounted(async () => {
  try {
    const res = await api.get('/setting')
    const data = res.data?.data
    if (data) {
      documentId.value = data.documentId
      form.value = {
        threshold_percent: data.threshold_percent ?? 20,
        digest_time: data.digest_time ?? '09:00',
        smtp_to: data.smtp_to ?? '',
        work_hours_start: data.work_hours_start ?? 9,
        work_hours_end: data.work_hours_end ?? 21,
        retention_months: data.retention_months ?? 6,
        monitored_regions: data.monitored_regions ?? ['moscow', 'mo'],
      }
      // Sync regionChecked from loaded data
      const regions = data.monitored_regions ?? ['moscow', 'mo']
      regionChecked.moscow = regions.includes('moscow')
      regionChecked.mo = regions.includes('mo')
      regionChecked.other = regions.includes('other')
    }
  } catch (err: any) {
    error.value = 'Не удалось загрузить настройки'
  } finally {
    loading.value = false
  }
})

onUnmounted(() => {
  stopPolling()
})

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

async function pollQueueStats() {
  try {
    const res = await api.get('/cron/queue-stats')
    const data = res.data
    if (!data?.ok) return null
    return data
  } catch {
    return null
  }
}

function isQueueEmpty(queues: Record<string, any>, prefix: string): boolean {
  // Check all queues matching prefix have 0 pending + active
  for (const [name, stats] of Object.entries(queues)) {
    if (name.startsWith(prefix)) {
      const s = stats as { pending: number; active: number }
      if (s.pending > 0 || s.active > 0) return false
    }
  }
  return true
}

function countSourcesParsed(sources: any[], slugs: string[]): number {
  return sources.filter((s: any) =>
    slugs.includes(s.slug) && s.last_parse_status !== 'running' && s.last_parse_status !== 'never'
  ).length
}

async function runPipeline() {
  // Reset
  pipelineStage.value = 'parsing'
  parseDone.value = false
  analyzeDone.value = false
  digestDone.value = false
  parseSourcesDone.value = 0
  analyzePending.value = 0
  error.value = ''

  try {
    // 1. Get active sources
    const sourcesRes = await api.get('/sources', {
      params: { 'filters[is_active][$eq]': true, 'pagination[pageSize]': 100 },
    })
    const sources = sourcesRes.data?.data || []

    if (sources.length === 0) {
      error.value = 'Нет активных источников'
      pipelineStage.value = 'error'
      return
    }

    parseSlugs.value = sources.map((s: any) => s.slug)
    parseSourcesTotal.value = sources.length

    // 2. Fire all parse jobs
    await Promise.all(
      sources.map((s: any) => api.post(`/cron/parse/${s.slug}`).catch(() => null))
    )

    // 3. Poll until all parse queues are empty
    await new Promise<void>((resolve, reject) => {
      let attempts = 0
      const maxAttempts = 120 // 120 × 3s = 6 min max
      pollTimer = setInterval(async () => {
        attempts++
        if (attempts > maxAttempts) {
          stopPolling()
          reject(new Error('Парсинг превысил таймаут (6 мин)'))
          return
        }

        const stats = await pollQueueStats()
        if (!stats) return

        // Update parse progress from source statuses
        parseSourcesDone.value = countSourcesParsed(stats.sources, parseSlugs.value)

        // Check if all parse queues are drained
        const allParseDone = isQueueEmpty(stats.queues, 'parse-')
        if (allParseDone && parseSourcesDone.value >= parseSourcesTotal.value) {
          stopPolling()
          parseDone.value = true
          pipelineStage.value = 'analyzing'
          resolve()
        }
      }, 3000)
    })

    // 4. Fire analyze
    await api.post('/cron/analyze')

    // 5. Poll until analyze queue is empty
    await new Promise<void>((resolve, reject) => {
      let attempts = 0
      const maxAttempts = 60 // 60 × 3s = 3 min max
      pollTimer = setInterval(async () => {
        attempts++
        if (attempts > maxAttempts) {
          stopPolling()
          reject(new Error('Анализ превысил таймаут (3 мин)'))
          return
        }

        const stats = await pollQueueStats()
        if (!stats) return

        const q = stats.queues['analyze-property'] || { pending: 0, active: 0 }
        analyzePending.value = q.pending + q.active

        if (isQueueEmpty(stats.queues, 'analyze-')) {
          stopPolling()
          analyzeDone.value = true
          pipelineStage.value = 'digesting'
          resolve()
        }
      }, 3000)
    })

    // 6. Fire digest
    await api.post('/cron/digest')

    // 7. Poll until digest queue is empty
    await new Promise<void>((resolve, reject) => {
      let attempts = 0
      const maxAttempts = 30 // 30 × 3s = 90 sec max
      pollTimer = setInterval(async () => {
        attempts++
        if (attempts > maxAttempts) {
          stopPolling()
          reject(new Error('Дайджест превысил таймаут (90 сек)'))
          return
        }

        const stats = await pollQueueStats()
        if (!stats) return

        if (isQueueEmpty(stats.queues, 'digest-')) {
          stopPolling()
          digestDone.value = true
          pipelineStage.value = 'done'
          resolve()
        }
      }, 3000)
    })
  } catch (err: any) {
    stopPolling()
    pipelineStage.value = 'error'
    error.value = err.message || 'Ошибка пайплайна'
  }
}

const save = async () => {
  saving.value = true
  error.value = ''
  saved.value = false

  try {
    if (documentId.value) {
      await api.put(`/setting/${documentId.value}`, { data: form.value })
    } else {
      await api.post('/setting', { data: form.value })
    }
    saved.value = true
    setTimeout(() => { saved.value = false }, 3000)
  } catch (err: any) {
    error.value = 'Ошибка сохранения: ' + (err.response?.data?.error?.message || err.message)
  } finally {
    saving.value = false
  }
}

const handleLogout = async () => {
  await authStore.logout()
  router.push('/auth')
}
</script>