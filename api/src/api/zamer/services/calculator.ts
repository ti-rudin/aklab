/**
 * Calculator service — серверные расчёты индексов TODOIT.
 * ВСЯ бизнес-логика расчётов здесь. Формулы — коммерческая тайна.
 */

import { z } from 'zod';

/** Zod-схема для nullable числового фактора (1-5 или null) */
const nullableFactor = z.number().min(1).max(5).nullable();

/** Zod-схема для валидации factors (H5+M3) */
export const factorsSchema = z.object({
  fs: z.object({
    F1: nullableFactor, F2: nullableFactor, F3: nullableFactor, F4: nullableFactor,
    C: nullableFactor, BR: nullableFactor, RC: nullableFactor, L: nullableFactor,
    GM: z.number().min(1).max(5),
  }),
  ms: z.object({
    M1: nullableFactor, M2: nullableFactor, M3: nullableFactor,
    M4: nullableFactor, M5: nullableFactor,
  }),
  rs: z.object({
    R1: nullableFactor, R2: nullableFactor, R3: nullableFactor,
    R4: nullableFactor, R5: nullableFactor,
  }),
  as: z.object({
    A1: nullableFactor, A2: nullableFactor, A3: nullableFactor,
    A4: nullableFactor, A5: nullableFactor,
  }),
});

type FactorInputs = z.infer<typeof factorsSchema>;

interface ProfileData {
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
}

interface KpiItem {
  label: string
  value: string
  color: string
}

interface ExecRow {
  label: string
  value: string
}

interface AxisInterpretation {
  axis: string
  label: string
  avg: number
  text: string
}

interface CalculationResults {
  // Profile KPIs
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
  // Indices
  indices: {
    fs: number
    ms: number
    rs: number
    as: number
    ex: number
    sqi: number
    sei: number
  }
  // KPI list for display
  kpiList: KpiItem[]
  // Executive summary
  execRows: ExecRow[]
  // System category
  systemCategory: string
  // Axis interpretations
  interpretations: AxisInterpretation[]
  // Chart data
  charts: {
    radar: { label: string; angle: number; value: number }[]
    quadrant: { x: number; y: number } | null
  }
}

export default () => ({
  /**
   * Полный расчёт всех индексов и интерпретаций.
   */
  computeAll(profile: ProfileData, factors: FactorInputs | null): CalculationResults {
    const profileKpis = this.computeProfile(profile)
    const indices = factors ? this.computeIndices(factors) : { fs: 0, ms: 0, rs: 0, as: 0, ex: 0, sqi: 0, sei: 0 }
    const kpiList = this.buildKpiList(indices)
    const execRows = this.buildExecRows(profile, profileKpis, indices)
    const systemCategory = this.computeCategory(indices)
    const interpretations = this.computeInterpretations(indices)
    const charts = this.buildChartData(indices)

    return {
      profile: profileKpis,
      indices,
      kpiList,
      execRows,
      systemCategory,
      interpretations,
      charts,
    }
  },

  /**
   * Расчёт профильных KPI.
   */
  computeProfile(p: ProfileData) {
    const gm = p.ceoCfoKpiAvailability ? '1.0' : '1.5'

    const costDowntimeDay = p.annualRevenueRub
      ? ((p.annualRevenueRub / 365) * (p.itDependencyPct / 100)).toFixed(2)
      : '—'

    const costDowntimeHour = costDowntimeDay !== '—'
      ? (parseFloat(costDowntimeDay) / 24).toFixed(2)
      : '—'

    const itPenetration = p.staffTotal
      ? ((p.companyUsers / p.staffTotal) * 100).toFixed(1) + '%'
      : '—'

    const itBudgetTotal = (p.itCapexMlnRub + p.itOpexMlnRub + p.itFotMlnRub).toFixed(1)

    const itIntensity = p.annualRevenueRub
      ? ((parseFloat(itBudgetTotal) / p.annualRevenueRub) * 100).toFixed(2) + '%'
      : '—'

    const itSaturation = p.companyUsers
      ? ((p.itStaffTotal / p.companyUsers) * 100).toFixed(1) + '%'
      : '—'

    const allocRemaining = Math.max(0, 100 - (p.itMgmtPct + p.itOpsPct + p.itSupportPct + p.itDevPct))

    return { gm, costDowntimeDay, costDowntimeHour, itPenetration, itBudgetTotal, itIntensity, itSaturation, allocRemaining }
  },

  /**
   * Расчёт индексов FS/MS/RS/AS/EX/SQI/SEI.
   */
  computeIndices(factors: FactorInputs) {
    const fs = this.axisAvg(factors.fs, ['F1', 'F2', 'F3', 'F4', 'C', 'BR', 'RC', 'L'])
    const ms = this.axisAvg(factors.ms, ['M1', 'M2', 'M3', 'M4', 'M5'])
    const rs = this.axisAvg(factors.rs, ['R1', 'R2', 'R3', 'R4', 'R5'])
    const as = this.axisAvg(factors.as, ['A1', 'A2', 'A3', 'A4', 'A5'])

    const lFactor = factors.fs.L
    const ex = (lFactor !== null && fs > 0) ? fs * lFactor : 0
    const sqi = fs > 0 ? ms / fs : 0
    const sei = (rs + as) / 2

    return {
      fs: this.round2(fs),
      ms: this.round2(ms),
      rs: this.round2(rs),
      as: this.round2(as),
      ex: this.round2(ex),
      sqi: this.round2(sqi),
      sei: this.round2(sei),
    }
  },

  /**
   * Среднее по указанным ключам оси.
   */
  axisAvg(axis: Record<string, number | null>, keys: string[]): number {
    const vals = keys
      .map((k) => axis[k])
      .filter((v): v is number => v !== null)
    if (!vals.length) return 0
    return vals.reduce((a, b) => a + b, 0) / vals.length
  },

  round2(v: number): number {
    return Math.round(v * 100) / 100
  },

  /**
   * KPI list для отображения.
   */
  buildKpiList(indices: { fs: number; ms: number; rs: number; as: number; ex: number; sqi: number; sei: number }): KpiItem[] {
    const colorScale = (v: number, inverted = false) => {
      if (inverted) {
        // FS: high = bad
        if (v > 3) return 'rgba(239, 68, 68, 0.95)'
        if (v > 2) return 'rgba(251, 191, 36, 0.95)'
        return 'rgba(16, 185, 129, 0.95)'
      }
      // MS/RS/AS: low = bad
      if (v < 2) return 'rgba(239, 68, 68, 0.95)'
      if (v < 3) return 'rgba(251, 191, 36, 0.95)'
      return 'rgba(16, 185, 129, 0.95)'
    }

    return [
      { label: 'FS', value: indices.fs.toFixed(2), color: colorScale(indices.fs, true) },
      { label: 'MS', value: indices.ms.toFixed(2), color: colorScale(indices.ms) },
      { label: 'RS', value: indices.rs.toFixed(2), color: colorScale(indices.rs) },
      { label: 'AS', value: indices.as.toFixed(2), color: colorScale(indices.as) },
      { label: 'EX', value: indices.ex.toFixed(2), color: 'var(--accent)' },
      { label: 'SQI', value: indices.sqi.toFixed(2), color: 'var(--accent)' },
      { label: 'SEI', value: indices.sei.toFixed(2), color: 'var(--accent)' },
    ]
  },

  /**
   * Executive summary rows.
   */
  buildExecRows(profile: ProfileData, profileKpis: any, indices: { fs: number; ms: number }): ExecRow[] {
    let status = 'Не определён'
    if (indices.fs > 0 && indices.ms > 0) {
      if (indices.ms >= 3.5 && indices.fs <= 2) status = 'Стабильная'
      else if (indices.ms >= 3 && indices.fs <= 3) status = 'Контролируемый риск'
      else if (indices.ms < 3 && indices.fs > 3) status = 'Критическая зона'
      else status = 'Скрытые проблемы'
    }

    return [
      { label: 'Статус системы', value: status },
      { label: 'Годовой оборот', value: profile.annualRevenueRub ? `${profile.annualRevenueRub} млн ₽` : '—' },
      { label: 'Стоимость простоя/день', value: profileKpis.costDowntimeDay !== '—' ? `${profileKpis.costDowntimeDay} млн ₽` : '—' },
      { label: 'Зависимость от ИТ', value: `${profile.itDependencyPct}%` },
      { label: 'GM', value: profileKpis.gm },
      { label: 'ИТ бюджет', value: `${profileKpis.itBudgetTotal} млн ₽` },
    ]
  },

  /**
   * Категория состояния системы.
   */
  computeCategory(indices: { fs: number; ms: number }): string {
    if (indices.fs === 0 && indices.ms === 0) return 'Заполните факторы для определения категории.'
    if (indices.ms >= 3.5 && indices.fs <= 2) return 'Стабильная система — высокая управляемость при низкой хрупкости.'
    if (indices.ms >= 3 && indices.fs <= 3) return 'Контролируемый риск — система управляема, но есть потенциальные слабости.'
    if (indices.ms < 3 && indices.fs > 3) return 'Критическая зона — низкая управляемость при высокой хрупкости. Требуется немедленное вмешательство.'
    return 'Скрытые проблемы — необходимо улучшать управляемость и снижать хрупкость.'
  },

  /**
   * Интерпретации по осям.
   */
  computeInterpretations(indices: { fs: number; ms: number; rs: number; as: number }): AxisInterpretation[] {
    const axes = [
      { key: 'fs', label: 'Хрупкость', inverted: true },
      { key: 'ms', label: 'Управляемость', inverted: false },
      { key: 'rs', label: 'Устойчивость', inverted: false },
      { key: 'as', label: 'Антихрупкость', inverted: false },
    ]

    return axes.map(({ key, label, inverted }) => {
      const avg = indices[key as keyof typeof indices]
      let text = 'Заполните факторы для интерпретации.'

      if (avg > 0) {
        if (inverted) {
          // FS: 1 = good, 5 = bad
          if (avg <= 2) text = 'Низкая хрупкость — система устойчива к отказам.'
          else if (avg <= 3) text = 'Средняя хрупкость — есть зоны риска.'
          else text = 'Высокая хрупкость — система подвержена сбоям.'
        } else {
          // MS/RS/AS: 1 = bad, 5 = good
          if (avg <= 2) text = `Низкий уровень ${label.toLowerCase()} — требуется развитие.`
          else if (avg <= 3) text = `Средний уровень ${label.toLowerCase()}.`
          else text = `Высокий уровень ${label.toLowerCase()}.`
        }
      }

      return { axis: key, label, avg: this.round2(avg), text }
    })
  },

  /**
   * Данные для графиков.
   */
  buildChartData(indices: { fs: number; ms: number; rs: number; as: number }) {
    const radar = [
      { label: 'FS', angle: -Math.PI / 2, value: indices.fs },
      { label: 'MS', angle: 0, value: indices.ms },
      { label: 'RS', angle: Math.PI / 2, value: indices.rs },
      { label: 'AS', angle: Math.PI, value: indices.as },
    ]

    let quadrant = null
    if (indices.fs > 0 || indices.ms > 0) {
      const x = 40 + ((indices.fs - 1) / 4) * 320
      const y = 290 - ((indices.ms - 1) / 4) * 280
      quadrant = { x: Math.round(x), y: Math.round(y) }
    }

    return { radar, quadrant }
  },
})
