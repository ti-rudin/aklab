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

function makeStrapi() {
  return {
    db: {
      query: vi.fn().mockReturnValue({
        findMany: vi.fn().mockResolvedValue([]),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      }),
      connection: {
        raw: vi.fn(),
      },
    },
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

  // =================== clearNew ===================
  describe('clearNew', () => {
    it('should return deleted count with photosDeleted', async () => {
      const queryResult = strapi.db.query('api::property.property');
      (queryResult.findMany as any).mockResolvedValue([]);
      (queryResult.deleteMany as any).mockResolvedValue({ count: 5 });

      const result = await service.clearNew();

      expect(strapi.db.query).toHaveBeenCalledWith('api::property.property');
      expect(result).toEqual({ deleted: 5, photosDeleted: 0 });
    });

    it('should return 0 when nothing deleted', async () => {
      const queryResult = strapi.db.query('api::property.property');
      (queryResult.findMany as any).mockResolvedValue([]);
      (queryResult.deleteMany as any).mockResolvedValue({ count: 0 });

      const result = await service.clearNew();

      expect(result).toEqual({ deleted: 0, photosDeleted: 0 });
    });

    it('should pass status!=in_progress filter', async () => {
      const queryResult = strapi.db.query('api::property.property');
      (queryResult.findMany as any).mockResolvedValue([]);
      const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
      (queryResult.deleteMany as any) = deleteMany;

      await service.clearNew();

      expect(deleteMany).toHaveBeenCalledWith({ where: { status: { $ne: 'in_progress' } } });
    });
  });
});
