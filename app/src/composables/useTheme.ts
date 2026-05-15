import { ref, watch, onMounted } from 'vue'

export function useTheme() {
  const initializeTheme = (): boolean => {
    if (typeof window === 'undefined') return true
    const saved = localStorage.getItem('theme')
    if (saved) return saved === 'dark'
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  }

  const isDark = ref(initializeTheme())

  const applyTheme = () => {
    if (typeof document === 'undefined') return
    const html = document.documentElement
    if (isDark.value) {
      html.classList.add('dark')
      html.classList.remove('light')
      html.removeAttribute('data-theme')
    } else {
      html.classList.remove('dark')
      html.classList.add('light')
      html.setAttribute('data-theme', 'light')
    }
  }

  // Применяем сразу
  if (typeof document !== 'undefined') applyTheme()

  const toggleTheme = () => {
    isDark.value = !isDark.value
  }

  watch(isDark, () => {
    localStorage.setItem('theme', isDark.value ? 'dark' : 'light')
    applyTheme()
  })

  onMounted(() => applyTheme())

  return { isDark, toggleTheme }
}
