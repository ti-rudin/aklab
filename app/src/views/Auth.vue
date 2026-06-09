<template>
  <div class="min-h-screen flex items-center justify-center px-4 py-8" style="background: var(--bg-main)">
    <div class="w-full max-w-md relative z-10">
      <div class="rounded-2xl p-6 sm:p-8" style="background: var(--bg-elevated); box-shadow: var(--shadow-soft);">
        <!-- Логотип -->
        <div class="flex justify-center mb-4">
          <span class="text-3xl font-bold" style="color: var(--text-main)">AKLAB</span>
        </div>

        <!-- Заголовок -->
        <div class="text-center mb-6">
          <h1 class="text-2xl font-bold mb-2" style="color: var(--text-main)">
            {{ isLoginMode ? 'Вход в личный кабинет' : 'Регистрация' }}
          </h1>
          <p class="text-sm" style="color: var(--text-muted)">
            {{ isLoginMode ? 'Введите данные для входа' : 'Создайте аккаунт' }}
          </p>
        </div>

        <!-- Форма -->
        <form @submit.prevent="handleSubmit" class="space-y-4 mb-6">
          <!-- Email -->
          <div>
            <label for="email" class="block text-sm font-semibold mb-1" style="color: var(--text-main)">Email</label>
            <input
              id="email"
              v-model="formData.email"
              type="email"
              required
              autocomplete="email"
              class="w-full px-3 py-2 rounded-lg border focus:outline-none focus:ring-2"
              style="background: var(--bg-alt); border-color: var(--border-subtle); color: var(--text-main); --tw-ring-color: var(--accent)"
              placeholder="your@email.com"
            />
          </div>

          <!-- Пароль (только для входа) -->
          <div v-if="isLoginMode">
            <label for="password" class="block text-sm font-semibold mb-1" style="color: var(--text-main)">Пароль</label>
            <input
              id="password"
              v-model="formData.password"
              type="password"
              required
              autocomplete="current-password"
              class="w-full px-3 py-2 rounded-lg border focus:outline-none focus:ring-2"
              style="background: var(--bg-alt); border-color: var(--border-subtle); color: var(--text-main); --tw-ring-color: var(--accent)"
              placeholder="Введите пароль"
            />
          </div>

          <!-- Инфо о регистрации -->
          <div v-if="!isLoginMode" class="rounded-lg p-3 border" style="background: var(--accent-soft); border-color: var(--accent)">
            <p class="text-sm" style="color: var(--accent)">Пароль будет сгенерирован автоматически и отправлен на email.</p>
          </div>

          <!-- Ошибка -->
          <div v-if="error" class="rounded-lg p-3 border" style="background: rgba(239, 68, 68, 0.1); border-color: rgba(239, 68, 68, 0.3)">
            <p class="text-sm" style="color: #fca5a5">{{ error }}</p>
          </div>

          <!-- Успех -->
          <div v-if="successMessage" class="rounded-lg p-3 border" style="background: rgba(16, 185, 129, 0.1); border-color: rgba(16, 185, 129, 0.3)">
            <p class="text-sm" style="color: #6ee7b7">{{ successMessage }}</p>
          </div>

          <!-- Кнопка -->
          <button
            type="submit"
            :disabled="loading"
            class="w-full py-3 px-4 rounded-xl text-sm font-semibold text-white transition-all duration-200 hover:opacity-90 disabled:opacity-50"
            style="background: var(--accent)"
          >
            <span v-if="loading" class="flex items-center justify-center">
              <svg class="animate-spin h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              {{ isLoginMode ? 'Вход...' : 'Регистрация...' }}
            </span>
            <span v-else>{{ isLoginMode ? 'Войти' : 'Зарегистрироваться' }}</span>
          </button>
        </form>

        <!-- Переключение режима -->
        <div class="text-center">
          <button
            @click="toggleMode"
            type="button"
            class="text-sm font-medium hover:opacity-80"
            style="color: var(--accent)"
          >
            {{ isLoginMode ? 'Нет аккаунта? Зарегистрироваться' : 'Уже есть аккаунт? Войти' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const authStore = useAuthStore()

const loading = ref(false)
const error = ref('')
const successMessage = ref('')
const isLoginMode = ref(true)

const formData = reactive({
  email: '',
  password: '',
})

const handleLogin = async () => {
  loading.value = true
  error.value = ''
  try {
    await authStore.loginWithEmail(formData.email, formData.password)
    router.push('/properties')
  } catch {
    error.value = authStore.error || 'Ошибка входа'
  } finally {
    loading.value = false
  }
}

const handleRegister = async () => {
  if (!formData.email) {
    error.value = 'Email обязателен'
    return
  }
  loading.value = true
  error.value = ''
  try {
    await authStore.register(formData.email)
    successMessage.value = 'Регистрация успешна! Пароль отправлен на email.'
    formData.email = ''
    isLoginMode.value = true
  } catch {
    error.value = authStore.error || 'Ошибка регистрации'
  } finally {
    loading.value = false
  }
}

const toggleMode = () => {
  isLoginMode.value = !isLoginMode.value
  error.value = ''
  successMessage.value = ''
  formData.email = ''
  formData.password = ''
}

const handleSubmit = () => {
  if (isLoginMode.value) handleLogin()
  else handleRegister()
}
</script>
