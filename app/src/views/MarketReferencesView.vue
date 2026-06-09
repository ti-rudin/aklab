<template>
  <div class="max-w-screen-xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
    <div class="flex items-center gap-4 mb-8">
      <router-link to="/settings" class="text-sm hover:underline" style="color: var(--text-muted)">← Настройки</router-link>
      <h1 class="text-2xl font-bold" style="color: var(--text-main)">Эталоны стоимости ₽/м²</h1>
    </div>

    <!-- Форма добавления -->
    <div class="rounded-xl p-6 border mb-8" style="background: var(--bg-elevated); border-color: var(--border-subtle)">
      <h2 class="text-lg font-semibold mb-4" style="color: var(--text-main)">Новый эталон</h2>
      <form @submit.prevent="handleCreate" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div>
          <label class="block text-sm mb-1" style="color: var(--text-muted)">Город *</label>
          <select v-model="form.city" class="w-full px-3 py-2 rounded-lg border text-sm" style="background: var(--bg-main); border-color: var(--border-subtle); color: var(--text-main)">
            <option value="" disabled>Выберите…</option>
            <option value="moscow">Москва</option>
            <option value="mo">МО</option>
            <option value="other">Другой</option>
          </select>
        </div>
        <div>
          <label class="block text-sm mb-1" style="color: var(--text-muted)">Тип недвижимости *</label>
          <select v-model="form.property_type" class="w-full px-3 py-2 rounded-lg border text-sm" style="background: var(--bg-main); border-color: var(--border-subtle); color: var(--text-main)">
            <option value="" disabled>Выберите…</option>
            <option value="office">Офис</option>
            <option value="warehouse">Склад</option>
            <option value="retail">Торговля</option>
            <option value="production">Производство</option>
            <option value="free_purpose">Свободного назначения</option>
            <option value="other">Другое</option>
          </select>
        </div>
        <div>
          <label class="block text-sm mb-1" style="color: var(--text-muted)">Цена за м² *</label>
          <input v-model.number="form.price_per_sqm" type="number" min="1" step="1" placeholder="250000"
            class="w-full px-3 py-2 rounded-lg border text-sm"
            style="background: var(--bg-main); border-color: var(--border-subtle); color: var(--text-main)" />
        </div>
        <div>
          <label class="block text-sm mb-1" style="color: var(--text-muted)">Действует с *</label>
          <input v-model="form.effective_from" type="date"
            class="w-full px-3 py-2 rounded-lg border text-sm"
            style="background: var(--bg-main); border-color: var(--border-subtle); color: var(--text-main)" />
        </div>
        <div class="sm:col-span-2">
          <label class="block text-sm mb-1" style="color: var(--text-muted)">Примечание</label>
          <input v-model="form.notes" type="text" placeholder="По данным ЦИАН"
            class="w-full px-3 py-2 rounded-lg border text-sm"
            style="background: var(--bg-main); border-color: var(--border-subtle); color: var(--text-main)" />
        </div>
        <div class="flex items-end">
          <button type="submit" :disabled="creating || !isFormValid"
            class="px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all duration-200 hover:opacity-90 disabled:opacity-40"
            style="background: var(--accent)">
            {{ creating ? 'Сохранение…' : 'Добавить' }}
          </button>
        </div>
      </form>
      <p v-if="error" class="mt-3 text-sm" style="color: #fca5a5">{{ error }}</p>
    </div>

    <!-- Loading -->
    <SkeletonTable v-if="loading" :rows="4" />

    <!-- Пустой список -->
    <div v-else-if="items.length === 0" class="text-center py-16">
      <p class="text-lg" style="color: var(--text-muted)">Эталоны не добавлены</p>
    </div>

    <!-- Desktop: Таблица -->
    <div v-else class="hidden md:block rounded-xl border overflow-hidden" style="border-color: var(--border-subtle)">
      <table class="w-full text-sm">
        <thead>
          <tr style="background: var(--bg-elevated)">
            <th class="text-left px-4 py-3 font-semibold" style="color: var(--text-muted)">Город</th>
            <th class="text-left px-4 py-3 font-semibold" style="color: var(--text-muted)">Тип</th>
            <th class="text-right px-4 py-3 font-semibold" style="color: var(--text-muted)">₽/м²</th>
            <th class="text-left px-4 py-3 font-semibold" style="color: var(--text-muted)">С даты</th>
            <th class="text-left px-4 py-3 font-semibold" style="color: var(--text-muted)">Примечание</th>
            <th class="text-center px-4 py-3 font-semibold" style="color: var(--text-muted)">Статус</th>
            <th class="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in items" :key="item.id"
            class="border-t transition-colors"
            :style="{ borderColor: 'var(--border-subtle)', opacity: item.is_active ? 1 : 0.5 }">
            <td class="px-4 py-3" style="color: var(--text-main)">{{ cityLabel(item.city) }}</td>
            <td class="px-4 py-3" style="color: var(--text-main)">{{ typeLabel(item.property_type) }}</td>
            <td class="px-4 py-3 text-right font-mono" style="color: var(--text-main)">
              <template v-if="editingId === item.id">
                <input v-model.number="editPrice" type="number" min="1" class="w-28 px-2 py-1 rounded border text-right text-sm"
                  style="background: var(--bg-main); border-color: var(--border-subtle); color: var(--text-main)" />
              </template>
              <template v-else>
                {{ Number(item.price_per_sqm).toLocaleString('ru-RU') }}
              </template>
            </td>
            <td class="px-4 py-3" style="color: var(--text-muted)">{{ formatDate(item.effective_from) }}</td>
            <td class="px-4 py-3 max-w-[200px] truncate" style="color: var(--text-muted)">{{ item.notes || '—' }}</td>
            <td class="px-4 py-3 text-center">
              <span v-if="item.is_active" class="text-xs px-2 py-0.5 rounded-full" style="background: rgba(16,185,129,0.15); color: #10b981">Активен</span>
              <span v-else class="text-xs px-2 py-0.5 rounded-full" style="background: rgba(239,68,68,0.15); color: #fca5a5">Неактивен</span>
            </td>
            <td class="px-4 py-3 whitespace-nowrap">
              <template v-if="editingId === item.id">
                <button @click="saveEdit(item.id)" class="text-xs font-semibold mr-2 hover:underline" style="color: #10b981">Сохранить</button>
                <button @click="cancelEdit" class="text-xs font-semibold hover:underline" style="color: var(--text-muted)">Отмена</button>
              </template>
              <template v-else>
                <button v-if="item.is_active" @click="startEdit(item)" class="text-xs font-semibold mr-2 hover:underline" style="color: var(--accent)">Изменить цену</button>
                <button @click="toggleActive(item)" class="text-xs font-semibold hover:underline"
                  :style="{ color: item.is_active ? '#fca5a5' : '#10b981' }">
                  {{ item.is_active ? 'Деактивировать' : 'Активировать' }}
                </button>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Mobile: Карточки -->
    <div v-if="!loading && items.length > 0" class="md:hidden space-y-3">
      <div v-for="item in items" :key="item.id"
        class="rounded-xl border p-4 transition-all"
        :style="{ background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)', opacity: item.is_active ? 1 : 0.5 }">
        <!-- Заголовок: город + тип + статус -->
        <div class="flex items-center justify-between gap-2 mb-3">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-sm font-semibold" style="color: var(--text-main)">{{ cityLabel(item.city) }}</span>
            <span class="text-xs px-2 py-0.5 rounded-full" style="background: var(--bg-main); color: var(--text-muted)">{{ typeLabel(item.property_type) }}</span>
          </div>
          <span v-if="item.is_active" class="text-xs px-2 py-0.5 rounded-full shrink-0" style="background: rgba(16,185,129,0.15); color: #10b981">Активен</span>
          <span v-else class="text-xs px-2 py-0.5 rounded-full shrink-0" style="background: rgba(239,68,68,0.15); color: #fca5a5">Неактивен</span>
        </div>

        <!-- Цена -->
        <div class="mb-3">
          <div class="text-xs mb-1" style="color: var(--text-muted)">₽/м²</div>
          <template v-if="editingId === item.id">
            <input v-model.number="editPrice" type="number" min="1" class="w-full px-3 py-2 rounded-lg border text-lg font-mono font-bold"
              style="background: var(--bg-main); border-color: var(--border-subtle); color: var(--text-main)" />
          </template>
          <template v-else>
            <div class="text-lg font-mono font-bold" style="color: var(--text-main)">{{ Number(item.price_per_sqm).toLocaleString('ru-RU') }} ₽</div>
          </template>
        </div>

        <!-- Дата + примечание -->
        <div class="text-xs mb-3 space-y-1" style="color: var(--text-muted)">
          <div v-if="item.effective_from">С {{ formatDate(item.effective_from) }}</div>
          <div v-if="item.notes">{{ item.notes }}</div>
        </div>

        <!-- Кнопки -->
        <div class="flex gap-2">
          <template v-if="editingId === item.id">
            <button @click="saveEdit(item.id)" class="px-3 py-1.5 rounded-lg text-xs font-semibold" style="background: #10b981; color: white">Сохранить</button>
            <button @click="cancelEdit" class="px-3 py-1.5 rounded-lg text-xs font-semibold border" style="border-color: var(--border-subtle); color: var(--text-muted)">Отмена</button>
          </template>
          <template v-else>
            <button v-if="item.is_active" @click="startEdit(item)" class="px-3 py-1.5 rounded-lg text-xs font-semibold" style="background: var(--accent); color: white">Изменить цену</button>
            <button @click="toggleActive(item)" class="px-3 py-1.5 rounded-lg text-xs font-semibold border"
              :style="{ borderColor: 'var(--border-subtle)', color: item.is_active ? '#fca5a5' : '#10b981' }">
              {{ item.is_active ? 'Деактивировать' : 'Активировать' }}
            </button>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import SkeletonTable from '@/components/SkeletonTable.vue'
import { ref, reactive, computed, onMounted } from 'vue'
import api from '@/api/strapi'

interface MarketReference {
  id: number
  documentId: string
  city: string
  property_type: string
  price_per_sqm: string
  effective_from: string
  notes: string | null
  created_by: string | null
  is_active: boolean
}

const items = ref<MarketReference[]>([])
const loading = ref(true)
const creating = ref(false)
const error = ref('')
const editingId = ref<number | null>(null)
const editPrice = ref(0)

const form = reactive({
  city: '',
  property_type: '',
  price_per_sqm: null as number | null,
  effective_from: '',
  notes: '',
})

const isFormValid = computed(() =>
  form.city && form.property_type && form.price_per_sqm && form.price_per_sqm > 0 && form.effective_from
)

const cityLabel = (v: string) => ({ moscow: 'Москва', mo: 'МО', other: 'Другой' })[v] || v
const typeLabel = (v: string) => ({
  office: 'Офис', warehouse: 'Склад', retail: 'Торговля',
  production: 'Производство', free_purpose: 'Свободного назначения', other: 'Другое'
})[v] || v

const formatDate = (d: string) => {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('ru-RU')
}

async function fetchItems() {
  loading.value = true
  try {
    const { data } = await api.get('/market-references', {
      params: { sort: 'effective_from:desc', pagination: { pageSize: 100 } }
    })
    items.value = data.data
  } catch (e: any) {
    error.value = e.response?.data?.error?.message || 'Ошибка загрузки'
  } finally {
    loading.value = false
  }
}

async function handleCreate() {
  if (!isFormValid.value) return
  creating.value = true
  error.value = ''
  try {
    await api.post('/market-references', {
      data: {
        city: form.city,
        property_type: form.property_type,
        price_per_sqm: form.price_per_sqm,
        effective_from: form.effective_from,
        notes: form.notes || null,
        is_active: true,
      }
    })
    form.city = ''
    form.property_type = ''
    form.price_per_sqm = null
    form.effective_from = ''
    form.notes = ''
    await fetchItems()
  } catch (e: any) {
    error.value = e.response?.data?.error?.message || 'Ошибка создания'
  } finally {
    creating.value = false
  }
}

function startEdit(item: MarketReference) {
  editingId.value = item.id
  editPrice.value = Number(item.price_per_sqm)
}

function cancelEdit() {
  editingId.value = null
}

async function saveEdit(id: number) {
  if (editPrice.value <= 0) return
  try {
    const item = items.value.find(i => i.id === id)
    if (!item) return
    await api.put(`/market-references/${item.documentId}`, {
      data: { price_per_sqm: editPrice.value }
    })
    editingId.value = null
    await fetchItems()
  } catch (e: any) {
    error.value = e.response?.data?.error?.message || 'Ошибка сохранения'
  }
}

async function toggleActive(item: MarketReference) {
  try {
    await api.put(`/market-references/${item.documentId}`, {
      data: { is_active: !item.is_active }
    })
    await fetchItems()
  } catch (e: any) {
    error.value = e.response?.data?.error?.message || 'Ошибка обновления'
  }
}

onMounted(fetchItems)
</script>
