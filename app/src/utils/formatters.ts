/**
 * Canonical formatters for property-related labels and styles.
 * Consolidated from PropertyListView, PropertyDetailView, MarketReferencesView.
 */

export const cityLabel = (v?: string): string =>
  ({ moscow: 'Москва', mo: 'МО', other: 'Другой' })[v || ''] || v || ''

export const typeLabel = (v?: string): string =>
  ({
    office: 'Офис',
    warehouse: 'Склад',
    retail: 'Торговля',
    production: 'Производство',
    free_purpose: 'Свободного назначения',
    apartment: 'Квартира',
    land: 'Зем. участок',
    other: 'Другое',
  })[v || ''] || v || ''

export const statusLabel = (v?: string): string =>
  ({
    new: 'Новый',
    in_progress: 'В работе',
    viewed: 'Просмотрен',
    rejected: 'Отклонён',
  })[v || ''] || v || ''

export const statusStyle = (s?: string): Record<string, string> =>
  ({
    new: { background: 'rgba(79,140,255,0.15)', color: '#4f8cff' },
    in_progress: { background: 'rgba(251,191,36,0.15)', color: '#f59e0b' },
    viewed: { background: 'rgba(16,185,129,0.15)', color: '#10b981' },
    rejected: { background: 'rgba(239,68,68,0.15)', color: '#ef4444' },
  })[s || ''] || {}

export const formatPrice = (v: string | number): string =>
  Number(v).toLocaleString('ru-RU')

export const formatPriceShort = (v: string | number | null | undefined): string => {
  if (v == null || v === '') return '—'
  const n = Number(v)
  if (isNaN(n)) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}М`
  if (n >= 1_000) return `${Math.round(n / 1_000)}К`
  return n.toLocaleString('ru-RU')
}
