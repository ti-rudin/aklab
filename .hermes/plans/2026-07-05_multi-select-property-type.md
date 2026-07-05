# Multi-select property_type — Implementation Plan

**Goal:** Заменить все `<select>` фильтры по типу недвижимости на multi-select чекбоксы.

**Файлы:**
- `app/src/views/PropertyListView.vue` — 2 селекта (line 182, 418) + query builder (line 768, 817, 1058)
- `app/src/composables/useFocusTab.ts` — `focusFilters.property_type` (line 49, 62, 81)
- `app/src/views/DashboardView.vue` — навигация (line 75)
- `api/src/api/property/controllers/property.ts` — focus endpoint (line 111-113)

---

### Task 1: Composable — focusFilters.property_type → string[]

**File:** `app/src/composables/useFocusTab.ts`

- Line 49: `property_type: ''` → `property_type: [] as string[]`
- Line 62: `if (parsed.property_type) focusFilters.property_type = parsed.property_type` — оставить как есть (массив из localStorage)
- Line 81: `focusFilters.property_type = ''` → `focusFilters.property_type = []`

### Task 2: Backend focus endpoint — support comma-separated types

**File:** `api/src/api/property/controllers/property.ts`

Lines 111-113 заменить на:
```ts
if (propertyType) {
  const types = propertyType.split(',').map((t: string) => t.trim()).filter(Boolean);
  if (types.length === 1) {
    conditions.push("property_type = ?");
    params.push(types[0]);
  } else if (types.length > 1) {
    conditions.push(`property_type IN (${types.map(() => "?").join(",")})`);
    params.push(...types);
  }
}
```

### Task 3: PropertyListView — "Все объекты" фильтр

**File:** `app/src/views/PropertyListView.vue`

- Line 721: `property_type: ''` → `property_type: [] as string[]`
- Line 768: `if (filters.property_type) f.property_type = { $eq: filters.property_type }` →
  `if (filters.property_type.length) f.property_type = { $in: filters.property_type }`
- Line 779: `filters.property_type = ''` → `filters.property_type = []`
- Lines 181-192: заменить `<select>` на блок чекбоксов:
```html
<div>
  <label class="block text-xs mb-1" style="color: var(--text-muted)">Тип</label>
  <div class="flex flex-wrap gap-1">
    <label v-for="opt in typeOptions" :key="opt.value"
      class="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded cursor-pointer"
      :style="filters.property_type.includes(opt.value) ? 'background: var(--accent-soft); color: var(--accent)' : 'color: var(--text-muted)'">
      <input type="checkbox" :value="opt.value" v-model="filters.property_type" class="hidden" />
      {{ opt.label }}
    </label>
  </div>
</div>
```
- Добавить константу `typeOptions` в script:
```ts
const typeOptions = [
  { value: 'office', label: 'Офис' },
  { value: 'warehouse', label: 'Склад' },
  { value: 'retail', label: 'Торговля' },
  { value: 'production', label: 'Произв.' },
  { value: 'free_purpose', label: 'Св. назн.' },
  { value: 'apartment', label: 'Квартира' },
  { value: 'land', label: 'Участок' },
  { value: 'other', label: 'Другое' },
]
```

### Task 4: PropertyListView — "В фокусе" фильтр

**File:** `app/src/views/PropertyListView.vue`

- Lines 417-428: заменить `<select>` на аналогичный блок чекбоксов (используя `focusFilters.property_type`)
- Line 817: `if (focusFilters.property_type) params.type = focusFilters.property_type` →
  `if (focusFilters.property_type.length) params.type = focusFilters.property_type.join(',')`
- Line 1058: аналогично `params.type = focusFilters.property_type.join(',')`

### Task 5: Dashboard — навигация с массивом

**File:** `app/src/views/DashboardView.vue`

- Line 75: `router.push('/properties?property_type=${t.type}')` — оставить как есть (один тип из кнопки)

### Task 6: onMounted — чтение query param как массив

**File:** `app/src/views/PropertyListView.vue`

- Lines 1148-1150: обработать `route.query.property_type` как массив:
```ts
if (route.query.property_type) {
  const q = route.query.property_type
  filters.property_type = Array.isArray(q) ? q as string[] : (q as string).split(',')
}
```

### Task 7: Watcher — property_type deep watch

**File:** `app/src/views/PropertyListView.vue`

Проверить что watcher на `filters` ловит изменения массива. Если `watch([filters, ...])` — должен ловить deep. Проверить что page сбрасывается при смене типов.

---

**Deploy:** ТОЛЬКО по команде пользователя. После реализации — commit + push, ждать команды на deploy.
