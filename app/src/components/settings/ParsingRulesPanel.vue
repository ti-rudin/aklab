<template>
  <div>
    <h2 class="text-lg font-semibold" style="color: var(--text-main)">Правила парсинга</h2>
    <p class="text-xs mb-6" style="color: var(--text-muted)">
      Настройте фильтры для парсинга объявлений: стоп-слова, диапазоны цен и площади, регионы и глубину обхода.
    </p>

    <!-- Loading -->
    <div v-if="loading" class="space-y-4">
      <div v-for="i in 5" :key="i" class="skeleton h-16 rounded-xl" />
    </div>

    <!-- Form -->
    <form v-else @submit.prevent="save" class="space-y-6">

      <!-- Стоп-слова -->
      <div class="rounded-xl p-4 border"
        style="background: var(--bg-elevated); border-color: var(--border-subtle)">
        <label class="block text-sm font-semibold mb-1" style="color: var(--text-main)">Стоп-слова</label>
        <p class="text-xs mb-3" style="color: var(--text-muted)">Объявления, содержащие эти слова, будут исключены. Одно слово на строку.</p>
        <textarea v-model="stopWordsText" rows="5"
          placeholder="пример&#10;стоп-слово&#10;ещё слово"
          class="w-full px-3 py-2 rounded-lg border text-sm"
          style="background: var(--bg-main); border-color: var(--border-subtle); color: var(--text-main)" />
      </div>

      <!-- Диапазон цен -->
      <div class="rounded-xl p-4 border"
        style="background: var(--bg-elevated); border-color: var(--border-subtle)">
        <label class="block text-sm font-semibold mb-1" style="color: var(--text-main)">Диапазон цен (₽)</label>
        <p class="text-xs mb-3" style="color: var(--text-muted)">Оставьте пустым, чтобы не ограничивать.</p>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-xs mb-1" style="color: var(--text-muted)">От</label>
            <input v-model.number="form.price_from" type="number" min="0"
              placeholder="0"
              class="w-full px-3 py-2 rounded-lg border text-sm"
              style="background: var(--bg-main); border-color: var(--border-subtle); color: var(--text-main)" />
          </div>
          <div>
            <label class="block text-xs mb-1" style="color: var(--text-muted)">До</label>
            <input v-model.number="form.price_to" type="number" min="0"
              placeholder="∞"
              class="w-full px-3 py-2 rounded-lg border text-sm"
              style="background: var(--bg-main); border-color: var(--border-subtle); color: var(--text-main)" />
          </div>
        </div>
      </div>

      <!-- Диапазон площади -->
      <div class="rounded-xl p-4 border"
        style="background: var(--bg-elevated); border-color: var(--border-subtle)">
        <label class="block text-sm font-semibold mb-1" style="color: var(--text-main)">Диапазон площади (м²)</label>
        <p class="text-xs mb-3" style="color: var(--text-muted)">Оставьте пустым, чтобы не ограничивать.</p>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-xs mb-1" style="color: var(--text-muted)">От</label>
            <input v-model.number="form.area_from" type="number" min="0"
              placeholder="0"
              class="w-full px-3 py-2 rounded-lg border text-sm"
              style="background: var(--bg-main); border-color: var(--border-subtle); color: var(--text-main)" />
          </div>
          <div>
            <label class="block text-xs mb-1" style="color: var(--text-muted)">До</label>
            <input v-model.number="form.area_to" type="number" min="0"
              placeholder="∞"
              class="w-full px-3 py-2 rounded-lg border text-sm"
              style="background: var(--bg-main); border-color: var(--border-subtle); color: var(--text-main)" />
          </div>
        </div>
      </div>

      <!-- Города (pill-чекбоксы) -->
      <div class="rounded-xl p-4 border"
        style="background: var(--bg-elevated); border-color: var(--border-subtle)">
        <label class="block text-sm font-semibold mb-1" style="color: var(--text-main)">Мониторинг регионов</label>
        <p class="text-xs mb-3" style="color: var(--text-muted)">Выберите регионы для парсинга объявлений.</p>
        <div class="flex flex-wrap gap-2">
          <label v-for="opt in cityOptions" :key="opt.value"
            class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm cursor-pointer transition-colors select-none"
            :style="form.monitored_regions.includes(opt.value)
              ? 'background: var(--accent-soft); color: var(--accent)'
              : 'background: var(--bg-main); color: var(--text-muted); border: 1px solid var(--border-subtle)'"
          >
            <input type="checkbox" :value="opt.value" v-model="form.monitored_regions" class="hidden" />
            {{ opt.label }}
          </label>
        </div>
      </div>

      <!-- Глубина -->
      <div class="rounded-xl p-4 border"
        style="background: var(--bg-elevated); border-color: var(--border-subtle)">
        <label class="block text-sm font-semibold mb-1" style="color: var(--text-main)">Глубина по умолчанию</label>
        <p class="text-xs mb-3" style="color: var(--text-muted)">Количество страниц для обхода (1–5000).</p>
        <input v-model.number="form.parse_depth" type="number" min="1" max="5000"
          class="w-full px-3 py-2 rounded-lg border text-sm"
          style="background: var(--bg-main); border-color: var(--border-subtle); color: var(--text-main)" />
      </div>

      <!-- Кнопка Сохранить -->
      <div class="flex items-center gap-3">
        <button type="submit" :disabled="saving"
          class="px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90 disabled:opacity-50"
          style="background: var(--accent)">
          {{ saving ? 'Сохранение…' : 'Сохранить' }}
        </button>
        <transition name="fade">
          <span v-if="saved" class="text-sm" style="color: var(--accent)">✓ Сохранено</span>
        </transition>
      </div>
    </form>

    <p v-if="error" class="mt-4 text-sm text-center" style="color: #fca5a5">{{ error }}</p>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import api from '@/api/strapi'

interface SettingData {
  stop_words: string[] | null
  price_from: number | null
  price_to: number | null
  area_from: number | null
  area_to: number | null
  monitored_regions: string[]
  parse_depth: number
}

const loading = ref(true)
const saving = ref(false)
const saved = ref(false)
const error = ref('')

const stopWordsText = ref('')

const form = reactive({
  price_from: null as number | null,
  price_to: null as number | null,
  area_from: null as number | null,
  area_to: null as number | null,
  monitored_regions: [] as string[],
  parse_depth: 100,
})

const cityOptions = [
  { value: 'moscow', label: 'Москва' },
  { value: 'mo', label: 'Московская область' },
  { value: 'other', label: 'Другие регионы' },
]

async function fetchSetting() {
  loading.value = true
  try {
    const { data } = await api.get('/setting')
    const d: SettingData = data.data || {}
    stopWordsText.value = (d.stop_words || []).join('\n')
    form.price_from = d.price_from ?? null
    form.price_to = d.price_to ?? null
    form.area_from = d.area_from ?? null
    form.area_to = d.area_to ?? null
    form.monitored_regions = d.monitored_regions || []
    form.parse_depth = d.parse_depth ?? 100
  } catch (e: any) {
    error.value = 'Ошибка загрузки настроек'
  } finally {
    loading.value = false
  }
}

async function save() {
  saving.value = true
  error.value = ''
  saved.value = false
  try {
    const stop_words = stopWordsText.value
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean)

    await api.put('/setting', {
      data: {
        stop_words,
        price_from: form.price_from,
        price_to: form.price_to,
        area_from: form.area_from,
        area_to: form.area_to,
        monitored_regions: form.monitored_regions,
        parse_depth: form.parse_depth,
      },
    })

    saved.value = true
    setTimeout(() => { saved.value = false }, 2500)
  } catch (e: any) {
    error.value = e.response?.data?.error?.message || 'Ошибка сохранения'
  } finally {
    saving.value = false
  }
}

onMounted(fetchSetting)
</script>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
