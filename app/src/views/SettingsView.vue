<template>
  <div class="max-w-2xl mx-auto px-4 py-8">
    <h1 class="text-2xl font-bold mb-6" style="color: var(--text-main)">Настройки</h1>

    <!-- Loading -->
    <div v-if="loading">
      <div class="skeleton h-8 w-40 mb-6" />
      <SkeletonLoader :lines="6" height="3.5rem" />
    </div>

    <!-- Error -->
    <div v-if="error" class="mb-4 p-3 rounded-lg text-sm" style="background: var(--error-bg, #fee); color: var(--error-text, #c00)">
      {{ error }}
    </div>

    <!-- Success -->
    <div v-if="saved" class="mb-4 p-3 rounded-lg text-sm" style="background: var(--success-bg, #efe); color: var(--success-text, #060)">
      Сохранено ✓
    </div>

    <form v-if="!loading" @submit.prevent="save" class="space-y-6">
      <!-- Порог отклонения -->
      <div>
        <label class="block text-sm font-medium mb-1" style="color: var(--text-main)">
          Порог отклонения (%)
        </label>
        <p class="text-xs mb-2" style="color: var(--text-muted)">
          Минимальное отклонение от рыночной цены для уведомления. По умолчанию 20%.
        </p>
        <input
          v-model.number="form.threshold_percent"
          type="number"
          min="1"
          max="99"
          class="w-full px-3 py-2 rounded-lg border text-sm"
          style="background: var(--bg-input, #fff); border-color: var(--border-subtle); color: var(--text-main)"
        />
      </div>

      <!-- Время дайджеста -->
      <div>
        <label class="block text-sm font-medium mb-1" style="color: var(--text-main)">
          Время утреннего дайджеста
        </label>
        <p class="text-xs mb-2" style="color: var(--text-muted)">
          Время отправки email-дайджеста (МСК). Формат: HH:MM
        </p>
        <input
          v-model="form.digest_time"
          type="time"
          class="w-full px-3 py-2 rounded-lg border text-sm"
          style="background: var(--bg-input, #fff); border-color: var(--border-subtle); color: var(--text-main)"
        />
      </div>

      <!-- Email получателя -->
      <div>
        <label class="block text-sm font-medium mb-1" style="color: var(--text-main)">
          Email для дайджеста
        </label>
        <p class="text-xs mb-2" style="color: var(--text-muted)">
          Куда отправлять утренний дайджест недооценённых объектов.
        </p>
        <input
          v-model="form.smtp_to"
          type="email"
          class="w-full px-3 py-2 rounded-lg border text-sm"
          style="background: var(--bg-input, #fff); border-color: var(--border-subtle); color: var(--text-main)"
          placeholder="email@example.com"
        />
      </div>

      <!-- Рабочее время -->
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium mb-1" style="color: var(--text-main)">
            Начало рабочего времени
          </label>
          <input
            v-model.number="form.work_hours_start"
            type="number"
            min="0"
            max="23"
            class="w-full px-3 py-2 rounded-lg border text-sm"
            style="background: var(--bg-input, #fff); border-color: var(--border-subtle); color: var(--text-main)"
          />
        </div>
        <div>
          <label class="block text-sm font-medium mb-1" style="color: var(--text-main)">
            Конец рабочего времени
          </label>
          <input
            v-model.number="form.work_hours_end"
            type="number"
            min="0"
            max="23"
            class="w-full px-3 py-2 rounded-lg border text-sm"
            style="background: var(--bg-input, #fff); border-color: var(--border-subtle); color: var(--text-main)"
          />
        </div>
      </div>

      <!-- Срок хранения -->
      <div>
        <label class="block text-sm font-medium mb-1" style="color: var(--text-main)">
          Срок хранения объектов (мес.)
        </label>
        <p class="text-xs mb-2" style="color: var(--text-muted)">
          Автоматическое удаление объектов старше N месяцев.
        </p>
        <input
          v-model.number="form.retention_months"
          type="number"
          min="1"
          max="24"
          class="w-full px-3 py-2 rounded-lg border text-sm"
          style="background: var(--bg-input, #fff); border-color: var(--border-subtle); color: var(--text-main)"
        />
      </div>

      <!-- Кнопка -->
      <button
        type="submit"
        :disabled="saving"
        class="w-full px-4 py-2 rounded-lg text-sm font-semibold text-white transition-all duration-200 hover:opacity-90 disabled:opacity-50"
        style="background: var(--accent)"
      >
        {{ saving ? 'Сохранение...' : 'Сохранить' }}
      </button>
    </form>

    <!-- Ссылки -->
    <div class="mt-8 pt-6 border-t space-y-3" style="border-color: var(--border-subtle)">
      <router-link
        to="/market-references"
        class="flex items-center justify-between p-3 rounded-lg border transition-colors hover:opacity-80"
        style="border-color: var(--border-subtle); color: var(--text-main)"
      >
        <div>
          <div class="text-sm font-medium">Рыночные эталоны</div>
          <div class="text-xs" style="color: var(--text-muted)">Ручные цены за м² для сравнения</div>
        </div>
        <span style="color: var(--text-muted)">→</span>
      </router-link>
    </div>

    <!-- Выход -->
    <div class="mt-6">
      <button
        @click="handleLogout"
        class="w-full px-4 py-2 rounded-lg text-sm font-medium border transition-colors hover:opacity-80"
        style="border-color: var(--border-subtle); color: var(--text-muted)"
      >
        Выйти
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import SkeletonLoader from '@/components/SkeletonLoader.vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import api from '@/api/strapi'

const router = useRouter()
const authStore = useAuthStore()

const loading = ref(true)
const saving = ref(false)
const saved = ref(false)
const error = ref('')
const documentId = ref('')

const form = ref({
  threshold_percent: 20,
  digest_time: '09:00',
  smtp_to: '',
  work_hours_start: 9,
  work_hours_end: 21,
  retention_months: 6,
})

onMounted(async () => {
  try {
    const res = await api.get('/setting')
    const data = res.data?.data
    if (data) {
      documentId.value = data.documentId
      form.value = {
        threshold_percent: data.threshold_percent ?? 20,
        digest_time: data.digest_time ?? '09:00',
        smtp_to: data.smtp_to ?? '',
        work_hours_start: data.work_hours_start ?? 9,
        work_hours_end: data.work_hours_end ?? 21,
        retention_months: data.retention_months ?? 6,
      }
    }
  } catch (err: any) {
    error.value = 'Не удалось загрузить настройки'
  } finally {
    loading.value = false
  }
})

const save = async () => {
  saving.value = true
  error.value = ''
  saved.value = false

  try {
    if (documentId.value) {
      await api.put(`/setting/${documentId.value}`, { data: form.value })
    } else {
      await api.post('/setting', { data: form.value })
    }
    saved.value = true
    setTimeout(() => { saved.value = false }, 3000)
  } catch (err: any) {
    error.value = 'Ошибка сохранения: ' + (err.response?.data?.error?.message || err.message)
  } finally {
    saving.value = false
  }
}

const handleLogout = async () => {
  await authStore.logout()
  router.push('/auth')
}
</script>
