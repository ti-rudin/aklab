const FALLBACK_MAP_URL = 'https://invest.mosreg.ru/investor/map';

type PlaceWithFields = {
  fields?: Array<{ id?: unknown; name?: unknown; value?: unknown }>;
};

function validAbsoluteHttpUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined;

  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
      ? parsed.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

export function resolveInvestMosregSourceUrl(place: PlaceWithFields): string {
  const websiteField = (place.fields ?? []).find((field) =>
    String(field.name ?? '').toLowerCase().includes('ссылка на сайт'),
  );

  return validAbsoluteHttpUrl(websiteField?.value) ?? FALLBACK_MAP_URL;
}
