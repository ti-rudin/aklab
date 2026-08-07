<template>
  <section>
    <div v-if="loading" class="space-y-4">
      <div v-for="line in 5" :key="line" class="skeleton h-16 rounded-xl" />
    </div>

    <template v-else>
      <div v-if="saved" class="mb-4 p-3 rounded-lg text-sm" style="background: var(--success-bg, #efe); color: var(--success-text, #060)">
        Профиль сохранён
      </div>
      <div v-if="conflict" class="mb-4 p-3 rounded-lg text-sm" style="background: var(--error-bg, #fee); color: var(--error-text, #c00)">
        Профиль был изменён в другом окне. Ваш черновик сохранён — загрузите актуальную версию только если готовы его заменить.
        <button
          data-testid="profile-reload"
          type="button"
          class="ml-2 underline"
          :disabled="reloading"
          @click="reload"
        >
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
    </template>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import api from '@/api/strapi'
import { useAuthStore } from '@/stores/auth'
import ParsingRulesPanel from './ParsingRulesPanel.vue'
import {
  createEmptyProfileDraft,
  isVersionConflict,
  profileDraftFromDto,
  profilePayload,
  validateProfileDraft,
  type ProfileDraft,
  type ProfileDto,
} from './user-profile-form'

const authStore = useAuthStore()
const draft = ref<ProfileDraft>(createEmptyProfileDraft())
const profileVersion = ref<number | null>(null)
const loading = ref(true)
const reloading = ref(false)
const saving = ref(false)
const saved = ref(false)
const conflict = ref(false)
const error = ref('')

function responseProfile(response: unknown): Partial<ProfileDto> | null {
  const value = (response as { data?: { data?: unknown } })?.data?.data
  return value && typeof value === 'object' ? value as Partial<ProfileDto> : null
}

async function loadProfile(options: { replaceDraft: boolean } = { replaceDraft: true }) {
  if (options.replaceDraft) loading.value = true
  else reloading.value = true
  error.value = ''
  try {
    const response = await api.get('/me/profile')
    const profile = responseProfile(response)
    if (!profile || !Number.isSafeInteger(profile.profile_version)) throw new Error('Некорректный ответ профиля')
    if (options.replaceDraft) draft.value = profileDraftFromDto(profile)
    else draft.value = profileDraftFromDto(profile)
    profileVersion.value = profile.profile_version as number
    conflict.value = false
  } catch (cause) {
    error.value = (cause as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message || 'Не удалось загрузить профиль'
  } finally {
    loading.value = false
    reloading.value = false
  }
}

async function reload() {
  await loadProfile({ replaceDraft: false })
}

async function submit() {
  saved.value = false
  error.value = ''
  const validationError = validateProfileDraft(draft.value)
  if (validationError) {
    error.value = validationError
    return
  }
  if (profileVersion.value === null) {
    error.value = 'Версия профиля не загружена'
    return
  }

  const currentVersion = profileVersion.value
  saving.value = true
  try {
    const payload = profilePayload({ ...draft.value, profile_version: currentVersion })
    const response = await api.put('/me/profile', { data: payload })
    const updated = responseProfile(response)
    if (
      !updated
      || !Number.isSafeInteger(updated.profile_version)
      || ![currentVersion, currentVersion + 1].includes(updated.profile_version as number)
    ) throw new Error('Некорректный ответ профиля')
    profileVersion.value = updated.profile_version as number
    draft.value = profileDraftFromDto(updated)
    conflict.value = false
    saved.value = true
    await authStore.refreshContext()
  } catch (cause) {
    if (isVersionConflict(cause)) {
      conflict.value = true
      error.value = 'Профиль был изменён в другом окне; черновик не заменён'
    } else {
      error.value = (cause as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message
        || (cause instanceof Error ? cause.message : 'Ошибка сохранения профиля')
    }
  } finally {
    saving.value = false
  }
}

onMounted(() => loadProfile())
</script>
