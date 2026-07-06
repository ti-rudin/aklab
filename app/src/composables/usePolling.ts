import { onUnmounted } from 'vue'

export function usePolling() {
  let stopped = false

  onUnmounted(() => { stopped = true })

  async function poll(
    fn: () => Promise<boolean>, // return true to stop
    intervalMs: number,
    maxAttempts: number,
  ): Promise<void> {
    for (let i = 0; i < maxAttempts; i++) {
      if (stopped) return
      await new Promise(r => setTimeout(r, intervalMs))
      if (stopped) return
      const done = await fn()
      if (done) return
    }
  }

  return { poll, isStopped: () => stopped }
}
