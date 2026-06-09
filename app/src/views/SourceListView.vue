<template>
  <div class="max-w-screen-xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-bold" style="color: var(--text)">Источники парсинга</h1>
      <button
        @click="showAddForm = !showAddForm"
        class="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        style="background: var(--accent); color: white"
      >
        {{ showAddForm ? '✕ Закрыть' : '+ Добавить' }}
      </button>
    </div>

    <!-- Форма добавления -->
    <div
      v-if="showAddForm"
      class="rounded-xl p-6 mb-6"
      style="background: var(--card-bg); border: 1px solid var(--border-subtle)"
    >
      <h3 class="text-lg font-semibold mb-4" style="color: var(--text)">Новый источник</h3>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label class="block text-sm mb-1" style="color: var(--text-muted)">Название</label>
          <input v-model="form.name" class="w-full rounded-lg px-3 py-2" style="background: var(--bg); color: var(--text); border: 1px solid var(--border-subtle)" placeholder="Фабрикант" />
        </div>
        <div>
          <label class="block text-sm mb-1" style="color: var(--text-muted)">Slug</label>
          <input v-model="form.slug" class="w-full rounded-lg px-3 py-2" style="background: var(--bg); color: var(--text); border: 1px solid var(--border-subtle)" placeholder="fabrikant" />
        </div>
        <div>
          <label class="block text-sm mb-1" style="color: var(--text-muted)">URL</label>
          <input v-model="form.url" class="w-full rounded-lg px-3 py-2" style="background: var(--bg); color: var(--text); border: 1px solid var(--border-subtle)" placeholder="https://..." />
        </div>
        <div>
          <label class="block text-sm mb-1" style="color: var(--text-muted)">Парсер</label>
          <select v-model="form.parser" @change="onParserChange" class="w-full rounded-lg px-3 py-2" style="background: var(--bg); color: var(--text); border: 1px solid var(--border-subtle)">
            <option v-for="p in availableParsers" :key="p.slug" :value="p.slug">{{ p.slug }}</option>
          </select>
        </div>
        <div>
          <label class="block text-sm mb-1" style="color: var(--text-muted)">Тип торгов</label>
          <select v-model="form.auction_type" class="w-full rounded-lg px-3 py-2" style="background: var(--bg); color: var(--text); border: 1px solid var(--border-subtle)">
            <option value="bankruptcy">Банкротство</option>
            <option value="privatization">Приватизация</option>
            <option value="marketplace">Маркетплейс</option>
          </select>
        </div>
        <div>
          <label class="block text-sm mb-1" style="color: var(--text-muted)">Регион</label>
          <input v-model="form.region" class="w-full rounded-lg px-3 py-2" style="background: var(--bg); color: var(--text); border: 1px solid var(--border-subtle)" placeholder="Москва и МО" />
        </div>
        <div>
          <label class="block text-sm mb-1" style="color: var(--text-muted)">Расписание (cron)</label>
          <input v-model="form.schedule" class="w-full rounded-lg px-3 py-2" style="background: var(--bg); color: var(--text); border: 1px solid var(--border-subtle)" placeholder="0 3 * * *" />
          <span class="text-xs mt-1 block" style="color: var(--text-muted)">{{ describeCron(form.schedule) }}</span>
        </div>
        <div>
          <label class="block text-sm mb-1" style="color: var(--text-muted)">Health порт</label>
          <input v-model.number="form.health_port" type="number" class="w-full rounded-lg px-3 py-2" style="background: var(--bg); color: var(--text); border: 1px solid var(--border-subtle)" placeholder="1345" />
        </div>
      </div>
      <div class="mt-4 flex gap-2">
        <button
          @click="createSource"
          :disabled="!form.name || !form.slug || !form.parser"
          class="px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
          style="background: var(--accent); color: white"
        >
          Создать
        </button>
        <span v-if="error" class="text-sm" style="color: #ef4444">{{ error }}</span>
      </div>
    </div>

    <!-- Загрузка -->
    <div v-if="loading" class="text-center py-12" style="color: var(--text-muted)">Загрузка...</div>

    <!-- Список источников -->
    <div v-else-if="sources.length === 0" class="text-center py-12" style="color: var(--text-muted)">
      Источников пока нет. Добавьте первый!
    </div>

    <div v-else class="grid gap-4">
      <div
        v-for="src in sources"
        :key="src.id"
        class="rounded-xl p-5 transition-all hover:shadow-lg"
        style="background: var(--card-bg); border: 1px solid var(--border-subtle)"
      >
        <div class="flex items-start justify-between gap-4">
          <!-- Левая часть: инфо -->
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-3 mb-2">
              <h3 class="text-lg font-semibold truncate" style="color: var(--text)">{{ src.name }}</h3>
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
                  background: src.is_active ? 'var(--accent-soft)' : 'var(--bg)',
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
                style="background: var(--bg); color: var(--text); border: 1px solid var(--border-subtle)"
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
          <div class="flex items-center gap-4 shrink-0">
            <!-- Статистика -->
            <div class="text-right">
              <div class="text-sm" style="color: var(--text-muted)">Найдено</div>
              <div class="text-xl font-bold" style="color: var(--text)">{{ src.total_found }}</div>
            </div>
            <div class="text-right">
              <div class="text-sm" style="color: var(--text-muted)">Создано</div>
              <div class="text-xl font-bold" style="color: var(--accent)">{{ src.total_created }}</div>
            </div>
            <div class="text-right">
              <div class="text-sm" style="color: var(--text-muted)">Запусков</div>
              <div class="text-xl font-bold" style="color: var(--text)">{{ src.parse_count }}</div>
            </div>

            <!-- Кнопки -->
            <div class="flex flex-col gap-1">
              <button
                @click="toggleActive(src)"
                class="px-3 py-1 rounded text-xs font-medium transition-colors"
                :style="{
                  background: src.is_active ? 'var(--bg)' : 'var(--accent-soft)',
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
          style="background: #fef2f2; color: #991b1b; border: 1px solid #fecaca"
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

interface ParserDef {
  slug: string
  health_port: number
}

const sources = ref<Source[]>([])
const loading = ref(true)
const showAddForm = ref(false)
const error = ref('')
const runningSource = ref<number | null>(null)
const healthStatuses = ref<Record<number, { status: string; error?: string }>>({})

// Schedule editing
const editingSchedule = ref<number | null>(null)
const scheduleEdit = ref('')

// Health polling interval
let healthInterval: ReturnType<typeof setInterval> | null = null

const availableParsers: ParserDef[] = [
  { slug: 'fabrikant', health_port: 1345 },
  { slug: 'torgi-gov', health_port: 1346 },
  { slug: 'fedresurs', health_port: 1347 },
]

const form = ref({
  name: '',
  slug: '',
  url: '',
  parser: 'fabrikant',
  auction_type: 'bankruptcy',
  region: 'Москва и МО',
  schedule: '0 3 * * *',
  health_port: 1345,
})

function onParserChange() {
  const p = availableParsers.find(x => x.slug === form.value.parser)
  if (p) form.value.health_port = p.health_port
}

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
      const res = await api.get(`/sources/${src.id}/health`)
      healthStatuses.value[src.id] = res.data?.data || { status: 'offline' }
    } catch {
      healthStatuses.value[src.id] = { status: 'offline' }
    }
  }
}

async function createSource() {
  error.value = ''
  try {
    await api.post('/sources', { data: form.value })
    showAddForm.value = false
    form.value = { name: '', slug: '', url: '', parser: 'fabrikant', auction_type: 'bankruptcy', region: 'Москва и МО', schedule: '0 3 * * *', health_port: 1345 }
    await fetchSources()
    await fetchHealth()
  } catch (e: any) {
    error.value = e.response?.data?.error?.message || e.message
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
    await api.put(`/sources/${src.documentId}`, { data: { last_parse_status: 'running', last_parse_error: null } })
    await fetchSources()
    await api.post(`/cron/parse/${src.slug}`)
    await new Promise(r => setTimeout(r, 3000))
    await fetchSources()
  } catch (e: any) {
    error.value = `Ошибка запуска: ${e.response?.data?.error?.message || e.message}`
    await api.put(`/sources/${src.documentId}`, { data: { last_parse_status: 'error', last_parse_error: e.message } }).catch(() => {})
    await fetchSources()
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
  if (!src.health_port) return { bg: 'var(--bg)', text: 'var(--text-muted)' }
  if (!h) return { bg: '#fef3c7', text: '#92400e' } // loading — жёлтый
  if (h.status === 'ok') return { bg: '#dcfce7', text: '#166534' }
  return { bg: '#fef2f2', text: '#991b1b' }
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
    case 'success': return { bg: '#dcfce7', text: '#166534' }
    case 'error': return { bg: '#fef2f2', text: '#991b1b' }
    case 'running': return { bg: '#dbeafe', text: '#1e40af' }
    default: return { bg: 'var(--bg)', text: 'var(--text-muted)' }
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

/**
 * Human-readable описание cron-выражения (простая версия).
 */
function describeCron(expr: string): string {
  if (!expr) return ''
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return expr

  const [min, hour, dom, mon, dow] = parts

  // Каждый час
  if (min === '0' && hour === '*' && dom === '*' && mon === '*' && dow === '*')
    return 'каждый час'

  // Каждые N минут
  if (min.startsWith('*/') && hour === '*')
    return `каждые ${min.slice(2)} мин`

  // Конкретное время ежедневно
  if (dom === '*' && mon === '*' && dow === '*' && hour !== '*' && min !== '*') {
    const h = hour.padStart(2, '0')
    const m = min.padStart(2, '0')
    return `ежедневно в ${h}:${m}`
  }

  // По дням недели
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
  // Polling health каждые 30 секунд
  healthInterval = setInterval(fetchHealth, 30000)
})

onUnmounted(() => {
  if (healthInterval) clearInterval(healthInterval)
})
</script>
