import { defineStore } from 'pinia'
import api from '@/api/strapi'

export interface FactorInputs {
  fs: { F1: number | null; F2: number | null; F3: number | null; F4: number | null; C: number | null; BR: number | null; RC: number | null; L: number | null; GM: number }
  ms: { M1: number | null; M2: number | null; M3: number | null; M4: number | null; M5: number | null }
  rs: { R1: number | null; R2: number | null; R3: number | null; R4: number | null; R5: number | null }
  as: { A1: number | null; A2: number | null; A3: number | null; A4: number | null; A5: number | null }
}

export interface CalculationResults {
  profile: {
    gm: string
    costDowntimeDay: string
    costDowntimeHour: string
    itPenetration: string
    itBudgetTotal: string
    itIntensity: string
    itSaturation: string
    allocRemaining: number
  }
  indices: {
    fs: number
    ms: number
    rs: number
    as: number
    ex: number
    sqi: number
    sei: number
  }
  kpiList: { label: string; value: string; color: string }[]
  execRows: { label: string; value: string }[]
  systemCategory: string
  interpretations: { axis: string; label: string; avg: number; text: string }[]
  charts: {
    radar: { label: string; angle: number; value: number }[]
    quadrant: { x: number; y: number } | null
  }
}

export interface Zamer {
  id: string
  documentId: string
  name: string
  industry: string
  staffTotal: number
  companyUsers: number
  branchesCount: number
  annualRevenueRub: number
  itCapexMlnRub: number
  itOpexMlnRub: number
  itFotMlnRub: number
  itStaffTotal: number
  itDependencyPct: number
  ceoCfoKpiAvailability: boolean
  itMgmtPct: number
  itOpsPct: number
  itSupportPct: number
  itDevPct: number
  factors: FactorInputs
  results: CalculationResults | null
  createdAt: string
}

interface ZameryState {
  items: Zamer[]
  loading: boolean
}

export const INDUSTRIES = [
  { value: 'aviation-industry', label: 'Авиационная промышленность' },
  { value: 'aviation-transport', label: 'Авиационный транспорт' },
  { value: 'automotive-oem', label: 'Автомобилестроение (ОЕМ)' },
  { value: 'agricultural-complex', label: 'Агропромышленный комплекс (АПК)' },
  { value: 'public-sector', label: 'Госсектор' },
  { value: 'horeca', label: 'Гостинично-ресторанный бизнес (HoReCa)' },
  { value: 'railway-transport', label: 'Железнодорожный транспорт' },
  { value: 'utilities-infrastructure', label: 'ЖКХ и инфраструктура' },
  { value: 'it-tech-companies', label: 'ИТ- и технологические компании' },
  { value: 'logistics-classic', label: 'Логистика (классическая, 3PL)' },
  { value: 'machinery', label: 'Машиностроение' },
  { value: 'healthcare', label: 'Медицина и здравоохранение' },
  { value: 'metallurgy-mining', label: 'Металлургия и горная добыча' },
  { value: 'maritime-transport', label: 'Морской транспорт' },
  { value: 'oil-gas-sector', label: 'Нефтегазовый сектор' },
  { value: 'education', label: 'Образование' },
  { value: 'defense-industry', label: 'ОПК (Оборонно-промышленный комплекс)' },
  { value: 'food-industry', label: 'Пищевая промышленность' },
  { value: 'industrial-production', label: 'Промышленность (общее производство)' },
  { value: 'alcoholic-beverages', label: 'Производство алкогольных напитков' },
  { value: 'non-alcoholic-beverages', label: 'Производство безалкогольных напитков' },
  { value: 'agricultural-production', label: 'Производство сельхозпродукции' },
  { value: 'auto-parts-sales', label: 'Продажа запчастей (легковые)' },
  { value: 'truck-sales-service', label: 'Продажа и ремонт грузовиков' },
  { value: 'retail-ecommerce', label: 'Ритейл (e-commerce)' },
  { value: 'retail-classic', label: 'Ритейл (классический)' },
  { value: 'agriculture', label: 'Сельское хозяйство' },
  { value: 'building-materials', label: 'Строительные материалы' },
  { value: 'construction', label: 'Строительство' },
  { value: 'insurance', label: 'Страхование' },
  { value: 'shipbuilding', label: 'Судостроительная промышленность' },
  { value: 'telecommunications', label: 'Телекоммуникации' },
  { value: 'transport-ftl', label: 'Транспорт (сегмент FTL)' },
  { value: 'transport-logistics-average', label: 'Транспорт и логистика (среднее)' },
  { value: 'pharmaceuticals', label: 'Фармацевтика' },
  { value: 'financial-sector', label: 'Финансовый сектор' },
  { value: 'chemical-industry', label: 'Химическая промышленность' },
  { value: 'energy', label: 'Энергетика' },
]

export const FACTORS = {
  fs: [
    { key: 'F1', title: 'F1 — SPOF', desc: 'Концентрация / единые точки отказа' },
    { key: 'F2', title: 'F2 — Зависимости', desc: 'Прозрачность зависимостей' },
    { key: 'F3', title: 'F3 — Связанность', desc: 'Coupling: насколько всё связано со всем' },
    { key: 'F4', title: 'F4 — Восстановляемость', desc: 'Архитектурная восстанавливаемость (self-healing)' },
    { key: 'C', title: 'C — Каскад', desc: 'Насколько сбой распространяется' },
    { key: 'BR', title: 'BR — Радиус', desc: 'Сколько функций/процессов затрагивает сбой' },
    { key: 'RC', title: 'RC — Восстановление', desc: 'Цена/сложность восстановления' },
    { key: 'L', title: 'L — Потери', desc: 'Стоимость простоя для бизнеса' },
  ],
  ms: [
    { key: 'M1', title: 'M1 — Наблюдаемость', desc: 'Метрики, логи, трейсы, алерты' },
    { key: 'M2', title: 'M2 — Контроль', desc: 'Feature flags, admin API, точки воздействия' },
    { key: 'M3', title: 'M3 — Ответственность', desc: 'Владельцы, зоны, SLA/on-call' },
    { key: 'M4', title: 'M4 — Обратная связь', desc: 'Скорость feedback от изменений' },
    { key: 'M5', title: 'M5 — Изменяемость', desc: 'Безопасность изменений: CI/CD, тесты, откаты' },
  ],
  rs: [
    { key: 'R1', title: 'R1 — Избыточность', desc: 'Репликация, запас по мощности' },
    { key: 'R2', title: 'R2 — Деградация', desc: 'Fallback/circuit breaker/изоляция' },
    { key: 'R3', title: 'R3 — DR', desc: 'RTO/RPO, backup/restore, учения' },
    { key: 'R4', title: 'R4 — Инциденты', desc: 'Runbooks, SLO/SLI как триггеры' },
    { key: 'R5', title: 'R5 — Организация', desc: 'On-call, эскалации, обучение' },
  ],
  as: [
    { key: 'A1', title: 'A1 — Постмортемы', desc: 'Инцидент → изменения' },
    { key: 'A2', title: 'A2 — Тесты', desc: 'Инцидент → регрессионные тесты' },
    { key: 'A3', title: 'A3 — Chaos', desc: 'Эксперименты/игровые дни' },
    { key: 'A4', title: 'A4 — Data-driven', desc: 'Метрики инцидентов → решения' },
    { key: 'A5', title: 'A5 — Классы проблем', desc: 'Устраняем класс причин, не симптом' },
  ],
} as const

export type AxisKey = keyof typeof FACTORS

export function createDefaultFactors(): FactorInputs {
  return {
    fs: { F1: null, F2: null, F3: null, F4: null, C: null, BR: null, RC: null, L: null, GM: 1.0 },
    ms: { M1: null, M2: null, M3: null, M4: null, M5: null },
    rs: { R1: null, R2: null, R3: null, R4: null, R5: null },
    as: { A1: null, A2: null, A3: null, A4: null, A5: null },
  }
}

/** Извлекает атрибуты из ответа Strapi 5 */
function unwrap(item: Record<string, unknown>): Zamer {
  return {
    id: (item.id as unknown as string)?.toString() ?? '',
    documentId: (item.documentId as string) ?? '',
    name: (item.name as string) ?? '',
    industry: (item.industry as string) ?? '',
    staffTotal: (item.staffTotal as number) ?? 0,
    companyUsers: (item.companyUsers as number) ?? 0,
    branchesCount: (item.branchesCount as number) ?? 0,
    annualRevenueRub: (item.annualRevenueRub as number) ?? 0,
    itCapexMlnRub: (item.itCapexMlnRub as number) ?? 0,
    itOpexMlnRub: (item.itOpexMlnRub as number) ?? 0,
    itFotMlnRub: (item.itFotMlnRub as number) ?? 0,
    itStaffTotal: (item.itStaffTotal as number) ?? 0,
    itDependencyPct: (item.itDependencyPct as number) ?? 100,
    ceoCfoKpiAvailability: (item.ceoCfoKpiAvailability as boolean) ?? false,
    itMgmtPct: (item.itMgmtPct as number) ?? 0,
    itOpsPct: (item.itOpsPct as number) ?? 0,
    itSupportPct: (item.itSupportPct as number) ?? 0,
    itDevPct: (item.itDevPct as number) ?? 0,
    factors: (item.factors as FactorInputs) ?? createDefaultFactors(),
    results: (item.results as CalculationResults | null) ?? null,
    createdAt: (item.createdAt as string) ?? '',
  }
}

export const useZameryStore = defineStore('zamery', {
  state: (): ZameryState => ({
    items: [],
    loading: false,
  }),

  actions: {
    async fetchAll() {
      this.loading = true
      try {
        const { data } = await api.get('/zamers')
        this.items = (data.data ?? []).map(unwrap)
      } catch (e: unknown) {
        const err = e as { response?: { data?: unknown }; message?: string }
        console.error('[zamery] fetchAll error:', err.response?.data ?? err.message)
      } finally {
        this.loading = false
      }
    },

    async add(payload: Omit<Zamer, 'id' | 'documentId' | 'createdAt' | 'results'>): Promise<Zamer | null> {
      try {
        const { data } = await api.post('/zamers', { data: payload })
        const zamer = unwrap(data.data)
        this.items.unshift(zamer)
        return zamer
      } catch (e: unknown) {
        const err = e as { response?: { data?: unknown }; message?: string }
        console.error('[zamery] add error:', err.response?.data ?? err.message)
        return null
      }
    },

    async update(documentId: string, payload: Partial<Omit<Zamer, 'id' | 'documentId' | 'createdAt' | 'results'>>) {
      try {
        const { data } = await api.put(`/zamers/${documentId}`, { data: payload })
        const updated = unwrap(data.data)
        const idx = this.items.findIndex((z) => z.documentId === documentId)
        if (idx !== -1) this.items[idx] = updated
      } catch (e: unknown) {
        const err = e as { response?: { data?: unknown }; message?: string }
        console.error('[zamery] update error:', err.response?.data ?? err.message)
      }
    },

    async remove(documentId: string) {
      try {
        await api.delete(`/zamers/${documentId}`)
        this.items = this.items.filter((z) => z.documentId !== documentId)
      } catch (e: unknown) {
        const err = e as { response?: { data?: unknown }; message?: string }
        console.error('[zamery] remove error:', err.response?.data ?? err.message)
      }
    },

    async calculate(documentId: string, payload: { factors?: FactorInputs; profile?: Record<string, unknown> }): Promise<CalculationResults | null> {
      try {
        const { data } = await api.post(`/zamers/${documentId}/calculate`, payload)
        const results = data.data?.results ?? null
        // Обновляем замер в store
        const zamer = this.items.find((z) => z.documentId === documentId)
        if (zamer && results) {
          zamer.results = results
        }
        return results
      } catch (e: unknown) {
        const err = e as { response?: { data?: unknown }; message?: string }
        console.error('[zamery] calculate error:', err.response?.data ?? err.message)
        return null
      }
    },

    getById(documentId: string): Zamer | undefined {
      return this.items.find((z) => z.documentId === documentId)
    },
  },
})
