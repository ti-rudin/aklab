/**
 * Shared style helpers — единый источник для score/tag/status цветов.
 * Заменяет дублированные scoreColor/tagStyle в DashboardView и useFocusTab.
 */

export function scoreColor(score: number): string {
  if (score >= 70) return 'var(--score-hot)'
  if (score >= 50) return 'var(--score-warm)'
  return 'var(--score-cold)'
}

export function scoreColorHex(score: number): string {
  // For cases that need hex values (e.g., dynamic backgrounds)
  if (score >= 70) return '#ef4444'
  if (score >= 50) return '#f59e0b'
  return '#4f8cff'
}

export function scoreBg(score: number): string {
  if (score >= 70) return 'var(--danger-soft)'
  if (score >= 50) return 'var(--warning-soft)'
  return 'var(--info-soft)'
}

export type TagVariant = 'undervalued' | 'has_minimum_price' | 'new' | 'large_area' | string

const TAG_STYLES: Record<string, { bg: string; color: string }> = {
  undervalued: { bg: 'var(--warning-soft)', color: 'var(--warning)' },
  has_minimum_price: { bg: 'var(--info-soft)', color: 'var(--info)' },
  new: { bg: 'var(--success-soft)', color: 'var(--success)' },
  large_area: { bg: 'rgba(168, 85, 247, 0.15)', color: '#a855f7' },
}

export function tagStyle(tag: string): { bg: string; color: string } {
  return TAG_STYLES[tag] || { bg: 'var(--accent-soft)', color: 'var(--accent)' }
}

export function tagLabel(tag: string): string {
  const labels: Record<string, string> = {
    undervalued: 'Недооценён',
    has_minimum_price: 'Мин. цена',
    new: 'Новый',
    large_area: 'Большая пл.',
  }
  return labels[tag] || tag
}

export function deviationStyle(deviation: number): { color: string; bg: string } {
  if (deviation <= -30) return { color: 'var(--danger)', bg: 'var(--danger-soft)' }
  if (deviation <= -20) return { color: 'var(--warning)', bg: 'var(--warning-soft)' }
  return { color: 'var(--info)', bg: 'var(--info-soft)' }
}
