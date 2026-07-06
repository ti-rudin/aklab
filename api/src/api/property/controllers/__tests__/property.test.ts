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
      return factoryFn;
    }),
  },
}));

// Import after mocks (vitest hoists vi.mock)
import * as fs from 'fs/promises';
import propertyControllerFactory from '../property';

// Build a mock strapi instance (fresh per test)
function makeStrapi() {
  const mockService = {
    getFocusQuery: vi.fn(),
    clearNew: vi.fn(),
  };
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
    service: vi.fn().mockReturnValue(mockService),
    _mockService: mockService,
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
    actions = (propertyControllerFactory as any)({ strapi });
    vi.clearAllMocks();
  });

  // =================== clearNew ===================
  describe('clearNew', () => {
    it('should delegate to service.clearNew and return result', async () => {
      const expectedResult = { deleted: 5, photosDeleted: 2 };
      strapi._mockService.clearNew.mockResolvedValue(expectedResult);

      const ctx = makeCtx();
      await actions.clearNew(ctx);

      expect(strapi.service).toHaveBeenCalledWith('api::property.property');
      expect(strapi._mockService.clearNew).toHaveBeenCalled();
      expect(ctx.body).toEqual(expectedResult);
    });

    it('should return 0 when nothing deleted', async () => {
      strapi._mockService.clearNew.mockResolvedValue({ deleted: 0, photosDeleted: 0 });

      const ctx = makeCtx();
      await actions.clearNew(ctx);

      expect(ctx.body).toEqual({ deleted: 0, photosDeleted: 0 });
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
    it('should parse query params and delegate to service.getFocusQuery', async () => {
      const expectedResult = {
        data: [{ id: 1, documentId: 'd1', title: 'Test' }],
        meta: { page: 1, pageSize: 20, total: 1, totalPages: 1, threshold: 20, filters: {} },
      };
      strapi._mockService.getFocusQuery.mockResolvedValue(expectedResult);

      const ctx = makeCtx({ query: {} });
      await actions.getFocus(ctx);

      expect(strapi.service).toHaveBeenCalledWith('api::property.property');
      expect(strapi._mockService.getFocusQuery).toHaveBeenCalledWith({
        threshold: 20,
        city: undefined,
        property_type: undefined,
        tags: undefined,
        sort: '-focus_score',
        page: 1,
        pageSize: 20,
      });
      expect(ctx.body).toEqual(expectedResult);
    });

    it('should pass custom threshold to service', async () => {
      strapi._mockService.getFocusQuery.mockResolvedValue({ data: [], meta: {} });

      const ctx = makeCtx({ query: { threshold: '50' } });
      await actions.getFocus(ctx);

      expect(strapi._mockService.getFocusQuery).toHaveBeenCalledWith(
        expect.objectContaining({ threshold: 50 })
      );
    });

    it('should pass city filter to service', async () => {
      strapi._mockService.getFocusQuery.mockResolvedValue({ data: [], meta: {} });

      const ctx = makeCtx({ query: { city: 'moscow' } });
      await actions.getFocus(ctx);

      expect(strapi._mockService.getFocusQuery).toHaveBeenCalledWith(
        expect.objectContaining({ city: 'moscow' })
      );
    });

    it('should pass property_type filter to service', async () => {
      strapi._mockService.getFocusQuery.mockResolvedValue({ data: [], meta: {} });

      const ctx = makeCtx({ query: { property_type: 'apartment' } });
      await actions.getFocus(ctx);

      expect(strapi._mockService.getFocusQuery).toHaveBeenCalledWith(
        expect.objectContaining({ property_type: 'apartment' })
      );
    });

    it('should pass tags filter to service', async () => {
      strapi._mockService.getFocusQuery.mockResolvedValue({ data: [], meta: {} });

      const ctx = makeCtx({ query: { tags: 'undervalued,new' } });
      await actions.getFocus(ctx);

      expect(strapi._mockService.getFocusQuery).toHaveBeenCalledWith(
        expect.objectContaining({ tags: 'undervalued,new' })
      );
    });

    it('should pass sort param to service', async () => {
      strapi._mockService.getFocusQuery.mockResolvedValue({ data: [], meta: {} });

      const ctx = makeCtx({ query: { sort: '-price_per_sqm' } });
      await actions.getFocus(ctx);

      expect(strapi._mockService.getFocusQuery).toHaveBeenCalledWith(
        expect.objectContaining({ sort: '-price_per_sqm' })
      );
    });

    it('should clamp pageSize to max 100', async () => {
      strapi._mockService.getFocusQuery.mockResolvedValue({ data: [], meta: {} });

      const ctx = makeCtx({ query: { pageSize: '500' } });
      await actions.getFocus(ctx);

      expect(strapi._mockService.getFocusQuery).toHaveBeenCalledWith(
        expect.objectContaining({ pageSize: 100 })
      );
    });

    it('should clamp pageSize to min 1', async () => {
      strapi._mockService.getFocusQuery.mockResolvedValue({ data: [], meta: {} });

      const ctx = makeCtx({ query: { pageSize: '-5' } });
      await actions.getFocus(ctx);

      expect(strapi._mockService.getFocusQuery).toHaveBeenCalledWith(
        expect.objectContaining({ pageSize: 1 })
      );
    });

    it('should clamp page to min 1', async () => {
      strapi._mockService.getFocusQuery.mockResolvedValue({ data: [], meta: {} });

      const ctx = makeCtx({ query: { page: '-3' } });
      await actions.getFocus(ctx);

      expect(strapi._mockService.getFocusQuery).toHaveBeenCalledWith(
        expect.objectContaining({ page: 1 })
      );
    });

    it('should handle non-numeric threshold gracefully (defaults to 20)', async () => {
      strapi._mockService.getFocusQuery.mockResolvedValue({ data: [], meta: {} });

      const ctx = makeCtx({ query: { threshold: 'abc' } });
      await actions.getFocus(ctx);

      expect(strapi._mockService.getFocusQuery).toHaveBeenCalledWith(
        expect.objectContaining({ threshold: 20 })
      );
    });
  });
});
