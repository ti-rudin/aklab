import { PermanentError } from '@aklab/sqlite-queue';
import { createHash, randomUUID } from 'crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

export const SCAN_ARTIFACT_SCHEMA_VERSION = 2 as const;
export const DEFAULT_SCAN_ARTIFACT_DIR = join(tmpdir(), 'aklab-scan');
export const LEGACY_FILTER_SNAPSHOT_HASH = '0'.repeat(64);

export type ScanArtifactScope = 'all' | 'single';

export interface ScanArtifactCounters {
  listed: number;
  eligible: number;
  existing: number;
  preFiltered: number;
  detailsNeeded: number;
}

export interface ScanArtifact {
  schemaVersion: typeof SCAN_ARTIFACT_SCHEMA_VERSION;
  runId: string;
  source: string;
  counters: ScanArtifactCounters;
  checksum: string;
  items: unknown[];
  filterSnapshotHash: string;
  scope: ScanArtifactScope;
  profileCount: number;
}

export interface ScanArtifactWriteInput {
  source: string;
  runId: string;
  counters: ScanArtifactCounters;
  items: unknown[];
  filterSnapshotHash: string;
  scope: ScanArtifactScope;
  profileCount: number;
}

export interface ScanArtifactExpectedMetadata {
  filterSnapshotHash: string;
  scope: ScanArtifactScope;
  profileCount: number;
}

export interface LocationUnresolvedDiagnostic {
  external_id: string;
  source_path: string;
  status: 'missing';
}

export interface LocationUnresolvedManifest {
  schemaVersion: 1;
  runId: string;
  source: string;
  items: LocationUnresolvedDiagnostic[];
  checksum: string;
}

const ARTIFACT_KEYS = [
  'schemaVersion',
  'runId',
  'source',
  'counters',
  'checksum',
  'items',
  'filterSnapshotHash',
  'scope',
  'profileCount',
] as const;

const COUNTER_KEYS = ['listed', 'eligible', 'existing', 'preFiltered', 'detailsNeeded'] as const;
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(message: string): never {
  throw new Error(message);
}

export function assertSafeScanSegment(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !SAFE_SEGMENT.test(value)) {
    fail(`${label} must be a safe segment`);
  }
}

function assertHash(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !SHA256_HEX.test(value)) {
    fail(`${label} must be a SHA-256 hex string`);
  }
}

function assertNonNegativeSafeInteger(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    fail(`${label} must be a non-negative safe integer`);
  }
}

function assertExactKeys(value: RecordValue, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${label} has unexpected fields`);
  }
}

function validateCounters(value: unknown): asserts value is ScanArtifactCounters {
  if (!isRecord(value)) fail('counters must be an object');
  assertExactKeys(value, COUNTER_KEYS, 'counters');
  for (const key of COUNTER_KEYS) assertNonNegativeSafeInteger(value[key], `counters.${key}`);
}

function validateMetadata(value: ScanArtifactExpectedMetadata): void {
  assertHash(value.filterSnapshotHash, 'filterSnapshotHash');
  if (value.scope !== 'all' && value.scope !== 'single') fail('scope is invalid');
  assertNonNegativeSafeInteger(value.profileCount, 'profileCount');
}

function validatePayload(value: unknown): asserts value is Omit<ScanArtifact, 'checksum'> & { checksum?: string } {
  if (!isRecord(value)) fail('manifest must be an object');
  assertExactKeys(value, ARTIFACT_KEYS, 'manifest');
  if (value.schemaVersion !== SCAN_ARTIFACT_SCHEMA_VERSION) fail('schemaVersion is invalid');
  assertSafeScanSegment(value.runId, 'runId');
  assertSafeScanSegment(value.source, 'source');
  validateCounters(value.counters);
  if (!Array.isArray(value.items)) fail('items must be an array');
  assertHash(value.filterSnapshotHash, 'filterSnapshotHash');
  if (value.scope !== 'all' && value.scope !== 'single') fail('scope is invalid');
  assertNonNegativeSafeInteger(value.profileCount, 'profileCount');
  assertHash(value.checksum, 'checksum');
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (isRecord(value)) {
    return Object.keys(value).sort().reduce<RecordValue>((sorted, key) => {
      sorted[key] = canonicalValue(value[key]);
      return sorted;
    }, {});
  }
  return value;
}

/** Stable JSON used for both writing and validating the complete manifest. */
export function canonicalScanArtifactJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function payloadOf(value: ScanArtifactWriteInput | ScanArtifact): Omit<ScanArtifact, 'checksum'> {
  return {
    schemaVersion: SCAN_ARTIFACT_SCHEMA_VERSION,
    runId: value.runId,
    source: value.source,
    counters: value.counters,
    items: value.items,
    filterSnapshotHash: value.filterSnapshotHash,
    scope: value.scope,
    profileCount: value.profileCount,
  };
}

export function checksumScanArtifact(value: ScanArtifactWriteInput | Omit<ScanArtifact, 'checksum'>): string {
  return createHash('sha256').update(canonicalScanArtifactJson(payloadOf(value as ScanArtifactWriteInput))).digest('hex');
}

export function getScanArtifactPath(source: string, runId: string, directory = DEFAULT_SCAN_ARTIFACT_DIR): string {
  assertSafeScanSegment(source, 'source');
  assertSafeScanSegment(runId, 'runId');
  return join(directory, `${source}-${runId}.json`);
}

export function getLocationUnresolvedManifestPath(
  source: string,
  runId: string,
  directory = DEFAULT_SCAN_ARTIFACT_DIR,
): string {
  assertSafeScanSegment(source, 'source');
  assertSafeScanSegment(runId, 'runId');
  return join(directory, `${source}-${runId}.location-unresolved.json`);
}

function assertBoundedDiagnosticText(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 256 || /[\u0000-\u001f\u007f]/u.test(value)) {
    fail(`${label} must be bounded text`);
  }
}

export function writeLocationUnresolvedManifest(
  source: string,
  runId: string,
  items: LocationUnresolvedDiagnostic[],
  directory = DEFAULT_SCAN_ARTIFACT_DIR,
): LocationUnresolvedManifest {
  assertSafeScanSegment(source, 'source');
  assertSafeScanSegment(runId, 'runId');
  if (!Array.isArray(items) || items.length < 1 || items.length > 10_000) fail('items are invalid');
  for (const item of items) {
    if (!isRecord(item) || Object.keys(item).sort().join(',') !== 'external_id,source_path,status') fail('item has unexpected fields');
    assertBoundedDiagnosticText(item.external_id, 'external_id');
    assertBoundedDiagnosticText(item.source_path, 'source_path');
    if (item.status !== 'missing') fail('status is invalid');
  }
  const payload = { schemaVersion: 1 as const, runId, source, items };
  const checksum = createHash('sha256').update(canonicalScanArtifactJson(payload)).digest('hex');
  const manifest: LocationUnresolvedManifest = { ...payload, checksum };
  mkdirSync(directory, { recursive: true });
  const target = getLocationUnresolvedManifestPath(source, runId, directory);
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, canonicalScanArtifactJson(manifest), 'utf-8');
    renameSync(temporary, target);
  } catch (error) {
    try { unlinkSync(temporary); } catch {}
    throw error;
  }
  return manifest;
}

export function writeScanArtifact(input: ScanArtifactWriteInput, directory = DEFAULT_SCAN_ARTIFACT_DIR): ScanArtifact {
  try {
    assertSafeScanSegment(input.source, 'source');
    assertSafeScanSegment(input.runId, 'runId');
    validateCounters(input.counters);
    if (!Array.isArray(input.items)) fail('items must be an array');
    validateMetadata(input);

    const payload = payloadOf(input);
    const artifact: ScanArtifact = { ...payload, checksum: checksumScanArtifact(input) };
    mkdirSync(directory, { recursive: true });
    const target = getScanArtifactPath(input.source, input.runId, directory);
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, canonicalScanArtifactJson(artifact), 'utf-8');
      renameSync(temporary, target);
    } catch (error) {
      try { unlinkSync(temporary); } catch {}
      throw error;
    }
    return artifact;
  } catch (error: any) {
    if (error instanceof Error && error.message.includes('safe segment')) throw error;
    throw new Error('Scan artifact manifest cannot be written');
  }
}

export function readScanArtifact(
  source: string,
  runId: string,
  expected?: ScanArtifactExpectedMetadata,
  directory = DEFAULT_SCAN_ARTIFACT_DIR,
): ScanArtifact {
  let scanFilePath: string;
  try {
    scanFilePath = getScanArtifactPath(source, runId, directory);
  } catch {
    throw new PermanentError('Scan artifact manifest is invalid');
  }

  if (!existsSync(scanFilePath)) {
    throw new PermanentError(`Scan artifact is missing for ${source} (${runId})`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(scanFilePath, 'utf-8'));
    validatePayload(parsed);
  } catch {
    throw new PermanentError(`Scan artifact manifest is invalid for ${source} (${runId})`);
  }

  const artifact = parsed as ScanArtifact;
  const payload = payloadOf(artifact);
  if (checksumScanArtifact(payload) !== artifact.checksum) {
    throw new PermanentError(`Scan artifact manifest is invalid for ${source} (${runId})`);
  }
  if (artifact.source !== source || artifact.runId !== runId) {
    throw new PermanentError(`Scan artifact manifest is invalid for ${source} (${runId})`);
  }
  if (expected) {
    try {
      validateMetadata(expected);
    } catch {
      throw new PermanentError(`Scan artifact metadata is invalid for ${source} (${runId})`);
    }
    if (
      artifact.filterSnapshotHash !== expected.filterSnapshotHash
      || artifact.scope !== expected.scope
      || artifact.profileCount !== expected.profileCount
    ) {
      throw new PermanentError(`Scan artifact metadata is invalid for ${source} (${runId})`);
    }
  }

  // Deliberately do not unlink here. A details retry must be able to reread it.
  return artifact;
}

export function cleanupScanArtifact(source: string, runId: string, directory = DEFAULT_SCAN_ARTIFACT_DIR): void {
  const scanFilePath = getScanArtifactPath(source, runId, directory);
  if (existsSync(scanFilePath)) unlinkSync(scanFilePath);
}
