import type {
  PartyAddress,
  PropertyLocation,
  PropertyLocationStatus,
  PropertyParty,
  StructuredSourceKind,
} from './types';

const LOCATION_STRENGTH = {
  missing: 0,
  legacy_unverified: 1,
  confirmed_region_only: 2,
  confirmed_address: 3,
} as const;

const LOCATION_STATUSES: readonly PropertyLocationStatus[] = [
  'confirmed_address',
  'confirmed_region_only',
  'missing',
  'legacy_unverified',
];

const SOURCE_KINDS: readonly StructuredSourceKind[] = [
  'dom_field',
  'api_field',
  'xml_field',
  'ssr_field',
];

type StructuredLocationInput = Partial<PropertyLocation> & {
  status: PropertyLocationStatus;
  source_kind: StructuredSourceKind;
  source_path: string;
};

function cleanText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function invalid(message: string): never {
  throw new TypeError(`Invalid property location: ${message}`);
}

function coordinate(value: unknown, min: number, max: number, name: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    invalid(`${name} must be a finite number in [${min}, ${max}]`);
  }
  return value;
}

/** Normalize only explicitly structured fields; never scan free-form text. */
export function normalizeStructuredLocation(input: StructuredLocationInput): PropertyLocation {
  if (!input || !LOCATION_STATUSES.includes(input.status)) invalid('status is required');
  if (!SOURCE_KINDS.includes(input.source_kind)) invalid('source_kind is required');
  const sourcePath = cleanText(input.source_path);
  if (!sourcePath) invalid('source_path is required');

  const address = cleanText(input.address);
  const region = cleanText(input.region);
  const regionCode = cleanText(input.region_code);
  const latitudeProvided = input.latitude !== undefined && input.latitude !== null;
  const longitudeProvided = input.longitude !== undefined && input.longitude !== null;
  if (latitudeProvided !== longitudeProvided) invalid('coordinates must be provided as a pair');
  const latitude = latitudeProvided ? coordinate(input.latitude, -90, 90, 'latitude') : undefined;
  const longitude = longitudeProvided ? coordinate(input.longitude, -180, 180, 'longitude') : undefined;

  if (input.status === 'confirmed_address' && !address) {
    invalid('confirmed_address requires address');
  }
  if (input.status === 'confirmed_region_only' && !region && !regionCode && latitude === undefined) {
    invalid('confirmed_region_only requires region, region_code, or coordinates');
  }
  if (
    input.status === 'missing'
    && (address || region || regionCode || latitude !== undefined || longitude !== undefined)
  ) {
    invalid('missing location cannot contain structured location data');
  }

  return {
    ...(address ? { address } : {}),
    ...(region ? { region } : {}),
    ...(regionCode ? { region_code: regionCode } : {}),
    ...(latitude !== undefined ? { latitude } : {}),
    ...(longitude !== undefined ? { longitude } : {}),
    status: input.status,
    source_kind: input.source_kind,
    source_path: sourcePath,
  };
}

/** Project the legacy address only from a confirmed structured full address. */
export function projectLegacyAddress(location: PropertyLocation): string {
  return location.status === 'confirmed_address' ? cleanText(location.address) ?? '' : '';
}

/** Derive geography exclusively from structured property-location fields. */
export function derivePropertyRegion(location: PropertyLocation):
  | 'moscow'
  | 'mo'
  | 'tver'
  | 'tver_oblast'
  | 'other' {
  const region = `${location.region ?? ''} ${location.region_code ?? ''}`.toLocaleLowerCase('ru-RU');
  const address = (location.address ?? '').toLocaleLowerCase('ru-RU');
  const structured = `${region} ${address}`;
  const code = (location.region_code ?? '').trim();

  if (/башкортостан/u.test(structured) || code === '02') return 'other';
  if (code === '50' || code === '90' || code === '150' || code === '190' || code === '750' || code === '790') return 'mo';
  if (code === '77' || /(?:^|[\s,.;])москв(?:а|е|ой)(?=$|[\s,.;])/u.test(structured)) return 'moscow';

  const explicitMo = /московск(?:ая|ой)\s+област|\bмо\b/u.test(region);
  if (explicitMo) return 'mo';

  const tverOblast = /тверск(?:ая|ой)\s+област|\bтверская\b/u.test(structured) || code === '69';
  if (tverOblast) {
    return /(?:^|[\s,.;])(?:г\.?\s*)?тверь(?=$|[\s,.;])/u.test(address)
      ? 'tver'
      : 'tver_oblast';
  }
  if (/(?:^|[\s,.;])(?:г\.?\s*)?тверь(?=$|[\s,.;])/u.test(structured)) return 'tver';
  return 'other';
}

/** Merge scan/details locations without allowing missing details to erase evidence. */
export function mergePropertyLocation(
  scan: PropertyLocation,
  details: PropertyLocation,
): PropertyLocation {
  if (details.status === 'missing') return scan;
  if (LOCATION_STRENGTH[scan.status] > LOCATION_STRENGTH[details.status]) return scan;

  return {
    ...scan,
    ...details,
    ...(details.region === undefined && scan.region !== undefined ? { region: scan.region } : {}),
    ...(details.region_code === undefined && scan.region_code !== undefined
      ? { region_code: scan.region_code }
      : {}),
    ...(details.latitude === undefined && scan.latitude !== undefined
      ? { latitude: scan.latitude }
      : {}),
    ...(details.longitude === undefined && scan.longitude !== undefined
      ? { longitude: scan.longitude }
      : {}),
  };
}

function identity(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU');
}

function identifier(value: string | undefined): string | undefined {
  const clean = cleanText(value);
  return clean ? clean.replace(/\s+/g, '') : undefined;
}

function matchingPartyIndex(parties: readonly PropertyParty[], party: PropertyParty): number {
  const inn = identifier(party.inn);
  if (inn) return parties.findIndex((item) => identifier(item.inn) === inn);

  const ogrn = identifier(party.ogrn);
  if (ogrn) return parties.findIndex((item) => identifier(item.ogrn) === ogrn);

  return parties.findIndex(
    (item) => !item.inn && !item.ogrn && identity(item.name) === identity(party.name),
  );
}

function mergeAddresses(
  left: PartyAddress[] | undefined,
  right: PartyAddress[] | undefined,
): PartyAddress[] | undefined {
  const addresses = [...(left ?? []), ...(right ?? [])];
  if (addresses.length === 0) return undefined;
  const seen = new Set<string>();
  return addresses.filter((address) => {
    const value = cleanText(address.value);
    if (!value) return false;
    const key = `${address.kind}:${identity(value)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mergeParty(left: PropertyParty, right: PropertyParty): PropertyParty {
  const roles = [...left.roles];
  for (const role of right.roles) {
    if (!roles.includes(role)) roles.push(role);
  }
  return {
    ...left,
    roles,
    inn: identifier(left.inn) ?? identifier(right.inn),
    ogrn: identifier(left.ogrn) ?? identifier(right.ogrn),
    kpp: identifier(left.kpp) ?? identifier(right.kpp),
    addresses: mergeAddresses(left.addresses, right.addresses),
    phone: cleanText(left.phone) ?? cleanText(right.phone),
    email: cleanText(left.email) ?? cleanText(right.email),
  };
}

/** Dedupe parties by INN, then OGRN, then normalized name. */
export function dedupeParties(parties: readonly PropertyParty[]): PropertyParty[] {
  const result: PropertyParty[] = [];
  for (const party of parties) {
    const existingIndex = matchingPartyIndex(result, party);
    if (existingIndex === -1) {
      result.push({
        ...party,
        roles: [...party.roles],
        ...(party.addresses ? { addresses: party.addresses.map((address) => ({ ...address })) } : {}),
      });
    } else {
      result[existingIndex] = mergeParty(result[existingIndex], party);
    }
  }
  return result;
}
