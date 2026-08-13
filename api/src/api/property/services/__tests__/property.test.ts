import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mock @strapi/strapi ---
vi.mock('@strapi/strapi', () => ({
  factories: {
    createCoreService: vi.fn((_uid: string, factoryFn: any) => {
      return factoryFn;
    }),
  },
}));

// Import after mocks
import propertyServiceFactory from '../property';
import propertySchema from '../../content-types/property/schema.json';

function makeStrapi() {
  const repository = {
    findMany: vi.fn().mockResolvedValue([]),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    findOne: vi.fn().mockResolvedValue(null),
    create: vi.fn(),
  };
  return {
    db: {
      query: vi.fn().mockReturnValue(repository),
      connection: {
        raw: vi.fn(),
      },
    },
    _repository: repository,
  };
}

describe('property service', () => {
  let strapi: ReturnType<typeof makeStrapi>;
  let service: any;

  beforeEach(() => {
    strapi = makeStrapi();
    service = (propertyServiceFactory as any)({ strapi });
    vi.clearAllMocks();
  });

  describe('upsertByIdentity', () => {
    const missingLocation = {
      status: 'missing',
      source_kind: 'dom_field',
      source_path: 'listing.property_location',
    };
    const payload = {
      source: 'alfalot',
      external_id: 'lot-42',
      title: 'Склад',
      property_location: missingLocation,
    };

    it('rejects parser payload without typed property location before identity lookup', async () => {
      await expect(service.upsertByIdentity({
        source: 'alfalot',
        external_id: 'lot-without-location',
        title: 'Склад',
      })).rejects.toThrow('property_location is required');

      expect(strapi._repository.findOne).not.toHaveBeenCalled();
      expect(strapi._repository.create).not.toHaveBeenCalled();
    });

    it('creates a property when no identity winner exists', async () => {
      const created = { id: 42, documentId: 'doc-42' };
      strapi._repository.findOne.mockResolvedValue(null);
      strapi._repository.create.mockResolvedValue(created);

      await expect(service.upsertByIdentity(payload)).resolves.toEqual({ property: created, created: true });
      expect(strapi._repository.create).toHaveBeenCalledWith({
        data: {
          ...payload,
          address: '',
          city: 'other',
          property_location: JSON.stringify(missingLocation),
          tags: JSON.stringify([]),
        },
      });
    });

    it('serializes JSON fields for the low-level SQLite query builder', async () => {
      const created = { id: 43, documentId: 'doc-43' };
      strapi._repository.findOne.mockResolvedValue(null);
      strapi._repository.create.mockResolvedValue(created);

      await service.upsertByIdentity({
        ...payload,
        photo_urls: ['https://example.test/photo.jpg'],
      });

      expect(strapi._repository.create).toHaveBeenCalledWith({
        data: {
          ...payload,
          address: '',
          city: 'other',
          photo_urls: JSON.stringify(['https://example.test/photo.jpg']),
          property_location: JSON.stringify(missingLocation),
          tags: JSON.stringify([]),
        },
      });
    });

    it('validates and serializes typed property geography and parties', async () => {
      const created = { id: 45, documentId: 'doc-45' };
      strapi._repository.findOne.mockResolvedValue(null);
      strapi._repository.create.mockResolvedValue(created);
      const propertyLocation = {
        status: 'confirmed_address',
        address: 'г. Тверь, ул. Советская, д. 1',
        region: 'tver',
        source_kind: 'api_field',
        source_path: 'lot.address',
        latitude: 56.8587,
        longitude: 35.9176,
      };
      const parties = [{
        name: 'Организатор торгов',
        roles: ['organizer'],
        inn: '1234567890',
        addresses: [{ kind: 'legal', value: 'г. Москва, ул. Иная, д. 2' }],
        source_path: 'lot.organizer',
        source_kind: 'api_field',
        confidence: 'structured',
      }];

      await service.upsertByIdentity({
        ...payload,
        property_location: propertyLocation,
        parties,
      });

      expect(strapi._repository.create).toHaveBeenCalledWith({
        data: {
          ...payload,
          city: 'tver',
          address: propertyLocation.address,
          property_location: JSON.stringify(propertyLocation),
          parties: JSON.stringify(parties),
          latitude: propertyLocation.latitude,
          longitude: propertyLocation.longitude,
          tags: JSON.stringify([]),
        },
      });
    });

    it('projects persisted geography from a typed-only property payload', async () => {
      strapi._repository.findOne.mockResolvedValue(null);
      strapi._repository.create.mockResolvedValue({ id: 46, documentId: 'doc-46' });
      const propertyLocation = {
        status: 'confirmed_region_only',
        region: 'Республика Башкортостан',
        region_code: '02',
        source_kind: 'api_field',
        source_path: 'lot.property.region',
      };
      const parties = [{
        name: 'ПАО Сбербанк',
        roles: ['pledgee'],
        addresses: [{ kind: 'legal', value: 'г. Москва, ул. Вавилова, д. 19' }],
        source_path: 'lot.pledgee',
        source_kind: 'api_field',
        confidence: 'structured',
      }];

      await service.upsertByIdentity({
        ...payload,
        property_location: propertyLocation,
        parties,
      });

      expect(strapi._repository.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          city: 'other',
          address: '',
          property_location: JSON.stringify(propertyLocation),
          parties: JSON.stringify(parties),
        }),
      });
      const persisted = strapi._repository.create.mock.calls[0][0].data;
      expect(persisted).not.toHaveProperty('latitude');
      expect(persisted).not.toHaveProperty('longitude');
    });

    it.each(['address', 'city', 'latitude', 'longitude'])(
      'rejects stale caller geography field %s before identity lookup',
      async (field) => {
        await expect(service.upsertByIdentity({
          ...payload,
          [field]: field === 'latitude' || field === 'longitude' ? 1 : 'stale',
        })).rejects.toThrow(`Field "${field}" is not accepted by parser upsert`);

        expect(strapi._repository.findOne).not.toHaveBeenCalled();
        expect(strapi._repository.create).not.toHaveBeenCalled();
      },
    );

    it.each([
      ['property_location', {
        status: 'missing',
        source_kind: 'api_field',
        source_path: 'lot.location',
        injected: 'not-contract-data',
      }],
      ['parties', [{
        name: 'ПАО Сбербанк',
        roles: ['pledgee'],
        source_kind: 'api_field',
        source_path: 'lot.pledgee',
        confidence: 'structured',
        injected: 'not-contract-data',
      }]],
      ['parties', [{
        name: 'ПАО Сбербанк',
        roles: ['pledgee'],
        source_kind: 'api_field',
        source_path: 'lot.pledgee',
        confidence: 'structured',
        addresses: [{
          kind: 'legal',
          value: 'г. Москва',
          injected: 'not-contract-data',
        }],
      }]],
    ])('rejects unknown nested fields in %s', async (field, value) => {
      await expect(service.upsertByIdentity({
        ...payload,
        [field]: value,
      })).rejects.toThrow(`${field} is malformed`);

      expect(strapi._repository.findOne).not.toHaveBeenCalled();
      expect(strapi._repository.create).not.toHaveBeenCalled();
    });

    it('rejects a full address under the region-only status before identity lookup', async () => {
      await expect(service.upsertByIdentity({
        ...payload,
        property_location: {
          status: 'confirmed_region_only',
          address: 'г. Москва, ул. Тверская, 1',
          region: 'Москва',
          source_kind: 'api_field',
          source_path: 'lot.region',
        },
      })).rejects.toThrow('property_location is malformed');

      expect(strapi._repository.findOne).not.toHaveBeenCalled();
      expect(strapi._repository.create).not.toHaveBeenCalled();
    });

    it('projects missing typed location to empty legacy geography', async () => {
      strapi._repository.findOne.mockResolvedValue(null);
      strapi._repository.create.mockResolvedValue({ id: 47, documentId: 'doc-47' });

      await service.upsertByIdentity({
        ...payload,
        property_location: missingLocation,
      });

      const persisted = strapi._repository.create.mock.calls[0][0].data;
      expect(persisted).toMatchObject({ city: 'other', address: '' });
      expect(persisted).not.toHaveProperty('latitude');
      expect(persisted).not.toHaveProperty('longitude');
    });

    it.each([
      [{ status: 'confirmed_address', address: '', region: 'tver', source_kind: 'api_field', source_path: 'lot.address' }, 'property_location'],
      [{ status: 'missing', address: '', region: 'other', source_kind: 'free_text', source_path: 'description' }, 'property_location'],
      [[{ name: 'Банк', roles: ['pledgee'], addresses: [{ kind: 'property', value: 'Москва' }], source_path: 'lot.bank', source_kind: 'api_field', confidence: 'structured' }], 'parties'],
    ])('rejects malformed typed parser field before identity lookup', async (value, field) => {
      await expect(service.upsertByIdentity({ ...payload, [field]: value }))
        .rejects.toThrow(`${field} is malformed`);

      expect(strapi._repository.findOne).not.toHaveBeenCalled();
      expect(strapi._repository.create).not.toHaveBeenCalled();
    });

    it('accepts an auction deadline as parser-owned data', async () => {
      const created = { id: 44, documentId: 'doc-44' };
      strapi._repository.findOne.mockResolvedValue(null);
      strapi._repository.create.mockResolvedValue(created);

      await service.upsertByIdentity({ ...payload, auction_end_at: '2026-10-27T20:59:59.000Z' });

      expect(strapi._repository.create).toHaveBeenCalledWith({
        data: {
          ...payload,
          address: '',
          city: 'other',
          property_location: JSON.stringify(missingLocation),
          auction_end_at: '2026-10-27T20:59:59.000Z',
          tags: JSON.stringify([]),
        },
      });
    });

    it('returns an existing property without creating a duplicate', async () => {
      const existing = { id: 7, documentId: 'existing' };
      strapi._repository.findOne.mockResolvedValue(existing);

      await expect(service.upsertByIdentity(payload)).resolves.toEqual({ property: existing, created: false });
      expect(strapi._repository.create).not.toHaveBeenCalled();
    });

    it('returns the concurrent unique-index winner instead of throwing', async () => {
      const winner = { id: 8, documentId: 'winner' };
      const conflict = Object.assign(
        new Error('UNIQUE constraint failed: properties.source, properties.external_id'),
        { code: 'SQLITE_CONSTRAINT_UNIQUE' },
      );
      strapi._repository.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(winner);
      strapi._repository.create.mockRejectedValue(conflict);

      await expect(service.upsertByIdentity(payload)).resolves.toEqual({ property: winner, created: false });
    });

    it('rejects protected and unknown fields instead of passing them to Strapi', async () => {
      await expect(service.upsertByIdentity({
        ...payload,
        status: 'rejected',
        focus_score: 100,
        arbitrary_client_field: true,
      })).rejects.toThrow('Field "status" is not accepted by parser upsert');

      expect(strapi._repository.findOne).not.toHaveBeenCalled();
      expect(strapi._repository.create).not.toHaveBeenCalled();
    });

    it.each([
      ['source', 'unknown-source'],
      ['property_type', 'castle'],
      ['auction_type', 'secret-sale'],
    ])('rejects unsupported %s enum values', async (field, value) => {
      await expect(service.upsertByIdentity({ ...payload, [field]: value }))
        .rejects.toThrow(`${field} has an unsupported value`);

      expect(strapi._repository.create).not.toHaveBeenCalled();
    });

    it('rejects non-canonical identity values rather than trimming them', async () => {
      await expect(service.upsertByIdentity({ ...payload, external_id: ' lot-42 ' }))
        .rejects.toThrow('external_id must not contain leading or trailing whitespace');

      expect(strapi._repository.findOne).not.toHaveBeenCalled();
      expect(strapi._repository.create).not.toHaveBeenCalled();
    });
  });

  // =================== getFocusQuery ===================
  describe('getFocusQuery', () => {
    function setupRaw(total: number, rows: any[]) {
      const raw = strapi.db.connection.raw as ReturnType<typeof vi.fn>;
      raw
        .mockResolvedValueOnce({ rows: [{ total: String(total) }] })
        .mockResolvedValueOnce({ rows });
    }

    it('should return data with meta using default threshold 20', async () => {
      setupRaw(1, [{ id: 1, document_id: 'd1', title: 'Test', tags: '["tag1"]' }]);

      const result = await service.getFocusQuery({
        threshold: 20, city: undefined, property_type: undefined, tags: undefined,
        sort: '-focus_score', page: 1, pageSize: 20,
      });

      expect(result.meta.threshold).toBe(20);
      expect(result.meta.page).toBe(1);
      expect(result.meta.pageSize).toBe(20);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].tags).toEqual(['tag1']);
    });

    it('should use custom threshold', async () => {
      setupRaw(0, []);

      await service.getFocusQuery({
        threshold: 50, city: undefined, property_type: undefined, tags: undefined,
        sort: '-focus_score', page: 1, pageSize: 20,
      });

      const firstRawCall = (strapi.db.connection.raw as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(firstRawCall[1]).toContain(50);
    });

    it('should build single city = ? condition', async () => {
      setupRaw(0, []);

      await service.getFocusQuery({
        threshold: 20, city: 'moscow', property_type: undefined, tags: undefined,
        sort: '-focus_score', page: 1, pageSize: 20,
      });

      const firstRawCall = (strapi.db.connection.raw as ReturnType<typeof vi.fn>).mock.calls[0];
      const sql = firstRawCall[0] as string;
      expect(sql).toContain('city = ?');
      expect(firstRawCall[1]).toContain('moscow');
    });

    it('should build IN clause for comma-separated cities', async () => {
      setupRaw(0, []);

      await service.getFocusQuery({
        threshold: 20, city: 'moscow,spb,kazan', property_type: undefined, tags: undefined,
        sort: '-focus_score', page: 1, pageSize: 20,
      });

      const firstRawCall = (strapi.db.connection.raw as ReturnType<typeof vi.fn>).mock.calls[0];
      const sql = firstRawCall[0] as string;
      expect(sql).toContain('city IN (?,?,?)');
      expect(firstRawCall[1]).toEqual(expect.arrayContaining(['moscow', 'spb', 'kazan']));
    });

    it('should add property_type condition', async () => {
      setupRaw(0, []);

      await service.getFocusQuery({
        threshold: 20, city: undefined, property_type: 'apartment', tags: undefined,
        sort: '-focus_score', page: 1, pageSize: 20,
      });

      const firstRawCall = (strapi.db.connection.raw as ReturnType<typeof vi.fn>).mock.calls[0];
      const sql = firstRawCall[0] as string;
      expect(sql).toContain('property_type = ?');
      expect(firstRawCall[1]).toContain('apartment');
    });

    it('should build LIKE conditions for tags', async () => {
      setupRaw(0, []);

      await service.getFocusQuery({
        threshold: 20, city: undefined, property_type: undefined, tags: 'undervalued,new',
        sort: '-focus_score', page: 1, pageSize: 20,
      });

      const firstRawCall = (strapi.db.connection.raw as ReturnType<typeof vi.fn>).mock.calls[0];
      const sql = firstRawCall[0] as string;
      const likeMatches = sql.match(/tags LIKE \?/g);
      expect(likeMatches).toHaveLength(2);
      expect(firstRawCall[1]).toEqual(expect.arrayContaining(['%"undervalued"%', '%"new"%']));
    });

    it('should use default sort -focus_score → DESC focus_score', async () => {
      setupRaw(0, []);

      await service.getFocusQuery({
        threshold: 20, city: undefined, property_type: undefined, tags: undefined,
        sort: '-focus_score', page: 1, pageSize: 20,
      });

      const dataRawCall = (strapi.db.connection.raw as ReturnType<typeof vi.fn>).mock.calls[1];
      const sql = dataRawCall[0] as string;
      expect(sql).toContain('ORDER BY focus_score DESC');
    });

    it('should handle ascending sort (no - prefix)', async () => {
      setupRaw(0, []);

      await service.getFocusQuery({
        threshold: 20, city: undefined, property_type: undefined, tags: undefined,
        sort: 'price_per_sqm', page: 1, pageSize: 20,
      });

      const dataRawCall = (strapi.db.connection.raw as ReturnType<typeof vi.fn>).mock.calls[1];
      const sql = dataRawCall[0] as string;
      expect(sql).toContain('ORDER BY price_per_sqm ASC');
    });

    it('should handle descending sort (with - prefix)', async () => {
      setupRaw(0, []);

      await service.getFocusQuery({
        threshold: 20, city: undefined, property_type: undefined, tags: undefined,
        sort: '-area_sqm', page: 1, pageSize: 20,
      });

      const dataRawCall = (strapi.db.connection.raw as ReturnType<typeof vi.fn>).mock.calls[1];
      const sql = dataRawCall[0] as string;
      expect(sql).toContain('ORDER BY area_sqm DESC');
    });

    it('should ignore disallowed sort fields and use default', async () => {
      setupRaw(0, []);

      await service.getFocusQuery({
        threshold: 20, city: undefined, property_type: undefined, tags: undefined,
        sort: 'hacker_field', page: 1, pageSize: 20,
      });

      const dataRawCall = (strapi.db.connection.raw as ReturnType<typeof vi.fn>).mock.calls[1];
      const sql = dataRawCall[0] as string;
      expect(sql).toContain('ORDER BY focus_score');
      expect(sql).not.toContain('hacker_field');
    });

    it('should map createdAt to created_at column', async () => {
      setupRaw(0, []);

      await service.getFocusQuery({
        threshold: 20, city: undefined, property_type: undefined, tags: undefined,
        sort: '-createdAt', page: 1, pageSize: 20,
      });

      const dataRawCall = (strapi.db.connection.raw as ReturnType<typeof vi.fn>).mock.calls[1];
      const sql = dataRawCall[0] as string;
      expect(sql).toContain('ORDER BY created_at DESC');
    });

    it('should apply pagination with LIMIT and OFFSET', async () => {
      setupRaw(50, []);

      await service.getFocusQuery({
        threshold: 20, city: undefined, property_type: undefined, tags: undefined,
        sort: '-focus_score', page: 3, pageSize: 10,
      });

      const dataRawCall = (strapi.db.connection.raw as ReturnType<typeof vi.fn>).mock.calls[1];
      const params = dataRawCall[1] as any[];
      expect(params[params.length - 2]).toBe(10); // pageSize
      expect(params[params.length - 1]).toBe(20); // (3-1)*10 = 20
    });

    it('should compute totalPages correctly', async () => {
      setupRaw(25, []);

      const result = await service.getFocusQuery({
        threshold: 20, city: undefined, property_type: undefined, tags: undefined,
        sort: '-focus_score', page: 1, pageSize: 10,
      });

      expect(result.meta.totalPages).toBe(3);
    });

    it('should handle total from rows[0].total (non-string)', async () => {
      const raw = strapi.db.connection.raw as ReturnType<typeof vi.fn>;
      raw
        .mockResolvedValueOnce({ rows: [{ total: 42 }] })
        .mockResolvedValueOnce({ rows: [] });

      const result = await service.getFocusQuery({
        threshold: 20, city: undefined, property_type: undefined, tags: undefined,
        sort: '-focus_score', page: 1, pageSize: 20,
      });

      expect(result.meta.total).toBe(42);
    });

    it('should handle total from flat array (no .rows wrapper)', async () => {
      const raw = strapi.db.connection.raw as ReturnType<typeof vi.fn>;
      raw
        .mockResolvedValueOnce([{ total: '7' }])
        .mockResolvedValueOnce([]);

      const result = await service.getFocusQuery({
        threshold: 20, city: undefined, property_type: undefined, tags: undefined,
        sort: '-focus_score', page: 1, pageSize: 20,
      });

      expect(result.meta.total).toBe(7);
    });

    it('should exclude rejected properties from focus', async () => {
      setupRaw(0, []);

      await service.getFocusQuery({
        threshold: 20, city: undefined, property_type: undefined, tags: undefined,
        sort: '-focus_score', page: 1, pageSize: 20,
      });

      const firstRawCall = (strapi.db.connection.raw as ReturnType<typeof vi.fn>).mock.calls[0];
      const sql = firstRawCall[0] as string;
      const params = firstRawCall[1] as any[];
      expect(sql).toContain('status != ?');
      expect(params).toContain('rejected');
    });

    it('should pass back filters in meta', async () => {
      setupRaw(0, []);

      const result = await service.getFocusQuery({
        threshold: 20, city: 'moscow', property_type: 'apartment', tags: 'new',
        sort: '-price_per_sqm', page: 1, pageSize: 20,
      });

      expect(result.meta.filters).toEqual({
        city: 'moscow',
        property_type: 'apartment',
        tags: 'new',
        sort: '-price_per_sqm',
      });
    });
  });
});

describe('property schema typed geography contract', () => {
  it('persists typed property geography and parties and exposes both Tver regions', () => {
    const attributes = propertySchema.attributes as Record<string, any>;

    expect(attributes.property_location).toEqual({ type: 'json', required: true });
    expect(attributes.parties).toEqual({ type: 'json' });
    expect(attributes.city.enum).toEqual(expect.arrayContaining([
      'moscow', 'mo', 'tver', 'tver_oblast', 'other',
    ]));
    expect(attributes.city.default).toBe('other');
    expect(attributes.source.enum).toContain('m-ets');
  });
});
