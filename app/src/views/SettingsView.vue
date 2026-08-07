<template>
  <div class="max-w-screen-xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
    <h1 class="text-2xl font-bold mb-6" style="color: var(--text-main)">Настройки</h1>

    <div class="flex gap-1 mb-6 overflow-x-auto pb-1" style="border-bottom: 1px solid var(--border-subtle)">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        type="button"
        class="px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors relative"
        :style="{
          color: activeTab === tab.id ? 'var(--accent)' : 'var(--text-muted)',
          opacity: activeTab === tab.id ? 1 : 0.7,
        }"
        @click="selectTab(tab.id)"
      >
        {{ tab.label }}
        <div v-if="activeTab === tab.id" class="absolute bottom-0 left-0 right-0 h-0.5" style="background: var(--accent)" />
      </button>
    </div>

    <UserProfileForm v-if="activeTab === 'personal'" />
    <component
      :is="activeAdminComponent"
      v-else-if="isAdmin && activeAdminComponent"
    />

    <div class="mt-8 max-w-2xl">
      <button
        type="button"
        class="w-full px-4 py-2 rounded-lg text-sm font-medium border transition-colors hover:opacity-80"
        style="border-color: var(--border-subtle); color: var(--text-muted)"
        @click="handleLogout"
      >
        Выйти
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import UserProfileForm from '@/components/settings/UserProfileForm.vue'

type TabId = 'personal' | 'profiles' | 'system' | 'rules' | 'sources' | 'references'

const router = useRouter()
const authStore = useAuthStore()
const isAdmin = computed(() => authStore.isAklabAdmin === true)

const adminComponents: Record<Exclude<TabId, 'personal'>, ReturnType<typeof defineAsyncComponent>> = {
  profiles: defineAsyncComponent(() => import('@/components/settings/AdminUserProfilesPanel.vue')),
  system: defineAsyncComponent(() => import('@/components/settings/SystemSettingsPanel.vue')),
  rules: defineAsyncComponent(() => import('@/components/settings/RulesPanel.vue')),
  sources: defineAsyncComponent(() => import('@/components/settings/SourcesPanel.vue')),
  references: defineAsyncComponent(() => import('@/components/settings/MarketReferencesPanel.vue')),
}

const tabs = computed<Array<{ id: TabId; label: string }>>(() => {
  const personal = { id: 'personal' as const, label: 'Мой профиль' }
  if (!isAdmin.value) return [personal]
  return [
    personal,
    { id: 'profiles', label: 'Профили пользователей' },
    { id: 'system', label: 'Система' },
    { id: 'rules', label: 'Правила' },
    { id: 'sources', label: 'Источники' },
    { id: 'references', label: 'Эталоны' },
  ]
})

const activeTab = ref<TabId>('personal')
const activeAdminComponent = computed(() => {
  if (activeTab.value === 'personal' || !isAdmin.value) return null
  return adminComponents[activeTab.value]
})

function selectTab(tab: TabId) {
  if (tab !== 'personal' && !isAdmin.value) {
    activeTab.value = 'personal'
    return
  }
  activeTab.value = tab
}

function applyHash() {
  const requested = window.location.hash.replace(/^#/, '') as TabId
  if (tabs.value.some(tab => tab.id === requested)) {
    activeTab.value = requested
  } else {
    activeTab.value = 'personal'
  }
}

watch(isAdmin, () => {
  if (!isAdmin.value && activeTab.value !== 'personal') activeTab.value = 'personal'
})

watch(activeTab, value => {
  if (!tabs.value.some(tab => tab.id === value)) {
    activeTab.value = 'personal'
    return
  }
  window.location.hash = value
})

async function handleLogout() {
  await authStore.logout()
  router.push('/auth')
}

onMounted(applyHash)
</script>
