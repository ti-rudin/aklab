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

        <!-- Время дайджеста -->
        <div>
          <label class="block text-sm font-medium mb-1" style="color: var(--text-main)">Дайджест включён</label>
          <p class="text-xs mb-2" style="color: var(--text-muted)">Включить или выключить автоматический утренний email-дайджест.</p>
          <label class="flex items-center gap-2 cursor-pointer">
            <input
              v-model="form.digest_enabled"
              type="checkbox"
              class="w-5 h-5 rounded"
            />
            <span class="text-sm" style="color: var(--text-main)">{{ form.digest_enabled ? 'Включён' : 'Выключен' }}</span>
          </label>
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
            <div class="flex items-center gap-2">
              <button
                v-if="!pipelineRunning"
                @click="startPipeline"
                class="px-4 py-2 rounded-lg text-sm font-semibold text-white transition-all duration-200 hover:opacity-90"
                :style="{ background: pipelineDone ? '#059669' : 'var(--accent)' }"
              >
                <template v-if="pipelineDone">✓ Ещё раз</template>
                <template v-else>▶ Ручной запуск</template>
              </button>
              <template v-else>
                <button
                  @click="cancelPipeline"
                  class="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-red-500 hover:bg-red-600 transition-all"
                >
                  ◼ Отменить
                </button>
                <button
                  @click="resetPipeline"
                  class="px-3 py-2 rounded-lg text-xs font-medium border transition-colors hover:opacity-80"
                  style="border-color: var(--border-subtle); color: var(--text-muted)"
                  title="Сбросить состояние (если зависло)"
                >
                  ↻ Сбросить
                </button>
              </template>
            </div>
          </div>
        </div>

        <!-- Прогресс пайплайна (SSE-based) -->
        <div v-if="pipelineRunning || pipelineDone" class="mt-3 p-3 sm:p-4 rounded-lg space-y-2 sm:space-y-3" style="background: var(--bg-elevated); border: 1px solid var(--border-subtle)">
          <!-- Парсинг -->
          <div class="flex items-center gap-3">
            <span class="flex-shrink-0 w-5 text-center">
              <template v-if="isParsingStage">⏳</template>
              <template v-else-if="isParsingDone">✓</template>
              <template v-else>○</template>
            </span>
            <div class="flex-1">
              <div class="text-sm font-medium" style="color: var(--text-main)">Парсинг</div>
              <div class="text-xs" style="color: var(--text-muted)">
                <template v-if="isParsingStage">{{ pipelineState.message }}</template>
                <template v-else-if="isParsingDone">{{ pipelineState.sources_done }} источников · {{ pipelineState.objects_created }} новых{{ pipelineState.details_needed > 0 ? ` · ${pipelineState.details_fetched}/${pipelineState.details_needed} детальных` : '' }}</template>
                <template v-else>Ожидание...</template>
              </div>
            </div>
          </div>

          <!-- Анализ -->
          <div class="flex items-center gap-3">
            <span class="flex-shrink-0 w-5 text-center">
              <template v-if="isAnalyzingStage">⏳</template>
              <template v-else-if="isAnalyzingDone">✓</template>
              <template v-else>○</template>
            </span>
            <div class="flex-1">
              <div class="text-sm font-medium" style="color: var(--text-main)">Анализ</div>
              <div class="text-xs" style="color: var(--text-muted)">
                <template v-if="isAnalyzingStage">{{ pipelineState.message }}</template>
                <template v-else-if="isAnalyzingDone">{{ pipelineState.undervalued_count }} недооценённых из {{ pipelineState.analyze_total }}</template>
                <template v-else-if="pipelineState.stage === 'analyzing_skipped'">Пропущен — нет новых объектов</template>
                <template v-else>Ожидание...</template>
              </div>
            </div>
          </div>

          <!-- Дайджест -->
          <div class="flex items-center gap-3">
            <span class="flex-shrink-0 w-5 text-center">
              <template v-if="pipelineState.stage === 'digesting'">⏳</template>
              <template v-else-if="isDigestDone">✓</template>
              <template v-else>○</template>
            </span>
            <div class="flex-1">
              <div class="text-sm font-medium" style="color: var(--text-main)">Дайджест</div>
              <div class="text-xs" style="color: var(--text-muted)">
                <template v-if="pipelineState.stage === 'digesting'">{{ pipelineState.message }}</template>
                <template v-else-if="pipelineState.stage === 'digest_done'">{{ pipelineState.message }}</template>
                <template v-else-if="pipelineState.stage === 'done' || pipelineState.stage === 'done_with_errors'">Отправлен</template>
                <template v-else>Ожидание...</template>
              </div>
            </div>
          </div>

          <!-- Done -->
          <div v-if="pipelineDone" class="pt-2 border-t text-sm font-medium text-center" style="border-color: var(--border-subtle); color: #059669">
            {{ pipelineState.message || '✓ Пайплайн завершён' }}
          </div>

          <!-- Errors -->
          <div v-if="pipelineState.errors?.length" class="pt-2 border-t space-y-1" style="border-color: var(--border-subtle)">
            <div v-for="err in pipelineState.errors" :key="err" class="text-xs" style="color: #ef4444">
              ⚠ {{ err }}
            </div>
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
      <ParsingRulesPanel />
      <div class="mt-8 pt-6 border-t" style="border-color: var(--border-subtle)">
        <RulesPanel />
      </div>
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
import ParsingRulesPanel from '@/components/settings/ParsingRulesPanel.vue'
import { usePipeline } from '@/composables/usePipeline'

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
  digest_time: '09:00',
  smtp_to: '',
  digest_enabled: true,
})

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
        digest_enabled: data.digest_enabled !== false, // default true
      }
      // Предзаполнение формы ручного запуска из Setting
      launchFilters.priceFrom = data.price_from ?? ''
      launchFilters.priceTo = data.price_to ?? ''
      const regions = data.monitored_regions ?? ['moscow', 'mo']
      launchFilters.cities.moscow = regions.includes('moscow')
      launchFilters.cities.mo = regions.includes('mo')
      launchFilters.cities.other = regions.includes('other')
      parseDepth.value = data.parse_depth ?? 20
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
// Pipeline
// ========================
const parseDepth = ref(20)
const pipelineOpen = ref(false)
const launchFilters = reactive({
  priceFrom: '',
  priceTo: '',
  cities: { moscow: true, mo: true, other: false },
  threshold: 20,
})

const {
  state: pipelineState,
  isRunning: pipelineRunning,
  isDone: pipelineDone,
  isParsingStage,
  isParsingDone,
  isAnalyzingStage,
  isAnalyzingDone,
  isDigestDone,
  start: pipelineStart,
  cancel: cancelPipeline,
  reset: resetPipeline,
  checkOnMount,
} = usePipeline()

function startPipeline() {
  const filters: any = {}
  if (launchFilters.priceFrom) filters.priceFrom = Number(launchFilters.priceFrom)
  if (launchFilters.priceTo) filters.priceTo = Number(launchFilters.priceTo)
  const cities: string[] = []
  if (launchFilters.cities.moscow) cities.push('moscow')
  if (launchFilters.cities.mo) cities.push('mo')
  if (launchFilters.cities.other) cities.push('other')
  if (cities.length > 0 && cities.length < 3) filters.city = cities
  if (launchFilters.threshold !== 20) filters.threshold = launchFilters.threshold

  pipelineStart(parseDepth.value, Object.keys(filters).length ? filters : undefined).catch((err: any) => {
    alert(err.response?.data?.message || err.message || 'Ошибка запуска')
  })
}

onMounted(checkOnMount)
</script>
