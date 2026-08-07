import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

vi.mock('vue', async () => ({
  ...(await vi.importActual<typeof import('vue')>('vue')),
  onUnmounted: vi.fn(),
}))

vi.mock('@/api/strapi', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}))

import api from '@/api/strapi'
import { usePipeline } from '../usePipeline'

const mockedApi = vi.mocked(api)

const runningState = {
  run_id: 'run-1',
  status: 'running',
  stage: 'parsing_scan',
  message: 'Парсинг',
  sources_total: 3,
  sources_done: 1,
  details_fetched: 0,
  details_needed: 2,
  analyze_total: 0,
  analyze_done: 0,
  undervalued_count: 0,
  objects_created: 4,
  digest_scheduled: 2,
  digest_sent: 0,
  digest_skipped: 0,
  digest_failed: 0,
  errors: [],
}

const terminalState = {
  ...runningState,
  status: 'idle',
  stage: 'done',
  sources_done: 3,
  digest_sent: 2,
}

describe('usePipeline authenticated polling contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts with the exact target-owned body and no filters', async () => {
    mockedApi.post.mockResolvedValueOnce({ data: { ok: true, run_id: 'run-1' } })
    mockedApi.get.mockResolvedValueOnce({ data: { ok: true, state: terminalState } })
    const pipeline = usePipeline({ apiClient: api, intervalMs: 100 })

    await pipeline.start(42, 100)
    await nextTick()

    expect(mockedApi.post).toHaveBeenCalledWith('/pipeline/start', {
      mode: 'full',
      depth: 100,
      targetUserId: 42,
    })
    expect(JSON.stringify(mockedApi.post.mock.calls)).not.toContain('filters')
    expect(mockedApi.get).toHaveBeenCalledWith('/pipeline/status', {
      signal: expect.any(AbortSignal),
    })
  })

  it('polls sequentially, never overlaps, and aborts the in-flight request on cleanup', async () => {
    let resolveStatus!: (value: unknown) => void
    mockedApi.post.mockResolvedValueOnce({ data: { ok: true, run_id: 'run-1' } })
    mockedApi.get.mockReturnValueOnce(new Promise((resolve) => { resolveStatus = resolve }))
    const pipeline = usePipeline({ apiClient: api, intervalMs: 100 })

    await pipeline.start(42, 100)
    await vi.advanceTimersByTimeAsync(500)
    expect(mockedApi.get).toHaveBeenCalledTimes(1)

    const signal = mockedApi.get.mock.calls[0]?.[1]?.signal
    pipeline.cleanup()
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(signal?.aborted).toBe(true)

    resolveStatus({ data: { ok: true, state: runningState } })
    await vi.advanceTimersByTimeAsync(500)
    expect(mockedApi.get).toHaveBeenCalledTimes(1)
  })

  it('stops polling on a terminal state and exposes only aggregate digest counters', async () => {
    mockedApi.post.mockResolvedValueOnce({ data: { ok: true, run_id: 'run-1' } })
    mockedApi.get.mockResolvedValueOnce({
      data: { ok: true, state: { ...terminalState, targetUserId: 42, email: 'secret@example.test' } },
    })
    const pipeline = usePipeline({ apiClient: api, intervalMs: 100 })

    await pipeline.start(42, 100)
    await vi.advanceTimersByTimeAsync(500)

    expect(mockedApi.get).toHaveBeenCalledTimes(1)
    expect(pipeline.state.stage).toBe('done')
    expect(pipeline.state.digest_sent).toBe(2)
    expect(pipeline.state).not.toHaveProperty('targetUserId')
    expect(pipeline.state).not.toHaveProperty('email')
  })

  it.each([
    [0, 100],
    [1.5, 100],
    [42, 0],
    [42, 1001],
    [42, 1.5],
  ])('rejects invalid target/depth %s/%s before any request', async (targetUserId, depth) => {
    const pipeline = usePipeline({ apiClient: api })
    await expect(pipeline.start(targetUserId, depth)).rejects.toThrow()
    expect(mockedApi.post).not.toHaveBeenCalled()
    expect(mockedApi.get).not.toHaveBeenCalled()
  })
})
