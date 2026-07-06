import { describe, it, expect } from 'vitest'
import {
  tagLabel,
  cityLabel,
  typeLabel,
  statusLabel,
  formatPrice,
  formatPriceShort,
} from '../formatters'

// ── tagLabel ─────────────────────────────────────────────────────
describe('tagLabel', () => {
  it.each([
    ['undervalued', 'Недооценённый'],
    ['has_minimum_price', 'Есть начальная цена'],
    ['price_drop', 'Снижение цены'],
    ['high_roi', 'Высокий ROI'],
    ['new_listing', 'Новый объект'],
    ['large_area', 'Большая площадь'],
    ['cheap_sqm', 'Дешёвый м²'],
    ['premium', 'Премиум'],
    ['investment', 'Инвестиция'],
    ['bargain', 'Выгодная сделка'],
  ])('%s → "%s"', (tag, expected) => {
    expect(tagLabel(tag)).toBe(expected)
  })

  it('unknown tag → возвращает как есть', () => {
    expect(tagLabel('magic_tag')).toBe('magic_tag')
  })

  it('undefined → пустая строка', () => {
    expect(tagLabel(undefined)).toBe('')
  })

  it('пустая строка → пустая строка', () => {
    expect(tagLabel('')).toBe('')
  })
})

// ── cityLabel ────────────────────────────────────────────────────
describe('cityLabel', () => {
  it('moscow → "Москва"', () => {
    expect(cityLabel('moscow')).toBe('Москва')
  })

  it('mo → "МО"', () => {
    expect(cityLabel('mo')).toBe('МО')
  })

  it('other → "Другой"', () => {
    expect(cityLabel('other')).toBe('Другой')
  })

  it('unknown city → возвращает как есть', () => {
    expect(cityLabel('spb')).toBe('spb')
  })

  it('undefined → пустая строка', () => {
    expect(cityLabel(undefined)).toBe('')
  })
})

// ── typeLabel ────────────────────────────────────────────────────
describe('typeLabel', () => {
  it.each([
    ['office', 'Офис'],
    ['warehouse', 'Склад'],
    ['retail', 'Торговля'],
    ['production', 'Производство'],
    ['free_purpose', 'Свободного назначения'],
    ['apartment', 'Квартира'],
    ['land', 'Зем. участок'],
    ['other', 'Другое'],
  ])('%s → "%s"', (type, expected) => {
    expect(typeLabel(type)).toBe(expected)
  })

  it('unknown type → возвращает как есть', () => {
    expect(typeLabel('garage')).toBe('garage')
  })

  it('undefined → пустая строка', () => {
    expect(typeLabel(undefined)).toBe('')
  })
})

// ── statusLabel ──────────────────────────────────────────────────
describe('statusLabel', () => {
  it.each([
    ['new', 'Новый'],
    ['in_progress', 'В работе'],
    ['viewed', 'Просмотрен'],
    ['rejected', 'Отклонён'],
  ])('%s → "%s"', (status, expected) => {
    expect(statusLabel(status)).toBe(expected)
  })

  it('unknown status → возвращает как есть', () => {
    expect(statusLabel('archived')).toBe('archived')
  })

  it('undefined → пустая строка', () => {
    expect(statusLabel(undefined)).toBe('')
  })
})

// ── formatPrice ──────────────────────────────────────────────────
describe('formatPrice', () => {
  it('форматирует число с разделителями', () => {
    const result = formatPrice(1234567)
    // ru-RU locale uses narrow no-break spaces or regular spaces as group separator
    expect(result.replace(/[\s\u00a0\u202f]/g, '')).toBe('1234567')
  })

  it('строковое число форматируется', () => {
    const result = formatPrice('98765')
    expect(result).toContain('98')
    expect(result).toContain('765')
  })

  it('ноль → "0"', () => {
    expect(formatPrice(0)).toBe('0')
  })
})

// ── formatPriceShort ─────────────────────────────────────────────
describe('formatPriceShort', () => {
  it('null → "—"', () => {
    expect(formatPriceShort(null)).toBe('—')
  })

  it('undefined → "—"', () => {
    expect(formatPriceShort(undefined)).toBe('—')
  })

  it('пустая строка → "—"', () => {
    expect(formatPriceShort('')).toBe('—')
  })

  it('NaN → "—"', () => {
    expect(formatPriceShort('abc')).toBe('—')
  })

  it('большие числа → М', () => {
    expect(formatPriceShort(5_000_000)).toBe('5М')
    expect(formatPriceShort(1_500_000)).toBe('1.5М')
    expect(formatPriceShort(1_000_000)).toBe('1М')
  })

  it('тысячи → К', () => {
    expect(formatPriceShort(500_000)).toBe('500К')
    expect(formatPriceShort(1_000)).toBe('1К')
    expect(formatPriceShort(45_000)).toBe('45К')
  })

  it('менее 1000 → обычный формат', () => {
    expect(formatPriceShort(999)).toBe('999')
    expect(formatPriceShort(500)).toBe('500')
  })
})
