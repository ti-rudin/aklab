import { reactive, computed, onUnmounted } from 'vue'
import api from '@/api/strapi'

interface PipelineServerState {
  status?: string
  stage?: string
  message?: string
  sources_total?: number
  sources_done?: number
  details_fetched?: number
  details_needed?: number
  analyze_total?: number
  analyze_done?: number
  undervalued_count?: number
  objects_created?: number
  errors?: string[]
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PipelineFilters = Record<string, any>

export function usePipeline() {
  // ========================
  // Pipeline state
  // ========================
  const state = reactive({
    status: 'idle' as string,
    stage: 'idle' as string,
    message: '',
    sources_total: 0,
    sources_done: 0,
    details_fetched: 0,
    details_needed: 0,
    analyze_total: 0,
    analyze_done: 0,
    undervalued_count: 0,
    objects_created: 0,
    errors: [] as string[],
  })

  // ========================
  // Computed stage flags
  // ========================
  const isRunning = computed(() =>
    state.status === 'running' ||
    state.status === 'cancelling' ||
    // Defensive: if stage is active but status got corrupted
    (state.stage !== 'idle' && state.stage !== 'done' &&
     state.stage !== 'done_with_errors' && state.stage !== 'cancelled' &&
     state.stage !== 'error')
  )

  const isDone = computed(() =>
    ['done', 'done_with_errors', 'cancelled', 'error'].includes(state.stage)
  )

  const isParsingStage = computed(() =>
    ['parsing_scan', 'parsing_details'].includes(state.stage)
  )

  const isParsingDone = computed(() =>
    state.stage === 'parsing_done' || isDone.value
  )

  const isAnalyzingStage = computed(() =>
    state.stage === 'analyzing'
  )

  const isAnalyzingDone = computed(() =>
    ['analyzing_done', 'analyzing_skipped'].includes(state.stage) || isDone.value
  )

  const isDigestDone = computed(() =>
    ['digest_done', 'done', 'done_with_errors'].includes(state.stage)
  )

  /**
   * Simplified parse stage for ParseLaunchPanel UI.
   * Maps full pipeline stages to: 'idle' | 'parsing' | 'done' | 'error'
   */
  const parseStage = computed<'idle' | 'parsing' | 'done' | 'error'>(() => {
    if (isParsingStage.value) return 'parsing'
    if (isParsingDone.value) return state.stage === 'error' ? 'error' : 'done'
    if (state.stage === 'idle') return 'idle'
    // Stages after parsing (analyzing, digesting) → parse is "done"
    if (['analyzing', 'analyzing_done', 'analyzing_skipped', 'digesting', 'digest_done'].includes(state.stage)) return 'done'
    return 'idle'
  })

  // ========================
  // State update helper
  // ========================
  function updateState(serverState: PipelineServerState | undefined) {
    if (!serverState) return
    Object.assign(state, {
      status: serverState.status || 'idle',
      stage: serverState.stage || 'idle',
      message: serverState.message || '',
      sources_total: serverState.sources_total || 0,
      sources_done: serverState.sources_done || 0,
      details_fetched: serverState.details_fetched || 0,
      details_needed: serverState.details_needed || 0,
      analyze_total: serverState.analyze_total || 0,
      analyze_done: serverState.analyze_done || 0,
      undervalued_count: serverState.undervalued_count || 0,
      objects_created: serverState.objects_created || 0,
      errors: serverState.errors || [],
    })
  }

  // ========================
  // Polling (fallback / backup)
  // ========================
  let pollInterval: ReturnType<typeof setInterval> | null = null

  function stopPolling() {
    if (pollInterval) { clearInterval(pollInterval); pollInterval = null }
  }

  function startPolling() {
    stopPolling()
    pollInterval = setInterval(async () => {
      try {
        const res = await api.get('/pipeline/status', { params: { _t: Date.now() } })
        if (res.data?.ok && res.data.state) {
          updateState(res.data.state)
          const s = res.data.state
          if (s.status === 'idle' || s.stage === 'done' || s.stage === 'done_with_errors' ||
              s.stage === 'cancelled' || s.stage === 'error') {
            stopPolling()
          }
        }
      } catch { /* ok */ }
    }, 3000)
  }

  // ========================
  // SSE connection
  // ========================
  let eventSource: EventSource | null = null

  function connectSSE() {
    if (eventSource) { eventSource.close(); eventSource = null }
    // SSE URL must point to API domain (Vite preview doesn't proxy /api)
    const apiBase = (import.meta.env.VITE_API_URL as string) || (window.location.origin + '/api')
    const sseBase = apiBase.replace(/\/api$/, '')
    eventSource = new EventSource(`${sseBase}/api/pipeline/stream`)
    eventSource.addEventListener('progress', (e) => {
      stopPolling() // SSE works, no need to poll
      try { updateState(JSON.parse(e.data)) } catch { /* ok */ }
    })
    eventSource.addEventListener('done', (e) => {
      try { updateState(JSON.parse((e as MessageEvent).data)) } catch { /* ok */ }
      if (eventSource) { eventSource.close(); eventSource = null }
      stopPolling()
    })
    eventSource.addEventListener('error', () => {
      if (eventSource && eventSource.readyState === EventSource.CLOSED) {
        // SSE failed — fall back to polling
        if (eventSource) { eventSource.close(); eventSource = null }
        startPolling()
      }
    })
    // Also start polling as backup (SSE might connect but never fire events)
    startPolling()
  }

  // ========================
  // Actions
  // ========================

  /**
   * Start the full pipeline. Caller builds filters object from UI state.
   */
  async function start(depth: number, filters?: PipelineFilters) {
    await api.post('/pipeline/start', {
      mode: 'full',
      depth,
      filters: filters && Object.keys(filters).length ? filters : undefined,
    })
    connectSSE()
  }

  async function cancel() {
    try {
      await api.post('/pipeline/cancel')
      // Immediately reset local state
      updateState({ status: 'idle', stage: 'cancelled', message: 'Пайплайн отменён' })
      stopPolling()
      if (eventSource) { eventSource.close(); eventSource = null }
    } catch { /* ok */ }
  }

  async function reset() {
    try {
      await api.post('/pipeline/reset')
      updateState({ status: 'idle', stage: 'idle', message: '' })
      stopPolling()
      if (eventSource) { eventSource.close(); eventSource = null }
    } catch { /* ok */ }
  }

  // ========================
  // Cleanup
  // ========================
  function cleanup() {
    if (eventSource) { eventSource.close(); eventSource = null }
    stopPolling()
  }

  onUnmounted(cleanup)

  // ========================
  // Check running on mount
  // ========================
  async function checkOnMount() {
    try {
      const res = await api.get('/pipeline/status')
      if (res.data?.ok && res.data.state) {
        updateState(res.data.state)
        // Connect SSE if pipeline is (or might be) running
        const s = res.data.state
        const mightBeRunning = s.status === 'running' || s.status === 'cancelling' ||
          (s.stage && s.stage !== 'idle' && s.stage !== 'done' &&
           s.stage !== 'done_with_errors' && s.stage !== 'cancelled' && s.stage !== 'error')
        if (mightBeRunning) {
          connectSSE()
        }
      }
    } catch { /* ok — no pipeline state */ }
  }

  return {
    state,
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
