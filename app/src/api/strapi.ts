import axios from 'axios'
import type { AxiosInstance } from 'axios'

const API_BASE_URL = import.meta.env.VITE_API_URL
if (!API_BASE_URL && import.meta.env.PROD) {
  console.error('[api] VITE_API_URL is not set — API calls will fail in production')
}

const api: AxiosInstance = axios.create({
  baseURL: API_BASE_URL || 'http://localhost:1338/api',
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
})

// Request interceptor — добавляем токен
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('jwt')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Дедупликация параллельных 401 — редирект выполняется только один раз
let redirectingTo401 = false

// Response interceptor — только 401 означает потерю сессии.
// Используем динамический импорт store/router чтобы избежать circular deps.
export function authResponseError(error: unknown): Promise<never> {
  const status = (error as { response?: { status?: number } })?.response?.status
  if (status === 401 && !redirectingTo401) {
    redirectingTo401 = true
    // Сбрасываем флаг после навигации (следующий logout должен работать)
    setTimeout(() => { redirectingTo401 = false }, 3000)

    // Синхронизируем store и LocalStorage через единый clearSession
    import('@/stores/auth').then(({ useAuthStore }) => {
      const store = useAuthStore()
      store.clearSession()
    }).catch(() => {
      // Fallback: чистим localStorage напрямую если store недоступен
      localStorage.removeItem('user')
      localStorage.removeItem('jwt')
      localStorage.removeItem('lastAuthTime')
    })

    import('@/router').then(({ default: router }) => {
      if (router.currentRoute.value.name !== 'auth') {
        router.replace({ name: 'auth' })
      }
    }).catch(() => {
      if (window.location.pathname !== '/auth') {
        window.location.href = '/auth'
      }
    })
  }
  return Promise.reject(error)
}

api.interceptors.response.use(
  (response) => response,
  authResponseError,
)

export default api
