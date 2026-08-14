import { createHash } from 'crypto';

export type ParserSchemaMismatch =
  | 'property_block_missing'
  | 'location_label_missing'
  | 'detail_payload_changed';

export interface ParserExtractionDiagnostics {
  schema_version: 1;
  property_block_found: boolean;
  location_label_id?: string;
  schema_mismatch?: ParserSchemaMismatch;
  semantic_fingerprint: string;
}

export interface ParserExtractionDiagnosticsInput {
  adapterVersion: string;
  propertyBlockFound: boolean;
  locationLabelId?: string;
  schemaMismatch?: ParserSchemaMismatch;
  semanticSignals: string[];
}

const SEMANTIC_ID_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const PARTY_DOMAIN_PATTERN = /(?:^|[._-])(?:party|organizer|debtor|pledgee|creditor|seller|customer)(?:$|[._-])/;
const MISMATCHES = new Set<ParserSchemaMismatch>([
  'property_block_missing',
  'location_label_missing',
  'detail_payload_changed',
]);

function assertSemanticId(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64 || !SEMANTIC_ID_PATTERN.test(value)) {
    throw new TypeError(`Invalid parser diagnostic semantic ${field}`);
  }
  if (PARTY_DOMAIN_PATTERN.test(value)) {
    throw new TypeError(`Parser diagnostic party-domain ${field} is forbidden`);
  }
}

/** Build a bounded, non-PII shape fingerprint from adapter-owned semantic IDs. */
export function createParserExtractionDiagnostics(
  input: ParserExtractionDiagnosticsInput,
): ParserExtractionDiagnostics {
  assertSemanticId(input.adapterVersion, 'adapter version');
  if (typeof input.propertyBlockFound !== 'boolean' || !Array.isArray(input.semanticSignals)) {
    throw new TypeError('Invalid parser diagnostic input');
  }
  if (input.locationLabelId !== undefined) assertSemanticId(input.locationLabelId, 'location label ID');
  if (input.schemaMismatch !== undefined && !MISMATCHES.has(input.schemaMismatch)) {
    throw new TypeError('Invalid parser diagnostic schema mismatch');
  }
  for (const signal of input.semanticSignals) assertSemanticId(signal, 'signal ID');

  const schemaMismatch = input.propertyBlockFound
    ? input.schemaMismatch
    : 'property_block_missing';
  const shape = {
    schema_version: 1,
    adapter_version: input.adapterVersion,
    property_block_found: input.propertyBlockFound,
    location_label_id: input.locationLabelId ?? null,
    schema_mismatch: schemaMismatch ?? null,
    semantic_signals: [...new Set(input.semanticSignals)].sort(),
  };

  return {
    schema_version: 1,
    property_block_found: input.propertyBlockFound,
    ...(input.locationLabelId ? { location_label_id: input.locationLabelId } : {}),
    ...(schemaMismatch ? { schema_mismatch: schemaMismatch } : {}),
    semantic_fingerprint: createHash('sha256').update(JSON.stringify(shape)).digest('hex'),
  };
}

export function isParserExtractionDiagnostics(value: unknown): value is ParserExtractionDiagnostics {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const diagnostic = value as Record<string, unknown>;
  const allowed = new Set([
    'schema_version', 'property_block_found', 'location_label_id', 'schema_mismatch', 'semantic_fingerprint',
  ]);
  if (Object.keys(diagnostic).some(key => !allowed.has(key))) return false;
  try {
    if (diagnostic.schema_version !== 1 || typeof diagnostic.property_block_found !== 'boolean') return false;
    if (diagnostic.location_label_id !== undefined) assertSemanticId(diagnostic.location_label_id, 'location label ID');
    if (diagnostic.schema_mismatch !== undefined && !MISMATCHES.has(diagnostic.schema_mismatch as ParserSchemaMismatch)) return false;
    return typeof diagnostic.semantic_fingerprint === 'string'
      && /^[a-f0-9]{64}$/.test(diagnostic.semantic_fingerprint);
  } catch {
    return false;
  }
}

/** Aggregate per-card fingerprints without depending on processing order. */
export function aggregateSemanticFingerprints(fingerprints: Iterable<string>): string | undefined {
  const values = [...new Set(fingerprints)].sort();
  if (values.length === 0) return undefined;
  if (values.some(value => !/^[a-f0-9]{64}$/.test(value))) {
    throw new TypeError('Invalid parser semantic fingerprint');
  }
  return createHash('sha256').update(JSON.stringify(values)).digest('hex');
}
