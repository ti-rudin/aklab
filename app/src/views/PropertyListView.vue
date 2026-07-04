<template>
  <div class="max-w-screen-xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
    <div class="flex justify-between items-center mb-6">
      <h1 class="text-2xl font-bold" style="color: var(--text-main)">Объекты</h1>
      <div class="flex items-center gap-3">
        <span class="text-sm" style="color: var(--text-muted)">{{ activeTab === 'all' ? total : activeTab === 'focus' ? focusTotal : workTotal }} шт.</span>
        <button v-if="activeTab === 'all'"
          @click="confirmClearNew"
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
        @click="activeTab = 'all'; if (workStatusApplied) { filters.status = ''; workStatusApplied = false }"
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
        @click="switchToFocus"
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
        @click="switchToWork"
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

    <!-- ============================== -->
    <!-- ВСЕ ОБЪЕКТЫ (существующий UI) -->
    <!-- ============================== -->
    <template v-if="activeTab === 'all' || activeTab === 'work'">
      <!-- Диалог подтверждения очистки -->
      <div v-if="showClearDialog"
        class="fixed inset-0 z-50 flex items-center justify-center"
        style="background: rgba(0,0,0,0.5)">
        <div class="rounded-xl p-6 border max-w-md w-full mx-4 shadow-2xl"
          style="background: var(--bg-elevated); border-color: var(--border-subtle)">
          <h3 class="text-lg font-semibold mb-3" style="color: var(--text-main)">Подтверждение</h3>
          <p class="text-sm mb-6" style="color: var(--text-muted)">
            Вы уверены, что хотите удалить все объекты со статусом «Новый»? Это действие нельзя отменить.
          </p>
          <div class="flex justify-end gap-3">
            <button @click="showClearDialog = false"
              class="px-4 py-2 rounded-lg text-sm font-medium transition-colors hover:opacity-80"
              style="background: var(--bg-main); border: 1px solid var(--border-subtle); color: var(--text-main)">
              Отмена
            </button>
            <button @click="executeClearNew"
              class="px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors hover:opacity-90"
              style="background: #ef4444">
              Очистить
            </button>
          </div>
        </div>
      </div>

      <!-- Запуск парсинга -->
      <div v-if="activeTab === 'all'" class="mb-4">
        <button @click="launchFiltersOpen = !launchFiltersOpen" 
          class="flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg transition-colors hover:opacity-80"
          style="color: var(--text-muted)">
          <span>{{ launchFiltersOpen ? '▼' : '▶' }}</span>
          <span>Запуск парсинга</span>
          <span v-if="activeFilterCount > 0" class="px-1.5 py-0.5 text-xs rounded-full" 
            style="background: var(--accent); color: white">{{ activeFilterCount }}</span>
        </button>
        
        <div v-if="launchFiltersOpen" class="mt-3 p-4 rounded-xl border" 
          style="background: var(--bg-elevated); border-color: var(--border-subtle)">
          <!-- Price range -->
          <div class="mb-4">
            <label class="block text-xs font-medium mb-2" style="color: var(--text-muted)">Цена лота (₽)</label>
            <div class="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] gap-2 items-center">
              <input v-model="launchFilters.priceFrom" type="number" placeholder="от" min="0"
                class="w-full px-3 py-2 rounded-lg border text-sm"
                style="background: var(--bg-main); border-color: var(--border-subtle); color: var(--text-main)" />
              <span class="text-sm text-center hidden sm:inline" style="color: var(--text-muted)">—</span>
              <input v-model="launchFilters.priceTo" type="number" placeholder="до" min="0"
                class="w-full px-3 py-2 rounded-lg border text-sm"
                style="background: var(--bg-main); border-color: var(--border-subtle); color: var(--text-main)" />
            </div>
          </div>
          
          <!-- Cities -->
          <div class="mb-4">
            <label class="block text-xs font-medium mb-2" style="color: var(--text-muted)">Город</label>
            <div class="grid grid-cols-3 gap-2">
              <label class="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" v-model="launchFilters.cities.moscow" class="rounded flex-shrink-0" style="accent-color: var(--accent)" />
                <span class="text-sm" style="color: var(--text-main)">Москва</span>
              </label>
              <label class="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" v-model="launchFilters.cities.mo" class="rounded flex-shrink-0" style="accent-color: var(--accent)" />
                <span class="text-sm" style="color: var(--text-main)">МО</span>
              </label>
              <label class="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" v-model="launchFilters.cities.other" class="rounded flex-shrink-0" style="accent-color: var(--accent)" />
                <span class="text-sm" style="color: var(--text-main)">Другие</span>
              </label>
            </div>
          </div>
          
          <!-- Threshold -->
          <div class="mb-4">
            <label class="block text-xs font-medium mb-2" style="color: var(--text-muted)">
              Порог отсечения: <span class="font-semibold" style="color: var(--text-main)">{{ launchFilters.threshold }}%</span>
            </label>
            <div class="flex items-center gap-3">
              <input v-model.number="launchFilters.threshold" type="range" min="1" max="99" step="1"
                class="flex-1 min-w-0" style="accent-color: var(--accent)" />
              <input v-model.number="launchFilters.threshold" type="number" min="1" max="99"
                class="w-16 flex-shrink-0 px-2 py-1 rounded-lg border text-sm text-center"
                style="background: var(--bg-main); border-color: var(--border-subtle); color: var(--text-main)" />
            </div>
          </div>
          
          <!-- Actions -->
          <div class="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-2 pt-2 border-t" style="border-color: var(--border-subtle)">
            <div class="flex flex-col sm:flex-row gap-2 sm:gap-3">
              <button @click="resetLaunchFilters" class="text-sm px-3 py-1.5 rounded-lg hover:opacity-80 text-left"
                style="color: var(--text-muted)">Сбросить</button>
              <div class="flex items-center gap-2">
                <label class="text-xs whitespace-nowrap" style="color: var(--text-muted)">Глубина:</label>
                <input v-model.number="parseDepth" type="number" min="1" max="500"
                  class="w-20 px-2 py-1.5 rounded-lg border text-sm text-center"
                  style="background: var(--bg-main); border-color: var(--border-subtle); color: var(--text-main)" />
              </div>
            </div>
            <button
              @click="runPipeline"
              :disabled="pipelineStage !== 'idle' && pipelineStage !== 'done' && pipelineStage !== 'error'"
              class="px-4 py-2 rounded-lg text-sm font-semibold text-white transition-all duration-200 hover:opacity-90 disabled:opacity-50"
              :style="{
                background: pipelineStage === 'done' ? '#059669' : 'var(--accent)',
              }"
            >
              <template v-if="pipelineStage === 'idle' || pipelineStage === 'error'">▶ Ручной запуск</template>
              <template v-else-if="pipelineStage === 'done'">Готово — ещё раз</template>
              <template v-else>Выполняется...</template>
            </button>
          </div>
        </div>
      </div>

      <!-- Прогресс пайплайна -->
      <div v-if="pipelineStage !== 'idle'" class="mb-6 p-3 sm:p-4 rounded-lg space-y-2 sm:space-y-3" style="background: var(--bg-elevated); border: 1px solid var(--border-subtle)">
        <!-- Парсинг -->
        <div class="flex items-center gap-3">
          <span class="flex-shrink-0 w-5 text-center">
            <template v-if="pipelineStage === 'parsing'">⏳</template>
            <template v-else-if="parseDone">✓</template>
            <template v-else>○</template>
          </span>
          <div class="flex-1">
            <div class="text-sm font-medium" style="color: var(--text-primary)">Парсинг</div>
            <div class="text-xs" style="color: var(--text-muted)">
              <template v-if="pipelineStage === 'parsing'">
                {{ parseSourcesDone }}/{{ parseSourcesTotal }} источников
                <template v-if="detailsNeeded > 0"> · {{ detailsFetched }}/{{ detailsNeeded }} детальных</template>
              </template>
              <template v-else-if="parseDone">
                {{ parseSourcesTotal }} источников, {{ pipelineResults.parseTotal }} объектов
                <template v-if="pipelineResults.detailsNeeded > 0"> · {{ pipelineResults.detailsFetched }}/{{ pipelineResults.detailsNeeded }} детальных</template>
                <template v-if="pipelineResults.parseErrors > 0">, {{ pipelineResults.parseErrors }} ошибок</template>
              </template>
              <template v-else>Ожидание...</template>
            </div>
          </div>
        </div>

        <!-- Analyze -->
        <div class="flex items-center gap-3">
          <span class="flex-shrink-0 w-5 text-center">
            <template v-if="pipelineStage === 'analyzing'">⏳</template>
            <template v-else-if="analyzeDone">✓</template>
            <template v-else>○</template>
          </span>
          <div class="flex-1">
            <div class="text-sm font-medium" style="color: var(--text-primary)">Анализ</div>
            <div class="text-xs" style="color: var(--text-muted)">
              <template v-if="pipelineStage === 'analyzing'">
                {{ analyzePending }} объектов в очереди
              </template>
              <template v-else-if="analyzeDone">
                {{ pipelineResults.undervaluedTotal }} недооценённых
                <template v-if="pipelineResults.undervaluedByCity.moscow"> · МСК: {{ pipelineResults.undervaluedByCity.moscow }}</template>
                <template v-if="pipelineResults.undervaluedByCity.mo"> · МО: {{ pipelineResults.undervaluedByCity.mo }}</template>
                <template v-if="pipelineResults.undervaluedByCity.other"> · Регионы: {{ pipelineResults.undervaluedByCity.other }}</template>
              </template>
              <template v-else>Ожидание...</template>
            </div>
          </div>
        </div>

        <!-- Digest -->
        <div class="flex items-center gap-3">
          <span class="flex-shrink-0 w-5 text-center">
            <template v-if="pipelineStage === 'digesting'">⏳</template>
            <template v-else-if="digestDone">✓</template>
            <template v-else>○</template>
          </span>
          <div class="flex-1">
            <div class="text-sm font-medium" style="color: var(--text-primary)">Дайджест</div>
            <div class="text-xs" style="color: var(--text-muted)">
              <template v-if="pipelineStage === 'digesting'">Отправка email...</template>
              <template v-else-if="digestDone && pipelineResults.digestSent">
                Отправлено {{ pipelineResults.digestCount }} объектов
              </template>
              <template v-else-if="digestDone && pipelineResults.digestSkipped">
                Нет недооценённых объектов в выбранных регионах
              </template>
              <template v-else-if="digestDone">Отправлен</template>
              <template v-else>Ожидание...</template>
            </div>
          </div>
        </div>

        <!-- Done -->
        <div v-if="pipelineStage === 'done'" class="pt-2 border-t text-sm font-medium text-center" style="border-color: var(--border-subtle); color: #059669">
          ✓ Пайплайн завершён · Новых объектов: {{ pipelineResults.parseTotal }}
          <template v-if="pipelineResults.detailsNeeded > 0"> · Детальных: {{ pipelineResults.detailsFetched }}/{{ pipelineResults.detailsNeeded }}</template>
          · Анализ: {{ pipelineResults.undervaluedTotal }} недооценённых · Дайджест: {{ pipelineResults.digestSent ? 'отправлен на ' + pipelineResults.digestCount + ' объектов' : 'не отправлен (нет объектов)' }}
        </div>

        <!-- Error -->
        <div v-if="pipelineStage === 'error'" class="pt-2 border-t text-sm font-medium text-center" style="border-color: var(--border-subtle); color: #ef4444">
          ✗ {{ pipelineError || 'Ошибка пайплайна' }}
        </div>
      </div>

      <!-- Фильтры -->
      <div class="rounded-xl p-3 sm:p-4 border mb-6 grid grid-cols-2 sm:flex sm:flex-row sm:flex-wrap gap-2 sm:gap-3 items-end" style="background: var(--bg-elevated); border-color: var(--border-subtle)">
        <div>
          <label class="block text-xs mb-1" style="color: var(--text-muted)">Город</label>
          <select v-model="filters.city" class="w-full px-2 py-1.5 rounded-lg border text-sm" style="background: var(--bg-main); border-color: var(--border-subtle); color: var(--text-main)">
            <option value="">Все</option>
            <option value="moscow">Москва</option>
            <option value="mo">МО</option>
            <option value="other">Другой</option>
          </select>
        </div>
        <div v-if="activeTab !== 'work'">
          <label class="block text-xs mb-1" style="color: var(--text-muted)">Статус</label>
          <select v-model="filters.status" class="w-full px-2 py-1.5 rounded-lg border text-sm" style="background: var(--bg-main); border-color: var(--border-subtle); color: var(--text-main)">
            <option value="">Все</option>
            <option value="new">Новый</option>
            <option value="in_progress">В работе</option>
            <option value="viewed">Просмотрен</option>
            <option value="rejected">Отклонён</option>
          </select>
        </div>
        <div>
          <label class="block text-xs mb-1" style="color: var(--text-muted)">Источник</label>
          <select v-model="filters.source" class="w-full px-2 py-1.5 rounded-lg border text-sm" style="background: var(--bg-main); border-color: var(--border-subtle); color: var(--text-main)">
            <option value="">Все</option>
            <option v-for="s in sources" :key="s" :value="s">{{ s }}</option>
          </select>
        </div>
        <div>
          <label class="block text-xs mb-1" style="color: var(--text-muted)">Тип</label>
          <select v-model="filters.property_type" class="w-full px-2 py-1.5 rounded-lg border text-sm" style="background: var(--bg-main); border-color: var(--border-subtle); color: var(--text-main)">
            <option value="">Все</option>
            <option value="office">Офис</option>
            <option value="warehouse">Склад</option>
            <option value="retail">Торговля</option>
            <option value="production">Производство</option>
            <option value="free_purpose">Св. назначения</option>
            <option value="other">Другое</option>
          </select>
        </div>
        <label class="flex items-center gap-2 cursor-pointer px-2 py-1.5 col-span-2 sm:col-span-1">
          <input type="checkbox" v-model="filters.undervalued" class="rounded" />
          <span class="text-sm" style="color: var(--text-muted)">Только недооценённые</span>
        </label>
        <button @click="resetFilters" class="col-span-2 sm:col-span-1 px-3 py-1.5 rounded-lg border text-sm hover:opacity-80" style="border-color: var(--border-subtle); color: var(--text-muted)">Сбросить</button>
      </div>

      <!-- Loading -->
      <SkeletonTable v-if="loading" :rows="6" />

      <!-- Пусто -->
      <div v-else-if="items.length === 0" class="text-center py-16">
        <p class="text-lg mb-2" style="color: var(--text-muted)">Нет объектов</p>
        <p class="text-sm" style="color: var(--text-muted)">Парсеры ещё не нашли подходящих объектов</p>
      </div>

      <!-- Desktop: Таблица -->
      <div v-else class="hidden md:block rounded-xl border overflow-x-auto" style="border-color: var(--border-subtle)">
        <table class="w-full text-sm">
          <thead>
            <tr style="background: var(--bg-elevated)">
              <th class="text-left px-3 py-2 font-semibold whitespace-nowrap" style="color: var(--text-muted)">Название</th>
              <th class="text-left px-3 py-2 font-semibold" style="color: var(--text-muted)">Адрес</th>
              <th class="text-left px-3 py-2 font-semibold" style="color: var(--text-muted)">Город</th>
              <th class="text-left px-3 py-2 font-semibold" style="color: var(--text-muted)">Тип</th>
              <th @click="toggleSort('area_sqm')" class="text-right px-3 py-2 font-semibold cursor-pointer select-none hover:opacity-80" style="color: var(--text-muted)">
                Площадь <span v-if="sort.field === 'area_sqm'">{{ sort.direction === 'asc' ? '↑' : '↓' }}</span>
              </th>
              <th class="text-right px-3 py-2 font-semibold" style="color: var(--text-muted)">Цена</th>
              <th @click="toggleSort('price_per_sqm')" class="text-right px-3 py-2 font-semibold cursor-pointer select-none hover:opacity-80" style="color: var(--text-muted)">
                ₽/м² <span v-if="sort.field === 'price_per_sqm'">{{ sort.direction === 'asc' ? '↑' : '↓' }}</span>
              </th>
              <th class="text-center px-3 py-2 font-semibold" style="color: var(--text-muted)">Статус</th>
              <th @click="toggleSort('deviation_percent')" class="text-center px-3 py-2 font-semibold cursor-pointer select-none hover:opacity-80" style="color: var(--text-muted)">
                Оценка <span v-if="sort.field === 'deviation_percent'">{{ sort.direction === 'asc' ? '↑' : '↓' }}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in items" :key="item.id"
              class="border-t cursor-pointer transition-colors hover:opacity-80"
              :style="{ borderColor: 'var(--border-subtle)' }"
              @click="router.push(`/properties/${item.documentId}`)">
              <td class="px-3 py-2 max-w-[200px] truncate font-medium" style="color: var(--text-main)">{{ item.title }}</td>
              <td class="px-3 py-2 max-w-[200px] truncate" style="color: var(--text-muted)">{{ item.address || '—' }}</td>
              <td class="px-3 py-2 whitespace-nowrap" style="color: var(--text-main)">{{ cityLabel(item.city) }}</td>
              <td class="px-3 py-2 whitespace-nowrap" style="color: var(--text-muted)">{{ typeLabel(item.property_type) }}</td>
              <td class="px-3 py-2 text-right font-mono" style="color: var(--text-main)">{{ item.area_sqm ? `${item.area_sqm} м²` : '—' }}</td>
              <td class="px-3 py-2 text-right font-mono" style="color: var(--text-main)">{{ item.price ? formatPrice(item.price) : '—' }}</td>
              <td class="px-3 py-2 text-right font-mono" style="color: var(--text-main)">{{ item.price_per_sqm ? formatPrice(item.price_per_sqm) : '—' }}</td>
              <td class="px-3 py-2 text-center">
                <span class="text-xs px-2 py-0.5 rounded-full" :style="statusStyle(item.status || 'unknown')">{{ statusLabel(item.status || 'unknown') }}</span>
              </td>
              <td class="px-3 py-2 text-center">
                <span v-if="item.is_undervalued" class="text-xs px-2 py-0.5 rounded-full font-semibold" style="background: rgba(251,191,36,0.15); color: #f59e0b">
                  ⚠ {{ item.deviation_percent }}%
                </span>
                <span v-else class="text-xs" style="color: var(--text-muted)">—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Mobile: Карточки -->
      <div v-if="!loading && items.length > 0" class="md:hidden space-y-3">
        <div
          v-for="item in items"
          :key="item.id"
          class="rounded-xl border p-4 cursor-pointer transition-all hover:shadow-lg"
          style="background: var(--bg-elevated); border-color: var(--border-subtle)"
          @click="router.push(`/properties/${item.documentId}`)"
        >
          <!-- Заголовок + badges -->
          <div class="flex items-start justify-between gap-2 mb-2">
            <h3 class="font-semibold text-sm truncate flex-1" style="color: var(--text-main)">{{ item.title }}</h3>
            <div class="flex items-center gap-1.5 shrink-0">
              <span class="text-xs px-2 py-0.5 rounded-full whitespace-nowrap" :style="statusStyle(item.status || 'unknown')">{{ statusLabel(item.status || 'unknown') }}</span>
              <span v-if="item.is_undervalued" class="text-xs px-2 py-0.5 rounded-full font-semibold whitespace-nowrap" style="background: rgba(251,191,36,0.15); color: #f59e0b">
                ⚠ {{ item.deviation_percent }}%
              </span>
            </div>
          </div>

          <!-- Адрес + город + тип -->
          <div class="text-xs mb-3" style="color: var(--text-muted)">
            <span v-if="item.address">{{ item.address }}</span>
            <span v-if="item.address && (item.city || item.property_type)"> · </span>
            <span v-if="item.city">{{ cityLabel(item.city) }}</span>
            <span v-if="item.city && item.property_type"> · </span>
            <span v-if="item.property_type">{{ typeLabel(item.property_type) }}</span>
          </div>

          <!-- Метрики -->
          <div class="grid grid-cols-3 gap-3">
            <div>
              <div class="text-xs" style="color: var(--text-muted)">Площадь</div>
              <div class="text-sm font-mono font-medium" style="color: var(--text-main)">{{ item.area_sqm ? `${item.area_sqm} м²` : '—' }}</div>
            </div>
            <div>
              <div class="text-xs" style="color: var(--text-muted)">Цена</div>
              <div class="text-sm font-mono font-medium" style="color: var(--text-main)">{{ item.price ? formatPrice(item.price) : '—' }}</div>
            </div>
            <div>
              <div class="text-xs" style="color: var(--text-muted)">₽/м²</div>
              <div class="text-sm font-mono font-medium" style="color: var(--text-main)">{{ item.price_per_sqm ? formatPrice(item.price_per_sqm) : '—' }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Пагинация -->
      <div v-if="totalPages > 1" class="flex justify-center items-center gap-1 sm:gap-2 mt-6">
        <button @click="page > 1 && page--" :disabled="page <= 1"
          class="px-2 py-1 sm:px-3 rounded-lg text-sm disabled:opacity-40"
          :style="{ background: 'var(--bg-elevated)', color: 'var(--text-main)', border: '1px solid var(--border-subtle)' }">
          ‹
        </button>
        <template v-for="p in visiblePages" :key="String(p)">
          <span v-if="p === '...'" class="px-1 text-sm hidden sm:inline" style="color: var(--text-muted)">…</span>
          <button v-else @click="page = Number(p)"
            class="px-2 py-1 sm:px-3 rounded-lg text-xs sm:text-sm hidden sm:inline-block"
            :style="{ background: p === page ? 'var(--accent)' : 'var(--bg-elevated)', color: p === page ? 'white' : 'var(--text-main)', border: '1px solid var(--border-subtle)' }">
            {{ p }}
          </button>
        </template>
        <span class="sm:hidden text-xs px-2" style="color: var(--text-muted)">{{ page }} / {{ totalPages }}</span>
        <button @click="page < totalPages && page++" :disabled="page >= totalPages"
          class="px-2 py-1 sm:px-3 rounded-lg text-sm disabled:opacity-40"
          :style="{ background: 'var(--bg-elevated)', color: 'var(--text-main)', border: '1px solid var(--border-subtle)' }">
          ›
        </button>
      </div>
    </template>

    <!-- ============================== -->
    <!-- В ФОКУСЕ (новый UI)           -->
    <!-- ============================== -->
    <template v-if="activeTab === 'focus'">
      <!-- Stats header -->
      <div class="mb-4 text-sm font-medium" style="color: var(--text-main)">
        В фокусе: <span class="font-bold">{{ focusTotal }}</span> объектов
        <template v-if="focusAvgScore !== null"> · Средний скор: <span class="font-bold">{{ focusAvgScore }}</span></template>
      </div>

      <!-- Action buttons -->
      <div class="flex flex-col sm:flex-row gap-2 sm:gap-3 mb-4">
        <button
          @click="recalculateScore"
          :disabled="scoringLoading"
          class="w-full sm:w-auto px-4 py-2.5 sm:py-2 rounded-lg text-sm font-semibold transition-all duration-200 hover:opacity-90 disabled:opacity-50"
          style="background: var(--bg-elevated); border: 1px solid var(--border-subtle); color: var(--text-main)"
        >
          {{ scoringLoading ? 'Пересчёт...' : '🔄 Пересчитать' }}
        </button>
        <button
          @click="exportCSV"
          class="w-full sm:w-auto px-4 py-2.5 sm:py-2 rounded-lg text-sm font-semibold transition-all duration-200 hover:opacity-90"
          style="background: var(--bg-elevated); border: 1px solid var(--border-subtle); color: var(--text-main)"
        >
          📥 Экспорт CSV
        </button>
      </div>

      <!-- Focus filters -->
      <div class="rounded-xl p-3 sm:p-4 border mb-6" style="background: var(--bg-elevated); border-color: var(--border-subtle)">
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <!-- Порог (threshold) -->
          <div>
            <label class="block text-xs font-medium mb-2" style="color: var(--text-muted)">
              Порог: <span class="font-semibold" style="color: var(--text-main)">{{ focusFilters.threshold }}</span>
            </label>
            <div class="flex items-center gap-3">
              <input v-model.number="focusFilters.threshold" type="range" min="0" max="100" step="1"
                class="flex-1 min-w-0" style="accent-color: var(--accent)" />
              <input v-model.number="focusFilters.threshold" type="number" min="0" max="100"
                class="w-16 flex-shrink-0 px-2 py-1 rounded-lg border text-sm text-center"
                style="background: var(--bg-main); border-color: var(--border-subtle); color: var(--text-main)" />
            </div>
          </div>

          <!-- Город (checkboxes) -->
          <div>
            <label class="block text-xs font-medium mb-2" style="color: var(--text-muted)">Город</label>
            <div class="flex flex-wrap gap-3">
              <label class="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" v-model="focusFilters.cities.moscow" class="rounded" style="accent-color: var(--accent)" />
                <span class="text-sm" style="color: var(--text-main)">Москва</span>
              </label>
              <label class="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" v-model="focusFilters.cities.mo" class="rounded" style="accent-color: var(--accent)" />
                <span class="text-sm" style="color: var(--text-main)">МО</span>
              </label>
              <label class="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" v-model="focusFilters.cities.other" class="rounded" style="accent-color: var(--accent)" />
                <span class="text-sm" style="color: var(--text-main)">Другие</span>
              </label>
            </div>
          </div>

          <!-- Тип недвижимости -->
          <div>
            <label class="block text-xs font-medium mb-2" style="color: var(--text-muted)">Тип недвижимости</label>
            <select v-model="focusFilters.property_type" class="w-full px-2 py-1.5 rounded-lg border text-sm" style="background: var(--bg-main); border-color: var(--border-subtle); color: var(--text-main)">
              <option value="">Все</option>
              <option value="office">Офис</option>
              <option value="warehouse">Склад</option>
              <option value="retail">Торговля</option>
              <option value="production">Производство</option>
              <option value="free_purpose">Св. назначения</option>
              <option value="other">Другое</option>
            </select>
          </div>

          <!-- Теги -->
          <div class="sm:col-span-2 lg:col-span-1">
            <label class="block text-xs font-medium mb-2" style="color: var(--text-muted)">Теги</label>
            <div class="flex flex-wrap gap-2">
              <label v-for="tag in availableTags" :key="tag.value" class="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" :value="tag.value" v-model="focusFilters.tags" class="rounded" style="accent-color: var(--accent)" />
                <span class="text-xs px-1.5 py-0.5 rounded-full" :style="{ background: tag.bgColor, color: tag.textColor }">{{ tag.label }}</span>
              </label>
            </div>
          </div>

          <!-- Цена -->
          <div>
            <label class="block text-xs font-medium mb-2" style="color: var(--text-muted)">Цена (₽)</label>
            <div class="flex gap-2 items-center">
              <input v-model="focusFilters.priceFrom" type="number" placeholder="от" min="0"
                class="w-full px-2 py-1.5 rounded-lg border text-sm"
                style="background: var(--bg-main); border-color: var(--border-subtle); color: var(--text-main)" />
              <span class="text-sm" style="color: var(--text-muted)">—</span>
              <input v-model="focusFilters.priceTo" type="number" placeholder="до" min="0"
                class="w-full px-2 py-1.5 rounded-lg border text-sm"
                style="background: var(--bg-main); border-color: var(--border-subtle); color: var(--text-main)" />
            </div>
          </div>
        </div>

        <!-- Reset -->
        <div class="mt-3 pt-2 border-t flex justify-end" style="border-color: var(--border-subtle)">
          <button @click="resetFocusFilters" class="text-sm px-3 py-1.5 rounded-lg hover:opacity-80"
            style="color: var(--text-muted)">Сбросить фильтры</button>
        </div>
      </div>

      <!-- Loading -->
      <SkeletonTable v-if="focusLoading" :rows="6" />

      <!-- Пусто -->
      <div v-else-if="focusItems.length === 0" class="text-center py-16">
        <p class="text-lg mb-2" style="color: var(--text-muted)">Нет объектов в фокусе</p>
        <p class="text-sm" style="color: var(--text-muted)">Запустите пересчёт скоров или измените фильтры</p>
      </div>

      <!-- Desktop: Focus Table -->
      <div v-else class="hidden md:block rounded-xl border overflow-x-auto" style="border-color: var(--border-subtle)">
        <table class="w-full text-sm">
          <thead>
            <tr style="background: var(--bg-elevated)">
              <th class="px-3 py-2 w-8">
                <input type="checkbox" :checked="allFocusChecked" @change="toggleAllFocus" class="rounded" style="accent-color: var(--accent)" />
              </th>
              <th @click="toggleFocusSort('title')" class="text-left px-3 py-2 font-semibold cursor-pointer select-none hover:opacity-80 whitespace-nowrap" style="color: var(--text-muted)">
                Название <span v-if="focusSort.field === 'title'">{{ focusSort.direction === 'asc' ? '↑' : '↓' }}</span>
              </th>
              <th class="text-left px-3 py-2 font-semibold" style="color: var(--text-muted)">Адрес</th>
              <th class="text-left px-3 py-2 font-semibold" style="color: var(--text-muted)">Город</th>
              <th class="text-left px-3 py-2 font-semibold" style="color: var(--text-muted)">Тип</th>
              <th @click="toggleFocusSort('area_sqm')" class="text-right px-3 py-2 font-semibold cursor-pointer select-none hover:opacity-80" style="color: var(--text-muted)">
                Площадь <span v-if="focusSort.field === 'area_sqm'">{{ focusSort.direction === 'asc' ? '↑' : '↓' }}</span>
              </th>
              <th @click="toggleFocusSort('price_per_sqm')" class="text-right px-3 py-2 font-semibold cursor-pointer select-none hover:opacity-80" style="color: var(--text-muted)">
                ₽/м² <span v-if="focusSort.field === 'price_per_sqm'">{{ focusSort.direction === 'asc' ? '↑' : '↓' }}</span>
              </th>
              <th @click="toggleFocusSort('focus_score')" class="text-right px-3 py-2 font-semibold cursor-pointer select-none hover:opacity-80" style="color: var(--text-muted)">
                Скор <span v-if="focusSort.field === 'focus_score'">{{ focusSort.direction === 'asc' ? '↑' : '↓' }}</span>
              </th>
              <th class="text-center px-3 py-2 font-semibold" style="color: var(--text-muted)">Теги</th>
              <th @click="toggleFocusSort('deviation_percent')" class="text-center px-3 py-2 font-semibold cursor-pointer select-none hover:opacity-80" style="color: var(--text-muted)">
                Оценка <span v-if="focusSort.field === 'deviation_percent'">{{ focusSort.direction === 'asc' ? '↑' : '↓' }}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in focusItems" :key="item.id"
              class="border-t cursor-pointer transition-colors hover:opacity-80"
              :style="{ borderColor: 'var(--border-subtle)' }">
              <td class="px-3 py-2" @click.stop>
                <input type="checkbox" :checked="focusSelected.has(item.id)" @change="toggleFocusSelect(item.id)" class="rounded" style="accent-color: var(--accent)" />
              </td>
              <td class="px-3 py-2 max-w-[200px] truncate font-medium" style="color: var(--text-main)"
                @click="router.push(`/properties/${item.documentId}`)">{{ item.title }}</td>
              <td class="px-3 py-2 max-w-[200px] truncate" style="color: var(--text-muted)"
                @click="router.push(`/properties/${item.documentId}`)">{{ item.address || '—' }}</td>
              <td class="px-3 py-2 whitespace-nowrap" style="color: var(--text-main)"
                @click="router.push(`/properties/${item.documentId}`)">{{ cityLabel(item.city) }}</td>
              <td class="px-3 py-2 whitespace-nowrap" style="color: var(--text-muted)"
                @click="router.push(`/properties/${item.documentId}`)">{{ typeLabel(item.property_type) }}</td>
              <td class="px-3 py-2 text-right font-mono" style="color: var(--text-main)"
                @click="router.push(`/properties/${item.documentId}`)">{{ item.area_sqm ? `${item.area_sqm} м²` : '—' }}</td>
              <td class="px-3 py-2 text-right font-mono" style="color: var(--text-main)"
                @click="router.push(`/properties/${item.documentId}`)">{{ item.price_per_sqm ? formatPrice(item.price_per_sqm) : '—' }}</td>
              <td class="px-3 py-2 text-right font-mono font-semibold" style="color: var(--text-main)"
                @click="router.push(`/properties/${item.documentId}`)">{{ item.focus_score ?? '—' }}</td>
              <td class="px-3 py-2" @click="router.push(`/properties/${item.documentId}`)">
                <div class="flex flex-wrap gap-1">
                  <span v-for="tag in (item.tags || [])" :key="tag" class="text-xs px-1.5 py-0.5 rounded-full whitespace-nowrap" :style="tagStyle(tag)">{{ tagLabel(tag) }}</span>
                  <span v-if="!item.tags || item.tags.length === 0" class="text-xs" style="color: var(--text-muted)">—</span>
                </div>
              </td>
              <td class="px-3 py-2 text-center" @click="router.push(`/properties/${item.documentId}`)">
                <div class="flex items-center justify-center gap-1.5">
                  <span v-if="item.has_minimum_price" class="text-xs px-1.5 py-0.5 rounded-full font-semibold" style="background: rgba(79,140,255,0.15); color: #4f8cff">Торги</span>
                  <span v-if="item.deviation_percent != null" class="text-xs px-2 py-0.5 rounded-full font-semibold" :style="deviationStyle(Number(item.deviation_percent))">
                    {{ item.deviation_percent }}%
                  </span>
                  <span v-if="item.deviation_percent == null && !item.has_minimum_price" class="text-xs" style="color: var(--text-muted)">—</span>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Mobile: Focus Cards -->
      <div v-if="!focusLoading && focusItems.length > 0" class="md:hidden space-y-3">
        <div
          v-for="item in focusItems"
          :key="item.id"
          class="rounded-xl border p-4 transition-all hover:shadow-lg"
          style="background: var(--bg-elevated); border-color: var(--border-subtle)"
        >
          <div class="flex items-start gap-2 mb-2">
            <input type="checkbox" :checked="focusSelected.has(item.id)" @change="toggleFocusSelect(item.id)" class="rounded mt-1 flex-shrink-0" style="accent-color: var(--accent)" />
            <div class="flex-1 min-w-0 cursor-pointer" @click="router.push(`/properties/${item.documentId}`)">
              <h3 class="font-semibold text-sm truncate" style="color: var(--text-main)">{{ item.title }}</h3>
              <div class="text-xs" style="color: var(--text-muted)">
                <span v-if="item.address">{{ item.address }}</span>
                <span v-if="item.address && (item.city || item.property_type)"> · </span>
                <span v-if="item.city">{{ cityLabel(item.city) }}</span>
                <span v-if="item.city && item.property_type"> · </span>
                <span v-if="item.property_type">{{ typeLabel(item.property_type) }}</span>
              </div>
            </div>
          </div>
          <div class="grid grid-cols-3 gap-3 mb-2">
            <div>
              <div class="text-xs" style="color: var(--text-muted)">Площадь</div>
              <div class="text-sm font-mono font-medium" style="color: var(--text-main)">{{ item.area_sqm ? `${item.area_sqm} м²` : '—' }}</div>
            </div>
            <div>
              <div class="text-xs" style="color: var(--text-muted)">₽/м²</div>
              <div class="text-sm font-mono font-medium" style="color: var(--text-main)">{{ item.price_per_sqm ? formatPrice(item.price_per_sqm) : '—' }}</div>
            </div>
            <div>
              <div class="text-xs" style="color: var(--text-muted)">Скор</div>
              <div class="text-sm font-mono font-semibold" style="color: var(--text-main)">{{ item.focus_score ?? '—' }}</div>
            </div>
          </div>
          <!-- Tags + deviation -->
          <div class="flex flex-wrap gap-1">
            <span v-for="tag in (item.tags || [])" :key="tag" class="text-xs px-1.5 py-0.5 rounded-full" :style="tagStyle(tag)">{{ tagLabel(tag) }}</span>
            <span v-if="item.has_minimum_price" class="text-xs px-1.5 py-0.5 rounded-full font-semibold" style="background: rgba(79,140,255,0.15); color: #4f8cff">Торги</span>
            <span v-if="item.deviation_percent != null" class="text-xs px-2 py-0.5 rounded-full font-semibold" :style="deviationStyle(Number(item.deviation_percent))">{{ item.deviation_percent }}%</span>
          </div>
        </div>
      </div>

      <!-- Focus Pagination -->
      <div v-if="focusTotalPages > 1" class="flex justify-between items-center mt-6">
        <span class="text-xs" style="color: var(--text-muted)">
          Показано {{ (focusPage - 1) * focusPageSize + 1 }}-{{ Math.min(focusPage * focusPageSize, focusTotal) }} из {{ focusTotal }}
        </span>
        <div class="flex gap-2">
          <button @click="focusPage > 1 && focusPage--" :disabled="focusPage <= 1"
            class="px-3 py-1 rounded-lg text-sm disabled:opacity-40"
            :style="{ background: 'var(--bg-elevated)', color: 'var(--text-main)', border: '1px solid var(--border-subtle)' }">
            ‹ Назад
          </button>
          <button @click="focusPage < focusTotalPages && focusPage++" :disabled="focusPage >= focusTotalPages"
            class="px-3 py-1 rounded-lg text-sm disabled:opacity-40"
            :style="{ background: 'var(--bg-elevated)', color: 'var(--text-main)', border: '1px solid var(--border-subtle)' }">
            Вперёд ›
          </button>
        </div>
      </div>

      <!-- Bulk action bar (floating) -->
      <div v-if="focusSelected.size > 0"
        class="fixed bottom-6 left-1/2 -translate-x-1/2 px-5 py-3 rounded-2xl shadow-2xl flex items-center gap-4 z-50"
        style="background: var(--bg-elevated); border: 1px solid var(--border-subtle)">
        <span class="text-sm font-medium" style="color: var(--text-main)">Выбрано: {{ focusSelected.size }}</span>
        <div class="flex gap-2">
          <button @click="bulkSetStatus('viewed')" class="text-xs px-3 py-1.5 rounded-lg hover:opacity-80" style="background: rgba(16,185,129,0.15); color: #10b981">Просмотрено</button>
          <button @click="bulkSetStatus('rejected')" class="text-xs px-3 py-1.5 rounded-lg hover:opacity-80" style="background: rgba(239,68,68,0.15); color: #ef4444">Отклонён</button>
          <button @click="bulkExportCSV" class="text-xs px-3 py-1.5 rounded-lg hover:opacity-80" style="background: rgba(79,140,255,0.15); color: #4f8cff">CSV</button>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import SkeletonTable from '@/components/SkeletonTable.vue'
import { ref, reactive, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import api from '@/api/strapi'
import { cityLabel, typeLabel, statusLabel, statusStyle, formatPrice } from '@/utils/formatters'
import { usePropertyData, type Property } from '@/composables/usePropertyData'
import { useFocusTab } from '@/composables/useFocusTab'

const router = useRouter()

// ========================
// Data composable
// ========================
const {
  properties: items,
  focusProperties: focusItems,
  loading,
  focusLoading,
  error,
  total,
  focusTotal,
  focusAvgScore,
  fetchProperties,
  fetchFocusProperties,
} = usePropertyData()

// ========================
// Focus tab composable
// ========================
let doFetchFocus: () => void = () => {}

const {
  activeTab,
  focusSort,
  toggleFocusSort,
  focusFilters,
  resetFocusFilters,
  availableTags,
  focusPage,
  focusPageSize,
  focusTotalPages,
  focusSelected,
  allFocusChecked,
  toggleFocusSelect,
  toggleAllFocus,
  tagStyle,
  tagLabel,
  deviationStyle,
  switchToFocus,
} = useFocusTab(() => doFetchFocus(), focusTotal, focusItems)

// ========================
// В РАБОТЕ — state
// ========================
const workTotal = ref(0)
const workStatusApplied = ref(false)

async function fetchWorkTotal() {
  try {
    const res = await api.get('/properties', {
      params: { 'filters[status][$eq]': 'in_progress', 'pagination[pageSize]': 1 },
    })
    workTotal.value = res.data?.meta?.pagination?.total || 0
  } catch { workTotal.value = 0 }
}

function switchToWork() {
  activeTab.value = 'work'
  if (!workStatusApplied.value) {
    filters.status = 'in_progress'
    workStatusApplied.value = true
  }
  fetchWorkTotal()
}

// ========================
// ВСЕ ОБЪЕКТЫ — state
// ========================
const sources = ['fedresurs', 'aggregator-bankrot', 'torgi-gov', 'investmoscow', 'invest-mosreg', 'roseltorg', 'fabrikant', 'alfalot', 'etprf', 'sberbank-ast', 'm-ets']

const sort = reactive({
  field: 'createdAt' as string,
  direction: 'desc' as 'asc' | 'desc',
})

function toggleSort(field: string) {
  if (sort.field === field) {
    sort.direction = sort.direction === 'asc' ? 'desc' : 'asc'
  } else {
    sort.field = field
    sort.direction = 'desc'
  }
}

const filters = reactive({
  city: '',
  status: '',
  source: '',
  property_type: '',
  undervalued: false,
})

// Launch filters (for pipeline analysis step)
const launchFiltersOpen = ref(false)
const launchFilters = reactive({
  priceFrom: '',
  priceTo: '',
  cities: { moscow: true, mo: true, other: false },
  threshold: 20,
})

// Load from localStorage
try {
  const saved = localStorage.getItem('aklab-launch-filters')
  if (saved) {
    const parsed = JSON.parse(saved)
    if (parsed.priceFrom) launchFilters.priceFrom = parsed.priceFrom
    if (parsed.priceTo) launchFilters.priceTo = parsed.priceTo
    if (parsed.cities) Object.assign(launchFilters.cities, parsed.cities)
    if (parsed.threshold) launchFilters.threshold = parsed.threshold
  }
} catch {}

// Save to localStorage on change
watch(launchFilters, (val) => {
  try {
    localStorage.setItem('aklab-launch-filters', JSON.stringify(val))
  } catch {}
}, { deep: true })

const activeFilterCount = computed(() => {
  let count = 0
  if (launchFilters.priceFrom) count++
  if (launchFilters.priceTo) count++
  if (launchFilters.threshold !== 20) count++
  if (!launchFilters.cities.moscow || !launchFilters.cities.mo || launchFilters.cities.other) count++
  return count
})

function resetLaunchFilters() {
  launchFilters.priceFrom = ''
  launchFilters.priceTo = ''
  launchFilters.cities.moscow = true
  launchFilters.cities.mo = true
  launchFilters.cities.other = false
  launchFilters.threshold = 20
}

// ========================
// ВСЕ ОБЪЕКТЫ — pagination
// ========================
const pageSize = 25
const page = ref(1)
const totalPages = computed(() => Math.ceil(total.value / pageSize))

const visiblePages = computed(() => {
  const t = totalPages.value
  const current = page.value
  const pages: (number | string)[] = []
  if (t <= 7) {
    for (let i = 1; i <= t; i++) pages.push(i)
    return pages
  }
  pages.push(1)
  if (current > 3) pages.push('...')
  const start = Math.max(2, current - 1)
  const end = Math.min(t - 1, current + 1)
  for (let i = start; i <= end; i++) pages.push(i)
  if (current < t - 2) pages.push('...')
  pages.push(t)
  return pages
})

// ========================
// ВСЕ ОБЪЕКТЫ — fetch
// ========================
async function fetchItems() {
  const params: any = {
    sort: `${sort.field}:${sort.direction}`,
    pagination: { page: page.value, pageSize },
  }
  const f: any = {}
  if (filters.city) f.city = { $eq: filters.city }
  if (filters.status) f.status = { $eq: filters.status }
  if (filters.source) f.source = { $eq: filters.source }
  if (filters.property_type) f.property_type = { $eq: filters.property_type }
  if (filters.undervalued) f.is_undervalued = { $eq: true }
  if (Object.keys(f).length) params.filters = f
  await fetchProperties(params)
}

function resetFilters() {
  filters.city = ''
  filters.status = ''
  filters.source = ''
  filters.property_type = ''
  filters.undervalued = false
  sort.field = 'createdAt'
  sort.direction = 'desc'
  page.value = 1
}

watch([filters, page, sort], ([, newPage], [, oldPage]) => {
  if (newPage === oldPage) {
    if (page.value !== 1) {
      page.value = 1
    } else {
      fetchItems()
    }
    return
  }
  fetchItems()
}, { deep: true })

// ========================
// Focus data fetch
// ========================
function fetchFocusItems() {
  const sortParam = `${focusSort.direction === 'desc' ? '-' : ''}${focusSort.field}`

  const cityList: string[] = []
  if (focusFilters.cities.moscow) cityList.push('moscow')
  if (focusFilters.cities.mo) cityList.push('mo')
  if (focusFilters.cities.other) cityList.push('other')

  const params: any = {
    threshold: focusFilters.threshold,
    sort: sortParam,
    page: focusPage.value,
    pageSize: focusPageSize,
  }
  if (cityList.length > 0 && cityList.length < 3) params.city = cityList.join(',')
  if (focusFilters.property_type) params.type = focusFilters.property_type
  if (focusFilters.tags.length > 0) params.tags = focusFilters.tags.join(',')
  if (focusFilters.priceFrom) params.priceFrom = focusFilters.priceFrom
  if (focusFilters.priceTo) params.priceTo = focusFilters.priceTo

  fetchFocusProperties(params)
}

doFetchFocus = fetchFocusItems

// ========================
// Pipeline state
// ========================
type PipelineStage = 'idle' | 'parsing' | 'analyzing' | 'digesting' | 'done' | 'error'
const pipelineStage = ref<PipelineStage>('idle')
const parseDepth = ref(20)
const parseSourcesTotal = ref(0)
const parseSourcesDone = ref(0)
const parseDone = ref(false)
const detailsFetched = ref(0)
const detailsNeeded = ref(0)
const analyzeDone = ref(false)
const analyzePending = ref(0)
const digestDone = ref(false)
const pipelineError = ref('')

const pipelineResults = reactive({
  parseTotal: 0,
  parseErrors: 0,
  detailsFetched: 0,
  detailsNeeded: 0,
  undervaluedTotal: 0,
  undervaluedByCity: {} as Record<string, number>,
  digestSent: false,
  digestCount: 0,
  digestSkipped: false,
})

const parseSlugs = ref<string[]>([])
let pollTimer: ReturnType<typeof setInterval> | null = null

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

async function pollQueueStats() {
  try {
    const res = await api.get('/cron/queue-stats')
    const data = res.data
    if (!data?.ok) return null
    return data
  } catch {
    return null
  }
}

function isQueueEmpty(queues: Record<string, any>, prefix: string): boolean {
  for (const [name, stats] of Object.entries(queues)) {
    if (name.startsWith(prefix)) {
      const s = stats as { pending: number; active: number }
      if (s.pending > 0 || s.active > 0) return false
    }
  }
  return true
}

function countSourcesParsed(sources: any[], slugs: string[]): number {
  return sources.filter((s: any) =>
    slugs.includes(s.slug) && s.last_parse_status !== 'running' && s.last_parse_status !== 'never'
  ).length
}

async function runPipeline() {
  pipelineStage.value = 'parsing'
  parseDone.value = false
  analyzeDone.value = false
  digestDone.value = false
  parseSourcesDone.value = 0
  detailsFetched.value = 0
  detailsNeeded.value = 0
  analyzePending.value = 0
  pipelineError.value = ''
  pipelineResults.parseTotal = 0
  pipelineResults.parseErrors = 0
  pipelineResults.detailsFetched = 0
  pipelineResults.detailsNeeded = 0
  pipelineResults.undervaluedTotal = 0
  pipelineResults.undervaluedByCity = {}
  pipelineResults.digestSent = false
  pipelineResults.digestCount = 0
  pipelineResults.digestSkipped = false

  try {
    const sourcesRes = await api.get('/sources', {
      params: { 'filters[is_active][$eq]': true, 'pagination[pageSize]': 100 },
    })
    const sources = sourcesRes.data?.data || []

    if (sources.length === 0) {
      pipelineError.value = 'Нет активных источников'
      pipelineStage.value = 'error'
      return
    }

    parseSlugs.value = sources.map((s: any) => s.slug)
    parseSourcesTotal.value = sources.length

    await Promise.all(
      sources.map((s: any) => api.post(`/cron/parse/${s.slug}`, { depth: parseDepth.value }).catch(() => null))
    )

    await new Promise<void>((resolve, reject) => {
      let attempts = 0
      const maxAttempts = 2000 // ~100 мин при poll 3 сек
      pollTimer = setInterval(async () => {
        attempts++
        if (attempts > maxAttempts) {
          stopPolling()
          reject(new Error('Парсинг превысил таймаут (100 мин)'))
          return
        }

        const stats = await pollQueueStats()
        if (!stats) return

        parseSourcesDone.value = countSourcesParsed(stats.sources, parseSlugs.value)

        // Считаем общее количество fetchDetails по всем источникам
        detailsFetched.value = (stats.sources || [])
          .filter((s: any) => parseSlugs.value.includes(s.slug))
          .reduce((sum: number, s: any) => sum + (s.total_details_fetched || 0), 0)
        detailsNeeded.value = (stats.sources || [])
          .filter((s: any) => parseSlugs.value.includes(s.slug))
          .reduce((sum: number, s: any) => sum + (s.total_details_needed || 0), 0)

        const allParseDone = isQueueEmpty(stats.queues, 'parse-')
        if (allParseDone && parseSourcesDone.value >= parseSourcesTotal.value) {
          stopPolling()
          for (const s of stats.sources || []) {
            if (parseSlugs.value.includes(s.slug)) {
              pipelineResults.parseTotal += (s.total_created || 0)
              if (s.last_parse_status === 'error') pipelineResults.parseErrors++
            }
          }
          pipelineResults.detailsFetched = detailsFetched.value
          pipelineResults.detailsNeeded = detailsNeeded.value
          parseDone.value = true
          pipelineStage.value = 'analyzing'
          resolve()
        }
      }, 3000)
    })

    // Build analysis filters
    const analyzeBody: any = {}
    if (launchFilters.priceFrom) analyzeBody.priceFrom = Number(launchFilters.priceFrom)
    if (launchFilters.priceTo) analyzeBody.priceTo = Number(launchFilters.priceTo)
    const cities = []
    if (launchFilters.cities.moscow) cities.push('moscow')
    if (launchFilters.cities.mo) cities.push('mo')
    if (launchFilters.cities.other) cities.push('other')
    if (cities.length > 0 && cities.length < 3) analyzeBody.city = cities
    if (launchFilters.threshold !== 20) analyzeBody.threshold = launchFilters.threshold

    await api.post('/cron/analyze', Object.keys(analyzeBody).length ? analyzeBody : undefined)

    await new Promise<void>((resolve, reject) => {
      let attempts = 0
      const maxAttempts = 60
      pollTimer = setInterval(async () => {
        attempts++
        if (attempts > maxAttempts) {
          stopPolling()
          reject(new Error('Анализ превысил таймаут (3 мин)'))
          return
        }

        const stats = await pollQueueStats()
        if (!stats) return

        const q = stats.queues['analyze-property'] || { pending: 0, active: 0 }
        analyzePending.value = q.pending + q.active

        if (isQueueEmpty(stats.queues, 'analyze-')) {
          stopPolling()
          try {
            const cities = ['moscow', 'mo', 'other']
            for (const city of cities) {
              const res = await api.get('/properties', {
                params: {
                  'filters[is_undervalued][$eq]': true,
                  'filters[city][$eq]': city,
                  'pagination[pageSize]': 1,
                },
              })
              const count = res.data?.meta?.pagination?.total || 0
              if (count > 0) pipelineResults.undervaluedByCity[city] = count
              pipelineResults.undervaluedTotal += count
            }
          } catch { /* ignore */ }
          analyzeDone.value = true
          pipelineStage.value = 'digesting'
          resolve()
        }
      }, 3000)
    })

    await api.post('/cron/digest')

    await new Promise<void>((resolve, reject) => {
      let attempts = 0
      const maxAttempts = 30
      pollTimer = setInterval(async () => {
        attempts++
        if (attempts > maxAttempts) {
          stopPolling()
          reject(new Error('Дайджест превысил таймаут (90 сек)'))
          return
        }

        const stats = await pollQueueStats()
        if (!stats) return

        if (isQueueEmpty(stats.queues, 'digest-')) {
          stopPolling()
          digestDone.value = true
          if (pipelineResults.undervaluedTotal > 0) {
            pipelineResults.digestSent = true
            pipelineResults.digestCount = pipelineResults.undervaluedTotal
          } else {
            pipelineResults.digestSkipped = true
          }
          pipelineStage.value = 'done'
          resolve()
        }
      }, 3000)
    })
  } catch (err: any) {
    stopPolling()
    pipelineStage.value = 'error'
    pipelineError.value = err.message || 'Ошибка пайплайна'
  }
}

// Clear new properties — with in-page confirmation dialog
const clearing = ref(false)
const showClearDialog = ref(false)

function confirmClearNew() {
  showClearDialog.value = true
}

async function executeClearNew() {
  showClearDialog.value = false
  clearing.value = true
  try {
    const { data } = await api.post('/properties/clear-new')
    if (data.deleted > 0) {
      alert(`Удалено ${data.deleted} объектов`)
    } else {
      alert('Нет объектов со статусом «Новый»')
    }
    fetchItems()
  } catch (e: any) {
    alert('Ошибка: ' + (e.response?.data?.error?.message || e.message))
  } finally {
    clearing.value = false
  }
}

// ========================
// Recalculate scoring
// ========================
const scoringLoading = ref(false)

async function recalculateScore() {
  scoringLoading.value = true
  try {
    const cityList: string[] = []
    if (focusFilters.cities.moscow) cityList.push('moscow')
    if (focusFilters.cities.mo) cityList.push('mo')
    if (focusFilters.cities.other) cityList.push('other')

    const body: any = { threshold: focusFilters.threshold }
    if (cityList.length > 0 && cityList.length < 3) body.city = cityList
    if (focusFilters.priceFrom) body.priceFrom = Number(focusFilters.priceFrom)
    if (focusFilters.priceTo) body.priceTo = Number(focusFilters.priceTo)

    await api.post('/cron/score', body)
    // Refresh list after scoring
    await fetchFocusItems()
  } catch (e: any) {
    console.error('Score recalculation failed:', e)
    // TODO: заменить на toast notification
    console.warn('[UI] Ошибка пересчёта: ' + (e.response?.data?.error?.message || e.message))
  } finally {
    scoringLoading.value = false
  }
}

// ========================
// CSV Export
// ========================
async function exportCSV() {
  try {
    const cityList: string[] = []
    if (focusFilters.cities.moscow) cityList.push('moscow')
    if (focusFilters.cities.mo) cityList.push('mo')
    if (focusFilters.cities.other) cityList.push('other')

    const sortParam = `${focusSort.direction === 'desc' ? '-' : ''}${focusSort.field}`

    const params: any = {
      threshold: focusFilters.threshold,
      sort: sortParam,
      page: 1,
      pageSize: 1000,
    }
    if (cityList.length > 0 && cityList.length < 3) params.city = cityList.join(',')
    if (focusFilters.property_type) params.type = focusFilters.property_type
    if (focusFilters.tags.length > 0) params.tags = focusFilters.tags.join(',')
    if (focusFilters.priceFrom) params.priceFrom = focusFilters.priceFrom
    if (focusFilters.priceTo) params.priceTo = focusFilters.priceTo

    const { data } = await api.get('/properties/focus', { params })
    const rows = data.data || []

    generateCSV(rows)
  } catch (e: any) {
    console.error('CSV export failed:', e)
    // TODO: заменить на toast notification
    console.warn('[UI] Ошибка экспорта: ' + (e.response?.data?.error?.message || e.message))
  }
}

function generateCSV(rows: any[]) {
  const header = ['Название', 'Адрес', 'Город', 'Тип', 'Площадь', 'Цена', '₽/м²', 'Скор', 'Теги', 'Ссылка']
  const csvRows = [header.join(';')]

  for (const row of rows) {
    const link = `${window.location.origin}/properties/${row.documentId}`
    const values = [
      escapeCSV(row.title),
      escapeCSV(row.address || ''),
      escapeCSV(cityLabel(row.city)),
      escapeCSV(typeLabel(row.property_type)),
      row.area_sqm || '',
      row.price || '',
      row.price_per_sqm || '',
      row.focus_score ?? '',
      escapeCSV((row.tags || []).join(', ')),
      link,
    ]
    csvRows.push(values.join(';'))
  }

  const BOM = '\uFEFF'
  const blob = new Blob([BOM + csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `focus_export_${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function escapeCSV(val: string): string {
  if (!val) return ''
  if (val.includes(';') || val.includes('"') || val.includes('\n')) {
    return `"${val.replace(/"/g, '""')}"`
  }
  return val
}

// ========================
// Bulk actions
// ========================
async function bulkSetStatus(status: string) {
  const ids = Array.from(focusSelected)
  try {
    await Promise.all(ids.map(id => {
      const item = focusItems.value.find(i => i.id === id)
      if (!item) return Promise.resolve()
      return api.put(`/properties/${item.documentId}`, { data: { status } })
    }))
    focusSelected.clear()
    await fetchFocusItems()
  } catch (e: any) {
    // TODO: заменить на toast notification
    console.warn('[UI] Ошибка: ' + (e.response?.data?.error?.message || e.message))
  }
}

async function bulkExportCSV() {
  const ids = Array.from(focusSelected)
  const rows = focusItems.value.filter(i => ids.includes(i.id))
  generateCSV(rows)
}

// ========================
// Lifecycle
// ========================
onUnmounted(() => {
  stopPolling()
})

onMounted(() => {
  fetchItems()
  fetchWorkTotal()
})
</script>
