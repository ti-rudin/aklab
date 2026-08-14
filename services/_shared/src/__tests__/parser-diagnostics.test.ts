import { describe, expect, it } from 'vitest';
import { aggregateSemanticFingerprints, createParserExtractionDiagnostics } from '../parser-diagnostics';

describe('parser extraction diagnostics', () => {
  it('is deterministic across signal order and ignores cosmetic DOM details that are not semantic inputs', () => {
    const first = createParserExtractionDiagnostics({
      adapterVersion: 'm-ets.v1',
      propertyBlockFound: true,
      locationLabelId: 'property.location.address',
      semanticSignals: ['property.region', 'property.block', 'property.location.address'],
    });
    const reordered = createParserExtractionDiagnostics({
      adapterVersion: 'm-ets.v1',
      propertyBlockFound: true,
      locationLabelId: 'property.location.address',
      semanticSignals: ['property.location.address', 'property.block', 'property.region'],
    });

    expect(first).toEqual(reordered);
    expect(first.semantic_fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(first)).not.toContain('lot-info-block');
  });

  it('changes the fingerprint and records a mismatch when the bounded property block disappears', () => {
    const healthy = createParserExtractionDiagnostics({
      adapterVersion: 'etprf.v1',
      propertyBlockFound: true,
      locationLabelId: 'property.location.region',
      semanticSignals: ['property.block', 'property.location.region'],
    });
    const changed = createParserExtractionDiagnostics({
      adapterVersion: 'etprf.v1',
      propertyBlockFound: false,
      semanticSignals: [],
    });

    expect(changed.schema_mismatch).toBe('property_block_missing');
    expect(changed.semantic_fingerprint).not.toBe(healthy.semantic_fingerprint);
  });

  it('records an expected location-label mismatch without storing raw text', () => {
    const result = createParserExtractionDiagnostics({
      adapterVersion: 'aggregator-bankrot.v1',
      propertyBlockFound: true,
      semanticSignals: ['property.block'],
      schemaMismatch: 'location_label_missing',
    });

    expect(result).toMatchObject({
      schema_version: 1,
      property_block_found: true,
      schema_mismatch: 'location_label_missing',
    });
    expect(result).not.toHaveProperty('location_label_id');
  });

  it.each([
    'Адрес местонахождения: г. Москва',
    'party.pledgee.address',
    'property.location.address@example.test',
    'property location address',
    'a'.repeat(65),
  ])('rejects unsafe or non-allowlisted semantic IDs: %s', (unsafeId) => {
    expect(() => createParserExtractionDiagnostics({
      adapterVersion: 'source.v1',
      propertyBlockFound: true,
      locationLabelId: unsafeId,
      semanticSignals: ['property.block'],
    })).toThrow(/semantic|party/i);
  });

  it('rejects party-domain signals even when they are syntactically safe', () => {
    expect(() => createParserExtractionDiagnostics({
      adapterVersion: 'source.v1',
      propertyBlockFound: true,
      semanticSignals: ['property.block', 'organizer.address'],
    })).toThrow(/party/i);
  });

  it('aggregates per-card fingerprints deterministically without processing-order noise', () => {
    const left = 'a'.repeat(64);
    const right = 'b'.repeat(64);
    expect(aggregateSemanticFingerprints([left, right, left]))
      .toBe(aggregateSemanticFingerprints([right, left]));
    expect(aggregateSemanticFingerprints([])).toBeUndefined();
    expect(() => aggregateSemanticFingerprints(['unsafe'])).toThrow(/fingerprint/i);
  });
});
