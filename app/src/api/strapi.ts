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

// Response interceptor — обработка 401 и Strapi Forbidden (500 с "Forbidden")
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const status = error.response?.status
    const msg = error.response?.data?.error?.message || ''
    // Strapi может вернуть 500 с "Forbidden access" вместо 401 при невалидном JWT
    if (status === 401 || (status === 500 && msg.toLowerCase().includes('forbidden'))) {
      localStorage.removeItem('user')
      localStorage.removeItem('jwt')
      localStorage.removeItem('lastAuthTime')
      if (window.location.pathname !== '/auth') {
        window.location.href = '/auth'
      }
    }
    return Promise.reject(error)
  },
)

export default api
