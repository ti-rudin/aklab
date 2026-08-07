import { defineStore } from 'pinia'
import api from '@/api/strapi'
import { persistAuth, clearPersistedAuth, parseAuthError } from '@/stores/auth-helpers'

export interface User {
  id: number
  email: string
  username: string
}

export interface AuthContextRole {
  type: string
}

export interface AuthContextDto {
  user: User
  role: AuthContextRole | null
  profileReady: boolean
  multiuserEnabled: boolean
}

export interface AuthContextResponse {
  data: AuthContextDto
}

export type AuthContext = AuthContextDto

interface AuthState {
  user: User | null
  token: string | null
  context: AuthContextDto | null
  loading: boolean
  error: string | null
  status: 'in' | 'out'
  isInitialized: boolean
}

type RecordValue = Record<string, unknown>

type ApiError = {
  response?: {
    status?: number
  }
}

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function safeUser(value: unknown): User | null {
  if (
    !isRecord(value)
    || typeof value.id !== 'number'
    || !Number.isSafeInteger(value.id)
    || value.id <= 0
    || typeof value.email !== 'string'
    || typeof value.username !== 'string'
  ) {
    return null
  }
  return {
    id: value.id,
    email: value.email,
    username: value.username,
  }
}

function safeContext(value: unknown): AuthContextDto | null {
  if (!isRecord(value) || !safeUser(value.user)) return null
  const role = value.role
  if (role !== null && role !== undefined && (!isRecord(role) || typeof role.type !== 'string')) return null
  if (typeof value.profileReady !== 'boolean' || typeof value.multiuserEnabled !== 'boolean') return null
  return {
    user: safeUser(value.user)!,
    role: role === null || role === undefined ? null : { type: role.type as string },
    profileReady: value.profileReady,
    multiuserEnabled: value.multiuserEnabled,
  }
}

function responseStatus(error: unknown): number | undefined {
  return (error as ApiError)?.response?.status
}

const getInitialState = (): AuthState => {
  let user: User | null = null
  let token: string | null = null
  let status: 'in' | 'out' = 'out'

  if (typeof localStorage !== 'undefined') {
    const userData = localStorage.getItem('user')
    const jwt = localStorage.getItem('jwt')
    if (userData && jwt) {
      try {
        user = safeUser(JSON.parse(userData))
        if (user) {
          token = jwt
          status = 'in'
        }
      } catch {
        // ignore malformed persisted state
      }
    }
  }

  return { user, token, context: null, loading: false, error: null, status, isInitialized: false }
}

export const useAuthStore = defineStore('auth', {
  state: (): AuthState => getInitialState(),

  getters: {
    isAuthenticated: (state) => !!state.user && !!state.token,
    isAklabAdmin: (state) => state.context?.role?.type === 'aklab_admin',
    profileReady: (state) => state.context?.profileReady === true,
    userEmail: (state) => state.user?.email,
    userId: (state) => state.user?.id,
    userName: (state) => state.user?.username || state.user?.email?.split('@')[0] || 'Пользователь',
  },

  actions: {
    clearSession() {
      clearPersistedAuth()
      this.user = null
      this.token = null
      this.context = null
      this.status = 'out'
    },

    async refreshContext() {
      if (!this.token) {
        this.context = null
        return null
      }

      try {
        const response = await api.get<AuthContextResponse>('/me/context')
        const context = safeContext(response.data?.data)
        if (!context) throw new Error('Некорректный контекст авторизации')
        this.context = context
        this.user = context.user
        this.status = 'in'
        persistAuth(this.user, this.token)
        return context
      } catch (error: unknown) {
        this.context = null
        if (responseStatus(error) === 401) this.clearSession()
        throw error
      }
    },

    async init() {
      this.loading = true
      try {
        const userData = localStorage.getItem('user')
        const token = localStorage.getItem('jwt')
        const cachedUser = userData ? safeUser(JSON.parse(userData)) : null

        if (cachedUser && token) {
          this.user = cachedUser
          this.token = token
          this.status = 'in'
          try {
            await this.refreshContext()
          } catch {
            // 403 and transient context failures preserve the authenticated session.
          }
        } else {
          this.context = null
          this.status = 'out'
        }
      } catch {
        this.clearSession()
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
        const authenticatedUser = safeUser(authResponse.data.user)
        if (!authenticatedUser) throw new Error('Некорректный пользователь')
        const jwt = authResponse.data.jwt as string

        this.user = authenticatedUser
        this.token = jwt
        this.context = null
        this.status = 'in'
        persistAuth(this.user, jwt)

        try {
          await this.refreshContext()
        } catch (error: unknown) {
          if (responseStatus(error) === 401) throw error
          // A 403 must not turn a successful login into a logout.
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
        this.clearSession()
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
