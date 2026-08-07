import { onUnmounted, ref } from 'vue'
import type { AxiosInstance } from 'axios'
import api from '@/api/strapi'

const DEFAULT_POLL_INTERVAL_MS = 2_000
const DEFAULT_MAX_ATTEMPTS = 30
const MAX_POLL_ATTEMPTS = 30
const PHOTO_PATH_ERROR = 'Недопустимый путь фотографии'
const PHOTO_LOAD_ERROR = 'Не удалось загрузить фотографию'

type TimerHandle = ReturnType<typeof setTimeout>

export interface ObjectUrlFactory {
  createObjectURL: (blob: Blob) => string
  revokeObjectURL: (url: string) => void
}

export interface TimerFactory {
  setTimeout: (handler: () => void, timeout: number) => TimerHandle
  clearTimeout: (handle: TimerHandle) => void
}

export interface PropertyMediaOptions {
  apiClient?: Pick<AxiosInstance, 'get'>
  objectUrl?: ObjectUrlFactory
  timers?: TimerFactory
  intervalMs?: number
  maxAttempts?: number
}

export interface PropertyThumbnail {
  path: string
  url: string
}

export type PhotoPollState = 'idle' | 'polling' | 'downloaded' | 'error' | 'stopped'
export type PhotoPollResult = { status: Exclude<PhotoPollState, 'idle' | 'polling'> }

function browserObjectUrl(): ObjectUrlFactory {
  return {
    createObjectURL: (blob) => URL.createObjectURL(blob),
    revokeObjectURL: (url) => URL.revokeObjectURL(url),
  }
}

function defaultTimers(): TimerFactory {
  return {
    setTimeout: (handler, timeout) => globalThis.setTimeout(handler, timeout),
    clearTimeout: (handle) => globalThis.clearTimeout(handle),
  }
}

function isSafeSegment(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,255}$/.test(value)
}

function isSafeFilename(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(value)
}

export function isSafeLogicalPhotoPath(path: unknown, documentId: unknown): path is string {
  if (typeof path !== 'string' || typeof documentId !== 'string' || !isSafeSegment(documentId)) return false
  const prefix = `/photos/${documentId}/`
  if (!path.startsWith(prefix)) return false

  const filename = path.slice(prefix.length)
  if (!isSafeFilename(filename) || filename === '.' || filename === '..') return false
  try {
    // Encoded separators/traversal are never sent to the private route.
    return decodeURIComponent(filename) === filename
  } catch {
    return false
  }
}

function responseBlob(value: unknown): Blob {
  if (typeof Blob === 'undefined' || !(value instanceof Blob)) throw new Error('INVALID_PHOTO_BLOB')
  return value
}

export function usePropertyMedia(options: PropertyMediaOptions = {}) {
  const apiClient = options.apiClient || api
  const objectUrl = options.objectUrl || browserObjectUrl()
  const timers = options.timers || defaultTimers()
  const intervalMs = Math.max(0, options.intervalMs ?? DEFAULT_POLL_INTERVAL_MS)
  const maxAttempts = Math.min(MAX_POLL_ATTEMPTS, Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS))

  const thumbnails = ref<PropertyThumbnail[]>([])
  const errors = ref<Record<string, string>>({})
  const loading = ref(false)
  const lightboxUrl = ref<string | null>(null)
  const pollState = ref<PhotoPollState>('idle')
  const polling = ref(false)

  const retainedBlobs = new Map<string, Blob>()
  const thumbnailUrls = new Map<string, string>()
  let mediaGeneration = 0
  let pollGeneration = 0
  let pollTimer: TimerHandle | null = null
  let pollPromise: Promise<PhotoPollResult> | null = null
  let resolvePoll: ((result: PhotoPollResult) => void) | null = null
  let disposed = false

  function revokeLightbox(): void {
    if (lightboxUrl.value) {
      objectUrl.revokeObjectURL(lightboxUrl.value)
      lightboxUrl.value = null
    }
  }

  function revokeThumbnails(): void {
    for (const url of thumbnailUrls.values()) objectUrl.revokeObjectURL(url)
    thumbnailUrls.clear()
    thumbnails.value = []
  }

  function resetMedia(): void {
    mediaGeneration += 1
    revokeLightbox()
    revokeThumbnails()
    retainedBlobs.clear()
    errors.value = {}
    loading.value = false
  }

  function stopPolling(): void {
    pollGeneration += 1
    if (pollTimer !== null) {
      timers.clearTimeout(pollTimer)
      pollTimer = null
    }
    polling.value = false
    pollState.value = 'stopped'
    if (resolvePoll) {
      const resolve = resolvePoll
      resolvePoll = null
      pollPromise = null
      resolve({ status: 'stopped' })
    }
  }

  async function load(documentId: string, paths: unknown): Promise<void> {
    if (disposed) return
    resetMedia()
    const generation = mediaGeneration
    loading.value = true
    const candidates = Array.isArray(paths) ? paths : []
    const uniquePaths = [...new Set(candidates.filter((path): path is string => typeof path === 'string'))]

    await Promise.all(uniquePaths.map(async (path) => {
      if (!isSafeLogicalPhotoPath(path, documentId)) {
        errors.value[path] = PHOTO_PATH_ERROR
        return
      }

      try {
        const response = await apiClient.get(path, { responseType: 'blob' })
        const blob = responseBlob(response.data)
        if (disposed || generation !== mediaGeneration) return
        retainedBlobs.set(path, blob)
        const url = objectUrl.createObjectURL(blob)
        thumbnailUrls.set(path, url)
        thumbnails.value = [...thumbnails.value, { path, url }]
      } catch {
        if (!disposed && generation === mediaGeneration) errors.value[path] = PHOTO_LOAD_ERROR
      }
    }))

    if (generation === mediaGeneration && !disposed) loading.value = false
  }

  function openLightbox(pathOrIndex: string | number): string | null {
    const path = typeof pathOrIndex === 'number'
      ? thumbnails.value[pathOrIndex]?.path
      : pathOrIndex
    if (!path) return null
    const blob = retainedBlobs.get(path)
    if (!blob) return null
    revokeLightbox()
    lightboxUrl.value = objectUrl.createObjectURL(blob)
    return lightboxUrl.value
  }

  function closeLightbox(): void {
    revokeLightbox()
  }

  function cleanup(): void {
    if (disposed) return
    disposed = true
    stopPolling()
    resetMedia()
    loading.value = false
  }

  function pollForPhotos(
    documentId: string,
    onDetail?: (detail: Record<string, unknown>) => void | Promise<void>,
  ): Promise<PhotoPollResult> {
    if (disposed) return Promise.resolve({ status: 'stopped' })
    if (pollPromise) return pollPromise

    const run = ++pollGeneration
    let attempts = 0
    let promise!: Promise<PhotoPollResult>

    const finish = (result: PhotoPollResult): void => {
      if (run !== pollGeneration) return
      if (pollTimer !== null) {
        timers.clearTimeout(pollTimer)
        pollTimer = null
      }
      polling.value = false
      pollState.value = result.status
      const resolve = resolvePoll
      if (pollPromise === promise) {
        pollPromise = null
        resolvePoll = null
      }
      resolve?.(result)
    }

    promise = new Promise<PhotoPollResult>((resolve) => {
      resolvePoll = resolve
      polling.value = true
      pollState.value = 'polling'

      const schedule = (): void => {
        if (run !== pollGeneration || disposed) {
          finish({ status: 'stopped' })
          return
        }
        if (attempts >= maxAttempts) {
          finish({ status: 'error' })
          return
        }

        pollTimer = timers.setTimeout(async () => {
          pollTimer = null
          if (run !== pollGeneration || disposed) {
            finish({ status: 'stopped' })
            return
          }
          attempts += 1
          try {
            const response = await apiClient.get(`/properties/${documentId}`)
            if (run !== pollGeneration || disposed) {
              finish({ status: 'stopped' })
              return
            }
            const detail = response?.data?.data
            if (!detail || typeof detail !== 'object' || Array.isArray(detail)) {
              finish({ status: 'error' })
              return
            }
            await onDetail?.(detail as Record<string, unknown>)
            if (detail.photos_downloaded === true) {
              finish({ status: 'downloaded' })
            } else {
              schedule()
            }
          } catch {
            finish({ status: 'error' })
          }
        }, intervalMs)
      }

      schedule()
    })

    pollPromise = promise
    return promise
  }

  onUnmounted(cleanup)

  return {
    thumbnails,
    errors,
    loading,
    lightboxUrl,
    pollState,
    polling,
    load,
    resetMedia,
    openLightbox,
    closeLightbox,
    pollForPhotos,
    stopPolling,
    cleanup,
  }
}
