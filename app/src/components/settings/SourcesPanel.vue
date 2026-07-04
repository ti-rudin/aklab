<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <h2 class="text-lg font-semibold" style="color: var(--text-main)">Источники парсинга</h2>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="space-y-4">
      <div v-for="i in 4" :key="i" class="skeleton h-24 rounded-xl" />
    </div>

    <!-- Пустой список -->
    <div v-else-if="sources.length === 0" class="text-center py-12" style="color: var(--text-muted)">
      Источников пока нет.
    </div>

    <!-- Список источников -->
    <div v-else class="grid gap-4">
      <div
        v-for="src in sources"
        :key="src.id"
        class="rounded-xl p-4 sm:p-5 transition-all hover:shadow-lg"
        style="background: var(--bg-elevated); border: 1px solid var(--border-subtle)"
      >
        <div class="flex flex-col sm:flex-row items-start justify-between gap-4">
          <!-- Левая часть: инфо -->
          <div class="flex-1 min-w-0 w-full sm:w-auto">
            <div class="flex flex-wrap items-center gap-2 sm:gap-3 mb-2">
              <h3 class="text-base sm:text-lg font-semibold truncate" style="color: var(--text-main)">{{ src.name }}</h3>
              <!-- Health badge -->
              <span
                class="px-2 py-0.5 rounded-full text-xs font-medium"
                :style="{
                  background: healthColor(src).bg,
                  color: healthColor(src).text
                }"
              >
                {{ healthLabel(src) }}
              </span>
              <span
                class="px-2 py-0.5 rounded-full text-xs font-medium"
                :style="{
                  background: src.is_active ? 'var(--accent-soft)' : 'var(--bg-main)',
                  color: src.is_active ? 'var(--accent)' : 'var(--text-muted)'
                }"
              >
                {{ src.is_active ? 'Активен' : 'Выключен' }}
              </span>
              <span
                class="px-2 py-0.5 rounded-full text-xs font-medium"
                :style="{
                  background: statusColor(src.last_parse_status).bg,
                  color: statusColor(src.last_parse_status).text
                }"
              >
                {{ statusLabel(src.last_parse_status) }}
              </span>
            </div>
            <div class="flex flex-wrap gap-x-6 gap-y-1 text-sm" style="color: var(--text-muted)">
              <span>{{ src.parser }}</span>
              <span>{{ src.url }}</span>
              <span v-if="src.region">{{ src.region }}</span>
            </div>
            <!-- Расписание -->
            <div class="flex items-center gap-2 mt-2">
              <span class="text-xs" style="color: var(--text-muted)">🕐 {{ src.schedule || '0 3 * * *' }}</span>
              <span class="text-xs" style="color: var(--text-muted)">({{ describeCron(src.schedule || '0 3 * * *') }})</span>
              <button
                v-if="editingSchedule !== src.id"
                @click="startEditSchedule(src)"
                class="text-xs px-2 py-0.5 rounded transition-colors"
                style="color: var(--accent); border: 1px solid var(--border-subtle)"
              >
                Изменить
              </button>
            </div>
            <!-- Inline редактирование расписания -->
            <div v-if="editingSchedule === src.id" class="flex items-center gap-2 mt-2">
              <input
                v-model="scheduleEdit"
                class="w-32 rounded px-2 py-1 text-xs"
                style="background: var(--bg-main); color: var(--text-main); border: 1px solid var(--border-subtle)"
                placeholder="0 3 * * *"
              />
              <span class="text-xs" style="color: var(--text-muted)">{{ describeCron(scheduleEdit) }}</span>
              <button
                @click="saveSchedule(src)"
                class="text-xs px-2 py-0.5 rounded font-medium"
                style="background: var(--accent); color: white"
              >
                ✓
              </button>
              <button
                @click="editingSchedule = null"
                class="text-xs px-2 py-0.5 rounded"
                style="color: var(--text-muted); border: 1px solid var(--border-subtle)"
              >
                ✕
              </button>
            </div>
          </div>

          <!-- Правая часть: статистика + действия -->
          <div class="flex items-center gap-3 sm:gap-4 shrink-0 w-full sm:w-auto justify-between sm:justify-end">
            <!-- Статистика -->
            <div class="flex gap-3 sm:gap-4">
              <div class="text-center sm:text-right">
                <div class="text-xs sm:text-sm" style="color: var(--text-muted)">Найдено</div>
                <div class="text-lg sm:text-xl font-bold" style="color: var(--text-main)">{{ src.total_found }}</div>
              </div>
              <div class="text-center sm:text-right">
                <div class="text-xs sm:text-sm" style="color: var(--text-muted)">Создано</div>
                <div class="text-lg sm:text-xl font-bold" style="color: var(--accent)">{{ src.total_created }}</div>
              </div>
              <div class="text-center sm:text-right">
                <div class="text-xs sm:text-sm" style="color: var(--text-muted)">Запусков</div>
                <div class="text-lg sm:text-xl font-bold" style="color: var(--text-main)">{{ src.parse_count }}</div>
              </div>
            </div>

            <!-- Кнопки -->
            <div class="flex flex-row sm:flex-col gap-1">
              <button
                @click="toggleActive(src)"
                class="px-3 py-1 rounded text-xs font-medium transition-colors"
                :style="{
                  background: src.is_active ? 'var(--bg-main)' : 'var(--accent-soft)',
                  color: src.is_active ? 'var(--text-muted)' : 'var(--accent)',
                  border: '1px solid var(--border-subtle)'
                }"
              >
                {{ src.is_active ? 'Выключить' : 'Включить' }}
              </button>
              <button
                @click="runParser(src)"
                :disabled="runningSource === src.id"
                class="px-3 py-1 rounded text-xs font-medium transition-colors disabled:opacity-50"
                style="background: var(--accent); color: white"
              >
                {{ runningSource === src.id ? '⏳ Парсинг...' : '▶ Запустить' }}
              </button>
            </div>
          </div>
        </div>

        <!-- Последняя ошибка -->
        <div
          v-if="src.last_parse_error"
          class="mt-3 px-3 py-2 rounded text-xs"
          style="background: rgba(239, 68, 68, 0.1); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.2)"
        >
          {{ src.last_parse_error }}
        </div>

        <!-- Время последнего парсинга -->
        <div v-if="src.last_parsed_at" class="mt-2 text-xs" style="color: var(--text-muted)">
          Последний парсинг: {{ formatDate(src.last_parsed_at) }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import api from '@/api/strapi'

interface Source {
  id: number
  documentId: string
  name: string
  slug: string
  url: string
  parser: string
  is_active: boolean
  auction_type: string
  region: string
  schedule: string
  health_port: number | null
  last_parsed_at: string | null
  last_parse_status: 'success' | 'error' | 'running' | 'never'
  last_parse_error: string | null
  total_found: number
  total_created: number
  parse_count: number
}

const sources = ref<Source[]>([])
const loading = ref(true)
const error = ref('')
const runningSource = ref<number | null>(null)
const healthStatuses = ref<Record<number, { status: string; error?: string }>>({})

// Schedule editing
const editingSchedule = ref<number | null>(null)
const scheduleEdit = ref('')

// Health polling interval
let healthInterval: ReturnType<typeof setInterval> | null = null

async function fetchSources() {
  loading.value = true
  try {
    const res = await api.get('/sources?sort=createdAt:desc&pagination[pageSize]=100')
    sources.value = res.data?.data || []
  } catch (e: any) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

async function fetchHealth() {
  for (const src of sources.value) {
    if (!src.health_port) continue
    try {
      const res = await api.get(`/sources/${src.documentId}/health`)
      healthStatuses.value[src.id] = res.data?.data || { status: 'offline' }
    } catch {
      healthStatuses.value[src.id] = { status: 'offline' }
    }
  }
}

async function toggleActive(src: Source) {
  try {
    await api.put(`/sources/${src.documentId}`, { data: { is_active: !src.is_active } })
    await fetchSources()
  } catch (e: any) {
    error.value = e.message
  }
}

async function runParser(src: Source) {
  runningSource.value = src.id
  error.value = ''
  try {
    await api.post(`/cron/parse/${src.slug}`)
    await fetchSources()
    for (let i = 0; i < 24; i++) {
      await new Promise(r => setTimeout(r, 5000))
      await fetchSources()
      const updated = sources.value.find(s => s.id === src.id)
      if (updated && updated.last_parse_status !== 'running') break
    }
  } catch (e: any) {
    error.value = `Ошибка запуска: ${e.response?.data?.error?.message || e.message}`
  } finally {
    runningSource.value = null
  }
}

function startEditSchedule(src: Source) {
  editingSchedule.value = src.id
  scheduleEdit.value = src.schedule || '0 3 * * *'
}

async function saveSchedule(src: Source) {
  try {
    await api.put(`/sources/${src.documentId}`, { data: { schedule: scheduleEdit.value } })
    editingSchedule.value = null
    await fetchSources()
  } catch (e: any) {
    error.value = `Ошибка сохранения расписания: ${e.message}`
  }
}

function healthColor(src: Source) {
  const h = healthStatuses.value[src.id]
  if (!src.health_port) return { bg: 'var(--bg-main)', text: 'var(--text-muted)' }
  if (!h) return { bg: 'rgba(251, 191, 36, 0.15)', text: '#f59e0b' }
  if (h.status === 'ok') return { bg: 'rgba(16, 185, 129, 0.15)', text: '#10b981' }
  return { bg: 'rgba(239, 68, 68, 0.15)', text: '#ef4444' }
}

function healthLabel(src: Source) {
  const h = healthStatuses.value[src.id]
  if (!src.health_port) return '⚪ Нет порта'
  if (!h) return '⏳ Проверка...'
  if (h.status === 'ok') return '🟢 Сервис ОК'
  return '🔴 Сервис оффлайн'
}

function statusColor(status: string) {
  switch (status) {
    case 'success': return { bg: 'rgba(16, 185, 129, 0.15)', text: '#10b981' }
    case 'error': return { bg: 'rgba(239, 68, 68, 0.15)', text: '#ef4444' }
    case 'running': return { bg: 'rgba(79, 140, 255, 0.15)', text: '#4f8cff' }
    default: return { bg: 'var(--bg-main)', text: 'var(--text-muted)' }
  }
}

function statusLabel(status: string) {
  switch (status) {
    case 'success': return '✅ Успешно'
    case 'error': return '❌ Ошибка'
    case 'running': return '⏳ Работает'
    default: return '— Не запускался'
  }
}

function formatDate(iso: string) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function describeCron(expr: string): string {
  if (!expr) return ''
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return expr

  const min = parts[0] || '*'
  const hour = parts[1] || '*'
  const dom = parts[2] || '*'
  const mon = parts[3] || '*'
  const dow = parts[4] || '*'

  if (min === '0' && hour === '*' && dom === '*' && mon === '*' && dow === '*')
    return 'каждый час'

  if (min.startsWith('*/') && hour === '*')
    return `каждые ${min.slice(2)} мин`

  if (dom === '*' && mon === '*' && dow === '*' && hour !== '*' && min !== '*') {
    const h = hour.padStart(2, '0')
    const m = min.padStart(2, '0')
    return `ежедневно в ${h}:${m}`
  }

  if (dom === '*' && mon === '*' && dow !== '*') {
    const days = dow.split(',').map(d => {
      const n = parseInt(d)
      return ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'][n] || d
    })
    return `по ${days.join(',')} в ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`
  }

  return expr
}

onMounted(async () => {
  await fetchSources()
  await fetchHealth()
  healthInterval = setInterval(fetchHealth, 30000)
})

onUnmounted(() => {
  if (healthInterval) clearInterval(healthInterval)
})
</script>
