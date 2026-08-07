import { describe, expect, it } from 'vitest'
import { requiresAdmin } from '../index'

describe('requiresAdmin router guard', () => {
  it.each([
    [{ isAuthenticated: false, isAklabAdmin: false }, { name: 'auth' }],
    [{ isAuthenticated: true, isAklabAdmin: false }, { name: 'properties' }],
  ])('returns the correct redirect for %o', (auth, expected) => {
    expect(requiresAdmin(auth)).toEqual(expected)
  })

  it('allows an authenticated exact admin context', () => {
    expect(requiresAdmin({ isAuthenticated: true, isAklabAdmin: true })).toBeUndefined()
  })
})
