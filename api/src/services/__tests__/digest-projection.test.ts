import { describe, expect, it, vi } from 'vitest';
import { createUserFilterSnapshot, type UserParseProfile } from '@aklab/parse-rules';
import {
  createDigestProjectionService,
  DigestProjectionConflictError,
  DigestProjectionMalformedError,
  DigestProjectionNotFoundError,
  type DigestProjectionStrapi,
} from '../digest-projection';

const PROFILE: UserParseProfile = {
  userId: 7,
  profileId: 12,
  version: 3,
  regions: ['moscow'],
  propertyTypes: ['office'],
  priceFrom: 100,
  priceTo: 2_000_000,
  areaFrom: 50,
  areaTo: 2_000,
  stopWords: ['secret'],
};

const WINDOW_END = '2026-08-07T12:00:00.000Z';
const DIGEST_WINDOW_END = '2026-08-07T12:30:00.000Z';

function makeSnapshot(profile = PROFILE) {
  return createUserFilterSnapshot({
    schemaVersion: 1,
    scope: 'single',
    createdAt: WINDOW_END,
    windowEndAt: WINDOW_END,
    profiles: [profile],
  });
}

function makeStrapi() {
  const snapshot = makeSnapshot();
  const parserRunQuery = { findOne: vi.fn().mockResolvedValue({
    run_id: 'run-1',
    status: 'running',
    filter_snapshot: snapshot,
    filter_snapshot_hash: snapshot.hash,
    filter_snapshot_schema_version: 1,
    profile_scope: 'single',
    digest_window_end_at: DIGEST_WINDOW_END,
  }) };
  const settingQuery = { findOne: vi.fn().mockResolvedValue({ threshold_percent: 25 }) };
  const userQuery = { findOne: vi.fn().mockResolvedValue({ blocked: false, confirmed: true }) };
  const profileQuery = { findOne: vi.fn().mockResolvedValue({ digest_enabled: true, digest_email: ' recipient@example.test ' }) };
  const raw = vi.fn();
  const db = {
    query: vi.fn((uid: string) => {
      if (uid === 'api::parser-run.parser-run') return parserRunQuery;
      if (uid === 'api::setting.setting') return settingQuery;
      if (uid === 'plugin::users-permissions.user') return userQuery;
      if (uid === 'api::user-profile.user-profile') return profileQuery;
      throw new Error(`unexpected uid: ${uid}`);
    }),
    connection: { raw },
  };
  const strapi: DigestProjectionStrapi & {
    parserRunQuery: typeof parserRunQuery;
    settingQuery: typeof settingQuery;
    userQuery: typeof userQuery;
    profileQuery: typeof profileQuery;
    raw: typeof raw;
    entityService: { findOne: ReturnType<typeof vi.fn> };
  } = {
    db,
    parserRunQuery,
    settingQuery,
    userQuery,
    profileQuery,
    raw,
    entityService: { findOne: vi.fn(() => { throw new Error('entityService must not be used'); }) },
  };
  return { strapi, snapshot, parserRunQuery, settingQuery, userQuery, profileQuery, raw };
}

const propertyInput = (snapshotHash: string) => ({
  runId: 'run-1',
  userId: 7,
  snapshotHash,
  page: 2,
  pageSize: 10,
});

const deliveryInput = (snapshotHash: string) => ({
  runId: 'run-1',
  userId: 7,
  snapshotHash,
});

function propertyRow() {
  return {
    document_id: 'property-7',
    title: 'Office',
    source: 'etprf',
    external_id: 'ext-7',
    url: 'https://example.test/7',
    city: 'moscow',
    address: 'Moscow',
    area_sqm: 100,
    price: 1_000,
    price_per_sqm: 10,
    property_type: 'office',
    auction_type: 'bankruptcy',
    description: 'safe',
    is_undervalued: true,
    deviation_percent: 30,
    focus_score: 40,
    personal_status: null,
    tags: '["new"]',
    photo_urls: '["https://example.test/photo.jpg"]',
    photos: '[{"url":"https://example.test/photo.jpg"}]',
    minimum_price: null,
    first_seen_at: WINDOW_END,
    created_at: WINDOW_END,
    comments: [{ id: 99 }],
    user_id: 99,
    profile_id: 99,
  };
}

describe('digest projection service', () => {
  it('projects through the immutable snapshot profile and fixed (lower, upper] window', async () => {
    const fixture = makeStrapi();
    fixture.raw
      .mockResolvedValueOnce({ rows: [{ total: '1' }] })
      .mockResolvedValueOnce({ rows: [propertyRow()] });
    const service = createDigestProjectionService(fixture.strapi);

    const result = await service.properties(propertyInput(fixture.snapshot.hash));
    expect(result).toEqual({
      data: [expect.objectContaining({ documentId: 'property-7', status: 'new' })],
      meta: {
        page: 2,
        pageSize: 10,
        total: 1,
        totalPages: 1,
        threshold: 25,
        windowEndAt: DIGEST_WINDOW_END,
      },
    });

    expect(fixture.parserRunQuery.findOne).toHaveBeenCalledWith({
      where: { run_id: 'run-1', status: 'running' },
      select: [
        'run_id',
        'status',
        'filter_snapshot',
        'filter_snapshot_hash',
        'filter_snapshot_schema_version',
        'profile_scope',
        'digest_window_end_at',
      ],
    });
    expect(fixture.settingQuery.findOne).toHaveBeenCalledWith({ select: ['threshold_percent'] });
    expect(fixture.profileQuery.findOne).not.toHaveBeenCalled();
    expect(fixture.strapi.entityService.findOne).not.toHaveBeenCalled();

    const [countCall, listCall] = fixture.raw.mock.calls;
    expect(countCall[0]).toContain('p.first_seen_at > ? AND p.first_seen_at <= ?');
    expect(listCall[0]).toContain('ORDER BY p.focus_score DESC LIMIT ? OFFSET ?');
    expect(countCall[0]).not.toContain(WINDOW_END);
    expect(listCall[0]).not.toContain(WINDOW_END);
    expect(countCall[1].slice(-2)).toEqual([
      Date.parse('2026-08-06T12:30:00.000Z'),
      Date.parse(DIGEST_WINDOW_END),
    ]);
    expect(listCall[1].slice(-4)).toEqual([
      Date.parse('2026-08-06T12:30:00.000Z'),
      Date.parse(DIGEST_WINDOW_END),
      10,
      10,
    ]);
    expect(result.data[0]).toMatchObject({ documentId: 'property-7', status: 'new' });
    expect(JSON.stringify(result.data[0])).not.toContain('profile_id');
  });

  it('fails closed when the immutable digest window is absent or predates the run snapshot', async () => {
    const fixture = makeStrapi();
    const baseRow = {
      run_id: 'run-1',
      status: 'running',
      filter_snapshot: fixture.snapshot,
      filter_snapshot_hash: fixture.snapshot.hash,
      filter_snapshot_schema_version: 1,
      profile_scope: 'single',
    };
    fixture.parserRunQuery.findOne
      .mockResolvedValueOnce({ ...baseRow, digest_window_end_at: null })
      .mockResolvedValueOnce({ ...baseRow, digest_window_end_at: '2026-08-07T11:59:59.999Z' });
    const service = createDigestProjectionService(fixture.strapi);

    await expect(service.properties(propertyInput(fixture.snapshot.hash)))
      .rejects.toBeInstanceOf(DigestProjectionMalformedError);
    await expect(service.properties(propertyInput(fixture.snapshot.hash)))
      .rejects.toBeInstanceOf(DigestProjectionMalformedError);
    expect(fixture.raw).not.toHaveBeenCalled();
  });

  it('keeps the current profile out of projection, so edits do not change a run', async () => {
    const fixture = makeStrapi();
    fixture.profileQuery.findOne.mockResolvedValue({
      digest_enabled: false,
      digest_email: null,
      regions: ['other'],
      property_types: ['land'],
    });
    fixture.raw
      .mockResolvedValueOnce({ rows: [{ total: '0' }] })
      .mockResolvedValueOnce({ rows: [] });
    const service = createDigestProjectionService(fixture.strapi);

    await expect(service.properties({ ...propertyInput(fixture.snapshot.hash), page: 1 })).resolves.toMatchObject({ data: [] });
    expect(fixture.profileQuery.findOne).not.toHaveBeenCalled();
  });

  it('fails before property SQL for a wrong user or a snapshot hash conflict', async () => {
    const fixture = makeStrapi();
    const service = createDigestProjectionService(fixture.strapi);

    await expect(service.properties({ ...propertyInput(fixture.snapshot.hash), userId: 99 }))
      .rejects.toBeInstanceOf(DigestProjectionNotFoundError);
    await expect(service.properties(propertyInput('f'.repeat(64))))
      .rejects.toBeInstanceOf(DigestProjectionConflictError);
    expect(fixture.raw).not.toHaveBeenCalled();
  });

  it('fails closed for a duplicate requested profile membership as a safe conflict', async () => {
    const fixture = makeStrapi();
    const duplicateHash = 'f'.repeat(64);
    fixture.parserRunQuery.findOne.mockResolvedValueOnce({
      run_id: 'run-1',
      status: 'running',
      filter_snapshot: {
        ...fixture.snapshot,
        hash: duplicateHash,
        profiles: [fixture.snapshot.profiles[0], { ...fixture.snapshot.profiles[0], profileId: 13 }],
      },
      filter_snapshot_hash: duplicateHash,
      filter_snapshot_schema_version: 1,
      profile_scope: 'single',
    });
    const service = createDigestProjectionService(fixture.strapi);

    await expect(service.properties(propertyInput(duplicateHash)))
      .rejects.toBeInstanceOf(DigestProjectionConflictError);
    expect(fixture.raw).not.toHaveBeenCalled();
  });

  it('fails closed for malformed stored snapshots without attempting property SQL', async () => {
    const fixture = makeStrapi();
    fixture.parserRunQuery.findOne.mockResolvedValueOnce({
      run_id: 'run-1',
      status: 'running',
      filter_snapshot: { schemaVersion: 1 },
      filter_snapshot_hash: 'f'.repeat(64),
      filter_snapshot_schema_version: 1,
      profile_scope: 'single',
    });
    const service = createDigestProjectionService(fixture.strapi);

    await expect(service.properties(propertyInput('f'.repeat(64))))
      .rejects.toBeInstanceOf(DigestProjectionMalformedError);
    expect(fixture.raw).not.toHaveBeenCalled();
  });

  it('requires an actual finite threshold in the fresh Setting row and never widens it', async () => {
    const fixture = makeStrapi();
    fixture.settingQuery.findOne.mockResolvedValueOnce({ threshold_percent: Number.NaN });
    const service = createDigestProjectionService(fixture.strapi);

    await expect(service.properties(propertyInput(fixture.snapshot.hash)))
      .rejects.toBeInstanceOf(DigestProjectionMalformedError);
    expect(fixture.raw).not.toHaveBeenCalled();

    fixture.settingQuery.findOne.mockResolvedValueOnce({});
    await expect(service.properties(propertyInput(fixture.snapshot.hash)))
      .rejects.toBeInstanceOf(DigestProjectionMalformedError);
    expect(fixture.raw).not.toHaveBeenCalled();

    fixture.settingQuery.findOne.mockResolvedValueOnce({ threshold_percent: '25' });
    await expect(service.properties(propertyInput(fixture.snapshot.hash)))
      .rejects.toBeInstanceOf(DigestProjectionMalformedError);
    expect(fixture.raw).not.toHaveBeenCalled();
  });

  it('re-reads current delivery controls and returns every normalized recipient', async () => {
    const fixture = makeStrapi();
    fixture.profileQuery.findOne.mockResolvedValueOnce({
      digest_enabled: true,
      digest_email: ' first@example.test, second@example.test, first@example.test ',
    });
    const service = createDigestProjectionService(fixture.strapi);

    await expect(service.delivery(deliveryInput(fixture.snapshot.hash))).resolves.toEqual({
      enabled: true,
      emails: ['first@example.test', 'second@example.test'],
    });
    fixture.profileQuery.findOne.mockResolvedValueOnce({ digest_enabled: false, digest_email: 'recipient@example.test' });
    await expect(service.delivery(deliveryInput(fixture.snapshot.hash))).resolves.toEqual({
      enabled: false,
      reason: 'disabled',
    });
    fixture.userQuery.findOne.mockResolvedValueOnce({ blocked: true, confirmed: true });
    await expect(service.delivery(deliveryInput(fixture.snapshot.hash))).resolves.toEqual({
      enabled: false,
      reason: 'inactive',
    });
    expect(fixture.profileQuery.findOne).toHaveBeenCalledTimes(2);
    expect(fixture.userQuery.findOne).toHaveBeenCalledTimes(3);
    expect(fixture.userQuery.findOne).toHaveBeenNthCalledWith(1, {
      where: { id: 7 },
      select: ['blocked', 'confirmed'],
    });
    expect(fixture.profileQuery.findOne).toHaveBeenNthCalledWith(1, {
      where: { user_id: 7 },
      select: ['digest_enabled', 'digest_email'],
    });
    expect(fixture.settingQuery.findOne).not.toHaveBeenCalled();
  });

  it.each([
    [{ blocked: true, confirmed: true }, { digest_enabled: true, digest_email: 'recipient@example.test' }, 'inactive'],
    [{ blocked: false, confirmed: false }, { digest_enabled: true, digest_email: 'recipient@example.test' }, 'inactive'],
    [{ blocked: false, confirmed: true }, { digest_enabled: false, digest_email: 'recipient@example.test' }, 'disabled'],
    [{ blocked: false, confirmed: true }, { digest_enabled: false, digest_email: 'stale malformed email' }, 'disabled'],
    [{ blocked: false, confirmed: true }, { digest_enabled: false, digest_email: null }, 'disabled'],
    [{ blocked: false, confirmed: true }, { digest_enabled: true, digest_email: null }, 'missing_email'],
  ])('skips delivery safely for current control state', async (user, profile, reason) => {
    const fixture = makeStrapi();
    fixture.userQuery.findOne.mockResolvedValue(user);
    fixture.profileQuery.findOne.mockResolvedValue(profile);
    const service = createDigestProjectionService(fixture.strapi);

    await expect(service.delivery(deliveryInput(fixture.snapshot.hash))).resolves.toEqual({ enabled: false, reason });
  });

  it('treats a malformed current email as a backend failure without exposing it', async () => {
    const fixture = makeStrapi();
    fixture.profileQuery.findOne.mockResolvedValue({ digest_enabled: true, digest_email: 'secret-not-an-email' });
    const service = createDigestProjectionService(fixture.strapi);

    await expect(service.delivery(deliveryInput(fixture.snapshot.hash)))
      .rejects.toBeInstanceOf(DigestProjectionMalformedError);
  });
});
