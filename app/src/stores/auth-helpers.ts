export function persistAuth(user: Record<string, unknown>, token: string) {
  localStorage.setItem('user', JSON.stringify(user))
  localStorage.setItem('jwt', token)
  localStorage.setItem('lastAuthTime', Date.now().toString())
}

export function clearPersistedAuth() {
  localStorage.removeItem('user')
  localStorage.removeItem('jwt')
  localStorage.removeItem('lastAuthTime')
}

export function parseAuthError(error: unknown, context: 'login' | 'register'): string {
  const defaults: Record<string, string> = {
    login: 'Ошибка входа. Проверьте данные.',
    register: 'Ошибка регистрации. Попробуйте ещё раз.',
  }

  const err = error as { response?: { status?: number; data?: { error?: { message?: string }; message?: string } }; message?: string }

  if (!err.response) {
    if (err.message?.includes('Network Error') || err.message?.includes('timeout')) {
      return 'Ошибка сети. Проверьте подключение к интернету.'
    }
    return String(err.message ?? defaults[context])
  }

  const status = err.response.status
  const data = err.response.data
  const dataMessage: string | undefined = data?.error?.message
  const message: string = (dataMessage || data?.message || '').toLowerCase()

  if (status === 400) {
    if (context === 'login') {
      if (message.includes('invalid identifier or password')) {
        return 'Неверный email или пароль.'
      }
      return String(dataMessage || 'Неверный email или пароль.')
    }
    if (message.includes('email') && message.includes('taken')) {
      return 'Пользователь с таким email уже зарегистрирован.'
    }
    if (message.includes('email') && message.includes('required')) {
      return 'Email обязателен для регистрации.'
    }
    return String(dataMessage || defaults[context])
  }

  if (status === 401) return 'Ошибка авторизации. Проверьте email и пароль.'
  if (status === 403) return context === 'register' ? 'Регистрация временно недоступна.' : 'Доступ запрещён.'
  if (status === 404 && context === 'login') return 'Пользователь с таким email не найден.'
  if (status === 429) return 'Слишком много попыток. Попробуйте позже.'

  return String(dataMessage || defaults[context])
}