import { describe, expect, it } from 'vitest'
import { isMultiuserEnabled } from '../multiuser-feature'

describe('isMultiuserEnabled', () => {
  it('enables only the exact string true', () => {
    expect(isMultiuserEnabled({ MULTIUSER_ENABLED: 'true' })).toBe(true)
  })

  it.each([undefined, '', 'false', '0', '1', 'yes', 'enabled', ' true ', 'TRUE', '\tTrUe\n', ' true-ish '])(
    'fails closed for %s',
    (value) => {
      expect(isMultiuserEnabled({ MULTIUSER_ENABLED: value })).toBe(false)
    },
  )

  it('fails closed for non-string invalid values without throwing', () => {
    expect(() =>
      isMultiuserEnabled({ MULTIUSER_ENABLED: null as unknown as string }),
    ).not.toThrow()
    expect(isMultiuserEnabled({ MULTIUSER_ENABLED: null as unknown as string })).toBe(false)
    expect(isMultiuserEnabled({ MULTIUSER_ENABLED: true as unknown as string })).toBe(false)
  })

  it('reads the current value on every call', () => {
    const env: NodeJS.ProcessEnv = { MULTIUSER_ENABLED: 'true' }

    expect(isMultiuserEnabled(env)).toBe(true)
    env.MULTIUSER_ENABLED = 'false'
    expect(isMultiuserEnabled(env)).toBe(false)
    env.MULTIUSER_ENABLED = ' TRUE '
    expect(isMultiuserEnabled(env)).toBe(false)
  })

  it('does not mutate process.env', () => {
    const before = process.env.MULTIUSER_ENABLED

    expect(isMultiuserEnabled({ MULTIUSER_ENABLED: 'true' })).toBe(true)
    expect(process.env.MULTIUSER_ENABLED).toBe(before)
  })

  it('reads process.env by default without caching its value', () => {
    const before = process.env.MULTIUSER_ENABLED

    try {
      process.env.MULTIUSER_ENABLED = 'true'
      expect(isMultiuserEnabled()).toBe(true)
      process.env.MULTIUSER_ENABLED = 'false'
      expect(isMultiuserEnabled()).toBe(false)
    } finally {
      if (before === undefined) {
        delete process.env.MULTIUSER_ENABLED
      } else {
        process.env.MULTIUSER_ENABLED = before
      }
    }
  })
})
