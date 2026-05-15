import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useTheme } from '../useTheme'

// Mock matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: query === '(prefers-color-scheme: dark)',
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

describe('useTheme', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove('dark', 'light')
  })

  it('initializes from localStorage', () => {
    localStorage.setItem('theme', 'dark')
    const { isDark } = useTheme()
    expect(isDark.value).toBe(true)
  })

  it('initializes from system preference when no localStorage', () => {
    const { isDark } = useTheme()
    expect(isDark.value).toBe(true)
  })

  it('toggleTheme toggles isDark', () => {
    const { isDark, toggleTheme } = useTheme()
    const initial = isDark.value
    toggleTheme()
    expect(isDark.value).toBe(!initial)
  })

  it('toggleTheme persists to localStorage', () => {
    const { toggleTheme } = useTheme()
    toggleTheme()
    expect(localStorage.getItem('theme')).toBeDefined()
  })
})
