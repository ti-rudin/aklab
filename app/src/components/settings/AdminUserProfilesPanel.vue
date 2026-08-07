<template>
  <section>
    <h2 class="text-lg font-semibold" style="color: var(--text-main)">Профили пользователей</h2>
    <p class="text-xs mb-6" style="color: var(--text-muted)">Администратор может изменить фильтры и дайджест выбранного пользователя. Учетные данные и роли здесь недоступны.</p>

    <div v-if="listError" class="mb-4 text-sm" style="color: #fca5a5">{{ listError }}</div>
    <div v-if="listLoading" class="space-y-3">
      <div v-for="line in 3" :key="line" class="skeleton h-14 rounded-xl" />
    </div>
    <div v-else class="grid grid-cols-1 lg:grid-cols-[minmax(14rem,22rem)_1fr] gap-6">
      <div class="space-y-2">
        <button
          v-for="item in users"
          :key="item.user_id"
          :data-testid="`profile-user-${item.user_id}`"
          type="button"
          class="w-full text-left rounded-xl p-3 border transition-colors"
          :style="selectedUserId === item.user_id ? { background: 'var(--accent-soft)', borderColor: 'var(--accent)' } : { background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }"
          @click="selectUser(item.user_id)"
        >
          <span class="block text-sm font-medium" style="color: var(--text-main)">{{ item.username || item.email || `Пользователь ${item.user_id}` }}</span>
          <span class="block text-xs mt-1" style="color: var(--text-muted)">{{ item.email || 'Email не указан' }} · #{{ item.user_id }}</span>
        </button>
        <p v-if="users.length === 0" class="text-sm" style="color: var(--text-muted)">Профили не найдены</p>
      </div>

      <div v-if="profileLoading" class="space-y-4">
        <div v-for="line in 5" :key="line" class="skeleton h-16 rounded-xl" />
      </div>
      <div v-else-if="selectedUserId !== null && draft && profileVersion !== null">
        <div v-if="conflict" class="mb-4 p-3 rounded-lg text-sm" style="background: var(--error-bg, #fee); color: var(--error-text, #c00)">
          Профиль был изменён в другом окне. Черновик сохранён.
          <button data-testid="admin-profile-reload" type="button" class="ml-2 underline" :disabled="reloading" @click="reloadSelected">
            {{ reloading ? 'Загрузка…' : 'Загрузить актуальную версию' }}
          </button>
        </div>
        <ParsingRulesPanel
          v-model="draft"
          :disabled="saving || reloading"
          :error="error"
          :submit-label="saving ? 'Сохранение…' : 'Сохранить профиль'"
          @submit="submit"
        />
      </div>
      <p v-else class="text-sm" style="color: var(--text-muted)">Выберите профиль слева.</p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import api from '@/api/strapi'
import ParsingRulesPanel from './ParsingRulesPanel.vue'
import {
  isVersionConflict,
  profileDraftFromDto,
  profilePayload,
  validateProfileDraft,
  type ProfileDraft,
  type ProfileDto,
} from './user-profile-form'

type UserProfileListItem = {
  user_id: number
  email?: string | null
  username?: string | null
  profile_version?: number
  blocked?: boolean
}

const users = ref<UserProfileListItem[]>([])
const selectedUserId = ref<number | null>(null)
const draft = ref<ProfileDraft | null>(null)
const profileVersion = ref<number | null>(null)
const listLoading = ref(true)
const profileLoading = ref(false)
const reloading = ref(false)
const saving = ref(false)
const conflict = ref(false)
const error = ref('')
const listError = ref('')

function profileFromResponse(response: unknown): Partial<ProfileDto> | null {
  const value = (response as { data?: { data?: unknown } })?.data?.data
  return value && typeof value === 'object' ? value as Partial<ProfileDto> : null
}

async function loadUsers() {
  listLoading.value = true
  listError.value = ''
  try {
    const response = await api.get('/admin/user-profiles?page=1&pageSize=100')
    const data = (response as { data?: { data?: unknown } })?.data?.data
    users.value = Array.isArray(data) ? data.filter(item => {
      const value = item as Partial<UserProfileListItem>
      return Number.isSafeInteger(value.user_id) && (value.user_id as number) > 0
    }) as UserProfileListItem[] : []
  } catch (cause) {
    listError.value = (cause as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message || 'Не удалось загрузить профили'
  } finally {
    listLoading.value = false
  }
}

async function loadSelected(userId: number, replace = true) {
  if (replace) profileLoading.value = true
  else reloading.value = true
  error.value = ''
  try {
    const response = await api.get(`/admin/user-profiles/${userId}`)
    const profile = profileFromResponse(response)
    if (!profile || !Number.isSafeInteger(profile.profile_version)) throw new Error('Некорректный ответ профиля')
    selectedUserId.value = userId
    draft.value = profileDraftFromDto(profile)
    profileVersion.value = profile.profile_version as number
    conflict.value = false
  } catch (cause) {
    error.value = (cause as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message || 'Не удалось загрузить профиль'
  } finally {
    profileLoading.value = false
    reloading.value = false
  }
}

async function selectUser(userId: number) {
  selectedUserId.value = userId
  draft.value = null
  profileVersion.value = null
  conflict.value = false
  await loadSelected(userId)
}

async function reloadSelected() {
  if (selectedUserId.value !== null) await loadSelected(selectedUserId.value, false)
}

async function submit() {
  if (selectedUserId.value === null || !draft.value || profileVersion.value === null) return
  error.value = ''
  const validationError = validateProfileDraft(draft.value)
  if (validationError) {
    error.value = validationError
    return
  }

  saving.value = true
  try {
    const payload = profilePayload({ ...draft.value, profile_version: profileVersion.value })
    const response = await api.put(`/admin/user-profiles/${selectedUserId.value}`, { data: payload })
    const updated = profileFromResponse(response)
    if (updated && Number.isSafeInteger(updated.profile_version)) {
      profileVersion.value = updated.profile_version as number
      draft.value = profileDraftFromDto(updated)
    } else {
      profileVersion.value += 1
    }
    conflict.value = false
  } catch (cause) {
    if (isVersionConflict(cause)) {
      conflict.value = true
      error.value = 'Профиль был изменён в другом окне; черновик не заменён'
    } else {
      error.value = (cause as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message || 'Ошибка сохранения профиля'
    }
  } finally {
    saving.value = false
  }
}

onMounted(loadUsers)
</script>
