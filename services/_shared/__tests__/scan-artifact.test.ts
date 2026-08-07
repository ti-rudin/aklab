import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  cleanupScanArtifact,
  getScanArtifactPath,
  readScanArtifact,
  writeScanArtifact,
  type ScanArtifactCounters,
} from '../src/scan-artifact';

const dirs: string[] = [];
const counters: ScanArtifactCounters = {
  listed: 3,
  eligible: 2,
  existing: 1,
  preFiltered: 0,
  detailsNeeded: 2,
};

function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'aklab-scan-artifact-test-'));
  dirs.push(dir);
  return dir;
}

function writeFixture(directory: string, overrides: Record<string, unknown> = {}) {
  writeScanArtifact({
    source: 'tender',
    runId: 'run-1',
    counters,
    items: [{ external_id: 'ext-1', title: 'Склад' }],
    filterSnapshotHash: 'a'.repeat(64),
    scope: 'all',
    profileCount: 2,
    ...overrides,
  }, directory);
  return getScanArtifactPath('tender', 'run-1', directory);
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('scan artifact v2', () => {
  it('round-trips the complete v2 manifest and read does not consume it', () => {
    const directory = makeDir();
    const path = writeFixture(directory);

    const artifact = readScanArtifact('tender', 'run-1', {
      filterSnapshotHash: 'a'.repeat(64),
      scope: 'all',
      profileCount: 2,
    }, directory);

    expect(artifact).toMatchObject({
      schemaVersion: 2,
      runId: 'run-1',
      source: 'tender',
      counters,
      items: [{ external_id: 'ext-1', title: 'Склад' }],
      filterSnapshotHash: 'a'.repeat(64),
      scope: 'all',
      profileCount: 2,
    });
    expect(typeof artifact.checksum).toBe('string');
    expect(Object.keys(artifact).sort()).toEqual([
      'checksum',
      'counters',
      'filterSnapshotHash',
      'items',
      'profileCount',
      'runId',
      'schemaVersion',
      'scope',
      'source',
    ]);
    expect(existsSync(path)).toBe(true);

    cleanupScanArtifact('tender', 'run-1', directory);
    expect(existsSync(path)).toBe(false);
  });

  it.each([
    ['counter tamper', (value: any) => ({ ...value, counters: { ...value.counters, listed: 99 } })],
    ['item tamper', (value: any) => ({ ...value, items: [{ external_id: 'changed' }] })],
    ['snapshot hash tamper', (value: any) => ({ ...value, filterSnapshotHash: 'b'.repeat(64) })],
    ['scope tamper', (value: any) => ({ ...value, scope: 'single' })],
    ['profile count tamper', (value: any) => ({ ...value, profileCount: 3 })],
    ['extra private field', (value: any) => ({ ...value, email: 'private@example.test' })],
  ])('rejects %s because checksum covers every manifest field', (_name, tamper) => {
    const directory = makeDir();
    const path = writeFixture(directory);
    const value = JSON.parse(readFileSync(path, 'utf8'));
    writeFileSync(path, JSON.stringify(tamper(value)), 'utf8');

    expect(() => readScanArtifact('tender', 'run-1', undefined, directory)).toThrow(/Scan artifact manifest is invalid/);
    expect(existsSync(path)).toBe(true);
  });

  it('rejects job metadata mismatch before the artifact can be consumed', () => {
    const directory = makeDir();
    const path = writeFixture(directory);

    expect(() => readScanArtifact('tender', 'run-1', {
      filterSnapshotHash: 'c'.repeat(64),
      scope: 'all',
      profileCount: 2,
    }, directory)).toThrow(/Scan artifact metadata is invalid/);
    expect(existsSync(path)).toBe(true);
  });

  it.each([
    ['../escape', 'run-1'],
    ['tender', '../escape'],
    ['tender/slash', 'run-1'],
    ['tender', 'run/ slash'],
  ])('rejects unsafe path segment source=%s runId=%s', (source, runId) => {
    const directory = makeDir();
    expect(() => writeScanArtifact({
      source,
      runId,
      counters,
      items: [],
      filterSnapshotHash: 'a'.repeat(64),
      scope: 'all',
      profileCount: 0,
    }, directory)).toThrow(/safe segment/);
  });
});
