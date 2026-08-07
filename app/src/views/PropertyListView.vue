<template>
  <div class="max-w-screen-xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
    <div class="flex justify-between items-center mb-6">
      <h1 class="text-2xl font-bold" style="color: var(--text-main)">Объекты</h1>
      <span class="text-sm" style="color: var(--text-muted)">{{ activeTabTotal }} шт.</span>
    </div>

    <div class="flex gap-1 mb-6 overflow-x-auto pb-1" style="border-bottom: 1px solid var(--border-subtle)">
      <button
        @click="activeTab = 'all'"
        class="px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors relative"
        :style="{ color: activeTab === 'all' ? 'var(--accent)' : 'var(--text-muted)', opacity: activeTab === 'all' ? 1 : 0.7 }"
      >
        Все объекты
        <div v-if="activeTab === 'all'" class="absolute bottom-0 left-0 right-0 h-0.5" style="background: var(--accent)" />
      </button>
      <button
        @click="activeTab = 'focus'"
        class="px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors relative"
        :style="{ color: activeTab === 'focus' ? 'var(--accent)' : 'var(--text-muted)', opacity: activeTab === 'focus' ? 1 : 0.7 }"
      >
        В фокусе
        <div v-if="activeTab === 'focus'" class="absolute bottom-0 left-0 right-0 h-0.5" style="background: var(--accent)" />
      </button>
      <button
        @click="activeTab = 'work'"
        class="px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors relative"
        :style="{ color: activeTab === 'work' ? 'var(--accent)' : 'var(--text-muted)', opacity: activeTab === 'work' ? 1 : 0.7 }"
      >
        В работе
        <div v-if="activeTab === 'work'" class="absolute bottom-0 left-0 right-0 h-0.5" style="background: var(--accent)" />
      </button>
    </div>

    <PropertyAllTab v-if="activeTab === 'all'" ref="allTabRef" />
    <PropertyAllTab v-if="activeTab === 'work'" ref="workTabRef" status="in_progress" />
    <PropertyFocusTab v-if="activeTab === 'focus'" ref="focusTabRef" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import PropertyAllTab from '@/components/properties/PropertyAllTab.vue'
import PropertyFocusTab from '@/components/properties/PropertyFocusTab.vue'

const route = useRoute()
const activeTab = ref<'all' | 'focus' | 'work'>('all')

const allTabRef = ref<InstanceType<typeof PropertyAllTab>>()
const workTabRef = ref<InstanceType<typeof PropertyAllTab>>()
const focusTabRef = ref<InstanceType<typeof PropertyFocusTab>>()

const activeTabTotal = computed(() => {
  if (activeTab.value === 'all') return allTabRef.value?.total ?? 0
  if (activeTab.value === 'work') return workTabRef.value?.total ?? 0
  return focusTabRef.value?.total ?? 0
})

onMounted(() => {
  const query = route.query ?? {}
  if (query.tab === 'focus' || route.hash === '#focus') {
    activeTab.value = 'focus'
  } else if (query.status === 'in_progress') {
    activeTab.value = 'work'
  }
})
</script>
