import { describe, it, expect, vi, beforeEach } from 'vitest'
import { nextTick } from 'vue'
import { useToast } from '../useToast'

describe('useToast', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // Clear all toasts before each test
    const { toasts } = useToast()
    toasts.value = []
  })

  it('show adds a toast and dismiss removes it', async () => {
    const { toasts, show, dismiss } = useToast()

    const id = show('Test message')
    expect(toasts.value).toHaveLength(1)
    expect(toasts.value[0].message).toBe('Test message')
    expect(toasts.value[0].id).toBe(id)

    dismiss(id)
    expect(toasts.value).toHaveLength(0)
  })

  it('success/error/info set correct type', () => {
    const { toasts, success, error, info } = useToast()

    success('Saved!')
    expect(toasts.value).toHaveLength(1)
    expect(toasts.value[0].type).toBe('success')

    error('Failed!')
    expect(toasts.value).toHaveLength(2)
    expect(toasts.value[1].type).toBe('error')

    info('Note')
    expect(toasts.value).toHaveLength(3)
    expect(toasts.value[2].type).toBe('info')
  })

  it('auto-dismisses after duration', () => {
    const { toasts, show } = useToast()

    show('Auto-dismiss', 'info', 2000)
    expect(toasts.value).toHaveLength(1)

    // Not dismissed yet
    vi.advanceTimersByTime(1000)
    expect(toasts.value).toHaveLength(1)

    // Should be dismissed now
    vi.advanceTimersByTime(1500)
    expect(toasts.value).toHaveLength(0)
  })
})
