import { beforeEach, describe, expect, it } from 'vitest'
import { authResponseError } from '../strapi'

describe('strapi auth response interceptor', () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('user', JSON.stringify({ id: 7 }))
    localStorage.setItem('jwt', 'token')
    localStorage.setItem('lastAuthTime', 'now')
    window.history.pushState({}, '', '/properties')
  })

  it('clears persisted auth and redirects only for an exact 401', async () => {
    window.history.pushState({}, '', '/auth')
    const error = { response: { status: 401 } }

    await expect(authResponseError(error)).rejects.toBe(error)

    expect(localStorage.getItem('user')).toBeNull()
    expect(localStorage.getItem('jwt')).toBeNull()
    expect(localStorage.getItem('lastAuthTime')).toBeNull()
  })

  it.each([
    { status: 403, data: { error: { message: 'Forbidden' } } },
    { status: 500, data: { error: { message: 'Forbidden' } } },
    { status: 500, data: { error: { message: 'Forbidden access' } } },
  ])('preserves persisted auth for non-401 response %#', async (response) => {
    const error = { response }

    await expect(authResponseError(error)).rejects.toBe(error)

    expect(localStorage.getItem('user')).not.toBeNull()
    expect(localStorage.getItem('jwt')).toBe('token')
    expect(localStorage.getItem('lastAuthTime')).toBe('now')
  })
})
