import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

vi.mock('vue', async () => ({
  ...(await vi.importActual<typeof import('vue')>('vue')),
  onUnmounted: vi.fn(),
}))

vi.mock('@/api/strapi', () => ({
  default: {
    get: vi.fn(),
  },
}))

import api from '@/api/strapi'
import {
  isSafeLogicalPhotoPath,
  usePropertyMedia,
  type ObjectUrlFactory,
} from '../usePropertyMedia'

const mockedApi = vi.mocked(api)

function objectUrlFactory() {
  let counter = 0
  const created: string[] = []
  const revoked: string[] = []
  const factory: ObjectUrlFactory = {
    createObjectURL: vi.fn(() => {
      const url = `blob:test-${++counter}`
      created.push(url)
      return url
    }),
    revokeObjectURL: vi.fn((url: string) => {
      revoked.push(url)
    }),
  }
  return { factory, created, revoked }
}

function blob(name: string) {
  return new Blob([name], { type: 'image/jpeg' })
}

describe('usePropertyMedia', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('loads private logical paths as authenticated Axios blobs and exposes only ObjectURLs', async () => {
    const urls = objectUrlFactory()
    mockedApi.get.mockResolvedValueOnce({ data: blob('first') })
    const media = usePropertyMedia({ apiClient: api, objectUrl: urls.factory })

    await media.load('doc-1', ['/photos/doc-1/first.jpg'])

    expect(mockedApi.get).toHaveBeenCalledWith('/photos/doc-1/first.jpg', { responseType: 'blob' })
    expect(media.thumbnails.value).toEqual([
      { path: '/photos/doc-1/first.jpg', url: 'blob:test-1' },
    ])
    expect(media.thumbnails.value[0].url).not.toContain('/api/')
    expect(media.thumbnails.value[0].url).not.toContain('token')
  })

  it('rejects paths from another property and unsafe filenames before any request', async () => {
    expect(isSafeLogicalPhotoPath('/photos/doc-1/first.jpg', 'doc-1')).toBe(true)
    expect(isSafeLogicalPhotoPath('/photos/doc-2/first.jpg', 'doc-1')).toBe(false)
    expect(isSafeLogicalPhotoPath('/photos/doc-1/../secret.jpg', 'doc-1')).toBe(false)
    expect(isSafeLogicalPhotoPath('/photos/doc-1/%2e%2e%2fsecret.jpg', 'doc-1')).toBe(false)
    expect(isSafeLogicalPhotoPath('/photos/doc-1/first.jpg?jwt=secret', 'doc-1')).toBe(false)

    const media = usePropertyMedia({ apiClient: api, objectUrl: objectUrlFactory().factory })
    await media.load('doc-1', [
      '/photos/doc-2/first.jpg',
      '/photos/doc-1/../secret.jpg',
      '/photos/doc-1/%2e%2e%2fsecret.jpg',
    ])

    expect(mockedApi.get).not.toHaveBeenCalled()
    expect(media.thumbnails.value).toEqual([])
    expect(Object.keys(media.errors.value)).toHaveLength(3)
  })

  it('keeps successful media when one blob fails and never falls back to a public URL', async () => {
    const urls = objectUrlFactory()
    mockedApi.get
      .mockResolvedValueOnce({ data: blob('ok') })
      .mockRejectedValueOnce(new Error('private photo unavailable'))
    const media = usePropertyMedia({ apiClient: api, objectUrl: urls.factory })

    await media.load('doc-1', ['/photos/doc-1/ok.jpg', '/photos/doc-1/broken.jpg'])

    expect(media.thumbnails.value).toEqual([
      { path: '/photos/doc-1/ok.jpg', url: 'blob:test-1' },
    ])
    expect(media.errors.value['/photos/doc-1/broken.jpg']).toBe('Не удалось загрузить фотографию')
    expect(media.thumbnails.value.some((item) => item.url.includes('api'))).toBe(false)
  })

  it('revokes lightbox URLs independently while keeping thumbnails valid until reload', async () => {
    const urls = objectUrlFactory()
    mockedApi.get
      .mockResolvedValueOnce({ data: blob('first') })
      .mockResolvedValueOnce({ data: blob('second') })
    const media = usePropertyMedia({ apiClient: api, objectUrl: urls.factory })

    await media.load('doc-1', ['/photos/doc-1/first.jpg'])
    media.openLightbox('/photos/doc-1/first.jpg')
    expect(media.lightboxUrl.value).toBe('blob:test-2')

    media.closeLightbox()
    expect(urls.revoked).toEqual(['blob:test-2'])
    expect(urls.revoked).not.toContain('blob:test-1')

    await media.load('doc-1', ['/photos/doc-1/second.jpg'])
    expect(urls.revoked).toContain('blob:test-1')
    expect(media.thumbnails.value).toEqual([
      { path: '/photos/doc-1/second.jpg', url: 'blob:test-3' },
    ])

    media.openLightbox('/photos/doc-1/second.jpg')
    expect(media.lightboxUrl.value).toBe('blob:test-4')
    media.cleanup()
    expect(urls.revoked).toContain('blob:test-3')
    expect(urls.revoked).toContain('blob:test-4')
  })

  it('polls detail sequentially, stops after downloaded, and refreshes through the callback', async () => {
    vi.useFakeTimers()
    const urls = objectUrlFactory()
    const onDetail = vi.fn()
    mockedApi.get
      .mockResolvedValueOnce({ data: { data: { documentId: 'doc-1', photos_downloaded: false } } })
      .mockResolvedValueOnce({ data: { data: {
        documentId: 'doc-1',
        photos_downloaded: true,
        photos: ['/photos/doc-1/first.jpg'],
      } } })
    const media = usePropertyMedia({
      apiClient: api,
      objectUrl: urls.factory,
      intervalMs: 1000,
      maxAttempts: 30,
    })

    const polling = media.pollForPhotos('doc-1', onDetail)
    await vi.advanceTimersByTimeAsync(1000)
    await nextTick()
    expect(mockedApi.get).toHaveBeenCalledTimes(1)
    expect(onDetail).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1000)
    await polling

    expect(mockedApi.get).toHaveBeenCalledTimes(2)
    expect(onDetail).toHaveBeenCalledTimes(2)
    expect(media.pollState.value).toBe('downloaded')
  })

  it('does not overlap in-flight detail requests and cleanup prevents later polling', async () => {
    vi.useFakeTimers()
    let resolveRequest!: (value: unknown) => void
    mockedApi.get.mockReturnValueOnce(new Promise((resolve) => { resolveRequest = resolve }))
    const media = usePropertyMedia({ apiClient: api, intervalMs: 100, maxAttempts: 3 })
    const polling = media.pollForPhotos('doc-1')

    await vi.advanceTimersByTimeAsync(100)
    await vi.advanceTimersByTimeAsync(500)
    expect(mockedApi.get).toHaveBeenCalledTimes(1)

    media.cleanup()
    resolveRequest({ data: { data: { photos_downloaded: false } } })
    await polling
    await vi.advanceTimersByTimeAsync(500)

    expect(mockedApi.get).toHaveBeenCalledTimes(1)
    expect(media.pollState.value).toBe('stopped')
  })

  it('stops polling at the attempt bound and records an error terminal state', async () => {
    vi.useFakeTimers()
    mockedApi.get.mockResolvedValue({ data: { data: { photos_downloaded: false } } })
    const media = usePropertyMedia({ apiClient: api, intervalMs: 250, maxAttempts: 2 })

    const polling = media.pollForPhotos('doc-1')
    await vi.advanceTimersByTimeAsync(250)
    await vi.advanceTimersByTimeAsync(250)
    await polling

    expect(mockedApi.get).toHaveBeenCalledTimes(2)
    expect(media.pollState.value).toBe('error')
  })
})
