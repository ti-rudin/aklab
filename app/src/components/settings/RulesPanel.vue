<template>
  <div>
    <div class="flex justify-between items-center mb-6">
      <h2 class="text-lg font-semibold" style="color: var(--text-main)">Правила фокуса</h2>
      <button @click="openCreate"
        class="px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90"
        style="background: var(--accent)">
        + Новое правило
      </button>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="space-y-3">
      <div v-for="i in 5" :key="i" class="skeleton h-16 rounded-xl" />
    </div>

    <!-- Список правил -->
    <div v-else-if="rules.length > 0" class="space-y-3">
      <div v-for="rule in rules" :key="rule.documentId"
        class="rounded-xl p-4 border flex flex-col sm:flex-row sm:items-center gap-3 transition-colors"
        :style="{ background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)', opacity: rule.is_active ? 1 : 0.5 }">
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 mb-1">
            <span class="font-semibold text-sm" style="color: var(--text-main)">{{ rule.name }}</span>
            <span class="text-xs px-2 py-0.5 rounded-full" style="background: var(--accent-soft); color: var(--accent)">
              +{{ rule.score }} очк.
            </span>
            <span class="text-xs px-2 py-0.5 rounded-full" style="background: var(--bg-main); color: var(--text-muted)">
              {{ rule.tag }}
            </span>
          </div>
          <p class="text-xs" style="color: var(--text-muted)">{{ conditionLabel(rule.condition_type) }}: {{ rule.condition_value || '—' }}</p>
          <p v-if="rule.description" class="text-xs mt-1" style="color: var(--text-muted)">{{ rule.description }}</p>
        </div>
        <div class="flex items-center gap-2 flex-shrink-0">
          <!-- Toggle -->
          <button @click="toggleRule(rule)"
            class="relative w-10 h-5 rounded-full transition-colors"
            :style="{ background: rule.is_active ? 'var(--accent)' : 'var(--border-subtle)' }">
            <span class="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform shadow"
              :style="{ left: rule.is_active ? '22px' : '2px' }" />
          </button>
          <!-- Edit -->
          <button @click="openEdit(rule)"
            class="p-2 rounded-lg transition-colors hover:opacity-80"
            style="color: var(--text-muted)">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
          <!-- Delete -->
          <button @click="deleteRule(rule)"
            class="p-2 rounded-lg transition-colors hover:opacity-80"
            style="color: #ef4444">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>
    </div>

    <div v-else class="text-center py-16">
      <p class="text-lg" style="color: var(--text-muted)">Нет правил</p>
      <p class="text-sm mt-2" style="color: var(--text-muted)">Создайте первое правило для расчёта фокуса</p>
    </div>

    <!-- Модалка создания/редактирования -->
    <div v-if="modal.open" class="fixed inset-0 z-50 flex items-center justify-center p-4" style="background: rgba(0,0,0,0.5)">
      <div class="w-full max-w-lg rounded-xl p-6 border" style="background: var(--bg-elevated); border-color: var(--border-subtle)">
        <h2 class="text-lg font-semibold mb-4" style="color: var(--text-main)">
          {{ modal.editing ? 'Редактировать правило' : 'Новое правило' }}
        </h2>
        <form @submit.prevent="saveRule" class="space-y-4">
          <div>
            <label class="block text-sm mb-1" style="color: var(--text-muted)">Название *</label>
            <input v-model="form.name" required
              class="w-full px-3 py-2 rounded-lg border text-sm"
              style="background: var(--bg-main); border-color: var(--border-subtle); color: var(--text-main)" />
          </div>
          <div>
            <label class="block text-sm mb-1" style="color: var(--text-muted)">Описание</label>
            <textarea v-model="form.description" rows="2"
              class="w-full px-3 py-2 rounded-lg border text-sm"
              style="background: var(--bg-main); border-color: var(--border-subtle); color: var(--text-main)" />
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-sm mb-1" style="color: var(--text-muted)">Тип условия *</label>
              <select v-model="form.condition_type" required
                class="w-full px-3 py-2 rounded-lg border text-sm"
                style="background: var(--bg-main); border-color: var(--border-subtle); color: var(--text-main)">
                <option value="deviation_threshold">Порог отклонения</option>
                <option value="has_field">Наличие поля</option>
                <option value="city_match">Совпадение города</option>
                <option value="custom">Произвольное</option>
              </select>
            </div>
            <div>
              <label class="block text-sm mb-1" style="color: var(--text-muted)">Значение условия</label>
              <input v-model="form.condition_value"
                class="w-full px-3 py-2 rounded-lg border text-sm"
                style="background: var(--bg-main); border-color: var(--border-subtle); color: var(--text-main)" />
            </div>
          </div>
          <div class="grid grid-cols-3 gap-4">
            <div>
              <label class="block text-sm mb-1" style="color: var(--text-muted)">Очки *</label>
              <input v-model.number="form.score" type="number" required min="1"
                class="w-full px-3 py-2 rounded-lg border text-sm"
                style="background: var(--bg-main); border-color: var(--border-subtle); color: var(--text-main)" />
            </div>
            <div>
              <label class="block text-sm mb-1" style="color: var(--text-muted)">Тег *</label>
              <input v-model="form.tag" required
                class="w-full px-3 py-2 rounded-lg border text-sm"
                style="background: var(--bg-main); border-color: var(--border-subtle); color: var(--text-main)" />
            </div>
            <div>
              <label class="block text-sm mb-1" style="color: var(--text-muted)">Приоритет</label>
              <input v-model.number="form.priority" type="number" min="0"
                class="w-full px-3 py-2 rounded-lg border text-sm"
                style="background: var(--bg-main); border-color: var(--border-subtle); color: var(--text-main)" />
            </div>
          </div>
          <div class="flex justify-end gap-3 mt-6">
            <button type="button" @click="modal.open = false"
              class="px-4 py-2 rounded-xl text-sm font-medium transition-colors hover:opacity-80"
              style="background: var(--bg-main); border: 1px solid var(--border-subtle); color: var(--text-main)">
              Отмена
            </button>
            <button type="submit" :disabled="saving"
              class="px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90 disabled:opacity-50"
              style="background: var(--accent)">
              {{ saving ? 'Сохранение…' : 'Сохранить' }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <p v-if="error" class="mt-4 text-sm text-center" style="color: #fca5a5">{{ error }}</p>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import api from '@/api/strapi'

interface FocusRule {
  documentId: string
  name: string
  description: string | null
  condition_type: string
  condition_value: string | null
  score: number
  tag: string
  is_active: boolean
  priority: number
}

const rules = ref<FocusRule[]>([])
const loading = ref(true)
const saving = ref(false)
const error = ref('')
const modal = reactive({ open: false, editing: false, editDocId: '' })

const defaultForm = () => ({
  name: '',
  description: '',
  condition_type: 'deviation_threshold',
  condition_value: '',
  score: 10,
  tag: '',
  priority: 0,
})
const form = reactive(defaultForm())

const conditionLabel = (t: string) => ({
  deviation_threshold: 'Порог отклонения',
  has_field: 'Наличие поля',
  city_match: 'Город',
  custom: 'Произвольное',
})[t] || t

async function fetchRules() {
  loading.value = true
  try {
    const { data } = await api.get('/focus-rules', {
      params: { sort: 'priority:asc', 'pagination[pageSize]': 100 }
    })
    rules.value = data.data || []
  } catch (e: any) {
    error.value = 'Ошибка загрузки правил'
  } finally {
    loading.value = false
  }
}

function openCreate() {
  modal.open = true
  modal.editing = false
  modal.editDocId = ''
  Object.assign(form, defaultForm())
}

function openEdit(rule: FocusRule) {
  modal.open = true
  modal.editing = true
  modal.editDocId = rule.documentId
  form.name = rule.name
  form.description = rule.description || ''
  form.condition_type = rule.condition_type
  form.condition_value = rule.condition_value || ''
  form.score = rule.score
  form.tag = rule.tag
  form.priority = rule.priority
}

async function saveRule() {
  saving.value = true
  error.value = ''
  try {
    const payload = {
      name: form.name,
      description: form.description || null,
      condition_type: form.condition_type,
      condition_value: form.condition_value || null,
      score: form.score,
      tag: form.tag,
      priority: form.priority,
    }
    if (modal.editing) {
      await api.put(`/focus-rules/${modal.editDocId}`, { data: payload })
    } else {
      await api.post('/focus-rules', { data: { ...payload, is_active: true } })
    }
    modal.open = false
    await fetchRules()
  } catch (e: any) {
    error.value = e.response?.data?.error?.message || 'Ошибка сохранения'
  } finally {
    saving.value = false
  }
}

async function toggleRule(rule: FocusRule) {
  try {
    await api.put(`/focus-rules/${rule.documentId}`, {
      data: { is_active: !rule.is_active }
    })
    rule.is_active = !rule.is_active
  } catch (e: any) {
    error.value = 'Ошибка переключения'
  }
}

async function deleteRule(rule: FocusRule) {
  if (!confirm(`Удалить правило «${rule.name}»?`)) return
  try {
    await api.delete(`/focus-rules/${rule.documentId}`)
    rules.value = rules.value.filter(r => r.documentId !== rule.documentId)
  } catch (e: any) {
    error.value = 'Ошибка удаления'
  }
}

onMounted(fetchRules)
</script>
