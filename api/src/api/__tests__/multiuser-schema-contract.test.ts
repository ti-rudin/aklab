import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

type SchemaAttribute = Record<string, unknown>;
type Schema = {
  kind: string;
  info: { singularName: string };
  options?: { draftAndPublish?: boolean };
  indexes?: Array<{ columns: string[]; unique?: boolean; name?: string }>;
  attributes: Record<string, SchemaAttribute>;
};

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, '../../../..');

function schema(relativePath: string): Schema {
  return JSON.parse(readFileSync(join(repoRoot, relativePath), 'utf8')) as Schema;
}

function expectCollectionWithoutDrafts(value: Schema, singularName: string) {
  expect(value.kind).toBe('collectionType');
  expect(value.info.singularName).toBe(singularName);
  expect(value.options?.draftAndPublish).toBe(false);
}

function expectRelation(
  attribute: SchemaAttribute | undefined,
  relation: string,
  target: string,
  extra: Record<string, unknown> = {},
) {
  expect(attribute).toMatchObject({ type: 'relation', relation, target, required: true, ...extra });
}

const legacyPropertyAttributes = [
  'source',
  'external_id',
  'url',
  'title',
  'address',
  'city',
  'area_sqm',
  'price',
  'price_per_sqm',
  'property_type',
  'auction_type',
  'status',
  'is_undervalued',
  'deviation_percent',
  'manual_price_per_sqm',
  'published_at_source',
  'description',
  'contacts',
  'photo_urls',
  'photos',
  'photos_downloaded',
  'comments',
  'focus_score',
  'tags',
  'minimum_price',
  'first_seen_at',
  'property_events',
  'latitude',
  'longitude',
];

const legacyParserRunAttributes = [
  'run_id',
  'mode',
  'trigger',
  'status',
  'started_at',
  'heartbeat_at',
  'finished_at',
  'error_summary',
];

describe('multi-user additive schema contract', () => {
  it('defines a route-free user profile with exact ownership and filter constraints', () => {
    const profile = schema('api/src/api/user-profile/content-types/user-profile/schema.json');
    expectCollectionWithoutDrafts(profile, 'user-profile');
    expect(Object.keys(profile.attributes).sort()).toEqual([
      'area_from',
      'area_to',
      'digest_email',
      'digest_enabled',
      'price_from',
      'price_to',
      'profile_version',
      'property_types',
      'regions',
      'stop_words',
      'user',
      'user_id',
    ]);

    expectRelation(profile.attributes.user, 'oneToOne', 'plugin::users-permissions.user');
    expect(profile.attributes.user_id).toMatchObject({
      type: 'integer',
      required: true,
      unique: true,
      min: 1,
    });

    for (const field of ['regions', 'property_types', 'stop_words']) {
      expect(profile.attributes[field]).toMatchObject({ type: 'json', default: [] });
    }
    for (const field of ['price_from', 'price_to', 'area_from', 'area_to']) {
      expect(profile.attributes[field]).toMatchObject({ type: 'decimal', min: 0 });
      expect(profile.attributes[field].required).not.toBe(true);
    }
    expect(profile.attributes.digest_email).toMatchObject({ type: 'email' });
    expect(profile.attributes.digest_email.required).not.toBe(true);
    expect(profile.attributes.digest_enabled).toMatchObject({ type: 'boolean', default: false, required: true });
    expect(profile.attributes.profile_version).toMatchObject({
      type: 'integer',
      default: 1,
      required: true,
      min: 1,
    });

    for (const namespace of ['user-profile', 'user-property-state']) {
      expect(existsSync(join(repoRoot, `api/src/api/${namespace}/routes`))).toBe(false);
    }
  });

  it('defines user property state with scalar identity and scalar-only indexes', () => {
    const state = schema('api/src/api/user-property-state/content-types/user-property-state/schema.json');
    expectCollectionWithoutDrafts(state, 'user-property-state');
    expect(Object.keys(state.attributes).sort()).toEqual([
      'identity_key',
      'property',
      'property_document_id',
      'status',
      'user',
      'user_id',
    ]);

    expectRelation(state.attributes.user, 'manyToOne', 'plugin::users-permissions.user');
    expectRelation(
      state.attributes.property,
      'manyToOne',
      'api::property.property',
      { inversedBy: 'user_states' },
    );
    expect(state.attributes.user_id).toMatchObject({ type: 'integer', required: true, min: 1 });
    expect(state.attributes.property_document_id).toMatchObject({ type: 'string', required: true });
    expect(state.attributes.identity_key).toMatchObject({ type: 'string', required: true, unique: true });
    expect(state.attributes.status).toMatchObject({
      type: 'enumeration',
      enum: ['in_progress', 'viewed', 'rejected'],
      required: true,
    });

    const indexes = state.indexes ?? [];
    expect(indexes.map((index) => index.columns)).toEqual(
      expect.arrayContaining([['user_id', 'status'], ['property_document_id']]),
    );
    const scalarAttributes = new Set(
      Object.entries(state.attributes)
        .filter(([, attribute]) => attribute.type !== 'relation')
        .map(([name]) => name),
    );
    for (const index of indexes) {
      expect(index.columns).not.toContain('user');
      expect(index.columns).not.toContain('property');
      for (const column of index.columns) expect(scalarAttributes.has(column)).toBe(true);
    }
  });

  it('adds only the reverse state relation to Property and preserves every legacy attribute', () => {
    const property = schema('api/src/api/property/content-types/property/schema.json');
    for (const field of legacyPropertyAttributes) expect(property.attributes).toHaveProperty(field);
    expect(property.attributes.status).toMatchObject({
      type: 'enumeration',
      enum: ['new', 'in_progress', 'viewed', 'rejected'],
      required: true,
    });
    expect(property.attributes.user_states).toEqual({
      type: 'relation',
      relation: 'oneToMany',
      target: 'api::user-property-state.user-property-state',
      mappedBy: 'property',
    });
  });

  it('adds a required author relation to comments without removing existing fields', () => {
    const comments = schema('api/src/api/user-comment/content-types/user-comment/schema.json');
    expect(comments.attributes).toHaveProperty('property');
    expect(comments.attributes).toHaveProperty('text');
    expectRelation(comments.attributes.author, 'manyToOne', 'plugin::users-permissions.user');
  });

  it('adds profile-scoped parser telemetry without removing legacy fields or adding PII', () => {
    const parserRun = schema('api/src/api/parser-run/content-types/parser-run/schema.json');
    expectCollectionWithoutDrafts(parserRun, 'parser-run');
    for (const field of legacyParserRunAttributes) expect(parserRun.attributes).toHaveProperty(field);

    expect(parserRun.attributes.profile_scope).toMatchObject({
      type: 'enumeration',
      enum: ['all', 'single', 'none'],
    });
    expect(parserRun.attributes.target_user_id).toMatchObject({ type: 'integer' });
    expect(parserRun.attributes.target_user_id.required).not.toBe(true);
    expect(parserRun.attributes.filter_snapshot).toEqual({ type: 'json' });
    expect(parserRun.attributes.filter_snapshot_hash).toEqual({ type: 'string' });
    expect(parserRun.attributes.filter_snapshot_schema_version).toEqual({ type: 'integer' });

    for (const field of ['digest_scheduled', 'digest_sent', 'digest_skipped', 'digest_failed']) {
      expect(parserRun.attributes[field]).toMatchObject({ type: 'integer', default: 0, min: 0 });
    }

    const serializedSnapshotSchema = JSON.stringify(parserRun.attributes.filter_snapshot).toLowerCase();
    for (const piiField of ['email', 'username', 'password', 'phone', 'first_name', 'last_name', 'token']) {
      expect(serializedSnapshotSchema).not.toContain(piiField);
    }
  });
});
