import { describe, expect, it, vi } from 'vitest';
import {
  compileUserPropertyScope,
  createUserPropertyScopeRepository,
  UserPropertyScopeMalformedError,
  UserPropertyScopeNotReadyError,
  UserPropertyScopeValidationError,
  type UserPropertyScopeStrapi,
  type UserParseProfile,
} from '../user-property-scope';

const profile: UserParseProfile = {
  userId: 7,
  profileId: 12,
  version: 3,
  regions: ['mo', 'moscow'],
  propertyTypes: ['office', 'warehouse'],
  priceFrom: 1_000_000,
  priceTo: 20_000_000,
  areaFrom: 50,
  areaTo: 2_000,
  stopWords: ['secret%_\\phrase', "'; drop table properties; --"],
};

const baseRequest = {
  city: ['moscow'] as const,
  propertyType: ['office'] as const,
  status: ['new', 'viewed'] as const,
  search: "needle%_'\\",
  focusThreshold: 10,
  documentId: 'property-7',
  sort: '-focus_score',
  page: 2,
  pageSize: 25,
};

function rawStrapi() {
  const raw = vi.fn();
  const strapi: UserPropertyScopeStrapi & { raw: ReturnType<typeof vi.fn> } = {
    db: { connection: { raw } },
    raw,
  };
  return strapi;
}

function rowsFromCall(call: unknown[]) {
  return (call[1] as unknown[]) || [];
}

describe('compileUserPropertyScope', () => {
  it('compiles one immutable profile predicate plus only narrowing AND filters', () => {
    const compiled = compileUserPropertyScope(profile, baseRequest);

    expect(compiled.fromSql).toBe(
      'FROM properties AS p LEFT JOIN user_property_states AS ups ON ups.property_document_id = p.document_id AND ups.user_id = ?'
    );
    expect(compiled.whereSql).toContain('p.city IN (?,?)');
    expect(compiled.whereSql).toContain('p.property_type IN (?,?)');
    expect(compiled.whereSql).toContain('(p.price IS NULL OR p.price >= ?)');
    expect(compiled.whereSql).toContain('(p.price IS NULL OR p.price <= ?)');
    expect(compiled.whereSql).toContain('(p.area_sqm IS NULL OR p.area_sqm >= ?)');
    expect(compiled.whereSql).toContain('(p.area_sqm IS NULL OR p.area_sqm <= ?)');
    expect(compiled.whereSql).toContain("LOWER(COALESCE(p.title, '') || ' ' || COALESCE(p.description, '')) NOT LIKE ? ESCAPE '\\'");
    expect(compiled.whereSql).toContain('p.city IN (?)');
    expect(compiled.whereSql).toContain('p.property_type IN (?)');
    expect(compiled.whereSql).toContain('COALESCE(ups.status, ?) IN (?,?)');
    expect(compiled.whereSql).toContain('p.focus_score >= ?');
    expect(compiled.whereSql).toContain('p.document_id = ?');
    // An explicit status request (new, viewed) deliberately replaces the
    // default inbox rule that excludes rejected objects.
    expect(compiled.whereSql).not.toContain('COALESCE(ups.status, ?) != ?');
    expect(compiled.orderBySql).toBe('p.focus_score DESC');
    expect(compiled.page).toBe(2);
    expect(compiled.pageSize).toBe(25);

    for (const value of [
      ...profile.regions,
      ...profile.propertyTypes,
      ...profile.stopWords,
      baseRequest.search,
      baseRequest.documentId,
    ]) {
      expect(compiled.whereSql).not.toContain(value);
    }
    expect(compiled.bindings).toEqual(expect.arrayContaining([
      7,
      'moscow',
      'office',
      1_000_000,
      20_000_000,
      50,
      2_000,
      `%secret\\%\\_\\\\phrase%`,
      `%'; drop table properties; --%`,
      'new',
      'viewed',
      10,
      'property-7',
    ]));
  });

  it('keeps missing property price and area values permissive under profile bounds', () => {
    const compiled = compileUserPropertyScope(profile);
    expect(compiled.whereSql.match(/p\.price IS NULL/g)).toHaveLength(2);
    expect(compiled.whereSql.match(/p\.area_sqm IS NULL/g)).toHaveLength(2);
    expect(compiled.bindings).toEqual(expect.arrayContaining([1_000_000, 20_000_000, 50, 2_000]));
  });

  it('adds a strict parameterized half-open-to-closed first-seen window only for internal callers', () => {
    const compiled = compileUserPropertyScope(profile, {
      firstSeenAfter: '2026-08-06T12:00:00.000Z',
      firstSeenAtOrBefore: '2026-08-07T12:00:00.000Z',
    });

    expect(compiled.whereSql).toContain('p.first_seen_at > ? AND p.first_seen_at <= ?');
    expect(compiled.bindings.slice(-2)).toEqual([
      Date.parse('2026-08-06T12:00:00.000Z'),
      Date.parse('2026-08-07T12:00:00.000Z'),
    ]);
    expect(compiled.whereSql).not.toContain('2026-08-06');
    expect(compiled.whereSql).not.toContain('2026-08-07');

    for (const request of [
      { firstSeenAfter: '2026-08-06T12:00:00Z', firstSeenAtOrBefore: '2026-08-07T12:00:00.000Z' },
      { firstSeenAfter: '2026-08-07T12:00:00.000Z', firstSeenAtOrBefore: '2026-08-06T12:00:00.000Z' },
      { firstSeenAfter: '2026-08-06T12:00:00.000Z' },
      { firstSeenAtOrBefore: '2026-08-07T12:00:00.000Z' },
    ]) {
      expect(() => compileUserPropertyScope(profile, request)).toThrow(UserPropertyScopeValidationError);
    }
  });

  it('uses a fixed allowlisted SQL identifier for sorting and bounded pagination', () => {
    expect(compileUserPropertyScope(profile, { sort: 'createdAt', page: 1, pageSize: 100 }).orderBySql)
      .toBe('p.created_at ASC');
    expect(compileUserPropertyScope(profile, { sort: '-area_sqm' }).orderBySql)
      .toBe('p.area_sqm DESC');

    for (const request of [
      { sort: 'p.created_at; DROP TABLE properties' },
      { sort: 'unknown' },
      { page: 0 },
      { pageSize: 0 },
      { pageSize: 101 },
      { focusThreshold: Number.NaN },
      { focusThreshold: Number.POSITIVE_INFINITY },
      { city: ['moscow', 'moscow', 'mo', 'other', 'moscow'] },
      { populate: ['comments'] } as never,
    ]) {
      expect(() => compileUserPropertyScope(profile, request as never))
        .toThrow(UserPropertyScopeValidationError);
    }
  });

  it('rejects malformed and unready canonical profiles before producing SQL', () => {
    expect(() => compileUserPropertyScope({ ...profile, regions: [] })).toThrow(UserPropertyScopeNotReadyError);
    expect(() => compileUserPropertyScope({ ...profile, propertyTypes: [] })).toThrow(UserPropertyScopeNotReadyError);
    expect(() => compileUserPropertyScope({ ...profile, userId: 0 })).toThrow(UserPropertyScopeMalformedError);
    expect(() => compileUserPropertyScope({ ...profile, priceFrom: 20, priceTo: 10 })).toThrow(UserPropertyScopeMalformedError);
    expect(() => compileUserPropertyScope({ ...profile, stopWords: ['x'.repeat(257)] })).toThrow(UserPropertyScopeMalformedError);
  });

  it('does not allow a request filter to widen the profile enum scope', () => {
    const compiled = compileUserPropertyScope({ ...profile, regions: ['moscow'], propertyTypes: ['office'] }, {
      city: ['mo'],
      propertyType: ['warehouse'],
    });

    expect(compiled.whereSql).toContain('p.city IN (?)');
    expect(compiled.whereSql).toContain('p.property_type IN (?)');
    expect(compiled.bindings).toEqual(expect.arrayContaining(['moscow', 'office', 'mo', 'warehouse']));
  });

  it('keeps Tver city and Tver oblast as separate canonical profile and request bindings', () => {
    const compiled = compileUserPropertyScope(
      { ...profile, regions: ['tver', 'tver_oblast'] },
      { city: ['tver_oblast'] },
    );

    expect(compiled.whereSql).toContain('p.city IN (?,?)');
    expect(compiled.whereSql).toContain('p.city IN (?)');
    expect(compiled.bindings).toEqual(expect.arrayContaining(['tver', 'tver_oblast']));
    expect(compiled.bindings.filter(value => value === 'tver')).toHaveLength(1);
    expect(compiled.bindings.filter(value => value === 'tver_oblast')).toHaveLength(2);
  });

  it('hides rejected objects by default but exposes them through an explicit status filter', () => {
    const defaultScope = compileUserPropertyScope(profile);
    expect(defaultScope.whereSql).toContain('COALESCE(ups.status, ?) != ?');
    expect(defaultScope.bindings).toEqual(expect.arrayContaining(['new', 'rejected']));

    const rejectedScope = compileUserPropertyScope(profile, { status: ['rejected'] });
    expect(rejectedScope.whereSql).toContain('COALESCE(ups.status, ?) IN (?)');
    expect(rejectedScope.whereSql).not.toContain('COALESCE(ups.status, ?) != ?');
  });
});

describe('UserPropertyScopeRepository', () => {
  it('loads a positive scalar user profile through the injected canonical loader and fails closed when not ready', async () => {
    const strapi = rawStrapi();
    const loader = vi.fn().mockResolvedValue({ ...profile, regions: [] });
    const repository = createUserPropertyScopeRepository(strapi, loader);

    await expect(repository.list(7, {})).rejects.toBeInstanceOf(UserPropertyScopeNotReadyError);
    expect(loader).toHaveBeenCalledWith(7);
    expect(strapi.raw).not.toHaveBeenCalled();

    await expect(repository.list(0, {})).rejects.toBeInstanceOf(UserPropertyScopeValidationError);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('uses the exact same compiled FROM/WHERE/bindings for count, list, and detail', async () => {
    const strapi = rawStrapi();
    const loader = vi.fn().mockResolvedValue(profile);
    strapi.raw
      .mockResolvedValueOnce({ rows: [{ total: '1' }] })
      .mockResolvedValueOnce({ rows: [{ total: '1' }] })
      .mockResolvedValueOnce({ rows: [{
        document_id: 'property-7',
        title: 'Office',
        source: 'etprf',
        external_id: 'ext-7',
        url: 'https://example.test/7',
        city: 'moscow',
        address: null,
        area_sqm: 100,
        price: 2_000_000,
        price_per_sqm: 20_000,
        manual_price_per_sqm: 18_500,
        property_type: 'office',
        is_undervalued: true,
        deviation_percent: 30,
        focus_score: 20,
        personal_status: 'viewed',
        published_at_source: '2026-08-06T08:00:00.000Z',
        contacts: '{"phone":"+7 999 000-00-00"}',
        photos_downloaded: 1,
        latitude: 55.75,
        longitude: 37.61,
        tags: '["new"]',
        photo_urls: '["https://example.test/photo.jpg"]',
        photos: '[{"url":"https://example.test/photo.jpg"}]',
        minimum_price: null,
        first_seen_at: '2026-08-07T09:00:00.000Z',
        created_at: '2026-08-07T09:00:00.000Z',
        comments: [{ id: 999 }],
        user_states: [{ user_id: 999 }],
        author: { id: 999 },
        profile_id: 999,
      }] })
      .mockResolvedValueOnce({ rows: [{
        document_id: 'property-7',
        title: 'Office',
        source: 'etprf',
        external_id: 'ext-7',
        city: 'moscow',
        price_per_sqm: 20_000,
        manual_price_per_sqm: 18_500,
        property_type: 'office',
        focus_score: 20,
        personal_status: 'viewed',
        published_at_source: '2026-08-06T08:00:00.000Z',
        contacts: '{"phone":"+7 999 000-00-00"}',
        photos_downloaded: 1,
        latitude: 55.75,
        longitude: 37.61,
        tags: '["new"]',
        photos: 'not-json',
      }] });

    const repository = createUserPropertyScopeRepository(strapi, loader);
    const request = { documentId: 'property-7', sort: '-focus_score', page: 1, pageSize: 20 } as const;
    const expected = compileUserPropertyScope(profile, request);

    await expect(repository.count(7, request)).resolves.toBe(1);
    await expect(repository.list(7, request)).resolves.toMatchObject({
      data: [expect.objectContaining({
        documentId: 'property-7',
        status: 'viewed',
        price_per_sqm: 20_000,
        manual_price_per_sqm: 18_500,
        published_at_source: '2026-08-06T08:00:00.000Z',
        contacts: '{"phone":"+7 999 000-00-00"}',
        photos_downloaded: true,
        latitude: 55.75,
        longitude: 37.61,
        tags: ['new'],
        photos: [{ url: 'https://example.test/photo.jpg' }],
      })],
      meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    });
    await expect(repository.detail(7, 'property-7', request)).resolves.toMatchObject({
      documentId: 'property-7',
      status: 'viewed',
      price_per_sqm: 20_000,
      manual_price_per_sqm: 18_500,
      published_at_source: '2026-08-06T08:00:00.000Z',
      contacts: '{"phone":"+7 999 000-00-00"}',
      photos_downloaded: true,
      latitude: 55.75,
      longitude: 37.61,
      tags: ['new'],
      photos: [],
    });

    const [countCall, listCountCall, listCall, detailCall] = strapi.raw.mock.calls;
    for (const call of [countCall, listCountCall, listCall, detailCall]) {
      expect(call[0]).toContain(expected.fromSql);
      expect(call[0]).toContain(`WHERE ${expected.whereSql}`);
    }
    expect(rowsFromCall(countCall)).toEqual(expected.bindings);
    expect(rowsFromCall(listCountCall)).toEqual(expected.bindings);
    expect(rowsFromCall(detailCall).slice(-expected.bindings.length)).toEqual(expected.bindings);
    expect((listCall[0] as string)).toContain('COALESCE(ups.status, ?) AS personal_status');
    expect((listCall[0] as string)).not.toContain('comments');
    expect((listCall[0] as string)).not.toContain('user_states');
    expect((listCall[0] as string)).not.toContain('profile_id');
    expect((listCall[0] as string)).not.toContain('author');
    for (const field of [
      'price_per_sqm',
      'manual_price_per_sqm',
      'published_at_source',
      'contacts',
      'photos_downloaded',
      'latitude',
      'longitude',
    ]) {
      expect(listCall[0]).toContain(`p.${field} AS ${field}`);
    }
  });

  it('returns null for a detail outside scope instead of exposing a forbidden distinction', async () => {
    const strapi = rawStrapi();
    strapi.raw.mockResolvedValueOnce({ rows: [] });
    const repository = createUserPropertyScopeRepository(strapi, vi.fn().mockResolvedValue(profile));

    await expect(repository.detail(7, 'not-visible', {})).resolves.toBeNull();
    expect(strapi.raw).toHaveBeenCalledTimes(1);
  });

  it('returns an allowlisted DTO with only the virtual personal status and safe JSON arrays', async () => {
    const strapi = rawStrapi();
    strapi.raw
      .mockResolvedValueOnce({ rows: [{ total: '1' }] })
      .mockResolvedValueOnce({ rows: [{
      document_id: 'property-7',
      title: 'Office',
      source: 'etprf',
      external_id: 'ext-7',
      city: 'moscow',
      property_type: 'office',
      personal_status: null,
      photos_downloaded: 0,
      status: 'rejected',
      tags: '{bad json',
      photos: '{"private":true}',
      photo_urls: '["https://example.test/photo.jpg"]',
      user_id: 999,
      comments: [{ id: 999 }],
      authors: [{ id: 999 }],
      profile_id: 999,
    }] });
    const repository = createUserPropertyScopeRepository(strapi, vi.fn().mockResolvedValue(profile));

    const result = await repository.list(7, {});
    expect(result.data[0]).toMatchObject({ documentId: 'property-7', status: 'new', tags: [], photos: [] });
    expect(result.data[0]).toHaveProperty('photo_urls', ['https://example.test/photo.jpg']);
    for (const privateKey of ['id', 'user_id', 'comments', 'authors', 'profile_id', 'status_global']) {
      expect(result.data[0]).not.toHaveProperty(privateKey);
    }
  });

  it('fails closed when photos_downloaded is not the SQLite 0/1 representation', async () => {
    const strapi = rawStrapi();
    strapi.raw
      .mockResolvedValueOnce({ rows: [{ total: '1' }] })
      .mockResolvedValueOnce({ rows: [{
        document_id: 'property-7',
        personal_status: null,
        photos_downloaded: '1',
      }] });
    const repository = createUserPropertyScopeRepository(strapi, vi.fn().mockResolvedValue(profile));

    await expect(repository.list(7, {})).rejects.toMatchObject({ code: 'USER_PROPERTY_SCOPE_QUERY_ERROR' });
  });

  it('aggregates stats from the same profile-visible scope while applying virtual new status semantics', async () => {
    const strapi = rawStrapi();
    strapi.raw
      .mockResolvedValueOnce({ rows: [{
        total: '2',
        in_focus: '1',
        hot: 1,
        undervalued: '3',
        new_today: '2',
      }] })
      .mockResolvedValueOnce({ rows: [
        { property_type: 'office', total: '1' },
        { property_type: 'warehouse', total: 1 },
      ] });
    const repository = createUserPropertyScopeRepository(strapi, vi.fn().mockResolvedValue(profile));
    const now = new Date('2026-08-07T12:00:00.000Z');

    await expect(repository.stats(7, now)).resolves.toEqual({
      total: 2,
      inFocus: 1,
      hot: 1,
      undervalued: 3,
      newToday: 2,
      typeBreakdown: { office: 1, warehouse: 1 },
    });

    const compiled = compileUserPropertyScope(profile);
    const [aggregateCall, breakdownCall] = strapi.raw.mock.calls;
    for (const call of [aggregateCall, breakdownCall]) {
      expect(call[0]).toContain(compiled.fromSql);
      expect(call[0]).toContain(`WHERE ${compiled.whereSql}`);
      expect(call[1]).toEqual(expect.arrayContaining(compiled.bindings));
    }
    expect(aggregateCall[0]).toContain("COALESCE(ups.status, 'new')");
    expect(aggregateCall[0]).toContain('p.is_undervalued');
    expect(aggregateCall[0]).toContain('new_today');
    expect(aggregateCall[1]).toEqual([...compiled.bindings, 1786017600000, 1786104000000, '2026-08-06T12:00:00.000Z', '2026-08-07T12:00:00.000Z']);
    expect(breakdownCall[1]).toEqual(compiled.bindings);
  });

  it('fails closed when stats aggregate or type rows have an unsafe shape', async () => {
    const strapi = rawStrapi();
    strapi.raw
      .mockResolvedValueOnce({ rows: [{ total: 'NaN', in_focus: 0, hot: 0, undervalued: 0, new_today: 0 }] })
      .mockResolvedValueOnce({ rows: [] });
    const repository = createUserPropertyScopeRepository(strapi, vi.fn().mockResolvedValue(profile));

    await expect(repository.stats(7)).rejects.toMatchObject({ code: 'USER_PROPERTY_SCOPE_QUERY_ERROR' });
  });

  it('does not use entityService or expose an unscoped actor path', async () => {
    const strapi = rawStrapi();
    strapi.raw
      .mockResolvedValueOnce({ rows: [{ total: '0' }] })
      .mockResolvedValueOnce({ rows: [] });
    const repository = createUserPropertyScopeRepository(strapi, vi.fn().mockResolvedValue(profile));

    await expect(repository.list(7, {})).resolves.toMatchObject({ data: [] });
    expect(repository).not.toHaveProperty('listUnscoped');
    expect(repository).not.toHaveProperty('countUnscoped');
  });
});
