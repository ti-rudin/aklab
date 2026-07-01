<template>
  <div class="flex flex-col min-h-screen">
    <!-- Skip to content (a11y) -->
    <a href="#main-content" class="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-2 focus:bg-blue-600 focus:text-white focus:rounded">
      Перейти к содержимому
    </a>

    <!-- Header -->
    <nav
      class="sticky top-0 z-50 glass border-b"
      style="border-color: var(--border-subtle)"
      role="navigation"
    >
      <div class="max-w-screen-xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="flex justify-between h-16 items-center">
          <!-- Логотип -->
          <div class="flex items-center gap-6">
            <router-link to="/" class="flex items-center" aria-label="AKLAB — на главную">
              <span
                class="text-xl font-bold"
                :style="{
                  background: isDark
                    ? 'linear-gradient(110deg, #6d829e 0%, #9eb2cc 12%, #d2deef 24%, #ffffff 34%, #e8eef8 42%, #a4b6ce 52%, #f5f8fd 64%, #8fa4be 78%, #c5d3e6 100%)'
                    : 'linear-gradient(110deg, #1e3a5f 0%, #2563eb 30%, #4f8cff 55%, #1e40af 80%, #3b82f6 100%)',
                  '-webkit-background-clip': 'text',
                  '-webkit-text-fill-color': 'transparent',
                  'background-clip': 'text'
                }"
              >
                AKLAB
              </span>
            </router-link>

            <!-- Нав-ссылки (authenticated) -->
            <div v-if="isAuthenticated" class="hidden sm:flex items-center gap-1">
              <router-link
                v-for="item in navItems"
                :key="item.to"
                :to="item.to"
                :aria-label="item.ariaLabel || item.label"
                class="px-3 py-2 rounded-lg text-sm font-medium transition-colors duration-200"
                :class="isActive(item.to) ? 'font-semibold' : 'hover:opacity-80'"
                :style="{
                  color: isActive(item.to) ? 'var(--accent)' : 'var(--text-muted)',
                  background: isActive(item.to) ? 'var(--accent-soft)' : 'transparent'
                }"
              >
                {{ item.label }}
              </router-link>
            </div>
          </div>

          <!-- Кнопки справа -->
          <div class="flex items-center gap-2">
            <!-- Гамбургер (mobile) -->
            <button
              v-if="isAuthenticated"
              @click="mobileMenuOpen = !mobileMenuOpen"
              class="sm:hidden p-2 rounded-lg transition-colors duration-200 hover:opacity-80"
              style="color: var(--text-muted)"
              aria-label="Меню"
            >
              <svg v-if="!mobileMenuOpen" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
              <svg v-else class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <!-- Тема -->
            <button
              @click="toggleTheme"
              aria-label="Переключить тему"
              class="p-2 rounded-lg transition-colors duration-200 hover:opacity-80"
              style="color: var(--text-muted)"
            >
              <svg v-if="isDark" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
              <svg v-else class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
            </button>

            <!-- Auth (desktop) -->
            <template v-if="isAuthenticated">
              <button
                @click="handleLogout"
                class="hidden sm:block px-3 py-2 rounded-lg text-sm font-medium transition-colors duration-200 hover:opacity-80"
                style="color: var(--text-muted)"
              >
                Выйти
              </button>
            </template>
            <template v-else>
              <router-link
                to="/auth"
                class="px-3 py-2 rounded-lg text-sm font-semibold transition-colors duration-200 hover:opacity-80"
                style="color: var(--accent)"
              >
                Войти
              </router-link>
            </template>
          </div>
        </div>
      </div>
    </nav>

    <!-- Mobile menu -->
    <transition name="slide-down">
      <div
        v-if="mobileMenuOpen && isAuthenticated"
        class="sm:hidden glass border-b"
        style="border-color: var(--border-subtle); background: var(--bg-elevated)"
      >
        <div class="px-4 py-3 space-y-1">
          <router-link
            v-for="item in navItems"
            :key="item.to"
            :to="item.to"
            :aria-label="item.ariaLabel || item.label"
            @click="mobileMenuOpen = false"
            class="block px-3 py-2 rounded-lg text-sm font-medium transition-colors duration-200"
            :class="isActive(item.to) ? 'font-semibold' : 'hover:opacity-80'"
            :style="{
              color: isActive(item.to) ? 'var(--accent)' : 'var(--text-muted)',
              background: isActive(item.to) ? 'var(--accent-soft)' : 'transparent'
            }"
          >
            {{ item.label }}
          </router-link>
          <button
            @click="handleLogout"
            class="w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors duration-200 hover:opacity-80"
            style="color: var(--text-muted)"
          >
            Выйти
          </button>
        </div>
      </div>
    </transition>

    <!-- Main content -->
    <main id="main-content" tabindex="-1" class="flex-grow">
      <router-view v-slot="{ Component, route }">
        <transition name="page" mode="out-in">
          <component :is="Component" :key="route.path" />
        </transition>
      </router-view>
    </main>

    <!-- Screen reader announcements -->
    <div aria-live="polite" class="sr-only"></div>

    <!-- Footer -->
    <Footer />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useTheme } from '@/composables/useTheme'
import Footer from '@/components/Footer.vue'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const { isDark, toggleTheme } = useTheme()

const isAuthenticated = computed(() => authStore.isAuthenticated)

const mobileMenuOpen = ref(false)

const navItems = [
  { to: '/', label: 'Дашборд' },
  { to: '/properties', label: 'Объекты' },
  { to: '/rules', label: 'Правила' },
  { to: '/sources', label: 'Парсеры', ariaLabel: 'Источники' },
  { to: '/market-references', label: 'Эталоны' },
  { to: '/settings', label: 'Настройки' },
]

const isActive = (path: string) => {
  if (path === '/') return route.path === '/'
  return route.path.startsWith(path)
}

// Закрываем мобильное меню при смене маршрута
watch(() => route.path, () => {
  mobileMenuOpen.value = false
})

const handleLogout = async () => {
  await authStore.logout()
  mobileMenuOpen.value = false
  router.push('/')
}
</script>

<style scoped>
.slide-down-enter-active,
.slide-down-leave-active {
  transition: all 0.2s ease;
  overflow: hidden;
}
.slide-down-enter-from,
.slide-down-leave-to {
  opacity: 0;
  max-height: 0;
}
.slide-down-enter-to,
.slide-down-leave-from {
  opacity: 1;
  max-height: 300px;
}
</style>
