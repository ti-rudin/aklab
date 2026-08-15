import { REGIONS, type Region } from '@/constants/regions'

export { REGIONS }
export type { Region }

export const PROPERTY_TYPES = [
  'office',
  'warehouse',
  'retail',
  'production',
  'free_purpose',
  'apartment',
  'land',
  'other',
] as const
export type PropertyType = (typeof PROPERTY_TYPES)[number]

export type NumericInput = number | string | null | undefined

export interface ProfileDraft {
  regions: Region[]
  property_types: PropertyType[]
  price_from: number | null
  price_to: number | null
  area_from: number | null
  area_to: number | null
  stop_words: string[]
  filter_rent: boolean
  digest_email: string
  digest_enabled: boolean
}

export type ProfileDto = Omit<ProfileDraft, 'digest_email'> & {
  id?: number
  user_id?: number
  digest_email: string | null
  profile_version: number
  documentId?: string
  email?: string | null
  username?: string | null
  blocked?: boolean
}

export interface ProfileUpdatePayload {
  expectedVersion: number
  regions: Region[]
  property_types: PropertyType[]
  price_from: number | null
  price_to: number | null
  area_from: number | null
  area_to: number | null
  stop_words: string[]
  filter_rent: boolean
  digest_email: string | null
  digest_enabled: boolean
}

export type ProfileInput = {
  id?: unknown
  user_id?: unknown
  documentId?: unknown
  regions?: unknown
  property_types?: unknown
  price_from?: unknown
  price_to?: unknown
  area_from?: unknown
  area_to?: unknown
  stop_words?: unknown
  filter_rent?: unknown
  digest_email?: unknown
  digest_enabled?: unknown
  profile_version?: unknown
}

const regionSet = new Set<string>(REGIONS)
const propertyTypeSet = new Set<string>(PROPERTY_TYPES)
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_DIGEST_RECIPIENTS = 10
const MAX_DIGEST_EMAIL_LENGTH = 320

function normalizeDigestRecipients(value: unknown): string[] {
  if (typeof value !== 'string') throw new Error('Укажите корректный email')
  const raw = value.trim()
  if (raw === '') return []

  const recipients = raw.split(',').map(recipient => recipient.trim())
  if (
    recipients.length > MAX_DIGEST_RECIPIENTS
    || recipients.some(recipient => recipient === '' || recipient.length > MAX_DIGEST_EMAIL_LENGTH || !emailPattern.test(recipient))
  ) {
    throw new Error('Укажите корректные email через запятую')
  }

  const unique = new Map<string, string>()
  for (const recipient of recipients) {
    const key = recipient.toLowerCase()
    if (!unique.has(key)) unique.set(key, recipient)
  }
  return [...unique.values()]
}

export function createEmptyProfileDraft(): ProfileDraft {
  return {
    regions: [...REGIONS],
    property_types: [...PROPERTY_TYPES],
    price_from: null,
    price_to: null,
    area_from: null,
    area_to: null,
    stop_words: [],
    filter_rent: true,
    digest_email: '',
    digest_enabled: false,
  }
}

export function normalizeNumericInput(value: NumericInput): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' && value.trim() === '') return null
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : null
}

export const normalizeNumberInput = normalizeNumericInput

export function normalizeStopWords(words: unknown): string[] {
  if (!Array.isArray(words)) throw new Error('Стоп-слова должны быть массивом')
  if (words.some(word => typeof word !== 'string')) throw new Error('Стоп-слова должны быть строками')

  const normalized = [...new Set(
    words
      .filter((word): word is string => typeof word === 'string')
      .map(word => word.trim().toLowerCase())
      .filter(Boolean),
  )].sort((left, right) => left.localeCompare(right, 'ru'))

  if (normalized.length > 128) throw new Error('Можно указать не более 128 стоп-слов')
  if (normalized.some(word => word.length > 256)) throw new Error('Стоп-слово не может быть длиннее 256 символов')
  return normalized
}

function normalizeArray<T extends string>(value: unknown, allowed: Set<string>): T[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && allowed.has(item)))] as T[]
}

function readNumeric(value: unknown): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' && value.trim() === '') return null
  if (typeof value === 'number') return value
  if (typeof value === 'string') return Number(value.trim())
  return Number.NaN
}

function readStoredNumeric(value: unknown): number | null {
  return normalizeNumericInput(value as NumericInput)
}

function readFilterRent(value: unknown, allowLegacyDefault: boolean): boolean {
  if (value === undefined && allowLegacyDefault) return true
  if (typeof value !== 'boolean') throw new Error('Некорректное значение фильтра аренды')
  return value
}

function normalizePayloadArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map(item => typeof item === 'string' ? item.trim().toLowerCase() : item as never))]
    .sort((left, right) => String(left).localeCompare(String(right))) as string[]
}

export function profileDraftFromDto(value: Partial<ProfileDto> | null | undefined): ProfileDraft {
  const source = value || {}
  return {
    regions: normalizeArray<Region>(source.regions, regionSet),
    property_types: normalizeArray<PropertyType>(source.property_types, propertyTypeSet),
    price_from: readStoredNumeric(source.price_from),
    price_to: readStoredNumeric(source.price_to),
    area_from: readStoredNumeric(source.area_from),
    area_to: readStoredNumeric(source.area_to),
    stop_words: normalizeStopWords(source.stop_words || []),
    filter_rent: readFilterRent(source.filter_rent, true),
    digest_email: typeof source.digest_email === 'string' ? source.digest_email : '',
    digest_enabled: source.digest_enabled === true,
  }
}

function isFiniteNonNegative(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0)
}

function validateRange(from: unknown, to: unknown, label: string): string | null {
  if (!isFiniteNonNegative(from) || !isFiniteNonNegative(to)) return `${label} должен быть конечным неотрицательным числом`
  if (from !== null && to !== null && from > to) return `${label}: значение «от» не может быть больше «до»`
  return null
}

export function validateProfileDraft(draft: ProfileInput): string | null {
  if (!Array.isArray(draft.regions) || draft.regions.length === 0) return 'Выберите хотя бы один регион'
  if (draft.regions.some(region => typeof region !== 'string' || !regionSet.has(region))) return 'Выбран недопустимый регион'
  if (!Array.isArray(draft.property_types) || draft.property_types.length === 0) return 'Выберите хотя бы один тип недвижимости'
  if (draft.property_types.some(type => typeof type !== 'string' || !propertyTypeSet.has(type))) return 'Выбран недопустимый тип недвижимости'

  const priceError = validateRange(draft.price_from, draft.price_to, 'Цена')
  if (priceError) return priceError
  const areaError = validateRange(draft.area_from, draft.area_to, 'Площадь')
  if (areaError) return areaError

  try {
    normalizeStopWords(draft.stop_words || [])
  } catch (error) {
    return error instanceof Error ? error.message : 'Некорректные стоп-слова'
  }

  let digestRecipients: string[]
  try {
    digestRecipients = normalizeDigestRecipients(draft.digest_email)
  } catch (error) {
    return error instanceof Error ? error.message : 'Укажите корректный email'
  }
  if (draft.digest_enabled === true && digestRecipients.length === 0) {
    return 'Для включённого дайджеста нужен корректный email'
  }
  return null
}

export function profilePayload(dto: ProfileInput): ProfileUpdatePayload {
  const draft: ProfileDraft = {
    regions: normalizePayloadArray(dto.regions) as Region[],
    property_types: normalizePayloadArray(dto.property_types) as PropertyType[],
    price_from: readNumeric(dto.price_from),
    price_to: readNumeric(dto.price_to),
    area_from: readNumeric(dto.area_from),
    area_to: readNumeric(dto.area_to),
    stop_words: normalizeStopWords(dto.stop_words || []),
    filter_rent: readFilterRent(dto.filter_rent, true),
    digest_email: normalizeDigestRecipients(dto.digest_email ?? '').join(', '),
    digest_enabled: dto.digest_enabled === true,
  }
  const error = validateProfileDraft(draft)
  if (error) throw new Error(error)

  const expectedVersion = dto.profile_version
  if (typeof expectedVersion !== 'number' || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
    throw new Error('Некорректная версия профиля')
  }

  return {
    expectedVersion,
    regions: draft.regions,
    property_types: draft.property_types,
    price_from: draft.price_from,
    price_to: draft.price_to,
    area_from: draft.area_from,
    area_to: draft.area_to,
    stop_words: draft.stop_words,
    filter_rent: draft.filter_rent,
    digest_email: draft.digest_email || null,
    digest_enabled: draft.digest_enabled,
  }
}

export const buildProfilePayload = profilePayload

export function isVersionConflict(error: unknown): boolean {
  return (error as { response?: { status?: number } })?.response?.status === 409
}
