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

    <div v-if="loading && !stats && !profileNotReady" class="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
      <div v-for="i in 4" :key="i" class="skeleton h-24 rounded-xl" />
    </div>

    <div v-else-if="profileNotReady" class="rounded-xl border p-6 text-center" style="background: var(--bg-elevated); border-color: var(--border-subtle)">
      <p class="text-lg font-semibold" style="color: var(--text-main)">Профиль ещё не готов</p>
      <p class="mt-2 text-sm" style="color: var(--text-muted)">Статистика и объекты станут доступны после подготовки профиля.</p>
    </div>

    <template v-else-if="stats">
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        <StatCard title="Всего объектов" :value="stats.total" icon="🏢" to="/properties" />
        <StatCard title="В фокусе" :value="stats.inFocus" icon="🎯" to="/properties#focus" color="var(--accent)" />
        <StatCard title="Горячие (≥50)" :value="stats.hot" icon="🔥" to="/properties?tab=focus" color="var(--score-hot)" />
        <StatCard title="Новые 24ч" :value="stats.newToday" icon="🆕" to="/properties?status=new" color="var(--success)" />
      </div>

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

      <BaseCard padding="lg" class="mb-8">
        <h2 class="text-lg font-semibold mb-4" style="color: var(--text-main)">🔥 Горячие объекты</h2>
        <div v-if="topProperties.length === 0" class="text-sm" style="color: var(--text-muted)">
          Нет объектов в фокусе
        </div>
        <div v-else class="space-y-2 sm:space-y-3">
          <div v-for="p in topProperties" :key="p.documentId"
            @click="router.push(`/properties/${p.documentId}`)"
            class="flex items-center gap-2 sm:gap-4 p-2.5 sm:p-3 rounded-lg cursor-pointer transition-colors hover:opacity-80"
            style="background: var(--bg-main); border: 1px solid var(--border-subtle)">
            <div class="flex-shrink-0 w-9 h-9 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center text-xs sm:text-sm font-bold"
              :style="{ background: scoreBg(p.focus_score), color: scoreColor(p.focus_score) }">
              {{ p.focus_score }}
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium truncate" style="color: var(--text-main)">{{ p.title }}</p>
              <p class="text-xs truncate" style="color: var(--text-muted)">{{ p.address || p.city }}</p>
              <p class="text-xs truncate" style="color: var(--text-muted)">Источник: {{ p.source || 'не указан' }}</p>
            </div>
            <div class="hidden sm:flex gap-1 flex-shrink-0">
              <BaseBadge v-for="tag in (p.tags || []).filter(t => !HIDDEN_TAGS.includes(t)).slice(0, 3)" :key="tag" size="sm">
                {{ tagLabel(tag) }}
              </BaseBadge>
            </div>
          </div>
        </div>
      </BaseCard>
    </template>

    <p v-if="error" class="mt-4 text-sm text-center" style="color: #fca5a5">{{ error }}</p>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import api from '@/api/strapi'
import { scoreColor, scoreBg } from '@/utils/styleHelpers'
import { typeLabel, tagLabel } from '@/utils/formatters'
import { HIDDEN_TAGS } from '@/composables/useFocusTab'
import StatCard from '@/components/ui/StatCard.vue'
import BaseCard from '@/components/ui/BaseCard.vue'
import BaseBadge from '@/components/ui/BaseBadge.vue'
import { useToast } from '@/composables/useToast'

const router = useRouter()
const toast = useToast()

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
  source?: string | null
  tags: string[]
}

const loading = ref(true)
const error = ref('')
const profileNotReady = ref(false)
const stats = ref<StatsResponse | null>(null)
const topProperties = ref<TopProperty[]>([])

const typeEntries = computed(() => {
  if (!stats.value?.typeBreakdown) return []
  return Object.entries(stats.value.typeBreakdown)
    .map(([type, count]) => ({ type, label: typeLabel(type), count }))
    .sort((a, b) => b.count - a.count)
})

const maxTypeCount = computed(() => Math.max(...typeEntries.value.map(entry => entry.count), 1))
function barWidth(count: number): number {
  return Math.round((count / maxTypeCount.value) * 100)
}

function isProfileNotReady(error: any): boolean {
  return error?.response?.status === 409
}

async function fetchStats() {
  try {
    const { data } = await api.get('/properties/stats')
    stats.value = data
  } catch (e: any) {
    if (isProfileNotReady(e)) {
      profileNotReady.value = true
      stats.value = null
      return
    }
    error.value = 'Ошибка загрузки статистики'
  }
}

async function fetchTopProperties() {
  try {
    const { data } = await api.get('/properties/focus', {
      params: { page: 1, pageSize: 5, sort: '-focus_score' },
    })
    topProperties.value = data.data || []
  } catch (e: any) {
    if (isProfileNotReady(e)) {
      profileNotReady.value = true
      return
    }
    toast.error('Ошибка загрузки горячих объектов')
  }
}

async function refresh() {
  loading.value = true
  error.value = ''
  profileNotReady.value = false
  await Promise.all([fetchStats(), fetchTopProperties()])
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
