export const REGIONS = ['moscow', 'mo', 'tver', 'tver_oblast', 'other'] as const

export type Region = (typeof REGIONS)[number]
export type RegionSelection = Record<Region, boolean>

export const REGION_LABELS: Record<Region, string> = {
  moscow: 'Москва',
  mo: 'Московская область',
  tver: 'Тверь',
  tver_oblast: 'Тверская область',
  other: 'Другой',
}

export const REGION_COMPACT_LABELS: Record<Region, string> = {
  moscow: 'Москва',
  mo: 'МО',
  tver: 'Тверь',
  tver_oblast: 'Тверская обл.',
  other: 'Другой',
}

export const REGION_OPTIONS: ReadonlyArray<{ value: Region; label: string }> = REGIONS.map(value => ({
  value,
  label: REGION_LABELS[value],
}))

export function createRegionSelection(selected = true): RegionSelection {
  return Object.fromEntries(REGIONS.map(region => [region, selected])) as RegionSelection
}

export function selectedRegions(selection: RegionSelection): Region[] {
  return REGIONS.filter(region => selection[region])
}
