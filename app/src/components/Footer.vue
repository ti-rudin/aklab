<template>
  <footer
    class="border-t"
    style="background: var(--bg-elevated); border-color: var(--border-subtle)"
    role="contentinfo"
  >
    <div class="max-w-screen-xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div class="grid grid-cols-1 md:grid-cols-3 gap-8 mb-6">
        <!-- Продукт -->
        <div>
          <h3 class="font-bold text-sm mb-3 uppercase tracking-wider" style="color: var(--text-muted)">Продукт</h3>
          <ul class="space-y-2">
            <li>
              <router-link to="/properties" class="text-sm hover:opacity-80 transition-opacity" style="color: var(--text-muted)">
                Объекты
              </router-link>
            </li>
            <li>
              <router-link to="/sources" class="text-sm hover:opacity-80 transition-opacity" style="color: var(--text-muted)">
                Источники
              </router-link>
            </li>
            <li>
              <router-link to="/market-references" class="text-sm hover:opacity-80 transition-opacity" style="color: var(--text-muted)">
                Рыночные эталоны
              </router-link>
            </li>
            <li>
              <router-link to="/settings" class="text-sm hover:opacity-80 transition-opacity" style="color: var(--text-muted)">
                Настройки
              </router-link>
            </li>
          </ul>
        </div>

        <!-- Поддержка -->
        <div>
          <h3 class="font-bold text-sm mb-3 uppercase tracking-wider" style="color: var(--text-muted)">Поддержка</h3>
          <ul class="space-y-2">
            <li>
              <a href="mailto:tirobots@yandex.ru" class="text-sm hover:opacity-80 transition-opacity" style="color: var(--text-muted)">
                tirobots@yandex.ru
              </a>
            </li>
          </ul>
        </div>

        <!-- Инфо -->
        <div>
          <h3 class="font-bold text-sm mb-3 uppercase tracking-wider" style="color: var(--text-muted)">AKLAB</h3>
          <p class="text-sm" style="color: var(--text-muted)">
            Мониторинг коммерческой недвижимости.
            Автоматический поиск объектов ниже рыночной цены.
          </p>
          <router-link to="/changelog" class="text-sm hover:opacity-80 transition-opacity mt-2 inline-block" style="color: var(--text-muted)">
            Changelog
          </router-link>
        </div>
      </div>

      <div class="border-t pt-4" style="border-color: var(--border-subtle)">
        <p class="text-xs text-center" style="color: var(--text-muted)">
          &copy; {{ new Date().getFullYear() }} AKLAB
        </p>
      </div>
    </div>
  </footer>
</template>
