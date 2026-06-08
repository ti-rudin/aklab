<template>
  <main class="calculator-content">
    <div class="calculator-top-row">
      <router-link to="/zamery" class="back-link">&larr; Назад к списку</router-link>
    </div>

    <!-- Hero -->
    <header class="calculator-hero">
      <div class="calculator-hero__divider calculator-hero__divider--top" aria-hidden="true"></div>
      <h1>AKLAB: System Exposure</h1>
      <p class="calculator-hero__subtitle">Калькулятор профиля системы</p>
      <p class="calculator-hero__tagline">Вводите факторы 1–5 — получайте индексы, executive-summary и графики.</p>
      <div class="calculator-hero__divider" aria-hidden="true"></div>
    </header>

    <!-- Company Profile -->
    <section class="calculator-section" id="company-profile" aria-labelledby="company-profile-title">
      <h2 id="company-profile-title" class="calc-section-title calculator-section-title">Профиль компании</h2>

      <div class="calc-card calculator-card">
        <!-- Бизнес параметры -->
        <div class="calculator-subsection">
          <h3 class="calculator-subsection__title">Бизнес параметры</h3>
          <div class="calculator-form-grid calculator-form-grid--business">
            <label class="calculator-field">
              <span class="calculator-field__label">Отрасль</span>
              <select v-model="form.industry" class="calculator-input" required>
                <option value="" disabled>Выберите отрасль…</option>
                <option v-for="opt in industries" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
              </select>
            </label>

            <label class="calculator-field">
              <span class="calculator-field__label">Общая численность сотрудников</span>
              <input v-model.number="form.staffTotal" class="calculator-input" type="number" min="1" step="1" placeholder="Например: 1200" required />
            </label>

            <label class="calculator-field">
              <span class="calculator-field__label">Количество пользователей</span>
              <input v-model.number="form.companyUsers" class="calculator-input" type="number" min="1" step="1" placeholder="Например: 500" required />
            </label>

            <label class="calculator-field">
              <span class="calculator-field__label">Количество филиалов или удаленных офисов</span>
              <input v-model.number="form.branchesCount" class="calculator-input" type="number" min="0" step="1" placeholder="Например: 12" required />
            </label>

            <label class="calculator-field">
              <span class="calculator-field__label">Годовой оборот (млн ₽/год)</span>
              <input v-model.number="form.annualRevenueRub" class="calculator-input calc-revenue" type="number" min="0" step="1" placeholder="Например: 20000" required />
            </label>

            <label class="calculator-field">
              <span class="calculator-field__label">
                Стоимость простоя в день (млн ₽)
                <button type="button" class="calculator-info" aria-label="Подсказка">?</button>
              </span>
              <input class="calculator-input calc-cost-downtime" type="text" readonly :value="costDowntimeDay" />
            </label>

            <label class="calculator-field">
              <span class="calculator-field__label">
                Стоимость простоя в час (млн ₽)
                <button type="button" class="calculator-info" aria-label="Подсказка">?</button>
              </span>
              <input class="calculator-input calc-cost-downtime" type="text" readonly :value="costDowntimeHour" />
            </label>

            <label class="calculator-field">
              <span class="calculator-field__label">
                Уровень проникновения ИТ
                <button type="button" class="calculator-info" aria-label="Подсказка">?</button>
              </span>
              <input class="calculator-input" type="text" readonly :value="itPenetration" />
            </label>

            <label class="calculator-field">
              <span class="calculator-field__label">
                GM (Governance Multiplier)
                <button type="button" class="calculator-info" aria-label="Подсказка">?</button>
              </span>
              <div class="calculator-switch-row">
                <span class="calculator-switch">
                  <input v-model="form.ceoCfoKpiAvailability" class="calculator-switch__input" type="checkbox" role="switch" />
                  <span class="calculator-switch__track" aria-hidden="true"></span>
                  <span class="calculator-switch__thumb" aria-hidden="true"></span>
                </span>
                <span class="calculator-switch__text">{{ form.ceoCfoKpiAvailability ? 'KPI есть' : 'KPI нет' }}</span>
                <span class="calculator-field__value">GM={{ gm }}</span>
              </div>
            </label>

            <label class="calculator-field">
              <span class="calculator-field__label">
                Зависимость от ИТ
                <button type="button" class="calculator-info" aria-label="Подсказка">?</button>
              </span>
              <div class="calculator-field__value">
                <span>{{ form.itDependencyPct }}</span>%
                <input v-model.number="form.itDependencyPct" class="calculator-range" type="range" min="1" max="100" step="1" />
              </div>
            </label>
          </div>
        </div>

        <!-- ИТ параметры -->
        <div class="calculator-subsection">
          <h3 class="calculator-subsection__title">ИТ параметры</h3>
          <div class="calculator-form-grid calculator-form-grid--business">
            <label class="calculator-field">
              <span class="calculator-field__label">
                CAPEX ИТ (млн ₽/год)
                <button type="button" class="calculator-info" aria-label="Подсказка">?</button>
              </span>
              <input v-model.number="form.itCapexMlnRub" class="calculator-input" type="number" min="0" step="1" placeholder="Например: 100" required />
            </label>

            <label class="calculator-field">
              <span class="calculator-field__label">
                OPEX ИТ (млн ₽/год)
                <button type="button" class="calculator-info" aria-label="Подсказка">?</button>
              </span>
              <input v-model.number="form.itOpexMlnRub" class="calculator-input" type="number" min="0" step="1" placeholder="Например: 200" required />
            </label>

            <label class="calculator-field">
              <span class="calculator-field__label">
                ФОТ ИТ (млн ₽/год)
                <button type="button" class="calculator-info" aria-label="Подсказка">?</button>
              </span>
              <input v-model.number="form.itFotMlnRub" class="calculator-input" type="number" min="0" step="1" placeholder="Например: 50" required />
            </label>

            <label class="calculator-field">
              <span class="calculator-field__label">ИТОГО БЮДЖЕТ ИТ (млн ₽/год)</span>
              <input class="calculator-input" type="text" readonly :value="itBudgetTotal" />
            </label>

            <label class="calculator-field">
              <span class="calculator-field__label">
                ИТ-интенсивность
                <button type="button" class="calculator-info" aria-label="Подсказка">?</button>
              </span>
              <input class="calculator-input" type="text" readonly :value="itIntensity" />
            </label>

            <label class="calculator-field">
              <span class="calculator-field__label">Общее количество ИТ сотрудников</span>
              <input v-model.number="form.itStaffTotal" class="calculator-input" type="number" min="0" step="1" placeholder="Например: 80" required />
            </label>

            <label class="calculator-field">
              <span class="calculator-field__label">
                Коэффициент ИТ-насыщенности
                <button type="button" class="calculator-info" aria-label="Подсказка">?</button>
              </span>
              <input class="calculator-input" type="text" readonly :value="itSaturation" />
            </label>

            <div class="calculator-hero__divider" aria-hidden="true"></div>

            <!-- IT Staff Allocation -->
            <div class="calculator-field calculator-field--wide calculator-field--vertical">
              <div class="calculator-field__label-row">
                <span class="calculator-field__label">Распределение ИТ персонала по направлениям в % от общего количества</span>
                <span class="calculator-field__value"><span>{{ allocRemaining }}</span>% доступно</span>
              </div>

              <div class="calculator-alloc">
                <div class="calculator-alloc__row">
                  <div class="calculator-alloc__meta">
                    <span class="calculator-alloc__label">
                      % Управляющего персонала ИТ
                      <button type="button" class="calculator-info" aria-label="Подсказка">?</button>
                    </span>
                    <span class="calculator-alloc__value"><span>{{ form.itMgmtPct }}</span>%</span>
                  </div>
                  <input v-model.number="form.itMgmtPct" class="calculator-range calculator-range--mgmt" type="range" min="0" max="100" step="1" />
                </div>

                <div class="calculator-alloc__row">
                  <div class="calculator-alloc__meta">
                    <span class="calculator-alloc__label">
                      % Эксплуатации инфраструктуры
                      <button type="button" class="calculator-info" aria-label="Подсказка">?</button>
                    </span>
                    <span class="calculator-alloc__value"><span>{{ form.itOpsPct }}</span>%</span>
                  </div>
                  <input v-model.number="form.itOpsPct" class="calculator-range calculator-range--ops" type="range" min="0" max="100" step="1" />
                </div>

                <div class="calculator-alloc__row">
                  <div class="calculator-alloc__meta">
                    <span class="calculator-alloc__label">
                      % Персонала в технической поддержке
                      <button type="button" class="calculator-info" aria-label="Подсказка">?</button>
                    </span>
                    <span class="calculator-alloc__value"><span>{{ form.itSupportPct }}</span>%</span>
                  </div>
                  <input v-model.number="form.itSupportPct" class="calculator-range calculator-range--support" type="range" min="0" max="100" step="1" />
                </div>

                <div class="calculator-alloc__row">
                  <div class="calculator-alloc__meta">
                    <span class="calculator-alloc__label">
                      % Персонала в разработке и проектах
                      <button type="button" class="calculator-info" aria-label="Подсказка">?</button>
                    </span>
                    <span class="calculator-alloc__value"><span>{{ form.itDevPct }}</span>%</span>
                  </div>
                  <input v-model.number="form.itDevPct" class="calculator-range calculator-range--dev" type="range" min="0" max="100" step="1" />
                </div>
              </div>

              <span class="calculator-field__hint">Ползунки связаны: суммарно можно распределить не более 100%. Остаток автоматически ограничивает максимум остальных.</span>
            </div>

            <div class="calculator-field calculator-field--wide">
              <button type="button" class="calc-btn-secondary" @click="fillPreset">Заполнить по правилу</button>
              <button type="button" class="calc-btn-secondary" @click="fillRandom">Заполнить случайно</button>
              <span class="calculator-field__hint">Для быстрого тестирования: заполнит профиль компании фиксированным сценарием или рандомом.</span>
            </div>
          </div>
        </div>

        <!-- Референсные значения -->
        <div class="calculator-subsection">
          <h3 class="calculator-subsection__title">Референсные значения</h3>
          <div class="calculator-switch-row">
            <span class="calculator-switch">
              <input v-model="benchmarkAutoScale" class="calculator-switch__input" type="checkbox" role="switch" />
              <span class="calculator-switch__track" aria-hidden="true"></span>
              <span class="calculator-switch__thumb" aria-hidden="true"></span>
            </span>
            <span class="calculator-switch__text">{{ benchmarkAutoScale ? 'Автомасштаб' : 'Шкала 0–100%' }}</span>
            <span class="calculator-field__value">
              Режим шкалы
              <button type="button" class="calculator-info" aria-label="Подсказка">?</button>
            </span>
          </div>
          <div class="calculator-form-grid" style="margin-top: 12px">
            <p class="calc-card-text" style="grid-column: 1 / -1; color: var(--text-muted); font-size: 13px;">
              Референсные значения загружаются по выбранной отрасли.
            </p>
          </div>
        </div>
      </div>
    </section>

    <!-- Gate -->
    <section class="calculator-section" id="profile-gate" v-if="!gateOpened">
      <div class="calc-card calculator-card calculator-gate">
        <p class="calc-card-label" id="profile-gate-title">Дальше — ввод факторов</p>
        <p class="calc-card-text calculator-gate__text">
          Сначала заполните обязательные поля профиля компании. После этого откроется таблица факторов и результаты.
        </p>
        <button type="button" class="calc-btn-secondary calculator-gate__btn" :disabled="!isProfileValid" @click="openGate">
          Заполнить таблицу факторов →
        </button>
      </div>
    </section>

    <!-- Below Profile (factors + results) -->
    <div v-show="gateOpened">
      <!-- Factor Inputs -->
      <section class="calculator-section" id="inputs" aria-labelledby="inputs-title">
        <div class="calculator-card-head">
          <h2 id="inputs-title" class="calc-section-title calculator-section-title">Ввод факторов (1–5)</h2>
        </div>

        <div class="calculator-columns">
          <div v-for="axis in axisKeys" :key="axis" class="calc-card calculator-card" :class="{ 'is-axis-complete': isAxisComplete(axis) }">
            <h3 class="calculator-subtitle">
              <span class="calculator-axis-code">{{ axis.toUpperCase() }}</span>
              {{ axisLabels[axis] }}
            </h3>
            <div class="calculator-factor-list">
              <div
                v-for="factor in factorsDef[axis]"
                :key="factor.key"
                class="calculator-factor"
                :data-axis="axis"
                :class="{ 'is-factor-selected': getFactor(axis, factor.key) !== null }"
              >
                <div class="calculator-factor__top">
                  <div class="calculator-factor__meta">
                    <span class="calculator-factor__title">{{ factor.title }}</span>
                    <span class="calculator-factor__desc">{{ factor.desc }}</span>
                  </div>
                </div>
                <div class="calculator-factor__divider"></div>
                <div class="calculator-factor__selection">
                  <span
                    v-if="getFactor(axis, factor.key) !== null"
                    class="calculator-badge"
                    :data-score="getFactor(axis, factor.key)"
                  >{{ getFactor(axis, factor.key) }}</span>
                  <span v-if="getFactor(axis, factor.key) !== null" class="calculator-selection-text">
                    {{ factorSelectionText(axis, getFactor(axis, factor.key)!) }}
                  </span>
                  <span v-else class="calculator-selection-text">Выберите оценку</span>
                  <div class="calculator-scale" :data-axis="axis" style="margin-left: auto">
                    <button
                      v-for="score in 5"
                      :key="score"
                      type="button"
                      :data-score="score"
                      :class="{ 'is-selected': getFactor(axis, factor.key) === score }"
                      @click="setFactor(axis, factor.key, score)"
                    >{{ score }}</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Calculate Button -->
      <section class="calculator-section">
        <div class="calculator-actions">
          <button
            type="button"
            class="calc-btn-secondary"
            :disabled="calculating"
            @click="handleCalculate"
          >
            {{ calculating ? 'Расчёт...' : 'Рассчитать коэффициенты' }}
          </button>
        </div>
      </section>

      <!-- Results -->
      <section class="calculator-section" id="results" aria-labelledby="results-title" v-if="results">
        <h2 id="results-title" class="calc-section-title calculator-section-title">Результаты</h2>

        <div class="calculator-results-grid">
          <article class="calc-card calculator-card">
            <div class="calculator-card-head">
              <p class="calc-card-label">Индексы</p>
            </div>
            <div class="calculator-kpi-grid calculator-kpi-grid--four">
              <div v-for="kpi in results.kpiList" :key="kpi.label" class="calculator-kpi">
                <p class="calculator-kpi__label">{{ kpi.label }}</p>
                <p class="calculator-kpi__value" :style="{ color: kpi.color }">{{ kpi.value }}</p>
              </div>
            </div>
            <p class="calc-card-text calculator-muted">FS/MS/RS/AS: 1–5. EX: 1–25. SQI/SEI: производные метрики.</p>
          </article>

          <article class="calc-card calculator-card">
            <p class="calc-card-label">Executive</p>
            <h3 class="calculator-subtitle">One‑Pager</h3>
            <div class="calculator-exec">
              <div v-for="row in results.execRows" :key="row.label" class="calculator-exec-row">
                <strong>{{ row.label }}</strong>
                <span>{{ row.value }}</span>
              </div>
            </div>
          </article>
        </div>
      </section>

      <!-- Interpretation -->
      <section class="calculator-section" id="interpretation" aria-labelledby="interpretation-title" v-if="results">
        <h2 id="interpretation-title" class="calc-section-title calculator-section-title">Интерпретация результатов и рекомендации</h2>

        <div class="calculator-results-grid">
          <article class="calc-card calculator-card">
            <h3 class="calculator-subtitle">Категория состояния системы</h3>
            <div class="calculator-category" style="margin-top: 10px">
              <p class="calc-card-text">{{ results.systemCategory }}</p>
            </div>
          </article>

          <article class="calc-card calculator-card">
            <h3 class="calculator-subtitle">Рекомендуемые технологии</h3>
            <div class="calculator-tech" style="margin-top: 10px">
              <p class="calc-card-text" style="color: var(--text-muted)">Подбор по матрице «Проблема → Методология» и порогам факторов/индексов.</p>
            </div>
          </article>

          <article class="calc-card calculator-card">
            <h3 class="calculator-subtitle">Рекомендуемые практики по осям AKLAB</h3>
            <div class="calculator-axis-practices" style="margin-top: 10px">
              <p class="calc-card-text" style="color: var(--text-muted)">Показываются только практики для факторов, которые не в «идеале».</p>
            </div>
          </article>

          <article v-for="interp in results.interpretations" :key="interp.axis" class="calc-card calculator-card">
            <h3 class="calculator-subtitle">{{ interp.axis.toUpperCase() }} — {{ interp.label }}</h3>
            <div style="margin-top: 10px">
              <p class="calc-card-text" style="color: var(--text-muted)">{{ interp.text }}</p>
            </div>
          </article>

          <article class="calc-card calculator-card">
            <h3 class="calculator-subtitle">SQI — баланс MS/FS</h3>
            <div class="calculator-sqi" style="margin-top: 10px">
              <p class="calc-card-text" style="color: var(--text-muted)">SQI = MS / FS. Показывает баланс управляемости и хрупкости.</p>
            </div>
          </article>

          <article class="calc-card calculator-card">
            <h3 class="calculator-subtitle">SEI — потенциал эволюции</h3>
            <div class="calculator-sei" style="margin-top: 10px">
              <p class="calc-card-text" style="color: var(--text-muted)">SEI = (RS + AS) / 2. Потенциал к эволюции и антихрупкости.</p>
            </div>
          </article>

          <article class="calc-card calculator-card">
            <h3 class="calculator-subtitle">EX — подверженность (FS×L)</h3>
            <div class="calculator-ex" style="margin-top: 10px">
              <p class="calc-card-text" style="color: var(--text-muted)">EX = FS × L. Подверженность сбоям с учётом потерь.</p>
            </div>
          </article>
        </div>
      </section>

      <!-- Charts -->
      <section class="calculator-section" id="charts" aria-labelledby="charts-title" v-if="results">
        <h2 id="charts-title" class="calc-section-title calculator-section-title">Графики</h2>

        <div class="calculator-results-grid">
          <article class="calc-card calculator-card">
            <p class="calc-card-label">Профиль осей</p>
            <div class="calculator-chart" id="chart-radar" aria-label="Radar chart FS/MS/RS/AS">
              <div style="width: 100%; min-height: 300px; display: flex; align-items: center; justify-content: center; color: var(--text-muted)">
                <svg viewBox="0 0 400 400" style="max-width: 400px">
                  <g transform="translate(200,200)">
                    <circle v-for="r in [40, 80, 120, 160]" :key="r" :r="r" fill="none" stroke="var(--border-subtle)" stroke-width="1" />
                    <line v-for="(d, i) in results.charts.radar" :key="'line-' + i" x1="0" y1="0" :x2="Math.cos(d.angle) * 160" :y2="Math.sin(d.angle) * 160" stroke="var(--border-subtle)" stroke-width="1" />
                    <text v-for="(d, i) in results.charts.radar" :key="'lbl-' + i" :x="Math.cos(d.angle) * 185" :y="Math.sin(d.angle) * 185" text-anchor="middle" dominant-baseline="middle" fill="var(--text-muted)" font-size="13" font-weight="700">{{ d.label }}</text>
                    <polygon v-if="radarPoints" :points="radarPoints" fill="rgba(79, 140, 255, 0.20)" stroke="rgba(79, 140, 255, 0.85)" stroke-width="2" />
                    <circle v-for="(pt, i) in radarPointCoords" :key="'pt-' + i" :cx="pt.x" :cy="pt.y" r="5" fill="var(--accent)" stroke="var(--bg-elevated)" stroke-width="2" />
                  </g>
                </svg>
              </div>
            </div>
          </article>

          <article class="calc-card calculator-card">
            <p class="calc-card-label">FS ↔ MS</p>
            <div class="calculator-chart" aria-label="Quadrant chart FS vs MS">
              <svg viewBox="0 0 400 320" style="max-width: 400px; width: 100%">
                <rect x="40" y="10" width="160" height="140" fill="rgba(16, 185, 129, 0.08)" />
                <rect x="200" y="10" width="160" height="140" fill="rgba(251, 191, 36, 0.08)" />
                <rect x="40" y="150" width="160" height="140" fill="rgba(79, 140, 255, 0.08)" />
                <rect x="200" y="150" width="160" height="140" fill="rgba(239, 68, 68, 0.08)" />
                <text x="120" y="30" text-anchor="middle" fill="var(--text-muted)" font-size="11" font-weight="600">Стабильная</text>
                <text x="280" y="30" text-anchor="middle" fill="var(--text-muted)" font-size="11" font-weight="600">Контролируемый риск</text>
                <text x="120" y="285" text-anchor="middle" fill="var(--text-muted)" font-size="11" font-weight="600">Скрытые проблемы</text>
                <text x="280" y="285" text-anchor="middle" fill="var(--text-muted)" font-size="11" font-weight="600">Критическая зона</text>
                <line x1="40" y1="150" x2="360" y2="150" stroke="var(--border-subtle)" stroke-width="1" />
                <line x1="200" y1="10" x2="200" y2="290" stroke="var(--border-subtle)" stroke-width="1" />
                <text x="200" y="310" text-anchor="middle" fill="var(--text-muted)" font-size="12" font-weight="600">FS →</text>
                <text x="20" y="150" text-anchor="middle" fill="var(--text-muted)" font-size="12" font-weight="600" transform="rotate(-90, 20, 150)">MS →</text>
                <circle v-if="results.charts.quadrant" :cx="results.charts.quadrant.x" :cy="results.charts.quadrant.y" r="8" fill="var(--accent)" stroke="var(--bg-elevated)" stroke-width="3" />
              </svg>
            </div>
            <p class="calc-card-text calculator-muted">Матрица §7.2 (MS vs FS): "Стабильная / Контролируемый риск / Скрытые проблемы / Критическая зона".</p>
          </article>
        </div>
      </section>
    </div>

    <!-- Actions -->
    <section class="calculator-section" aria-label="Дальше">
      <div class="calculator-actions">
        <button type="button" class="calc-btn-secondary" @click="handleSubmit">
          {{ isEdit ? 'Сохранить замер' : 'Создать замер' }}
        </button>
        <router-link to="/zamery" class="calc-btn-secondary">Отмена</router-link>
      </div>
    </section>
  </main>
</template>

<script setup lang="ts">
import { reactive, computed, ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useZameryStore, INDUSTRIES, FACTORS, createDefaultFactors } from '@/stores/zamery'
import type { AxisKey, CalculationResults } from '@/stores/zamery'
import '@/assets/calculator.css'

const route = useRoute()
const router = useRouter()
const store = useZameryStore()

const isEdit = computed(() => !!route.params.id && route.params.id !== 'new')
const industries = INDUSTRIES
const factorsDef = FACTORS
const axisKeys: AxisKey[] = ['fs', 'ms', 'rs', 'as']
const axisLabels: Record<AxisKey, string> = { fs: 'Хрупкость', ms: 'Управляемость', rs: 'Устойчивость', as: 'Антихрупкость' }

const gateOpened = ref(false)
const benchmarkAutoScale = ref(true)
const calculating = ref(false)
const results = ref<CalculationResults | null>(null)
let savedDocumentId: string | null = null

const form = reactive({
  name: '',
  industry: '',
  staffTotal: 0,
  companyUsers: 0,
  branchesCount: 0,
  annualRevenueRub: 0,
  itCapexMlnRub: 0,
  itOpexMlnRub: 0,
  itFotMlnRub: 0,
  itStaffTotal: 0,
  itDependencyPct: 100,
  ceoCfoKpiAvailability: false,
  itMgmtPct: 0,
  itOpsPct: 0,
  itSupportPct: 0,
  itDevPct: 0,
  factors: createDefaultFactors(),
})

// === Computed: Profile (клиентские — только для превью в форме) ===
const gm = computed(() => (form.ceoCfoKpiAvailability ? '1.0' : '1.5'))

const costDowntimeDay = computed(() => {
  if (!form.annualRevenueRub) return '—'
  return ((form.annualRevenueRub / 365) * (form.itDependencyPct / 100)).toFixed(2)
})

const costDowntimeHour = computed(() => {
  if (costDowntimeDay.value === '—') return '—'
  return (parseFloat(costDowntimeDay.value) / 24).toFixed(2)
})

const itPenetration = computed(() => {
  if (!form.staffTotal) return '—'
  return ((form.companyUsers / form.staffTotal) * 100).toFixed(1) + '%'
})

const itBudgetTotal = computed(() => (form.itCapexMlnRub + form.itOpexMlnRub + form.itFotMlnRub).toFixed(1))

const itIntensity = computed(() => {
  if (!form.annualRevenueRub) return '—'
  return ((parseFloat(itBudgetTotal.value) / form.annualRevenueRub) * 100).toFixed(2) + '%'
})

const itSaturation = computed(() => {
  if (!form.companyUsers) return '—'
  return ((form.itStaffTotal / form.companyUsers) * 100).toFixed(1) + '%'
})

const allocRemaining = computed(() => {
  const sum = form.itMgmtPct + form.itOpsPct + form.itSupportPct + form.itDevPct
  return Math.max(0, 100 - sum)
})

const isProfileValid = computed(() => {
  return !!(
    form.industry &&
    form.staffTotal > 0 &&
    form.companyUsers > 0 &&
    form.annualRevenueRub > 0 &&
    form.itCapexMlnRub >= 0 &&
    form.itOpexMlnRub >= 0 &&
    form.itFotMlnRub >= 0 &&
    form.itStaffTotal >= 0
  )
})

// === Computed: Charts (из серверных данных) ===
const radarPointCoords = computed(() => {
  if (!results.value) return []
  return results.value.charts.radar.map((d) => ({
    x: Math.cos(d.angle) * (d.value / 5) * 160,
    y: Math.sin(d.angle) * (d.value / 5) * 160,
  }))
})

const radarPoints = computed(() => {
  return radarPointCoords.value.map((p) => `${p.x},${p.y}`).join(' ')
})

// === Factor helpers ===
function getFactor(axis: AxisKey, key: string): number | null {
  return (form.factors[axis] as Record<string, number | null>)[key] ?? null
}

function setFactor(axis: AxisKey, key: string, score: number) {
  const current = getFactor(axis, key)
  ;(form.factors[axis] as Record<string, number | null>)[key] = current === score ? null : score
  form.factors.fs.GM = form.ceoCfoKpiAvailability ? 1.0 : 1.5
}

function factorSelectionText(axis: AxisKey, score: number): string {
  if (axis === 'fs') {
    return score <= 2 ? 'Низкая хрупкость' : score === 3 ? 'Средняя' : 'Высокая хрупкость'
  }
  return score <= 2 ? 'Низкий уровень' : score === 3 ? 'Средний' : 'Высокий уровень'
}

function isAxisComplete(axis: AxisKey): boolean {
  const f = form.factors[axis] as Record<string, number | null>
  return Object.entries(f).every(([k, v]) => k === 'GM' || v !== null)
}

// === Actions ===
function openGate() {
  gateOpened.value = true
}

function fillPreset() {
  form.staffTotal = 7000
  form.companyUsers = 2500
  form.branchesCount = 30
  form.annualRevenueRub = 50000
  form.itCapexMlnRub = 30
  form.itOpexMlnRub = 300
  form.itFotMlnRub = 350
  form.itStaffTotal = 200
  form.itMgmtPct = 13
  form.itOpsPct = 30
  form.itSupportPct = 20
  form.itDevPct = 37
}

function fillRandom() {
  const opts = industries.filter((o) => o.value)
  const pick = opts[Math.floor(Math.random() * opts.length)]
  form.industry = pick?.value ?? ''
  form.itDependencyPct = Math.floor(30 + Math.random() * 71)
  form.ceoCfoKpiAvailability = Math.random() < 0.5

  form.staffTotal = Math.floor(100 + Math.random() * 9900)
  form.companyUsers = Math.floor(form.staffTotal * (0.3 + Math.random() * 0.5))
  form.branchesCount = Math.floor(Math.random() * 50)
  form.annualRevenueRub = Math.floor(100 + Math.random() * 99900)
  form.itCapexMlnRub = Math.floor(10 + Math.random() * 490)
  form.itOpexMlnRub = Math.floor(50 + Math.random() * 950)
  form.itFotMlnRub = Math.floor(20 + Math.random() * 480)
  form.itStaffTotal = Math.floor(10 + Math.random() * 490)
  form.itMgmtPct = Math.floor(Math.random() * 30)
  form.itOpsPct = Math.floor(Math.random() * 40)
  form.itSupportPct = Math.floor(Math.random() * 30)
  form.itDevPct = Math.floor(Math.random() * 40)

  for (const axis of axisKeys) {
    const f = form.factors[axis]
    for (const key of Object.keys(f)) {
      if (key === 'GM') continue
      ;(f as Record<string, number | null>)[key] = Math.floor(Math.random() * 5) + 1
    }
  }
  form.factors.fs.GM = form.ceoCfoKpiAvailability ? 1.0 : 1.5
}

function getProfilePayload() {
  return {
    name: form.name || `Замер ${new Date().toLocaleDateString('ru-RU')}`,
    industry: form.industry,
    staffTotal: form.staffTotal,
    companyUsers: form.companyUsers,
    branchesCount: form.branchesCount,
    annualRevenueRub: form.annualRevenueRub,
    itCapexMlnRub: form.itCapexMlnRub,
    itOpexMlnRub: form.itOpexMlnRub,
    itFotMlnRub: form.itFotMlnRub,
    itStaffTotal: form.itStaffTotal,
    itDependencyPct: form.itDependencyPct,
    ceoCfoKpiAvailability: form.ceoCfoKpiAvailability,
    itMgmtPct: form.itMgmtPct,
    itOpsPct: form.itOpsPct,
    itSupportPct: form.itSupportPct,
    itDevPct: form.itDevPct,
  }
}

async function handleCalculate() {
  calculating.value = true
  try {
    // Соходим замер если ещё не сохранён
    if (!savedDocumentId) {
      const zamer = await store.add({ ...getProfilePayload(), factors: JSON.parse(JSON.stringify(form.factors)) })
      if (!zamer) return
      savedDocumentId = zamer.documentId
    } else {
      await store.update(savedDocumentId, { ...getProfilePayload(), factors: JSON.parse(JSON.stringify(form.factors)) })
    }

    // Отправляем на расчёт
    const serverResults = await store.calculate(savedDocumentId, {
      factors: JSON.parse(JSON.stringify(form.factors)),
      profile: getProfilePayload(),
    })

    if (serverResults) {
      results.value = serverResults
    }
  } finally {
    calculating.value = false
  }
}

async function handleSubmit() {
  if (!savedDocumentId) {
    const zamer = await store.add({ ...getProfilePayload(), factors: JSON.parse(JSON.stringify(form.factors)) })
    if (zamer) savedDocumentId = zamer.documentId
  } else {
    await store.update(savedDocumentId, { ...getProfilePayload(), factors: JSON.parse(JSON.stringify(form.factors)) })
  }
  router.push('/zamery')
}

// === Load existing ===
onMounted(async () => {
  if (isEdit.value) {
    const docId = route.params.id as string
    // Загружаем если store пуст
    if (!store.items.length) {
      await store.fetchAll()
    }
    const zamer = store.getById(docId)
    if (zamer) {
      savedDocumentId = zamer.documentId
      form.name = zamer.name
      form.industry = zamer.industry
      form.staffTotal = zamer.staffTotal
      form.companyUsers = zamer.companyUsers
      form.branchesCount = zamer.branchesCount
      form.annualRevenueRub = zamer.annualRevenueRub
      form.itCapexMlnRub = zamer.itCapexMlnRub
      form.itOpexMlnRub = zamer.itOpexMlnRub
      form.itFotMlnRub = zamer.itFotMlnRub
      form.itStaffTotal = zamer.itStaffTotal
      form.itDependencyPct = zamer.itDependencyPct
      form.ceoCfoKpiAvailability = zamer.ceoCfoKpiAvailability
      form.itMgmtPct = zamer.itMgmtPct ?? 0
      form.itOpsPct = zamer.itOpsPct ?? 0
      form.itSupportPct = zamer.itSupportPct ?? 0
      form.itDevPct = zamer.itDevPct ?? 0
      if (zamer.factors) {
        form.factors = JSON.parse(JSON.stringify(zamer.factors))
      }
      if (zamer.results) {
        results.value = zamer.results
      }
      gateOpened.value = true
    }
  }
})
</script>
