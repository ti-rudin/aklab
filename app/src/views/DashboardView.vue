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

    <!-- Loading skeleton -->
    <div v-if="loading && !stats" class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-8">
      <div v-for="i in 5" :key="i" class="skeleton h-24 rounded-xl" />
    </div>

    <template v-else-if="stats">
      <!-- KPI StatCards -->
      <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-8">
        <StatCard title="Всего объектов" :value="stats.total" icon="🏢" to="/properties" />
        <StatCard title="В фокусе" :value="stats.inFocus" icon="🎯" to="/properties#focus" color="var(--accent)" />
        <StatCard title="Горячие (≥50)" :value="stats.hot" icon="🔥" color="var(--score-hot)" />
        <StatCard title="Недооценённые" :value="stats.undervalued" icon="💎" color="var(--warning)" />
        <StatCard title="Новые 24ч" :value="stats.newToday" icon="🆕" color="var(--success)" />
      </div>

      <!-- Bar chart: property types -->
      <BaseCard v-if="typeEntries.length" padding="lg" class="mb-8">
        <h2 class="text-lg font-semibold mb-4" style="color: var(--text-main)">📊 Объекты по типам</h2>
        <div class="space-y-3">
          <div v-for="entry in typeEntries" :key="entry.type" class="flex items-center gap-3">
            <span class="bar-label">{{ entry.label }}</span>
            <div class="bar-track flex-1">
              <div class="bar-fill" :style="{ width: barWidth(entry.count) + '%' }" />
            </div>
            <span class="bar-count">{{ entry.count }}</span>
          </div>
        </div>
      </BaseCard>

      <!-- Hot properties -->
      <BaseCard padding="lg" class="mb-8">
        <h2 class="text-lg font-semibold mb-4" style="color: var(--text-main)">🔥 Горячие объекты</h2>
        <div v-if="topProperties.length === 0" class="text-sm" style="color: var(--text-muted)">
          Нет объектов в фокусе
        </div>
        <div v-else class="space-y-2 sm:space-y-3">
          <div v-for="p in topProperties" :key="p.documentId"
            @click="$router.push(`/properties/${p.documentId}`)"
            class="flex items-center gap-2 sm:gap-4 p-2.5 sm:p-3 rounded-lg cursor-pointer transition-colors hover:opacity-80"
            style="background: var(--bg-main); border: 1px solid var(--border-subtle)">
            <div class="flex-shrink-0 w-9 h-9 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center text-xs sm:text-sm font-bold"
              :style="{ background: scoreBg(p.focus_score), color: scoreColor(p.focus_score) }">
              {{ p.focus_score }}
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium truncate" style="color: var(--text-main)">{{ p.title }}</p>
              <p class="text-xs truncate" style="color: var(--text-muted)">{{ p.address || p.city }}</p>
            </div>
            <div class="hidden sm:flex gap-1 flex-shrink-0">
              <BaseBadge v-for="tag in (p.tags || []).slice(0, 3)" :key="tag" size="sm">
                {{ tag }}
              </BaseBadge>
            </div>
          </div>
        </div>
      </BaseCard>

      <!-- Parser status mini-widget -->
      <BaseCard v-if="sources.length" padding="md">
        <h2 class="text-base font-semibold mb-3" style="color: var(--text-main)">⚡ Парсеры</h2>
        <div class="flex flex-wrap gap-2">
          <span v-for="src in sources" :key="src.documentId"
            class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
            :style="src.active ? 'background: var(--success-soft); color: var(--success)' : 'background: var(--bg-alt); color: var(--text-muted)'">
            <span class="w-1.5 h-1.5 rounded-full" :style="src.active ? 'background: var(--success)' : 'background: var(--text-muted)'" />
            {{ src.slug || src.name }}
          </span>
        </div>
      </BaseCard>
    </template>

    <!-- Error -->
    <p v-if="error" class="mt-4 text-sm text-center" style="color: #fca5a5">{{ error }}</p>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import api from '@/api/strapi'
import { scoreColor, scoreBg } from '@/utils/styleHelpers'
import { typeLabel } from '@/utils/formatters'
import StatCard from '@/components/ui/StatCard.vue'
import BaseCard from '@/components/ui/BaseCard.vue'
import BaseBadge from '@/components/ui/BaseBadge.vue'

const router = useRouter()

/* ── Types ── */
interface StatsResponse {
  total: number
  inFocus: number
  hot: number
  undervalued: number
  newToday: number
  typeBreakdown: Record<string, number>
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
  documentId: string
  slug?: string
  name?: string
  active?: boolean
}

/* ── State ── */
const loading = ref(true)
const error = ref('')
const stats = ref<StatsResponse | null>(null)
const topProperties = ref<TopProperty[]>([])
const sources = ref<Source[]>([])

/* ── Computed ── */
const typeEntries = computed(() => {
  if (!stats.value?.typeBreakdown) return []
  const entries = Object.entries(stats.value.typeBreakdown)
    .map(([type, count]) => ({ type, label: typeLabel(type), count }))
    .sort((a, b) => b.count - a.count)
  return entries
})

const maxTypeCount = computed(() => {
  if (!typeEntries.value.length) return 1
  return Math.max(...typeEntries.value.map(e => e.count), 1)
})

function barWidth(count: number): number {
  return Math.round((count / maxTypeCount.value) * 100)
}

/* ── Fetchers ── */
async function fetchStats() {
  try {
    const { data } = await api.get('/properties/stats')
    stats.value = data
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
    const { data } = await api.get('/sources')
    sources.value = data.data || data || []
  } catch { /* ignore */ }
}

async function refresh() {
  loading.value = true
  error.value = ''
  await Promise.all([fetchStats(), fetchTopProperties(), fetchSources()])
  loading.value = false
}

onMounted(refresh)
</script>

<style scoped>
.bar-label {
  font-size: 0.75rem;
  color: var(--text-muted);
  min-width: 7rem;
  text-align: right;
  flex-shrink: 0;
}

.bar-track {
  height: 0.625rem;
  border-radius: 9999px;
  background: var(--bg-alt);
  overflow: hidden;
}

.bar-fill {
  height: 100%;
  border-radius: 9999px;
  background: var(--accent);
  transition: width 0.4s ease;
  min-width: 0.25rem;
}

.bar-count {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-main);
  min-width: 2rem;
  text-align: right;
}
</style>
