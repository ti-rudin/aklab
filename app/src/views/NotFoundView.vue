<template>
  <div class="min-h-[60vh] flex flex-col items-center justify-center px-4 text-center">
    <div class="mb-6">
      <span class="text-8xl font-bold tracking-tighter" style="color: var(--accent)">404</span>
    </div>
    <h1 class="text-2xl font-semibold mb-3" style="color: var(--text-main)">Страница не найдена</h1>
    <p class="text-sm mb-8 max-w-md" style="color: var(--text-muted)">
      Возможно, адрес введён неправильно или страница была удалена.
    </p>
    <router-link
      to="/properties"
      class="btn-primary px-6 py-3 rounded-xl text-sm font-semibold text-white"
      style="background: var(--accent)"
    >
      Перейти к объектам
    </router-link>
  </div>
</template>
