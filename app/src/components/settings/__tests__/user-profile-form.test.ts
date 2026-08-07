import { describe, expect, it } from 'vitest'
import {
  createEmptyProfileDraft,
  normalizeNumericInput,
  normalizeStopWords,
  profilePayload,
  validateProfileDraft,
} from '../user-profile-form'

const validDraft = () => ({
  regions: ['moscow', 'mo'],
  property_types: ['office', 'warehouse'],
  price_from: null,
  price_to: 20_000_000,
  area_from: null,
  area_to: 500,
  stop_words: ['  ЗЕМЛЯ ', 'Аукцион', 'аукцион'],
  digest_email: 'user@example.test',
  digest_enabled: true,
})

describe('user-profile-form contracts', () => {
  it('creates a ready draft with the supported regions and property types', () => {
    expect(createEmptyProfileDraft()).toEqual({
      regions: ['moscow', 'mo', 'other'],
      property_types: [
        'office',
        'warehouse',
        'retail',
        'production',
        'free_purpose',
        'apartment',
        'land',
        'other',
      ],
      price_from: null,
      price_to: null,
      area_from: null,
      area_to: null,
      stop_words: [],
      digest_email: '',
      digest_enabled: false,
    })
  })

  it('normalizes empty numeric controls to null', () => {
    expect(normalizeNumericInput('')).toBeNull()
    expect(normalizeNumericInput('   ')).toBeNull()
    expect(normalizeNumericInput('12.5')).toBe(12.5)
  })

  it('canonicalizes stop words by trim, lowercase, deduplication and sort', () => {
    expect(normalizeStopWords(['  ЗЕМЛЯ ', 'Аукцион', 'аукцион', ''])).toEqual([
      'аукцион',
      'земля',
    ])
  })

  it('accepts exact stop-word cardinality and length boundaries', () => {
    expect(() => normalizeStopWords(Array.from({ length: 128 }, (_, i) => `word-${i}`))).not.toThrow()
    expect(() => normalizeStopWords(Array.from({ length: 129 }, (_, i) => `word-${i}`))).toThrow()
    expect(() => normalizeStopWords(['a'.repeat(256)])).not.toThrow()
    expect(() => normalizeStopWords(['a'.repeat(257)])).toThrow()
  })

  it('rejects invalid enums, ranges and digest dependency', () => {
    expect(validateProfileDraft({ ...validDraft(), regions: [] })).toContain('регион')
    expect(validateProfileDraft({ ...validDraft(), property_types: ['hotel'] })).toContain('тип')
    expect(validateProfileDraft({ ...validDraft(), price_from: 10, price_to: 9 })).toContain('Цена')
    expect(validateProfileDraft({ ...validDraft(), area_from: -1 })).toContain('Площадь')
    expect(validateProfileDraft({ ...validDraft(), digest_email: '', digest_enabled: true })).toContain('email')
  })

  it('does not silently drop invalid profile values while building a payload', () => {
    expect(() => profilePayload({ ...validDraft(), profile_version: 1, regions: ['moscow', 'invalid-region'] })).toThrow()
    expect(() => profilePayload({ ...validDraft(), profile_version: 1, price_from: 'not-a-number' })).toThrow()
    expect(() => normalizeStopWords([42])).toThrow()
    expect(() => profilePayload({ ...validDraft(), profile_version: '1' })).toThrow()
  })

  it('serializes only the exact profile update body and strips protected DTO fields', () => {
    expect(
      profilePayload({
        id: 11,
        user_id: 42,
        profile_version: 7,
        ...validDraft(),
      }),
    ).toEqual({
      expectedVersion: 7,
      regions: ['mo', 'moscow'],
      property_types: ['office', 'warehouse'],
      price_from: null,
      price_to: 20_000_000,
      area_from: null,
      area_to: 500,
      stop_words: ['аукцион', 'земля'],
      digest_email: 'user@example.test',
      digest_enabled: true,
    })

    expect(JSON.stringify(profilePayload({ profile_version: 1, ...validDraft() }))).not.toContain('user_id')
  })

  it('serializes a disabled empty recipient as nullable instead of an invalid empty email', () => {
    expect(profilePayload({ profile_version: 1, ...validDraft(), digest_email: '', digest_enabled: false })).toMatchObject({
      digest_email: null,
      digest_enabled: false,
    })
  })
})
