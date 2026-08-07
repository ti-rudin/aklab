import { computed, onUnmounted, reactive, ref } from 'vue'
import type { AxiosInstance } from 'axios'
import api from '@/api/strapi'

const PIPELINE_STAGES = [
  'idle',
  'parsing_scan',
  'parsing_scan_done',
  'parsing_details',
  'parsing_done',
  'analyzing',
  'analyzing_skipped',
  'analyzing_done',
  'digesting',
  'digest_done',
  'done',
  'done_with_errors',
  'cancelled',
  'error',
] as const

const TERMINAL_STAGES = new Set<string>(['done', 'done_with_errors', 'cancelled', 'error'])

type PipelineStage = (typeof PIPELINE_STAGES)[number]
type PipelineStatus = 'idle' | 'running' | 'cancelling'

export interface PipelinePublicState {
  run_id: string | null
  status: PipelineStatus
  stage: PipelineStage
  message: string
  sources_total: number
  sources_done: number
  details_fetched: number
  details_needed: number
  analyze_total: number
  analyze_done: number
  undervalued_count: number
  objects_created: number
  digest_scheduled: number
  digest_sent: number
  digest_skipped: number
  digest_failed: number
  errors: string[]
}

interface PipelineOptions {
  apiClient?: AxiosInstance
  intervalMs?: number
}

function emptyState(): PipelinePublicState {
  return {
    run_id: null,
    status: 'idle',
    stage: 'idle',
    message: '',
    sources_total: 0,
    sources_done: 0,
    details_fetched: 0,
    details_needed: 0,
    analyze_total: 0,
    analyze_done: 0,
    undervalued_count: 0,
    objects_created: 0,
    digest_scheduled: 0,
    digest_sent: 0,
    digest_skipped: 0,
    digest_failed: 0,
    errors: [],
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonNegativeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0
}

function parseServerState(value: unknown): PipelinePublicState | null {
  if (!isRecord(value)) return null
  const status = value.status
  const stage = value.stage
  if (!['idle', 'running', 'cancelling'].includes(status as string)) return null
  if (!PIPELINE_STAGES.includes(stage as PipelineStage)) return null

  return {
    run_id: typeof value.run_id === 'string' && value.run_id.trim() !== '' ? value.run_id : null,
    status: status as PipelineStatus,
    stage: stage as PipelineStage,
    message: typeof value.message === 'string' ? value.message : '',
    sources_total: nonNegativeInteger(value.sources_total),
    sources_done: nonNegativeInteger(value.sources_done),
    details_fetched: nonNegativeInteger(value.details_fetched),
    details_needed: nonNegativeInteger(value.details_needed),
    analyze_total: nonNegativeInteger(value.analyze_total),
    analyze_done: nonNegativeInteger(value.analyze_done),
    undervalued_count: nonNegativeInteger(value.undervalued_count),
    objects_created: nonNegativeInteger(value.objects_created),
    digest_scheduled: nonNegativeInteger(value.digest_scheduled),
    digest_sent: nonNegativeInteger(value.digest_sent),
    digest_skipped: nonNegativeInteger(value.digest_skipped),
    digest_failed: nonNegativeInteger(value.digest_failed),
    errors: Array.isArray(value.errors)
      ? value.errors.filter((item): item is string => typeof item === 'string').slice(0, 100)
      : [],
  }
}

function terminal(state: PipelinePublicState): boolean {
  return state.status === 'idle' && TERMINAL_STAGES.has(state.stage)
}

function active(state: PipelinePublicState): boolean {
  return state.status === 'running' || state.status === 'cancelling'
}

export function usePipeline(options: PipelineOptions = {}) {
  const apiClient = options.apiClient ?? api
  const intervalMs = options.intervalMs ?? 3_000
  const state = reactive<PipelinePublicState>(emptyState())
  const polling = ref(false)
  const requestError = ref('')

  let disposed = false
  let generation = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  let controller: AbortController | null = null

  const isRunning = computed(() => active(state))
  const isDone = computed(() => terminal(state))
  const isParsingStage = computed(() => ['parsing_scan', 'parsing_scan_done', 'parsing_details'].includes(state.stage))
  const isParsingDone = computed(() => state.stage === 'parsing_done' || isDone.value)
  const isAnalyzingStage = computed(() => state.stage === 'analyzing')
  const isAnalyzingDone = computed(() => ['analyzing_done', 'analyzing_skipped'].includes(state.stage) || isDone.value)
  const isDigestDone = computed(() => ['digest_done', 'done', 'done_with_errors'].includes(state.stage))
  const parseStage = computed<'idle' | 'parsing' | 'done' | 'error'>(() => {
    if (isParsingStage.value) return 'parsing'
    if (state.stage === 'error') return 'error'
    if (state.stage === 'idle') return 'idle'
    return 'done'
  })

  function updateState(next: PipelinePublicState) {
    Object.assign(state, next)
  }

  function stopPolling() {
    generation += 1
    polling.value = false
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    controller?.abort()
    controller = null
  }

  function schedule(runGeneration: number) {
    if (disposed || runGeneration !== generation || !polling.value) return
    timer = setTimeout(() => {
      timer = null
      void pollOnce(runGeneration)
    }, intervalMs)
  }

  async function pollOnce(runGeneration: number) {
    if (disposed || runGeneration !== generation || !polling.value) return
    controller = new AbortController()
    const signal = controller.signal
    try {
      const response = await apiClient.get('/pipeline/status', { signal })
      if (disposed || runGeneration !== generation) return
      if (response.data?.ok !== true) throw new Error('Некорректный ответ статуса pipeline')
      const next = parseServerState(response.data?.state)
      if (!next) throw new Error('Некорректный ответ статуса pipeline')
      requestError.value = ''
      updateState(next)
      if (terminal(next) || !active(next)) {
        polling.value = false
        return
      }
      schedule(runGeneration)
    } catch (cause) {
      if (disposed || runGeneration !== generation || signal.aborted) return
      requestError.value = cause instanceof Error ? cause.message : 'Не удалось получить статус pipeline'
      schedule(runGeneration)
    } finally {
      if (controller?.signal === signal) controller = null
    }
  }

  function startPolling() {
    stopPolling()
    if (disposed) return
    polling.value = true
    const runGeneration = ++generation
    void pollOnce(runGeneration)
  }

  async function start(targetUserId: number, depth: number) {
    if (!Number.isSafeInteger(targetUserId) || targetUserId <= 0) {
      throw new Error('Выберите целевого пользователя')
    }
    if (!Number.isSafeInteger(depth) || depth < 1 || depth > 1000) {
      throw new Error('Глубина должна быть целым числом от 1 до 1000')
    }
    if (disposed) throw new Error('Pipeline panel is disposed')

    requestError.value = ''
    const response = await apiClient.post('/pipeline/start', {
      mode: 'full',
      depth,
      targetUserId,
    })
    const runId = response.data?.run_id
    if (response.data?.ok !== true || typeof runId !== 'string' || runId.trim() === '') {
      throw new Error('Некорректный ответ запуска pipeline')
    }
    Object.assign(state, emptyState(), {
      run_id: runId,
      status: 'running',
      stage: 'idle',
      message: 'Pipeline запущен',
    })
    startPolling()
    return runId
  }

  async function cancel() {
    const response = await apiClient.post('/pipeline/cancel')
    if (response.data?.ok !== true) throw new Error('Некорректный ответ отмены pipeline')
    const next = parseServerState(response.data?.state)
    if (next) updateState(next)
    startPolling()
  }

  async function reset() {
    const response = await apiClient.post('/pipeline/reset')
    if (response.data?.ok !== true) throw new Error('Некорректный ответ сброса pipeline')
    stopPolling()
    updateState(emptyState())
    requestError.value = ''
  }

  async function checkOnMount() {
    if (disposed) return
    startPolling()
  }

  function cleanup() {
    if (disposed) return
    disposed = true
    stopPolling()
  }

  onUnmounted(cleanup)

  return {
    state,
    polling,
    requestError,
    isRunning,
    isDone,
    isParsingStage,
    isParsingDone,
    isAnalyzingStage,
    isAnalyzingDone,
    isDigestDone,
    parseStage,
    start,
    cancel,
    reset,
    cleanup,
    checkOnMount,
  }
}
