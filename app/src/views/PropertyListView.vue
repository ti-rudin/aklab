<template>
  <div class="max-w-screen-xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
    <div class="flex justify-between items-center mb-6">
      <h1 class="text-2xl font-bold" style="color: var(--text-main)">Объекты</h1>
      <div class="flex items-center gap-3">
        <span class="text-sm" style="color: var(--text-muted)">{{ activeTabTotal }} шт.</span>
        <button v-if="activeTab === 'all'"
          @click="showClearDialog = true"
          :disabled="clearing"
          class="px-3 py-1.5 rounded-lg text-sm font-semibold text-white transition-all duration-200 hover:opacity-90 disabled:opacity-50"
          style="background: #ef4444"
        >
          {{ clearing ? 'Удаление...' : 'Очистить' }}
        </button>
      </div>
    </div>

    <!-- Табы -->
    <div class="flex gap-1 mb-6 overflow-x-auto pb-1" style="border-bottom: 1px solid var(--border-subtle)">
      <button
        @click="activeTab = 'all'"
        class="px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors relative"
        :style="{
          color: activeTab === 'all' ? 'var(--accent)' : 'var(--text-muted)',
          opacity: activeTab === 'all' ? 1 : 0.7,
        }"
      >
        Все объекты
        <div v-if="activeTab === 'all'" class="absolute bottom-0 left-0 right-0 h-0.5" style="background: var(--accent)" />
      </button>
      <button
        @click="activeTab = 'focus'"
        class="px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors relative"
        :style="{
          color: activeTab === 'focus' ? 'var(--accent)' : 'var(--text-muted)',
          opacity: activeTab === 'focus' ? 1 : 0.7,
        }"
      >
        В фокусе
        <div v-if="activeTab === 'focus'" class="absolute bottom-0 left-0 right-0 h-0.5" style="background: var(--accent)" />
      </button>
      <button
        @click="activeTab = 'work'"
        class="px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors relative"
        :style="{
          color: activeTab === 'work' ? 'var(--accent)' : 'var(--text-muted)',
          opacity: activeTab === 'work' ? 1 : 0.7,
        }"
      >
        В работе
        <div v-if="activeTab === 'work'" class="absolute bottom-0 left-0 right-0 h-0.5" style="background: var(--accent)" />
      </button>
    </div>

    <!-- Запуск парсинга (only on "Все объекты") -->
    <ParseLaunchPanel v-if="activeTab === 'all'" v-model:parse-depth="parseDepth" @done="onParseDone" />

    <!-- Tab content -->
    <PropertyAllTab v-if="activeTab === 'all'" ref="allTabRef" status="new" />
    <PropertyAllTab v-if="activeTab === 'work'" ref="workTabRef" status="in_progress" />
    <PropertyFocusTab v-if="activeTab === 'focus'" ref="focusTabRef" />

    <!-- Диалог подтверждения очистки -->
    <ConfirmClearDialog
      :visible="showClearDialog"
      @confirm="executeClearNew"
      @cancel="showClearDialog = false"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import api from '@/api/strapi'
import ParseLaunchPanel from '@/components/properties/ParseLaunchPanel.vue'
import PropertyAllTab from '@/components/properties/PropertyAllTab.vue'
import PropertyFocusTab from '@/components/properties/PropertyFocusTab.vue'
import ConfirmClearDialog from '@/components/properties/ConfirmClearDialog.vue'
import { useToast } from '@/composables/useToast'

const route = useRoute()
const toast = useToast()

// ========================
// Tab state
// ========================
const activeTab = ref<'all' | 'focus' | 'work'>('all')

// ========================
// Template refs
// ========================
const allTabRef = ref<InstanceType<typeof PropertyAllTab>>()
const workTabRef = ref<InstanceType<typeof PropertyAllTab>>()
const focusTabRef = ref<InstanceType<typeof PropertyFocusTab>>()

const activeTabTotal = computed(() => {
  if (activeTab.value === 'all') return allTabRef.value?.total ?? 0
  if (activeTab.value === 'work') return workTabRef.value?.total ?? 0
  if (activeTab.value === 'focus') return focusTabRef.value?.total ?? 0
  return 0
})

// ========================
// Parse depth (v-model)
// ========================
const parseDepth = ref(20)

function onParseDone() {
  // Refresh the "Все объекты" tab after parsing completes
  allTabRef.value?.refresh()
}

// ========================
// Clear properties
// ========================
const clearing = ref(false)
const showClearDialog = ref(false)

async function executeClearNew() {
  showClearDialog.value = false
  clearing.value = true
  try {
    const { data } = await api.post('/properties/clear-new')
    if (data.deleted > 0) {
      const photoInfo = data.photosDeleted > 0 ? ` (папок с фото: ${data.photosDeleted})` : ''
      toast.success(`Удалено ${data.deleted} объектов${photoInfo}`)
    } else {
      toast.info('Нет объектов со статусом «Новый»')
    }
    allTabRef.value?.refresh()
  } catch (e: any) {
    toast.error('Ошибка: ' + (e.response?.data?.error?.message || e.message))
  } finally {
    clearing.value = false
  }
}

// ========================
// Lifecycle
// ========================
onMounted(() => {
  if (route.hash === '#focus') {
    activeTab.value = 'focus'
  }
})
</script>
