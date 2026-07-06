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
          :disabled="parseStage === 'parsing'"
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
            {{ pipelineState.sources_done }}/{{ pipelineState.sources_total }} источников
            <template v-if="pipelineState.details_needed > 0"> · {{ pipelineState.details_fetched }}/{{ pipelineState.details_needed }} детальных</template>
          </template>
          <template v-else-if="parseDone">
            {{ pipelineState.sources_total }} источников, {{ pipelineState.objects_created }} объектов
            <template v-if="pipelineState.details_needed > 0"> · {{ pipelineState.details_fetched }}/{{ pipelineState.details_needed }} детальных</template>
            <template v-if="pipelineState.errors.length > 0">, {{ pipelineState.errors.length }} ошибок</template>
          </template>
          <template v-else>Ожидание...</template>
        </div>
      </div>
    </div>

    <div v-if="parseStage === 'done'" class="mt-2 pt-2 border-t text-sm font-medium text-center" style="border-color: var(--border-subtle); color: #059669">
      ✓ Парсинг завершён · Новых объектов: {{ pipelineState.objects_created }}
      <template v-if="pipelineState.details_needed > 0"> · Детальных: {{ pipelineState.details_fetched }}/{{ pipelineState.details_needed }}</template>
    </div>

    <div v-if="parseStage === 'error'" class="mt-2 pt-2 border-t text-sm font-medium text-center" style="border-color: var(--border-subtle); color: #ef4444">
      ✗ {{ pipelineError || 'Ошибка парсинга' }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch } from 'vue'
import api from '@/api/strapi'
import FilterChips from '@/components/properties/FilterChips.vue'
import { usePipeline } from '@/composables/usePipeline'

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
// Pipeline (composable)
// ========================
const {
  state: pipelineState,
  parseStage,
  isParsingDone: parseDone,
  isDone,
  start: pipelineStart,
} = usePipeline()

const pipelineError = computed(() => {
  if (pipelineState.errors?.length) return pipelineState.errors.join('; ')
  if (pipelineState.stage === 'error') return pipelineState.message || 'Ошибка парсинга'
  return ''
})

async function runParseOnly() {
  const filters: any = {}
  if (parseFilters.priceFrom) filters.priceFrom = Number(parseFilters.priceFrom)
  if (parseFilters.priceTo) filters.priceTo = Number(parseFilters.priceTo)
  if (parseFilters.cities.length > 0 && parseFilters.cities.length < 3) filters.city = parseFilters.cities

  try {
    await pipelineStart(props.parseDepth, Object.keys(filters).length ? filters : undefined)
  } catch (err: any) {
    // POST error — state will reflect the failure
  }
}

// Emit 'done' when pipeline transitions to terminal stage
watch(isDone, (done, prevDone) => {
  if (done && !prevDone) emit('done')
})

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
</script>
