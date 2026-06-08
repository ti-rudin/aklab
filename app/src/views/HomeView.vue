<template>
  <div class="flex flex-col items-center justify-center min-h-[60vh] px-4">
    <h1 class="text-4xl font-bold mb-4" style="color: var(--text-main)">AKLAB</h1>
    <p class="text-lg mb-8" style="color: var(--text-muted)">Система замеров и аналитики</p>
    <div class="flex gap-4">
      <router-link
        to="/auth"
        class="px-6 py-3 rounded-xl text-sm font-semibold text-white transition-all duration-200 hover:opacity-90"
        style="background: var(--accent)"
      >
        Войти
      </router-link>
    </div>
  </div>
</template>
