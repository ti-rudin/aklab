<template>
  <div class="max-w-screen-xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
    <h1 class="text-2xl font-bold mb-8" style="color: var(--text-main)">Настройки</h1>

    <div class="rounded-xl p-6 border" style="background: var(--bg-elevated); border-color: var(--border-subtle)">
      <div class="space-y-6">
        <!-- Профиль -->
        <div>
          <h2 class="text-lg font-semibold mb-4" style="color: var(--text-main)">Профиль</h2>
          <div class="space-y-3">
            <div class="flex justify-between items-center py-2 border-b" style="border-color: var(--border-subtle)">
              <span style="color: var(--text-muted)">Email</span>
              <span style="color: var(--text-main)">{{ authStore.userEmail || '—' }}</span>
            </div>
            <div class="flex justify-between items-center py-2 border-b" style="border-color: var(--border-subtle)">
              <span style="color: var(--text-muted)">Имя</span>
              <span style="color: var(--text-main)">{{ authStore.userName || '—' }}</span>
            </div>
          </div>
        </div>

        <!-- Тема -->
        <div>
          <h2 class="text-lg font-semibold mb-4" style="color: var(--text-main)">Внешний вид</h2>
          <div class="flex items-center justify-between py-2">
            <span style="color: var(--text-muted)">Тёмная тема</span>
            <button
              @click="toggleTheme"
              class="relative w-12 h-6 rounded-full transition-colors duration-200"
              :style="{ background: isDark ? 'var(--accent)' : 'var(--border-subtle)' }"
            >
              <span
                class="absolute top-0.5 left-0.5 w-5 h-5 rounded-full transition-transform duration-200"
                style="background: white"
                :style="{ transform: isDark ? 'translateX(24px)' : 'translateX(0)' }"
              />
            </button>
          </div>
        </div>

        <!-- Эталоны -->
        <div class="pt-4 border-t" style="border-color: var(--border-subtle)">
          <router-link
            to="/market-references"
            class="flex items-center justify-between py-2 group"
          >
            <span style="color: var(--text-muted)">Эталоны стоимости ₽/м²</span>
            <span class="text-sm group-hover:underline" style="color: var(--accent)">Открыть →</span>
          </router-link>
        </div>

        <!-- Выход -->
        <div class="pt-4 border-t" style="border-color: var(--border-subtle)">
          <button
            @click="handleLogout"
            class="px-4 py-2 rounded-xl text-sm font-semibold border transition-all duration-200 hover:opacity-80"
            style="border-color: rgba(239, 68, 68, 0.3); color: #fca5a5"
          >
            Выйти
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useTheme } from '@/composables/useTheme'

const router = useRouter()
const authStore = useAuthStore()
const { isDark, toggleTheme } = useTheme()

const handleLogout = async () => {
  await authStore.logout()
  router.push('/')
}
</script>
