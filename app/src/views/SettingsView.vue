<template>
  <div class="max-w-screen-xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
    <h1 class="text-2xl font-bold mb-6" style="color: var(--text-main)">Настройки</h1>

    <!-- Табы -->
    <div class="flex gap-1 mb-6 overflow-x-auto pb-1" style="border-bottom: 1px solid var(--border-subtle)">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        @click="activeTab = tab.id"
        class="px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors relative"
        :style="{
          color: activeTab === tab.id ? 'var(--accent)' : 'var(--text-muted)',
          opacity: activeTab === tab.id ? 1 : 0.7,
        }"
      >
        {{ tab.label }}
        <div
          v-if="activeTab === tab.id"
          class="absolute bottom-0 left-0 right-0 h-0.5"
          style="background: var(--accent)"
        />
      </button>
    </div>

    <!-- Таб: Дайджест -->
    <div v-if="activeTab === 'digest'">
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

      <form v-if="!loading" @submit.prevent="save" class="space-y-6 max-w-2xl">
        <!-- Порог отклонения -->
        <div>
          <label class="block text-sm font-medium mb-1" style="color: var(--text-main)">Порог отклонения (%)</label>
          <p class="text-xs mb-2" style="color: var(--text-muted)">Минимальное отклонение от рыночной цены для уведомления. По умолчанию 20%.</p>
          <input
            v-model.number="form.threshold_percent"
            type="number"
            min="1"
            max="99"
            class="w-full px-3 py-2 rounded-lg border text-sm"
            style="background: var(--bg-input, #fff); border-color: var(--border-subtle); color: var(--text-main)"
          />
        </div>

        <!-- Глубина парсинга -->
        <div>
          <label class="block text-sm font-medium mb-1" style="color: var(--text-main)">Глубина парсинга (по расписанию)</label>
          <p class="text-xs mb-2" style="color: var(--text-muted)">Максимум новых объектов за один запуск парсинга по крону. По умолчанию 20.</p>
          <input
            v-model.number="form.parse_depth"
            type="number"
            min="1"
            max="5000"
            class="w-full px-3 py-2 rounded-lg border text-sm"
            style="background: var(--bg-input, #fff); border-color: var(--border-subtle); color: var(--text-main)"
          />
        </div>

        <!-- Время дайджеста -->
        <div>
          <label class="block text-sm font-medium mb-1" style="color: var(--text-main)">Время утреннего дайджеста</label>
          <p class="text-xs mb-2" style="color: var(--text-muted)">Время отправки email-дайджеста (МСК). Формат: HH:MM</p>
          <input
            v-model="form.digest_time"
            type="time"
            class="w-full px-3 py-2 rounded-lg border text-sm"
            style="background: var(--bg-input, #fff); border-color: var(--border-subtle); color: var(--text-main)"
          />
        </div>

        <!-- Email получателя -->
        <div>
          <label class="block text-sm font-medium mb-1" style="color: var(--text-main)">Email для дайджеста</label>
          <p class="text-xs mb-2" style="color: var(--text-muted)">Куда отправлять утренний дайджест недооценённых объектов. Можно указать несколько адресов через запятую.</p>
          <input
            v-model="form.smtp_to"
            type="text"
            class="w-full px-3 py-2 rounded-lg border text-sm"
            style="background: var(--bg-input, #fff); border-color: var(--border-subtle); color: var(--text-main)"
            placeholder="email@example.com"
          />
        </div>

        <!-- Диапазон цен для дайджеста -->
        <div>
          <label class="block text-sm font-medium mb-1" style="color: var(--text-main)">Диапазон цен (₽)</label>
          <p class="text-xs mb-2" style="color: var(--text-muted)">Объекты вне диапазона не попадут в дайджест. Оставьте пустым для без ограничений.</p>
          <div class="flex gap-2 items-center">
            <input v-model.number="form.price_from" type="number" placeholder="от" min="0"
              class="w-full px-3 py-2 rounded-lg border text-sm"
              style="background: var(--bg-input, #fff); border-color: var(--border-subtle); color: var(--text-main)" />
            <span class="text-sm shrink-0" style="color: var(--text-muted)">—</span>
            <input v-model.number="form.price_to" type="number" placeholder="до" min="0"
              class="w-full px-3 py-2 rounded-lg border text-sm"
              style="background: var(--bg-input, #fff); border-color: var(--border-subtle); color: var(--text-main)" />
          </div>
        </div>

        <!-- Регионы мониторинга -->
        <div>
          <label class="block text-sm font-medium mb-1" style="color: var(--text-main)">Регионы мониторинга</label>
          <p class="text-xs mb-2" style="color: var(--text-muted)">Объекты из неотмеченных регионов не попадут в дайджест.</p>
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

      <!-- Ручной запуск полного пайплайна -->
      <div class="mt-8 pt-6 border-t" style="border-color: var(--border-subtle)">
        <button @click="pipelineOpen = !pipelineOpen"
          class="flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg transition-colors hover:opacity-80"
          style="color: var(--text-muted)">
          <span>{{ pipelineOpen ? '▼' : '▶' }}</span>
          <span>Ручной запуск</span>
        </button>

        <div v-if="pipelineOpen" class="mt-3 p-4 rounded-xl border"
          style="background: var(--bg-elevated); border-color: var(--border-subtle)">
          <!-- Price range -->
          <div class="mb-4">
            <label class="block text-xs font-medium mb-2" style="color: var(--text-muted)">Цена лота (₽)</label>
            <div class="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] gap-2 items-center">
              <input v-model="launchFilters.priceFrom" type="number" placeholder="от" min="0"
                class="w-full px-3 py-2 rounded-lg border text-sm"
                style="background: var(--bg-main); border-color: var(--border-subtle); color: var(--text-main)" />
              <span class="text-sm text-center hidden sm:inline" style="color: var(--text-muted)">—</span>
              <input v-model="launchFilters.priceTo" type="number" placeholder="до" min="0"
                class="w-full px-3 py-2 rounded-lg border text-sm"
                style="background: var(--bg-main); border-color: var(--border-subtle); color: var(--text-main)" />
            </div>
          </div>

          <!-- Cities -->
          <div class="mb-4">
            <label class="block text-xs font-medium mb-2" style="color: var(--text-muted)">Город</label>
            <div class="grid grid-cols-3 gap-2">
              <label class="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" v-model="launchFilters.cities.moscow" class="rounded flex-shrink-0" style="accent-color: var(--accent)" />
                <span class="text-sm" style="color: var(--text-main)">Москва</span>
              </label>
              <label class="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" v-model="launchFilters.cities.mo" class="rounded flex-shrink-0" style="accent-color: var(--accent)" />
                <span class="text-sm" style="color: var(--text-main)">МО</span>
              </label>
              <label class="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" v-model="launchFilters.cities.other" class="rounded flex-shrink-0" style="accent-color: var(--accent)" />
                <span class="text-sm" style="color: var(--text-main)">Другие</span>
              </label>
            </div>
          </div>

          <!-- Threshold -->
          <div class="mb-4">
            <label class="block text-xs font-medium mb-2" style="color: var(--text-muted)">
              Порог отсечения: <span class="font-semibold" style="color: var(--text-main)">{{ launchFilters.threshold }}%</span>
            </label>
            <div class="flex items-center gap-3">
              <input v-model.number="launchFilters.threshold" type="range" min="1" max="99" step="1"
                class="flex-1 min-w-0" style="accent-color: var(--accent)" />
              <input v-model.number="launchFilters.threshold" type="number" min="1" max="99"
                class="w-16 flex-shrink-0 px-2 py-1 rounded-lg border text-sm text-center"
                style="background: var(--bg-main); border-color: var(--border-subtle); color: var(--text-main)" />
            </div>
          </div>

          <!-- Depth + Actions -->
          <div class="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-2 pt-2 border-t" style="border-color: var(--border-subtle)">
            <div class="flex items-center gap-2">
              <label class="text-xs whitespace-nowrap" style="color: var(--text-muted)">Глубина:</label>
              <input v-model.number="parseDepth" type="number" min="1" max="5000"
                class="w-24 px-2 py-1.5 rounded-lg border text-sm text-center"
                style="background: var(--bg-main); border-color: var(--border-subtle); color: var(--text-main)" />
            </div>
            <button
              @click="runFullPipeline"
              :disabled="pipelineStage !== 'idle' && pipelineStage !== 'done' && pipelineStage !== 'error'"
              class="px-4 py-2 rounded-lg text-sm font-semibold text-white transition-all duration-200 hover:opacity-90 disabled:opacity-50"
              :style="{
                background: pipelineStage === 'done' ? '#059669' : 'var(--accent)',
              }"
            >
              <template v-if="pipelineStage === 'idle' || pipelineStage === 'error'">▶ Ручной запуск</template>
              <template v-else-if="pipelineStage === 'done'">Готово — ещё раз</template>
              <template v-else>Выполняется...</template>
            </button>
          </div>
        </div>

        <!-- Прогресс пайплайна -->
        <div v-if="pipelineStage !== 'idle'" class="mt-3 p-3 sm:p-4 rounded-lg space-y-2 sm:space-y-3" style="background: var(--bg-elevated); border: 1px solid var(--border-subtle)">
          <!-- Парсинг -->
          <div class="flex items-center gap-3">
            <span class="flex-shrink-0 w-5 text-center">
              <template v-if="pipelineStage === 'parsing'">⏳</template>
              <template v-else-if="parseDone">✓</template>
              <template v-else>○</template>
            </span>
            <div class="flex-1">
              <div class="text-sm font-medium" style="color: var(--text-main)">Парсинг</div>
              <div class="text-xs" style="color: var(--text-muted)">
                <template v-if="pipelineStage === 'parsing'">
                  {{ parseSourcesDone }}/{{ parseSourcesTotal }} источников
                </template>
                <template v-else-if="parseDone">
                  {{ parseSourcesTotal }} источников, {{ pl.parseTotal }} объектов
                </template>
                <template v-else>Ожидание...</template>
              </div>
            </div>
          </div>

          <!-- Анализ -->
          <div class="flex items-center gap-3">
            <span class="flex-shrink-0 w-5 text-center">
              <template v-if="pipelineStage === 'analyzing'">⏳</template>
              <template v-else-if="analyzeDone">✓</template>
              <template v-else>○</template>
            </span>
            <div class="flex-1">
              <div class="text-sm font-medium" style="color: var(--text-main)">Анализ</div>
              <div class="text-xs" style="color: var(--text-muted)">
                <template v-if="pipelineStage === 'analyzing'">{{ analyzePending }} объектов в очереди</template>
                <template v-else-if="analyzeDone">{{ pl.undervaluedTotal }} недооценённых</template>
                <template v-else>Ожидание...</template>
              </div>
            </div>
          </div>

          <!-- Дайджест -->
          <div class="flex items-center gap-3">
            <span class="flex-shrink-0 w-5 text-center">
              <template v-if="pipelineStage === 'digesting'">⏳</template>
              <template v-else-if="digestDone">✓</template>
              <template v-else>○</template>
            </span>
            <div class="flex-1">
              <div class="text-sm font-medium" style="color: var(--text-main)">Дайджест</div>
              <div class="text-xs" style="color: var(--text-muted)">
                <template v-if="pipelineStage === 'digesting'">Отправка email...</template>
                <template v-else-if="digestDone && pl.digestSent">Отправлено на {{ pl.digestCount }} объектов</template>
                <template v-else-if="digestDone && pl.digestSkipped">Нет недооценённых</template>
                <template v-else-if="digestDone">Отправлен</template>
                <template v-else>Ожидание...</template>
              </div>
            </div>
          </div>

          <!-- Done -->
          <div v-if="pipelineStage === 'done'" class="pt-2 border-t text-sm font-medium text-center" style="border-color: var(--border-subtle); color: #059669">
            ✓ Пайплайн завершён · {{ pl.parseTotal }} новых · {{ pl.undervaluedTotal }} недооценённых · Дайджест: {{ pl.digestSent ? 'отправлен' : 'не отправлен' }}
          </div>

          <!-- Error -->
          <div v-if="pipelineStage === 'error'" class="pt-2 border-t text-sm font-medium text-center" style="border-color: var(--border-subtle); color: #ef4444">
            ✗ {{ pipelineError || 'Ошибка пайплайна' }}
          </div>
        </div>
      </div>

      <!-- Выход -->
      <div class="mt-6 max-w-2xl">
        <button
          @click="handleLogout"
          class="w-full px-4 py-2 rounded-lg text-sm font-medium border transition-colors hover:opacity-80"
          style="border-color: var(--border-subtle); color: var(--text-muted)"
        >
          Выйти
        </button>
      </div>
    </div>

    <!-- Таб: Правила -->
    <div v-if="activeTab === 'rules'">
      <RulesPanel />
    </div>

    <!-- Таб: Парсеры -->
    <div v-if="activeTab === 'sources'">
      <SourcesPanel />
    </div>

    <!-- Таб: Эталоны -->
    <div v-if="activeTab === 'references'">
      <MarketReferencesPanel />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, watch, onMounted } from 'vue'
import SkeletonLoader from '@/components/SkeletonLoader.vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import api from '@/api/strapi'
import RulesPanel from '@/components/settings/RulesPanel.vue'
import SourcesPanel from '@/components/settings/SourcesPanel.vue'
import MarketReferencesPanel from '@/components/settings/MarketReferencesPanel.vue'

const router = useRouter()
const authStore = useAuthStore()

const tabs = [
  { id: 'digest', label: 'Дайджест' },
  { id: 'rules', label: 'Правила' },
  { id: 'sources', label: 'Парсеры' },
  { id: 'references', label: 'Эталоны' },
]

const activeTab = ref('digest')

// Watch URL hash for tab
onMounted(() => {
  const hash = window.location.hash.replace('#', '')
  if (tabs.some(t => t.id === hash)) {
    activeTab.value = hash
  }
})

watch(activeTab, (val) => {
  window.location.hash = val
})

const loading = ref(true)
const saving = ref(false)
const saved = ref(false)
const error = ref('')
const documentId = ref('')

const form = ref({
  threshold_percent: 20,
  parse_depth: 20,
  digest_time: '09:00',
  smtp_to: '',
  price_from: null as number | null,
  price_to: null as number | null,
  monitored_regions: ['moscow', 'mo', 'other'] as string[],
})
const regionOptions = [
  { value: 'moscow', label: 'Москва' },
  { value: 'mo', label: 'Московская область' },
  { value: 'other', label: 'Другие регионы' },
]
const regionChecked = reactive<Record<string, boolean>>({
  moscow: true,
  mo: true,
  other: true,
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
        parse_depth: data.parse_depth ?? 20,
        digest_time: data.digest_time ?? '09:00',
        smtp_to: data.smtp_to ?? '',
        price_from: data.price_from ?? null,
        price_to: data.price_to ?? null,
        monitored_regions: data.monitored_regions ?? ['moscow', 'mo', 'other'],
      }
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

const save = async () => {
  saving.value = true
  error.value = ''
  saved.value = false

  try {
    if (documentId.value) {
      await api.put('/setting', { data: form.value })
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

// ========================
// Ручной запуск (полный пайплайн)
// ========================
const pipelineOpen = ref(false)
const parseDepth = ref(20)
const launchFilters = reactive({
  priceFrom: '',
  priceTo: '',
  cities: { moscow: true, mo: true, other: false },
  threshold: 20,
})

type PipelineStage = 'idle' | 'parsing' | 'analyzing' | 'digesting' | 'done' | 'error'
const pipelineStage = ref<PipelineStage>('idle')
const parseDone = ref(false)
const parseSourcesTotal = ref(0)
const parseSourcesDone = ref(0)
const analyzeDone = ref(false)
const analyzePending = ref(0)
const digestDone = ref(false)
const pipelineError = ref('')

const pl = reactive({
  parseTotal: 0,
  undervaluedTotal: 0,
  digestSent: false,
  digestCount: 0,
  digestSkipped: false,
})

let pollTimer: ReturnType<typeof setInterval> | null = null

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
}

async function pollQueueStats() {
  try {
    const res = await api.get('/cron/queue-stats')
    return res.data?.ok ? res.data : null
  } catch { return null }
}

function isQueueEmpty(queues: Record<string, any>, prefix: string): boolean {
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

async function runFullPipeline() {
  pipelineStage.value = 'parsing'
  parseDone.value = false; analyzeDone.value = false; digestDone.value = false
  parseSourcesDone.value = 0; analyzePending.value = 0; pipelineError.value = ''
  pl.parseTotal = 0; pl.undervaluedTotal = 0; pl.digestSent = false; pl.digestCount = 0; pl.digestSkipped = false

  try {
    // 1. Парсинг
    const sourcesRes = await api.get('/sources', { params: { 'filters[is_active][$eq]': true, 'pagination[pageSize]': 100 } })
    const sources = sourcesRes.data?.data || []
    if (sources.length === 0) { pipelineError.value = 'Нет активных источников'; pipelineStage.value = 'error'; return }

    const slugs = sources.map((s: any) => s.slug)
    parseSourcesTotal.value = sources.length

    await Promise.all(sources.map((s: any) => api.post(`/cron/parse/${s.slug}`, { depth: parseDepth.value }).catch(() => null)))

    await new Promise<void>((resolve, reject) => {
      let attempts = 0; const max = 2000
      pollTimer = setInterval(async () => {
        if (++attempts > max) { stopPolling(); reject(new Error('Парсинг: таймаут 100 мин')); return }
        const stats = await pollQueueStats(); if (!stats) return
        parseSourcesDone.value = countSourcesParsed(stats.sources, slugs)
        if (isQueueEmpty(stats.queues, 'parse-') && parseSourcesDone.value >= parseSourcesTotal.value) {
          stopPolling()
          for (const s of stats.sources || []) { if (slugs.includes(s.slug)) pl.parseTotal += (s.total_created || 0) }
          parseDone.value = true; pipelineStage.value = 'analyzing'; resolve()
        }
      }, 3000)
    })

    // 2. Анализ
    const analyzeBody: any = {}
    if (launchFilters.priceFrom) analyzeBody.priceFrom = Number(launchFilters.priceFrom)
    if (launchFilters.priceTo) analyzeBody.priceTo = Number(launchFilters.priceTo)
    const cities: string[] = []
    if (launchFilters.cities.moscow) cities.push('moscow')
    if (launchFilters.cities.mo) cities.push('mo')
    if (launchFilters.cities.other) cities.push('other')
    if (cities.length > 0 && cities.length < 3) analyzeBody.city = cities
    if (launchFilters.threshold !== 20) analyzeBody.threshold = launchFilters.threshold
    await api.post('/cron/analyze', Object.keys(analyzeBody).length ? analyzeBody : undefined)

    await new Promise<void>((resolve, reject) => {
      let attempts = 0; const max = 60
      pollTimer = setInterval(async () => {
        if (++attempts > max) { stopPolling(); reject(new Error('Анализ: таймаут 3 мин')); return }
        const stats = await pollQueueStats(); if (!stats) return
        const q = stats.queues['analyze-property'] || { pending: 0, active: 0 }
        analyzePending.value = q.pending + q.active
        if (isQueueEmpty(stats.queues, 'analyze-')) {
          stopPolling()
          for (const city of ['moscow', 'mo', 'other']) {
            try {
              const res = await api.get('/properties', { params: { 'filters[is_undervalued][$eq]': true, 'filters[city][$eq]': city, 'pagination[pageSize]': 1 } })
              pl.undervaluedTotal += res.data?.meta?.pagination?.total || 0
            } catch { /* ok */ }
          }
          analyzeDone.value = true; pipelineStage.value = 'digesting'; resolve()
        }
      }, 3000)
    })

    // 3. Дайджест
    await api.post('/cron/digest')

    await new Promise<void>((resolve, reject) => {
      let attempts = 0; const max = 30
      pollTimer = setInterval(async () => {
        if (++attempts > max) { stopPolling(); reject(new Error('Дайджест: таймаут 90 сек')); return }
        const stats = await pollQueueStats(); if (!stats) return
        if (isQueueEmpty(stats.queues, 'digest-')) {
          stopPolling(); digestDone.value = true
          if (pl.undervaluedTotal > 0) { pl.digestSent = true; pl.digestCount = pl.undervaluedTotal }
          else { pl.digestSkipped = true }
          pipelineStage.value = 'done'; resolve()
        }
      }, 3000)
    })

  } catch (err: any) {
    stopPolling(); pipelineStage.value = 'error'
    pipelineError.value = err.message || 'Ошибка пайплайна'
  }
}
</script>
