import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mock fs/promises ---
vi.mock('fs/promises', () => ({
  access: vi.fn(),
  readFile: vi.fn(),
  rm: vi.fn().mockResolvedValue(undefined),
}));

// --- Mock @strapi/strapi ---
vi.mock('@strapi/strapi', () => ({
  factories: {
    createCoreController: vi.fn((_uid: string, factoryFn: any) => {
      // Return the factory result as the controller object directly
      // so tests can import it
      return factoryFn;
    }),
  },
}));

// Import after mocks (vitest hoists vi.mock)
import * as fs from 'fs/promises';
import propertyControllerFactory from '../property';

// Build a mock strapi instance (fresh per test)
function makeStrapi() {
  return {
    db: {
      query: vi.fn().mockReturnValue({
        findMany: vi.fn().mockResolvedValue([]),
        deleteMany: vi.fn(),
      }),
      connection: {
        raw: vi.fn(),
      },
    },
    entityService: {
      findMany: vi.fn(),
    },
  };
}

// Build a minimal koa ctx
function makeCtx(overrides: Record<string, any> = {}): any {
  const headers: Record<string, string> = {};
  return {
    params: {},
    query: {},
    request: { body: {} },
    body: undefined,
    status: 200,
    set: vi.fn((key: string, val: string) => { headers[key] = val; }),
    _headers: headers,
    ...overrides,
  };
}

describe('property controller', () => {
  let strapi: ReturnType<typeof makeStrapi>;
  let actions: Record<string, (ctx: any) => Promise<void>>;

  beforeEach(() => {
    strapi = makeStrapi();
    // The mock returns the factory function itself; call it to get actions
    actions = (propertyControllerFactory as any)({ strapi });
    vi.clearAllMocks();
  });

  // =================== clearNew ===================
  describe('clearNew', () => {
    it('should return deleted count with photosDeleted', async () => {
      const queryResult = strapi.db.query('api::property.property');
      (queryResult.findMany as any).mockResolvedValue([]);
      (queryResult.deleteMany as any).mockResolvedValue({ count: 5 });
      const ctx = makeCtx();

      await actions.clearNew(ctx);

      expect(strapi.db.query).toHaveBeenCalledWith('api::property.property');
      expect(ctx.body).toEqual({ deleted: 5, photosDeleted: 0 });
    });

    it('should return 0 when nothing deleted', async () => {
      const queryResult = strapi.db.query('api::property.property');
      (queryResult.findMany as any).mockResolvedValue([]);
      (queryResult.deleteMany as any).mockResolvedValue({ count: 0 });
      const ctx = makeCtx();

      await actions.clearNew(ctx);

      expect(ctx.body).toEqual({ deleted: 0, photosDeleted: 0 });
    });

    it('should pass status=new filter', async () => {
      const queryResult = strapi.db.query('api::property.property');
      (queryResult.findMany as any).mockResolvedValue([]);
      const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
      (queryResult.deleteMany as any) = deleteMany;
      const ctx = makeCtx();

      await actions.clearNew(ctx);

      expect(deleteMany).toHaveBeenCalledWith({ where: { status: 'new' } });
    });

    it('should delete photo directories for new properties', async () => {
      const queryResult = strapi.db.query('api::property.property');
      (queryResult.findMany as any).mockResolvedValue([
        { documentId: 'doc-aaa' },
        { documentId: 'doc-bbb' },
      ]);
      (queryResult.deleteMany as any).mockResolvedValue({ count: 2 });
      const ctx = makeCtx();

      await actions.clearNew(ctx);

      expect(fs.rm).toHaveBeenCalledTimes(2);
      expect(ctx.body).toEqual({ deleted: 2, photosDeleted: 2 });
    });
  });

  // =================== servePhoto ===================
  describe('servePhoto', () => {
    it('should serve file with correct content-type for jpg', async () => {
      const fileBuffer = Buffer.from('fake-jpg');
      (fs.access as any).mockResolvedValue(undefined);
      (fs.readFile as any).mockResolvedValue(fileBuffer);

      const ctx = makeCtx({ params: { documentId: 'doc123', filename: 'photo.jpg' } });
      await actions.servePhoto(ctx);

      expect(fs.access).toHaveBeenCalled();
      expect(fs.readFile).toHaveBeenCalled();
      expect(ctx.body).toBe(fileBuffer);
      expect(ctx.set).toHaveBeenCalledWith('Content-Type', 'image/jpeg');
      expect(ctx.set).toHaveBeenCalledWith('Cache-Control', 'public, max-age=86400');
    });

    it('should set image/png for .png extension', async () => {
      (fs.access as any).mockResolvedValue(undefined);
      (fs.readFile as any).mockResolvedValue(Buffer.from('png'));

      const ctx = makeCtx({ params: { documentId: 'doc1', filename: 'img.png' } });
      await actions.servePhoto(ctx);

      expect(ctx.set).toHaveBeenCalledWith('Content-Type', 'image/png');
    });

    it('should set image/webp for .webp extension', async () => {
      (fs.access as any).mockResolvedValue(undefined);
      (fs.readFile as any).mockResolvedValue(Buffer.from('webp'));

      const ctx = makeCtx({ params: { documentId: 'doc1', filename: 'img.webp' } });
      await actions.servePhoto(ctx);

      expect(ctx.set).toHaveBeenCalledWith('Content-Type', 'image/webp');
    });

    it('should default to image/jpeg for unknown extension', async () => {
      (fs.access as any).mockResolvedValue(undefined);
      (fs.readFile as any).mockResolvedValue(Buffer.from('data'));

      const ctx = makeCtx({ params: { documentId: 'doc1', filename: 'img.bmp' } });
      await actions.servePhoto(ctx);

      expect(ctx.set).toHaveBeenCalledWith('Content-Type', 'image/jpeg');
    });

    it('should return 404 when file not found', async () => {
      (fs.access as any).mockRejectedValue(new Error('ENOENT'));

      const ctx = makeCtx({ params: { documentId: 'doc1', filename: 'missing.jpg' } });
      await actions.servePhoto(ctx);

      expect(ctx.status).toBe(404);
      expect(ctx.body).toEqual({ error: 'Photo not found' });
    });

    it('should block path traversal in filename (../)', async () => {
      (fs.access as any).mockResolvedValue(undefined);
      (fs.readFile as any).mockResolvedValue(Buffer.from('data'));

      const ctx = makeCtx({ params: { documentId: 'doc1', filename: '../../etc/passwd' } });
      await actions.servePhoto(ctx);

      // path.basename strips traversal — the file path should be safe
      const accessPath = (fs.access as any).mock.calls[0]?.[0] as string;
      expect(accessPath).not.toContain('../');
      expect(accessPath).toContain('data/photos/doc1/passwd');
    });

    it('should block path traversal in documentId (../)', async () => {
      (fs.access as any).mockResolvedValue(undefined);
      (fs.readFile as any).mockResolvedValue(Buffer.from('data'));

      const ctx = makeCtx({ params: { documentId: '../secret', filename: 'photo.jpg' } });
      await actions.servePhoto(ctx);

      const accessPath = (fs.access as any).mock.calls[0]?.[0] as string;
      expect(accessPath).not.toContain('../secret');
      expect(accessPath).toContain('data/photos/secret/photo.jpg');
    });
  });

  // =================== getFocus ===================
  describe('getFocus', () => {
    // Helper: set up raw to return count first, then data rows
    function setupRaw(total: number, rows: any[]) {
      const raw = strapi.db.connection.raw as ReturnType<typeof vi.fn>;
      raw
        .mockResolvedValueOnce({ rows: [{ total: String(total) }] }) // COUNT query
        .mockResolvedValueOnce({ rows }); // data query
    }

    it('should return data with meta using default threshold 20', async () => {
      setupRaw(1, [{ id: 1, document_id: 'd1', title: 'Test', tags: '["tag1"]' }]);

      const ctx = makeCtx({ query: {} });
      await actions.getFocus(ctx);

      expect(ctx.body.meta.threshold).toBe(20);
      expect(ctx.body.meta.page).toBe(1);
      expect(ctx.body.meta.pageSize).toBe(20);
      expect(ctx.body.data).toHaveLength(1);
      expect(ctx.body.data[0].tags).toEqual(['tag1']); // JSON parsed
    });

    it('should use custom threshold', async () => {
      setupRaw(0, []);

      const ctx = makeCtx({ query: { threshold: '50' } });
      await actions.getFocus(ctx);

      expect(ctx.body.meta.threshold).toBe(50);
      // The first raw call should include threshold in params
      const firstRawCall = (strapi.db.connection.raw as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(firstRawCall[1]).toContain(50);
    });

    it('should build single city = ? condition', async () => {
      setupRaw(0, []);

      const ctx = makeCtx({ query: { city: 'moscow' } });
      await actions.getFocus(ctx);

      const firstRawCall = (strapi.db.connection.raw as ReturnType<typeof vi.fn>).mock.calls[0];
      const sql = firstRawCall[0] as string;
      expect(sql).toContain('city = ?');
      expect(firstRawCall[1]).toContain('moscow');
    });

    it('should build IN clause for comma-separated cities', async () => {
      setupRaw(0, []);

      const ctx = makeCtx({ query: { city: 'moscow,spb,kazan' } });
      await actions.getFocus(ctx);

      const firstRawCall = (strapi.db.connection.raw as ReturnType<typeof vi.fn>).mock.calls[0];
      const sql = firstRawCall[0] as string;
      expect(sql).toContain('city IN (?,?,?)');
      expect(firstRawCall[1]).toEqual(expect.arrayContaining(['moscow', 'spb', 'kazan']));
    });

    it('should add property_type condition', async () => {
      setupRaw(0, []);

      const ctx = makeCtx({ query: { property_type: 'apartment' } });
      await actions.getFocus(ctx);

      const firstRawCall = (strapi.db.connection.raw as ReturnType<typeof vi.fn>).mock.calls[0];
      const sql = firstRawCall[0] as string;
      expect(sql).toContain('property_type = ?');
      expect(firstRawCall[1]).toContain('apartment');
    });

    it('should build LIKE conditions for tags', async () => {
      setupRaw(0, []);

      const ctx = makeCtx({ query: { tags: 'undervalued,new' } });
      await actions.getFocus(ctx);

      const firstRawCall = (strapi.db.connection.raw as ReturnType<typeof vi.fn>).mock.calls[0];
      const sql = firstRawCall[0] as string;
      // Should have two LIKE conditions
      const likeMatches = sql.match(/tags LIKE \?/g);
      expect(likeMatches).toHaveLength(2);
      // Params should include wrapped tag strings
      expect(firstRawCall[1]).toEqual(expect.arrayContaining(['%"undervalued"%', '%"new"%']));
    });

    it('should use default sort -focus_score → DESC focus_score', async () => {
      setupRaw(0, []);

      const ctx = makeCtx({ query: {} });
      await actions.getFocus(ctx);

      const dataRawCall = (strapi.db.connection.raw as ReturnType<typeof vi.fn>).mock.calls[1];
      const sql = dataRawCall[0] as string;
      expect(sql).toContain('ORDER BY focus_score DESC');
    });

    it('should handle ascending sort (no - prefix)', async () => {
      setupRaw(0, []);

      const ctx = makeCtx({ query: { sort: 'price_per_sqm' } });
      await actions.getFocus(ctx);

      const dataRawCall = (strapi.db.connection.raw as ReturnType<typeof vi.fn>).mock.calls[1];
      const sql = dataRawCall[0] as string;
      expect(sql).toContain('ORDER BY price_per_sqm ASC');
    });

    it('should handle descending sort (with - prefix)', async () => {
      setupRaw(0, []);

      const ctx = makeCtx({ query: { sort: '-area_sqm' } });
      await actions.getFocus(ctx);

      const dataRawCall = (strapi.db.connection.raw as ReturnType<typeof vi.fn>).mock.calls[1];
      const sql = dataRawCall[0] as string;
      expect(sql).toContain('ORDER BY area_sqm DESC');
    });

    it('should ignore disallowed sort fields and use default', async () => {
      setupRaw(0, []);

      const ctx = makeCtx({ query: { sort: 'hacker_field' } });
      await actions.getFocus(ctx);

      const dataRawCall = (strapi.db.connection.raw as ReturnType<typeof vi.fn>).mock.calls[1];
      const sql = dataRawCall[0] as string;
      expect(sql).toContain('ORDER BY focus_score');
      expect(sql).not.toContain('hacker_field');
    });

    it('should map createdAt to created_at column', async () => {
      setupRaw(0, []);

      const ctx = makeCtx({ query: { sort: '-createdAt' } });
      await actions.getFocus(ctx);

      const dataRawCall = (strapi.db.connection.raw as ReturnType<typeof vi.fn>).mock.calls[1];
      const sql = dataRawCall[0] as string;
      expect(sql).toContain('ORDER BY created_at DESC');
    });

    it('should apply pagination with LIMIT and OFFSET', async () => {
      setupRaw(50, []);

      const ctx = makeCtx({ query: { page: '3', pageSize: '10' } });
      await actions.getFocus(ctx);

      const dataRawCall = (strapi.db.connection.raw as ReturnType<typeof vi.fn>).mock.calls[1];
      // params should be [...filterParams, pageSize, offset]
      const params = dataRawCall[1] as any[];
      // Last two are pageSize, offset
      expect(params[params.length - 2]).toBe(10); // pageSize
      expect(params[params.length - 1]).toBe(20); // (3-1)*10 = 20
    });

    it('should compute totalPages correctly', async () => {
      setupRaw(25, []);

      const ctx = makeCtx({ query: { pageSize: '10' } });
      await actions.getFocus(ctx);

      expect(ctx.body.meta.totalPages).toBe(3); // ceil(25/10)
    });

    it('should clamp pageSize to max 100', async () => {
      setupRaw(0, []);

      const ctx = makeCtx({ query: { pageSize: '500' } });
      await actions.getFocus(ctx);

      expect(ctx.body.meta.pageSize).toBe(100);
    });

    it('should clamp pageSize to min 1', async () => {
      setupRaw(0, []);

      const ctx = makeCtx({ query: { pageSize: '-5' } });
      await actions.getFocus(ctx);

      expect(ctx.body.meta.pageSize).toBe(1);
    });

    it('should clamp page to min 1', async () => {
      setupRaw(0, []);

      const ctx = makeCtx({ query: { page: '-3' } });
      await actions.getFocus(ctx);

      expect(ctx.body.meta.page).toBe(1);
    });

    it('should handle non-numeric threshold gracefully (defaults to 20)', async () => {
      setupRaw(0, []);

      const ctx = makeCtx({ query: { threshold: 'abc' } });
      await actions.getFocus(ctx);

      expect(ctx.body.meta.threshold).toBe(20); // Number('abc') || 20
    });

    it('should handle total from rows[0].total (non-string)', async () => {
      // Some DB drivers return the total as a number
      const raw = strapi.db.connection.raw as ReturnType<typeof vi.fn>;
      raw
        .mockResolvedValueOnce({ rows: [{ total: 42 }] })
        .mockResolvedValueOnce({ rows: [] });

      const ctx = makeCtx({ query: {} });
      await actions.getFocus(ctx);

      expect(ctx.body.meta.total).toBe(42);
    });

    it('should handle total from flat array (no .rows wrapper)', async () => {
      const raw = strapi.db.connection.raw as ReturnType<typeof vi.fn>;
      // Some drivers return [{total: ...}] directly
      raw
        .mockResolvedValueOnce([{ total: '7' }])  // count
        .mockResolvedValueOnce([]);                  // data

      const ctx = makeCtx({ query: {} });
      await actions.getFocus(ctx);

      expect(ctx.body.meta.total).toBe(7);
    });

    it('should pass back filters in meta', async () => {
      setupRaw(0, []);

      const ctx = makeCtx({ query: { city: 'moscow', property_type: 'apartment', tags: 'new', sort: '-price_per_sqm' } });
      await actions.getFocus(ctx);

      expect(ctx.body.meta.filters).toEqual({
        city: 'moscow',
        property_type: 'apartment',
        tags: 'new',
        sort: '-price_per_sqm',
      });
    });
  });
});
