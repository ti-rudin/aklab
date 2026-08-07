<template>
  <div>
    <h2 class="text-lg font-semibold" style="color: var(--text-main)">Профиль фильтров</h2>
    <p class="text-xs mb-6" style="color: var(--text-muted)">
      Выберите регионы, типы недвижимости и ограничения для вашей персональной выдачи и дайджеста.
    </p>

    <form @submit.prevent="emit('submit')" class="space-y-6">
      <div class="rounded-xl p-4 border" style="background: var(--bg-elevated); border-color: var(--border-subtle)">
        <label class="block text-sm font-semibold mb-1" style="color: var(--text-main)">Стоп-слова</label>
        <p class="text-xs mb-3" style="color: var(--text-muted)">По одному значению на строку. При сохранении слова будут приведены к нижнему регистру.</p>
        <textarea
          data-testid="profile-stop-words"
          :value="modelValue.stop_words.join('\n')"
          rows="5"
          :disabled="disabled"
          placeholder="пример&#10;стоп-слово"
          class="w-full px-3 py-2 rounded-lg border text-sm"
          style="background: var(--bg-main); border-color: var(--border-subtle); color: var(--text-main)"
          @input="setStopWords(($event.target as HTMLTextAreaElement).value)"
        />
      </div>

      <div class="rounded-xl p-4 border" style="background: var(--bg-elevated); border-color: var(--border-subtle)">
        <label class="block text-sm font-semibold mb-1" style="color: var(--text-main)">Регионы</label>
        <p class="text-xs mb-3" style="color: var(--text-muted)">Нужно выбрать хотя бы один регион.</p>
        <div class="flex flex-wrap gap-2">
          <label
            v-for="option in regionOptions"
            :key="option.value"
            class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm cursor-pointer select-none"
            :style="modelValue.regions.includes(option.value) ? 'background: var(--accent-soft); color: var(--accent)' : 'background: var(--bg-main); color: var(--text-muted); border: 1px solid var(--border-subtle)'"
          >
            <input
              type="checkbox"
              :data-testid="`profile-region-${option.value}`"
              :checked="modelValue.regions.includes(option.value)"
              :disabled="disabled"
              class="hidden"
              @change="toggleValue('regions', option.value)"
            />
            {{ option.label }}
          </label>
        </div>
      </div>

      <div class="rounded-xl p-4 border" style="background: var(--bg-elevated); border-color: var(--border-subtle)">
        <label class="block text-sm font-semibold mb-1" style="color: var(--text-main)">Типы недвижимости</label>
        <p class="text-xs mb-3" style="color: var(--text-muted)">Нужно выбрать хотя бы один тип.</p>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <label
            v-for="option in propertyTypeOptions"
            :key="option.value"
            class="flex items-center gap-2 text-sm cursor-pointer select-none"
            style="color: var(--text-main)"
          >
            <input
              type="checkbox"
              :data-testid="`profile-property-type-${option.value}`"
              :checked="modelValue.property_types.includes(option.value)"
              :disabled="disabled"
              class="rounded"
              @change="toggleValue('property_types', option.value)"
            />
            {{ option.label }}
          </label>
        </div>
      </div>

      <div class="rounded-xl p-4 border" style="background: var(--bg-elevated); border-color: var(--border-subtle)">
        <label class="block text-sm font-semibold mb-1" style="color: var(--text-main)">Диапазон цены (₽)</label>
        <p class="text-xs mb-3" style="color: var(--text-muted)">Оставьте поле пустым без ограничения.</p>
        <div class="grid grid-cols-2 gap-4">
          <input
            data-testid="profile-price-from"
            type="number"
            min="0"
            placeholder="От"
            :value="displayNumber(modelValue.price_from)"
            :disabled="disabled"
            class="w-full px-3 py-2 rounded-lg border text-sm"
            style="background: var(--bg-main); border-color: var(--border-subtle); color: var(--text-main)"
            @input="setNumber('price_from', ($event.target as HTMLInputElement).value)"
          />
          <input
            data-testid="profile-price-to"
            type="number"
            min="0"
            placeholder="До"
            :value="displayNumber(modelValue.price_to)"
            :disabled="disabled"
            class="w-full px-3 py-2 rounded-lg border text-sm"
            style="background: var(--bg-main); border-color: var(--border-subtle); color: var(--text-main)"
            @input="setNumber('price_to', ($event.target as HTMLInputElement).value)"
          />
        </div>
      </div>

      <div class="rounded-xl p-4 border" style="background: var(--bg-elevated); border-color: var(--border-subtle)">
        <label class="block text-sm font-semibold mb-1" style="color: var(--text-main)">Диапазон площади (м²)</label>
        <p class="text-xs mb-3" style="color: var(--text-muted)">Оставьте поле пустым без ограничения.</p>
        <div class="grid grid-cols-2 gap-4">
          <input
            data-testid="profile-area-from"
            type="number"
            min="0"
            placeholder="От"
            :value="displayNumber(modelValue.area_from)"
            :disabled="disabled"
            class="w-full px-3 py-2 rounded-lg border text-sm"
            style="background: var(--bg-main); border-color: var(--border-subtle); color: var(--text-main)"
            @input="setNumber('area_from', ($event.target as HTMLInputElement).value)"
          />
          <input
            data-testid="profile-area-to"
            type="number"
            min="0"
            placeholder="До"
            :value="displayNumber(modelValue.area_to)"
            :disabled="disabled"
            class="w-full px-3 py-2 rounded-lg border text-sm"
            style="background: var(--bg-main); border-color: var(--border-subtle); color: var(--text-main)"
            @input="setNumber('area_to', ($event.target as HTMLInputElement).value)"
          />
        </div>
      </div>

      <div class="rounded-xl p-4 border" style="background: var(--bg-elevated); border-color: var(--border-subtle)">
        <label class="block text-sm font-semibold mb-1" style="color: var(--text-main)">Персональный дайджест</label>
        <div class="space-y-3">
          <input
            data-testid="profile-digest-email"
            type="email"
            :value="modelValue.digest_email"
            :disabled="disabled"
            placeholder="email@example.com"
            class="w-full px-3 py-2 rounded-lg border text-sm"
            style="background: var(--bg-main); border-color: var(--border-subtle); color: var(--text-main)"
            @input="setField('digest_email', ($event.target as HTMLInputElement).value)"
          />
          <label class="flex items-center gap-2 text-sm cursor-pointer" style="color: var(--text-main)">
            <input
              data-testid="profile-digest-enabled"
              type="checkbox"
              :checked="modelValue.digest_enabled"
              :disabled="disabled"
              class="rounded"
              @change="setField('digest_enabled', ($event.target as HTMLInputElement).checked)"
            />
            Включить дайджест
          </label>
        </div>
      </div>

      <div class="flex items-center gap-3">
        <button
          type="submit"
          :disabled="disabled"
          class="px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90 disabled:opacity-50"
          style="background: var(--accent)"
        >
          {{ submitLabel }}
        </button>
        <span v-if="error" class="text-sm" style="color: #fca5a5">{{ error }}</span>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import type { ProfileDraft, PropertyType, Region } from './user-profile-form'

const props = withDefaults(defineProps<{
  modelValue: ProfileDraft
  disabled?: boolean
  submitLabel?: string
  error?: string
}>(), {
  disabled: false,
  submitLabel: 'Сохранить',
  error: '',
})

const emit = defineEmits<{
  'update:modelValue': [value: ProfileDraft]
  submit: []
}>()

const regionOptions: Array<{ value: Region; label: string }> = [
  { value: 'moscow', label: 'Москва' },
  { value: 'mo', label: 'Московская область' },
  { value: 'other', label: 'Другие регионы' },
]

const propertyTypeOptions: Array<{ value: PropertyType; label: string }> = [
  { value: 'office', label: 'Офис' },
  { value: 'warehouse', label: 'Склад' },
  { value: 'retail', label: 'Торговля' },
  { value: 'production', label: 'Производство' },
  { value: 'free_purpose', label: 'Свободное назначение' },
  { value: 'apartment', label: 'Квартира' },
  { value: 'land', label: 'Земля' },
  { value: 'other', label: 'Другое' },
]

function updateField<K extends keyof ProfileDraft>(key: K, value: ProfileDraft[K]) {
  emit('update:modelValue', { ...props.modelValue, [key]: value })
}

function setField<K extends keyof ProfileDraft>(key: K, value: ProfileDraft[K]) {
  updateField(key, value)
}

function toggleValue(key: 'regions' | 'property_types', value: Region | PropertyType) {
  const current = props.modelValue[key] as Array<Region | PropertyType>
  const next = current.includes(value) ? current.filter(item => item !== value) : [...current, value]
  updateField(key, next as ProfileDraft[typeof key])
}

function setNumber(key: 'price_from' | 'price_to' | 'area_from' | 'area_to', value: string) {
  updateField(key, value.trim() === '' ? null : Number(value))
}

function setStopWords(value: string) {
  updateField('stop_words', value.split('\n'))
}

function displayNumber(value: number | null) {
  return value === null ? '' : value
}

</script>
