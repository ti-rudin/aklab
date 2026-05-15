<template>
  <div class="max-w-screen-xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
    <div class="flex justify-between items-center mb-8">
      <h1 class="text-2xl font-bold" style="color: var(--text-main)">Замеры</h1>
      <router-link
        to="/zamery/new"
        class="px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all duration-200 hover:opacity-90"
        style="background: var(--accent)"
      >
        + Новый замер
      </router-link>
    </div>

    <!-- Loading -->
    <div v-if="store.loading" class="text-center py-16">
      <p class="text-lg" style="color: var(--text-muted)">Загрузка...</p>
    </div>

    <!-- Список замеров -->
    <div v-else-if="zamery.length === 0" class="text-center py-16">
      <p class="text-lg mb-4" style="color: var(--text-muted)">Пока нет замеров</p>
      <router-link
        to="/zamery/new"
        class="px-6 py-3 rounded-xl text-sm font-semibold text-white transition-all duration-200 hover:opacity-90 inline-block"
        style="background: var(--accent)"
      >
        Создать первый замер
      </router-link>
    </div>

    <div v-else class="space-y-4">
      <div
        v-for="zamer in zamery"
        :key="zamer.documentId"
        class="rounded-xl p-4 border cursor-pointer transition-all duration-200 hover:-translate-y-1"
        style="background: var(--bg-elevated); border-color: var(--border-subtle); box-shadow: var(--shadow-card)"
        @click="router.push(`/zamery/${zamer.documentId}`)"
      >
        <div class="flex justify-between items-start">
          <div>
            <h3 class="font-semibold" style="color: var(--text-main)">{{ zamer.name }}</h3>
            <p class="text-sm mt-1" style="color: var(--text-muted)">{{ zamer.industry }} — {{ zamer.staffTotal }} сотр.</p>
          </div>
          <span class="text-xs px-2 py-1 rounded-full" style="background: var(--accent-soft); color: var(--accent)">
            {{ new Date(zamer.createdAt).toLocaleDateString('ru-RU') }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useZameryStore } from '@/stores/zamery'

const router = useRouter()
const store = useZameryStore()
const zamery = computed(() => store.items)

onMounted(() => {
  store.fetchAll()
})
</script>
