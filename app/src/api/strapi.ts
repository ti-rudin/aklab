import axios from 'axios'
import type { AxiosInstance } from 'axios'

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:1338/api'

const api: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
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

// Response interceptor — только 401 означает потерю сессии.
export function authResponseError(error: unknown): Promise<never> {
  const status = (error as { response?: { status?: number } })?.response?.status
  if (status === 401) {
    localStorage.removeItem('user')
    localStorage.removeItem('jwt')
    localStorage.removeItem('lastAuthTime')
    if (window.location.pathname !== '/auth') {
      window.location.href = '/auth'
    }
  }
  return Promise.reject(error)
}

api.interceptors.response.use(
  (response) => response,
  authResponseError,
)

export default api
