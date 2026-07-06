import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Мокаем vue до импорта тестируемого модуля
vi.mock('vue', () => ({
  onUnmounted: vi.fn(),
}))

import { onUnmounted } from 'vue'
import { usePolling } from '../usePolling'

describe('usePolling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(onUnmounted).mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('isStopped возвращает false по умолчанию', () => {
    const { isStopped } = usePolling()
    expect(isStopped()).toBe(false)
  })

  it('usePolling создаёт composable с poll функцией', () => {
    const result = usePolling()
    expect(result).toHaveProperty('poll')
    expect(result).toHaveProperty('isStopped')
    expect(typeof result.poll).toBe('function')
    expect(typeof result.isStopped).toBe('function')
  })

  it('poll вызывает fn повторно с интервалом', async () => {
    const { poll } = usePolling()
    const fn = vi.fn().mockResolvedValue(false)

    const promise = poll(fn, 1000, 3)

    // Первый вызов после 1000мс
    await vi.advanceTimersByTimeAsync(1000)
    expect(fn).toHaveBeenCalledTimes(1)

    // Второй вызов после ещё 1000мс
    await vi.advanceTimersByTimeAsync(1000)
    expect(fn).toHaveBeenCalledTimes(2)

    // Третий вызов после ещё 1000мс
    await vi.advanceTimersByTimeAsync(1000)
    expect(fn).toHaveBeenCalledTimes(3)

    await promise
  })

  it('poll останавливается когда fn возвращает true', async () => {
    const { poll } = usePolling()
    const fn = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)

    const promise = poll(fn, 500, 10)

    await vi.advanceTimersByTimeAsync(500)
    expect(fn).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(500)
    expect(fn).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(500)
    expect(fn).toHaveBeenCalledTimes(3)

    await promise
    // Не вызывается 4-й раз
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('poll останавливается после maxAttempts', async () => {
    const { poll } = usePolling()
    const fn = vi.fn().mockResolvedValue(false)

    const promise = poll(fn, 200, 2)

    await vi.advanceTimersByTimeAsync(200)
    expect(fn).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(200)
    expect(fn).toHaveBeenCalledTimes(2)

    await promise
    // Больше не вызывается
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('poll прекращается при вызове cleanup (onUnmounted)', async () => {
    // Захватываем callback из onUnmounted
    let cleanup: (() => void) | undefined
    vi.mocked(onUnmounted).mockImplementation((cb: () => void) => {
      cleanup = cb
    })

    const { poll, isStopped } = usePolling()
    const fn = vi.fn().mockResolvedValue(false)

    const promise = poll(fn, 1000, 10)

    await vi.advanceTimersByTimeAsync(1000)
    expect(fn).toHaveBeenCalledTimes(1)

    // Имитируем unmount
    cleanup!()
    expect(isStopped()).toBe(true)

    await vi.advanceTimersByTimeAsync(1000)
    // fn не вызывается после unmount
    expect(fn).toHaveBeenCalledTimes(1)

    await promise
  })
})
