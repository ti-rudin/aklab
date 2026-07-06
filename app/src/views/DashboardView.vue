<template>
  <div class="max-w-screen-xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
    <div class="flex justify-between items-center mb-8">
      <h1 class="text-2xl font-bold" style="color: var(--text-main)">Дашборд</h1>
      <button @click="refresh" :disabled="loading"
        class="px-3 py-2 rounded-lg text-sm font-medium transition-colors hover:opacity-80"
        style="background: var(--bg-elevated); border: 1px solid var(--border-subtle); color: var(--text-muted)">
        {{ loading ? 'Загрузка…' : '↻ Обновить' }}
      </button>
    </div>

    <!-- Loading -->
    <div v-if="loading && !stats" class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
      <div v-for="i in 2" :key="i" class="skeleton h-24 rounded-xl" />
    </div>

    <template v-else>
      <!-- Статистика -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
        <div @click="router.push('/properties')"
          class="rounded-xl p-5 border cursor-pointer transition-all hover:scale-[1.02]" style="background: var(--bg-elevated); border-color: var(--border-subtle)">
          <p class="text-sm" style="color: var(--text-muted)">Всего объектов</p>
          <p class="text-3xl font-bold mt-1" style="color: var(--text-main)">{{ stats?.total ?? '—' }}</p>
        </div>
        <div @click="router.push('/properties#focus')"
          class="rounded-xl p-5 border cursor-pointer transition-all hover:scale-[1.02] overflow-hidden"
          style="background: var(--bg-elevated); border-color: var(--border-subtle)">
          <p style="color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 0.75rem;">Добавленные в фокус</p>
          <p style="color: var(--accent); white-space: nowrap; font-weight: 700; margin-top: 0.25rem; font-size: clamp(1.2rem, 4vw, 1.875rem);">{{ stats?.inFocus ?? '—' }}</p>
        </div>

      </div>

      <!-- Горячие объекты -->
      <div class="mb-8">
        <div class="rounded-xl p-4 sm:p-6 border" style="background: var(--bg-elevated); border-color: var(--border-subtle)">
          <h2 class="text-lg font-semibold mb-4" style="color: var(--text-main)">🔥 Горячие объекты</h2>
          <div v-if="topProperties.length === 0" class="text-sm" style="color: var(--text-muted)">Нет объектов в фокусе</div>
          <div v-else class="space-y-2 sm:space-y-3">
            <div v-for="p in topProperties" :key="p.documentId"
              @click="$router.push(`/properties/${p.documentId}`)"
              class="flex items-center gap-2 sm:gap-4 p-2.5 sm:p-3 rounded-lg cursor-pointer transition-colors hover:opacity-80"
              style="background: var(--bg-main); border: 1px solid var(--border-subtle)">
              <div class="flex-shrink-0 w-9 h-9 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center text-xs sm:text-sm font-bold"
                :style="{ background: scoreColor(p.focus_score) + '20', color: scoreColor(p.focus_score) }">
                {{ p.focus_score }}
              </div>
              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium truncate" style="color: var(--text-main)">{{ p.title }}</p>
                <p class="text-xs truncate" style="color: var(--text-muted)">{{ p.address || p.city }}</p>
              </div>
              <div class="hidden sm:flex gap-1 flex-shrink-0">
                <span v-for="tag in (p.tags || []).slice(0, 3)" :key="tag"
                  class="text-xs px-1.5 py-0.5 rounded-full"
                  style="background: var(--accent-soft); color: var(--accent)">
                  {{ tag }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Типы недвижимости -->
      <div class="mb-8">
        <div class="rounded-xl p-4 sm:p-6 border" style="background: var(--bg-elevated); border-color: var(--border-subtle)">
          <h2 class="text-lg font-semibold mb-4" style="color: var(--text-main)">📊 Объекты по типам</h2>
          <div v-if="typeBreakdown.length === 0" class="text-sm" style="color: var(--text-muted)">Нет данных</div>
          <div v-else class="flex flex-wrap gap-2 sm:gap-3">
            <button v-for="t in typeBreakdown" :key="t.type"
              @click="router.push(`/properties?property_type=${t.type}`)"
              class="flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-all hover:scale-[1.03]"
              style="background: var(--bg-main); border-color: var(--border-subtle)">
              <span class="text-sm" style="color: var(--text-muted)">{{ t.label }}</span>
              <span class="text-sm font-bold px-2 py-0.5 rounded-full"
                style="background: var(--accent-soft); color: var(--accent)">{{ t.count }}</span>
            </button>
          </div>
        </div>
      </div>


    </template>

    <!-- Ошибка -->
    <p v-if="error" class="mt-4 text-sm text-center" style="color: #fca5a5">{{ error }}</p>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import api from '@/api/strapi'

const router = useRouter()

interface DashboardStats {
  total: number
  inFocus: number
}

interface TopProperty {
  documentId: string
  title: string
  address: string | null
  city: string
  focus_score: number
  tags: string[]
}

interface TypeBreakdown {
  type: string
  label: string
  count: number
}

const loading = ref(true)
const error = ref('')
const stats = ref<DashboardStats | null>(null)
const topProperties = ref<TopProperty[]>([])
const typeBreakdown = ref<TypeBreakdown[]>([])

const TYPE_LABELS: Record<string, string> = {
  free_purpose: 'Своб. назначения',
  land: 'Земельные участки',
  apartment: 'Квартиры',
  office: 'Офисы',
  retail: 'Ритейл',
  warehouse: 'Склады',
  other: 'Прочее',
  commercial: 'Коммерческая',
}

const scoreColor = (score: number) => {
  if (score >= 70) return '#ef4444'
  if (score >= 50) return '#f59e0b'
  return '#4f8cff'
}

async function fetchStats() {
  // Fetch general stats using standard Strapi pagination meta
  try {
    const { data } = await api.get('/properties', { params: { 'pagination[pageSize]': 1 } })
    const total = data.meta?.pagination?.total ?? 0

    // Fetch focus count
    const focusRes = await api.get('/properties/focus', { params: { threshold: 20, pageSize: 1 } })
    const inFocus = focusRes.data.meta?.total ?? 0

    stats.value = { total, inFocus }
  } catch (e: any) {
    error.value = 'Ошибка загрузки статистики'
  }
}

async function fetchTopProperties() {
  try {
    const { data } = await api.get('/properties/focus', {
      params: { threshold: 20, pageSize: 5, sort: '-focus_score' }
    })
    topProperties.value = data.data || []
  } catch { /* ignore */ }
}

async function fetchTypeBreakdown() {
  try {
    const { data } = await api.get('/properties', {
      params: { 'fields[0]': 'property_type', 'pagination[pageSize]': 5000 }
    })
    const counts: Record<string, number> = {}
    for (const p of data.data || []) {
      const t = p.property_type || 'other'
      counts[t] = (counts[t] || 0) + 1
    }
    typeBreakdown.value = Object.entries(counts)
      .map(([type, count]) => ({
        type,
        label: TYPE_LABELS[type] || type,
        count,
      }))
      .sort((a, b) => b.count - a.count)
  } catch { /* ignore */ }
}

async function refresh() {
  loading.value = true
  error.value = ''
  await Promise.all([fetchStats(), fetchTopProperties(), fetchTypeBreakdown()])
  loading.value = false
}

onMounted(refresh)
</script>
