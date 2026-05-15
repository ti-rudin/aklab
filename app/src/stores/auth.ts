import { defineStore } from 'pinia'
import api from '@/api/strapi'
import { persistAuth, clearPersistedAuth, parseAuthError } from '@/stores/auth-helpers'

interface User {
  id: number
  email: string
  username: string
  [key: string]: unknown
}

interface AuthState {
  user: User | null
  token: string | null
  loading: boolean
  error: string | null
  status: 'in' | 'out'
  isInitialized: boolean
}

const getInitialState = (): AuthState => {
  let user = null
  let token = null
  let status: 'in' | 'out' = 'out'

  if (typeof localStorage !== 'undefined') {
    const userData = localStorage.getItem('user')
    const jwt = localStorage.getItem('jwt')
    if (userData && jwt) {
      try {
        user = JSON.parse(userData)
        token = jwt
        status = 'in'
      } catch {
        // ignore
      }
    }
  }

  return { user, token, loading: false, error: null, status, isInitialized: false }
}

export const useAuthStore = defineStore('auth', {
  state: (): AuthState => getInitialState(),

  getters: {
    isAuthenticated: (state) => !!state.user && !!state.token,
    userEmail: (state) => state.user?.email,
    userId: (state) => state.user?.id,
    userName: (state) => state.user?.username || state.user?.email?.split('@')[0] || 'Пользователь',
  },

  actions: {
    async init() {
      this.loading = true
      try {
        const userData = localStorage.getItem('user')
        const token = localStorage.getItem('jwt')

        if (userData && token) {
          this.user = JSON.parse(userData)
          this.token = token
          this.status = 'in'

          try {
            const response = await api.get('/users/me?populate=role')
            if (response.data) {
              this.user = { ...this.user, ...response.data }
              persistAuth(this.user!, this.token!)
            }
          } catch (error: unknown) {
            const err = error as { response?: { status?: number } }
            if (err.response?.status === 401) {
              this.user = null
              this.token = null
              this.status = 'out'
              clearPersistedAuth()
            }
          }
        } else {
          this.status = 'out'
        }
      } catch {
        this.logout()
      } finally {
        this.isInitialized = true
        this.loading = false
      }
      return this.user
    },

    async loginWithEmail(email: string, password: string) {
      this.loading = true
      this.error = null

      try {
        const authResponse = await api.post('/auth/local', {
          identifier: email,
          password,
        })

        if (!authResponse.data?.jwt) {
          throw new Error('Токен не получен')
        }

        this.user = authResponse.data.user
        this.token = authResponse.data.jwt
        this.status = 'in'
        persistAuth(this.user!, this.token!)

        // Доп. данные пользователя
        try {
          const userResponse = await api.get('/users/me?populate=role')
          if (userResponse.data) {
            this.user = { ...this.user, ...userResponse.data }
            localStorage.setItem('user', JSON.stringify(this.user))
          }
        } catch {
          // не критично
        }

        return this.user
      } catch (error: unknown) {
        this.error = parseAuthError(error, 'login')
        throw error
      } finally {
        this.loading = false
      }
    },

    async register(email: string) {
      this.loading = true
      this.error = null

      try {
        const response = await api.post('/auth/local/register', {
          username: email,
          email,
        })

        if (!response.data?.user) {
          throw new Error('Ошибка регистрации')
        }

        return { success: true, email }
      } catch (error: unknown) {
        this.error = parseAuthError(error, 'register')
        throw error
      } finally {
        this.loading = false
      }
    },

    async logout() {
      this.loading = true
      try {
        clearPersistedAuth()
        this.user = null
        this.token = null
        this.status = 'out'
        this.error = null
      } finally {
        this.loading = false
      }
    },

    clearError() {
      this.error = null
    },
  },
})
