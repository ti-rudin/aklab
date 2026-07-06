<template>
  <div class="mb-4">
    <button @click="launchFiltersOpen = !launchFiltersOpen"
      class="flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg transition-colors hover:opacity-80"
      style="color: var(--text-muted)">
      <span>{{ launchFiltersOpen ? '▼' : '▶' }}</span>
      <span>Запуск парсинга</span>
    </button>

    <div v-if="launchFiltersOpen" class="mt-3 p-4 rounded-xl border"
      style="background: var(--bg-elevated); border-color: var(--border-subtle)">
      <!-- Price range -->
      <div class="mb-3">
        <label class="block text-xs font-medium mb-1" style="color: var(--text-muted)">Цена лота (₽)</label>
        <div class="flex gap-2 items-center">
          <input v-model="parseFilters.priceFrom" type="number" placeholder="от" min="0"
            class="w-full px-2 py-1.5 rounded-lg border text-sm"
            style="background: var(--bg-main); border-color: var(--border-subtle); color: var(--text-main)" />
          <span class="text-xs flex-shrink-0" style="color: var(--text-muted)">—</span>
          <input v-model="parseFilters.priceTo" type="number" placeholder="до" min="0"
            class="w-full px-2 py-1.5 rounded-lg border text-sm"
            style="background: var(--bg-main); border-color: var(--border-subtle); color: var(--text-main)" />
        </div>
      </div>
      <!-- Cities -->
      <div class="mb-3">
        <label class="block text-xs font-medium mb-1" style="color: var(--text-muted)">Город</label>
        <FilterChips v-model="parseFilters.cities" :options="cityOptions" />
      </div>
      <!-- Depth + Button -->
      <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 pt-2 border-t" style="border-color: var(--border-subtle)">
        <div class="flex items-center gap-2">
          <label class="text-xs whitespace-nowrap" style="color: var(--text-muted)">Глубина:</label>
          <input :value="parseDepth" @input="$emit('update:parseDepth', Number(($event.target as HTMLInputElement).value))" type="number" min="1" max="5000"
            class="w-24 px-2 py-1.5 rounded-lg border text-sm text-center"
            style="background: var(--bg-main); border-color: var(--border-subtle); color: var(--text-main)" />
        </div>
        <button
          @click="runParseOnly"
          :disabled="parseStage !== 'idle' && parseStage !== 'done' && parseStage !== 'error'"
          class="px-4 py-2 rounded-lg text-sm font-semibold text-white transition-all duration-200 hover:opacity-90 disabled:opacity-50"
          :style="{
            background: parseStage === 'done' ? '#059669' : 'var(--accent)',
          }"
        >
          <template v-if="parseStage === 'idle' || parseStage === 'error'">▶ Запустить парсинг</template>
          <template v-else-if="parseStage === 'done'">Готово — ещё раз</template>
          <template v-else>Парсинг...</template>
        </button>
      </div>
    </div>
  </div>

  <!-- Прогресс парсинга -->
  <div v-if="parseStage !== 'idle'" class="mb-6 p-3 sm:p-4 rounded-lg" style="background: var(--bg-elevated); border: 1px solid var(--border-subtle)">
    <div class="flex items-center gap-3">
      <span class="flex-shrink-0 w-5 text-center">
        <template v-if="parseStage === 'parsing'">⏳</template>
        <template v-else-if="parseDone">✓</template>
        <template v-else>○</template>
      </span>
      <div class="flex-1">
        <div class="text-sm font-medium" style="color: var(--text-primary)">Парсинг</div>
        <div class="text-xs" style="color: var(--text-muted)">
          <template v-if="parseStage === 'parsing'">
            {{ parseSourcesDone }}/{{ parseSourcesTotal }} источников
            <template v-if="detailsNeeded > 0"> · {{ detailsFetched }}/{{ detailsNeeded }} детальных</template>
          </template>
          <template v-else-if="parseDone">
            {{ parseSourcesTotal }} источников, {{ pipelineResults.parseTotal }} объектов
            <template v-if="pipelineResults.detailsNeeded > 0"> · {{ pipelineResults.detailsFetched }}/{{ pipelineResults.detailsNeeded }} детальных</template>
            <template v-if="pipelineResults.parseErrors > 0">, {{ pipelineResults.parseErrors }} ошибок</template>
          </template>
          <template v-else>Ожидание...</template>
        </div>
      </div>
    </div>

    <div v-if="parseStage === 'done'" class="mt-2 pt-2 border-t text-sm font-medium text-center" style="border-color: var(--border-subtle); color: #059669">
      ✓ Парсинг завершён · Новых объектов: {{ pipelineResults.parseTotal }}
      <template v-if="pipelineResults.detailsNeeded > 0"> · Детальных: {{ pipelineResults.detailsFetched }}/{{ pipelineResults.detailsNeeded }}</template>
    </div>

    <div v-if="parseStage === 'error'" class="mt-2 pt-2 border-t text-sm font-medium text-center" style="border-color: var(--border-subtle); color: #ef4444">
      ✗ {{ pipelineError || 'Ошибка парсинга' }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted } from 'vue'
import api from '@/api/strapi'
import FilterChips from '@/components/properties/FilterChips.vue'

const props = defineProps<{
  parseDepth: number
}>()

const emit = defineEmits<{
  'update:parseDepth': [value: number]
  done: []
}>()

const cityOptions = [
  { value: 'moscow', label: 'Москва' },
  { value: 'mo', label: 'МО' },
  { value: 'other', label: 'Другой' },
]

// ========================
// Launch panel state
// ========================
const launchFiltersOpen = ref(false)

const parseFilters = reactive({
  priceFrom: '' as string | number,
  priceTo: '' as string | number,
  cities: ['moscow', 'mo', 'other'] as string[],
})

// ========================
// Pipeline state
// ========================
type ParseStage = 'idle' | 'parsing' | 'done' | 'error'
const parseStage = ref<ParseStage>('idle')
const parseSourcesTotal = ref(0)
const parseSourcesDone = ref(0)
const parseDone = ref(false)
const detailsFetched = ref(0)
const detailsNeeded = ref(0)
const pipelineError = ref('')

const pipelineResults = reactive({
  parseTotal: 0,
  parseErrors: 0,
  detailsFetched: 0,
  detailsNeeded: 0,
})

let pollTimer: ReturnType<typeof setInterval> | null = null

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

async function runParseOnly() {
  parseStage.value = 'parsing'
  parseDone.value = false
  parseSourcesDone.value = 0
  detailsFetched.value = 0
  detailsNeeded.value = 0
  pipelineError.value = ''
  pipelineResults.parseTotal = 0
  pipelineResults.parseErrors = 0
  pipelineResults.detailsFetched = 0
  pipelineResults.detailsNeeded = 0

  try {
    // Build filters for pipeline
    const filters: any = {}
    if (parseFilters.priceFrom) filters.priceFrom = Number(parseFilters.priceFrom)
    if (parseFilters.priceTo) filters.priceTo = Number(parseFilters.priceTo)
    if (parseFilters.cities.length > 0 && parseFilters.cities.length < 3) filters.city = parseFilters.cities

    // Start full pipeline (parse → analyze → digest)
    await api.post('/pipeline/start', {
      mode: 'full',
      depth: props.parseDepth,
      filters: Object.keys(filters).length ? filters : undefined,
    })

    // Poll pipeline status until done
    await new Promise<void>((resolve, reject) => {
      let attempts = 0
      const maxAttempts = 2000
      pollTimer = setInterval(async () => {
        attempts++
        if (attempts > maxAttempts) {
          stopPolling()
          reject(new Error('Пайплайн превысил таймаут (100 мин)'))
          return
        }

        try {
          const { data } = await api.get('/pipeline/status')
          const state = data?.state
          if (!state) return

          // Map pipeline stages to parse progress UI
          const stage = state.stage || ''
          if (['parsing_scan', 'parsing_details'].includes(stage)) {
            parseStage.value = 'parsing'
            parseSourcesDone.value = state.sources_done || 0
            parseSourcesTotal.value = state.sources_total || 0
            detailsFetched.value = state.details_fetched || 0
            detailsNeeded.value = state.details_needed || 0
          } else if (['parsing_done', 'analyzing', 'analyzing_done', 'analyzing_skipped', 'digesting', 'digest_done'].includes(stage)) {
            parseDone.value = true
            parseStage.value = 'done'
            parseSourcesDone.value = state.sources_done || parseSourcesDone.value
            parseSourcesTotal.value = state.sources_total || parseSourcesTotal.value
            detailsFetched.value = state.details_fetched || detailsFetched.value
            detailsNeeded.value = state.details_needed || detailsNeeded.value
            pipelineResults.parseTotal = state.objects_created || 0
          }

          if (['done', 'done_with_errors', 'error', 'cancelled'].includes(stage)) {
            stopPolling()
            parseDone.value = true
            parseStage.value = stage === 'error' ? 'error' : 'done'
            pipelineResults.parseTotal = state.objects_created || 0
            if (state.errors?.length) pipelineError.value = state.errors.join('; ')
            if (stage === 'error') pipelineError.value = state.message || 'Ошибка пайплайна'
            emit('done')
            resolve()
          }
        } catch { /* ignore polling errors */ }
      }, 3000)
    })
  } catch (err: any) {
    stopPolling()
    parseStage.value = 'error'
    pipelineError.value = err.message || 'Ошибка парсинга'
  }
}

// ========================
// Load defaults
// ========================
async function loadParseDefaults() {
  try {
    const { data } = await api.get('/setting')
    const s = data?.data
    if (s) {
      emit('update:parseDepth', s.parse_depth ?? 20)
      parseFilters.priceFrom = s.price_from ?? ''
      parseFilters.priceTo = s.price_to ?? ''
      parseFilters.cities = s.monitored_regions ?? ['moscow', 'mo', 'other']
    }
  } catch { /* используем дефолты */ }
}

onMounted(() => {
  loadParseDefaults()
})

onUnmounted(() => {
  stopPolling()
})
</script>
