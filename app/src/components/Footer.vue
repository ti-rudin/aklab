<template>
  <footer
    class="border-t"
    style="background: var(--bg-elevated); border-color: var(--border-subtle); min-height: 200px"
    role="contentinfo"
  >
    <div class="max-w-screen-xl mx-auto px-4 sm:px-6 lg:px-8 pt-12 pb-6">
      <!-- Основной контент -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-8 mb-8">
        <!-- Продукт -->
        <div>
          <h3 class="font-bold text-lg mb-4" style="color: var(--text-main)">Продукт</h3>
          <ul class="space-y-3">
            <li>
              <router-link to="/" class="text-sm hover:opacity-80 transition-opacity" style="color: var(--text-muted)">
                Главная
              </router-link>
            </li>
            <li>
              <router-link to="/zamery" class="text-sm hover:opacity-80 transition-opacity" style="color: var(--text-muted)">
                Замеры
              </router-link>
            </li>
            <li>
              <router-link to="/settings" class="text-sm hover:opacity-80 transition-opacity" style="color: var(--text-muted)">
                Настройки
              </router-link>
            </li>
          </ul>
        </div>

        <!-- Компания -->
        <div>
          <h3 class="font-bold text-lg mb-4" style="color: var(--text-main)">Компания</h3>
          <ul class="space-y-3">
            <li>
              <a href="https://todoit.ru" target="_blank" class="text-sm hover:opacity-80 transition-opacity" style="color: var(--text-muted)">
                Сайт TODOIT
              </a>
            </li>
            <li>
              <a href="https://todoit.ru/privacy.html" target="_blank" class="text-sm hover:opacity-80 transition-opacity" style="color: var(--text-muted)">
                Политика конфиденциальности
              </a>
            </li>
          </ul>
        </div>

        <!-- Поддержка -->
        <div>
          <h3 class="font-bold text-lg mb-4" style="color: var(--text-main)">Поддержка</h3>
          <ul class="space-y-3">
            <li>
              <a href="mailto:tirobots@yandex.ru" class="text-sm hover:opacity-80 transition-opacity" style="color: var(--text-muted)">
                tirobots@yandex.ru
              </a>
            </li>
          </ul>
        </div>
      </div>

      <!-- Нижняя строка -->
      <div class="border-t pt-6 flex flex-col md:flex-row justify-between items-center gap-4" style="border-color: var(--border-subtle)">
        <p class="text-sm" style="color: var(--text-muted)">
          &copy; {{ new Date().getFullYear() }} TODOIT. Все права защищены.
        </p>
        <router-link
          :to="isAuthenticated ? '/zamery' : '/auth'"
          class="px-6 py-2 rounded-xl text-sm font-semibold text-white transition-all duration-200 hover:opacity-90"
          style="background: var(--accent)"
        >
          Начать
        </router-link>
      </div>
    </div>
  </footer>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useAuthStore } from '@/stores/auth'

const authStore = useAuthStore()
const isAuthenticated = computed(() => authStore.isAuthenticated)
</script>
