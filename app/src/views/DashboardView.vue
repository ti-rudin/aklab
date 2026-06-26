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
    <div v-if="loading && !stats" class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
      <div v-for="i in 3" :key="i" class="skeleton h-24 rounded-xl" />
    </div>

    <template v-else>
      <!-- Статистика -->
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div class="rounded-xl p-5 border" style="background: var(--bg-elevated); border-color: var(--border-subtle)">
          <p class="text-sm" style="color: var(--text-muted)">Всего объектов</p>
          <p class="text-3xl font-bold mt-1" style="color: var(--text-main)">{{ stats?.total ?? '—' }}</p>
        </div>
        <div class="rounded-xl p-5 border" style="background: var(--bg-elevated); border-color: var(--border-subtle)">
          <p class="text-sm" style="color: var(--text-muted)">В фокусе</p>
          <p class="text-3xl font-bold mt-1" style="color: var(--accent)">{{ stats?.inFocus ?? '—' }}</p>
        </div>
        <div class="rounded-xl p-5 border" style="background: var(--bg-elevated); border-color: var(--border-subtle)">
          <p class="text-sm" style="color: var(--text-muted)">Средний скор</p>
          <p class="text-3xl font-bold mt-1" style="color: var(--text-main)">{{ stats?.avgScore ?? '—' }}</p>
        </div>
      </div>

      <!-- Горячие объекты + Быстрые действия -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <!-- Топ-5 -->
        <div class="lg:col-span-2 rounded-xl p-6 border" style="background: var(--bg-elevated); border-color: var(--border-subtle)">
          <h2 class="text-lg font-semibold mb-4" style="color: var(--text-main)">🔥 Горячие объекты</h2>
          <div v-if="topProperties.length === 0" class="text-sm" style="color: var(--text-muted)">Нет объектов в фокусе</div>
          <div v-else class="space-y-3">
            <div v-for="p in topProperties" :key="p.documentId"
              @click="$router.push(`/properties/${p.documentId}`)"
              class="flex items-center gap-4 p-3 rounded-lg cursor-pointer transition-colors hover:opacity-80"
              style="background: var(--bg-main); border: 1px solid var(--border-subtle)">
              <div class="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold"
                :style="{ background: scoreColor(p.focus_score) + '20', color: scoreColor(p.focus_score) }">
                {{ p.focus_score }}
              </div>
              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium truncate" style="color: var(--text-main)">{{ p.title }}</p>
                <p class="text-xs truncate" style="color: var(--text-muted)">{{ p.address || p.city }}</p>
              </div>
              <div class="flex gap-1 flex-shrink-0">
                <span v-for="tag in (p.tags || []).slice(0, 3)" :key="tag"
                  class="text-xs px-1.5 py-0.5 rounded-full"
                  style="background: var(--accent-soft); color: var(--accent)">
                  {{ tag }}
                </span>
              </div>
            </div>
          </div>
        </div>

        <!-- Быстрые действия -->
        <div class="rounded-xl p-6 border" style="background: var(--bg-elevated); border-color: var(--border-subtle)">
          <h2 class="text-lg font-semibold mb-4" style="color: var(--text-main)">Действия</h2>
          <div class="space-y-3">
            <button @click="runParsing" :disabled="actionLoading"
              class="w-full px-4 py-3 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90 disabled:opacity-50"
              style="background: var(--accent)">
              {{ actionLoading === 'parse' ? 'Запуск…' : '▶ Запустить парсинг' }}
            </button>
            <button @click="runScoring" :disabled="actionLoading"
              class="w-full px-4 py-3 rounded-xl text-sm font-semibold transition-all hover:opacity-90 disabled:opacity-50"
              style="background: var(--bg-main); border: 1px solid var(--border-subtle); color: var(--text-main)">
              {{ actionLoading === 'score' ? 'Запуск…' : '🔄 Пересчитать выборку' }}
            </button>
          </div>
          <p v-if="actionMsg" class="text-xs mt-3" style="color: var(--accent)">{{ actionMsg }}</p>
        </div>
      </div>

      <!-- Источники + Тренд -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- Статус источников -->
        <div class="rounded-xl p-6 border" style="background: var(--bg-elevated); border-color: var(--border-subtle)">
          <h2 class="text-lg font-semibold mb-4" style="color: var(--text-main)">Источники</h2>
          <div v-if="sources.length === 0" class="text-sm" style="color: var(--text-muted)">Нет источников</div>
          <div v-else class="space-y-2">
            <div v-for="s in sources" :key="s.slug"
              class="flex items-center gap-3 p-2 rounded-lg"
              style="background: var(--bg-main)">
              <span class="w-2.5 h-2.5 rounded-full flex-shrink-0"
                :style="{ background: s.is_active && s.last_parse_status === 'ok' ? '#10b981' : s.last_parse_status === 'error' ? '#ef4444' : '#6b7280' }" />
              <span class="text-sm flex-1" style="color: var(--text-main)">{{ s.slug }}</span>
              <span class="text-xs" style="color: var(--text-muted)">{{ formatTime(s.last_parsed_at) }}</span>
            </div>
          </div>
        </div>

        <!-- 7-дневный тренд -->
        <div class="rounded-xl p-6 border" style="background: var(--bg-elevated); border-color: var(--border-subtle)">
          <h2 class="text-lg font-semibold mb-4" style="color: var(--text-main)">📈 Тренд (7 дней)</h2>
          <div v-if="trend.length === 0" class="text-sm" style="color: var(--text-muted)">Нет данных</div>
          <div v-else class="space-y-2">
            <div v-for="t in trend" :key="t.date"
              class="flex items-center gap-3">
              <span class="text-xs w-20" style="color: var(--text-muted)">{{ formatDate(t.date) }}</span>
              <div class="flex-1 h-6 rounded-lg overflow-hidden" style="background: var(--bg-main)">
                <div class="h-full rounded-lg transition-all duration-500"
                  :style="{ width: trendBarWidth(t.count) + '%', background: 'var(--accent)' }" />
              </div>
              <span class="text-sm font-mono w-8 text-right" style="color: var(--text-main)">{{ t.count }}</span>
            </div>
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
import api from '@/api/strapi'

interface DashboardStats {
  total: number
  inFocus: number
  avgScore: string
}

interface TopProperty {
  documentId: string
  title: string
  address: string | null
  city: string
  focus_score: number
  tags: string[]
}

interface Source {
  slug: string
  is_active: boolean
  last_parse_status: string | null
  last_parsed_at: string | null
}

interface TrendDay {
  date: string
  count: number
}

const loading = ref(true)
const error = ref('')
const stats = ref<DashboardStats | null>(null)
const topProperties = ref<TopProperty[]>([])
const sources = ref<Source[]>([])
const trend = ref<TrendDay[]>([])
const actionLoading = ref<string | false>(false)
const actionMsg = ref('')

const scoreColor = (score: number) => {
  if (score >= 70) return '#ef4444'
  if (score >= 50) return '#f59e0b'
  return '#4f8cff'
}

const formatTime = (d: string | null) => {
  if (!d) return '—'
  return new Date(d).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

const formatDate = (d: string) => {
  return new Date(d).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
}

const trendBarWidth = (count: number) => {
  const max = Math.max(...trend.value.map(t => t.count), 1)
  return Math.round((count / max) * 100)
}

async function fetchStats() {
  // Fetch general stats using standard Strapi pagination meta
  try {
    const { data } = await api.get('/properties', { params: { 'pagination[pageSize]': 1 } })
    const total = data.meta?.pagination?.total ?? 0

    // Fetch focus count
    const focusRes = await api.get('/properties/focus', { params: { threshold: 20, pageSize: 1 } })
    const inFocus = focusRes.data.meta?.total ?? 0

    // Average score from focus endpoint top items
    const avgRes = await api.get('/properties/focus', { params: { threshold: 0, pageSize: 100, sort: '-focus_score' } })
    const items = avgRes.data.data || []
    const avgScore = items.length > 0
      ? (items.reduce((s: number, i: any) => s + (i.focus_score || 0), 0) / items.length).toFixed(1)
      : '0'

    stats.value = { total, inFocus, avgScore }
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

async function fetchSources() {
  try {
    const { data } = await api.get('/cron/queue-stats')
    sources.value = data.sources || []
  } catch { /* ignore */ }
}

async function fetchTrend() {
  try {
    // Get events of type 'entered_focus' from last 7 days
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const { data } = await api.get('/property-events', {
      params: {
        'filters[event_type][$eq]': 'entered_focus',
        'filters[createdAt][$gte]': since,
        'sort': 'createdAt:desc',
        'pagination[pageSize]': 100,
      }
    })
    // Group by date
    const byDate: Record<string, number> = {}
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000)
      byDate[d.toISOString().slice(0, 10)] = 0
    }
    for (const evt of data.data || []) {
      const day = evt.createdAt?.slice(0, 10)
      if (day && byDate[day] !== undefined) byDate[day]++
    }
    trend.value = Object.entries(byDate).map(([date, count]) => ({ date, count }))
  } catch { /* ignore */ }
}

async function refresh() {
  loading.value = true
  error.value = ''
  await Promise.all([fetchStats(), fetchTopProperties(), fetchSources(), fetchTrend()])
  loading.value = false
}

async function runParsing() {
  actionLoading.value = 'parse'
  actionMsg.value = ''
  try {
    // Parse all active sources
    const { data } = await api.get('/sources', { params: { 'filters[is_active][$eq]': true, 'pagination[pageSize]': 50 } })
    const activeSources = data.data || []
    for (const s of activeSources) {
      await api.post(`/cron/parse/${s.slug}`)
    }
    actionMsg.value = `Запущен парсинг ${activeSources.length} источников`
  } catch (e: any) {
    actionMsg.value = 'Ошибка: ' + (e.response?.data?.error?.message || e.message)
  } finally {
    actionLoading.value = false
  }
}

async function runScoring() {
  actionLoading.value = 'score'
  actionMsg.value = ''
  try {
    await api.post('/cron/score')
    actionMsg.value = 'Скоринг запущен'
  } catch (e: any) {
    actionMsg.value = 'Ошибка: ' + (e.response?.data?.error?.message || e.message)
  } finally {
    actionLoading.value = false
  }
}

onMounted(refresh)
</script>
