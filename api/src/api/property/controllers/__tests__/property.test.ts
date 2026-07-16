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
    createCoreService: vi.fn((_uid: string, factoryFn: any) => {
      return factoryFn;
    }),
  },
}));

// Import after mocks (vitest hoists vi.mock)
import * as fs from 'fs/promises';
import propertyControllerFactory from '../property';
import { PropertyUpsertValidationError } from '../../services/property';
import propertyRoutes from '../../routes/property';

// Build a mock strapi instance (fresh per test)
function makeStrapi() {
  const mockService = {
    getFocusQuery: vi.fn(),
    clearNew: vi.fn(),
    upsertByIdentity: vi.fn(),
  };
  const mockDbQuery = {
    findMany: vi.fn().mockResolvedValue([]),
    deleteMany: vi.fn(),
    update: vi.fn(),
  };
  return {
    db: {
      query: vi.fn().mockReturnValue(mockDbQuery),
      connection: {
        raw: vi.fn(),
      },
    },
    entityService: {
      findMany: vi.fn(),
    },
    service: vi.fn().mockReturnValue(mockService),
    _mockService: mockService,
    _mockDbQuery: mockDbQuery,
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

  // =================== upsert ===================
  describe('upsert', () => {
    it('returns 201 for a newly created identity', async () => {
      const property = { id: 42, documentId: 'doc-42' };
      strapi._mockService.upsertByIdentity.mockResolvedValue({ property, created: true });
      const data = { source: 'alfalot', external_id: 'lot-42' };
      const ctx = makeCtx({ request: { body: { data } } });

      await actions.upsert(ctx);

      expect(strapi._mockService.upsertByIdentity).toHaveBeenCalledWith(data);
      expect(ctx.status).toBe(201);
      expect(ctx.body).toEqual({ data: property, meta: { created: true } });
    });

    it('returns the concurrent winner with created=false', async () => {
      const property = { id: 8, documentId: 'winner' };
      strapi._mockService.upsertByIdentity.mockResolvedValue({ property, created: false });
      const ctx = makeCtx({ request: { body: { data: { source: 'alfalot', external_id: 'lot-42' } } } });

      await actions.upsert(ctx);

      expect(ctx.status).toBe(200);
      expect(ctx.body).toEqual({ data: property, meta: { created: false } });
    });

    it('rejects missing identity fields before calling the service', async () => {
      const ctx = makeCtx({ request: { body: { data: { source: 'alfalot', external_id: '  ' } } } });

      await actions.upsert(ctx);

      expect(ctx.status).toBe(400);
      expect(ctx.body).toEqual({ error: 'source and external_id are required' });
      expect(strapi._mockService.upsertByIdentity).not.toHaveBeenCalled();
    });

    it('returns 400 for a service-side parser payload validation error', async () => {
      strapi._mockService.upsertByIdentity.mockRejectedValue(
        new PropertyUpsertValidationError('Field "status" is not accepted by parser upsert'),
      );
      const ctx = makeCtx({ request: { body: { data: { source: 'alfalot', external_id: 'lot-42', status: 'rejected' } } } });

      await actions.upsert(ctx);

      expect(ctx.status).toBe(400);
      expect(ctx.body).toEqual({ error: 'Field "status" is not accepted by parser upsert' });
    });
  });

  describe('internalUpdate', () => {
    it('updates only analyzer/photo-owned fields by documentId', async () => {
      const fields = { is_undervalued: true, deviation_percent: 12.5, photos_downloaded: false };
      const updated = { documentId: 'property-doc', ...fields };
      strapi._mockDbQuery.update.mockResolvedValue(updated);
      const ctx = makeCtx({ params: { id: 'property-doc' }, request: { body: { data: fields } } });

      await actions.internalUpdate(ctx);

      expect(strapi.db.query).toHaveBeenCalledWith('api::property.property');
      expect(strapi._mockDbQuery.update).toHaveBeenCalledWith({
        where: { documentId: 'property-doc' },
        data: fields,
      });
      expect(ctx.body).toEqual({ data: updated });
    });

    it('rejects empty or non-allowlisted internal update payloads before writing', async () => {
      const ctx = makeCtx({ params: { id: 'property-doc' }, request: { body: { data: {} } } });

      await actions.internalUpdate(ctx);

      expect(ctx.status).toBe(400);
      expect(strapi._mockDbQuery.update).not.toHaveBeenCalled();

      const protectedFieldCtx = makeCtx({
        params: { id: 'property-doc' },
        request: { body: { data: { status: 'rejected' } } },
      });
      await actions.internalUpdate(protectedFieldCtx);

      expect(protectedFieldCtx.status).toBe(400);
      expect(strapi._mockDbQuery.update).not.toHaveBeenCalled();
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
        threshold: 0,
        city: undefined,
        property_type: undefined,
        tags: undefined,
        search: undefined,
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

    it('should handle non-numeric threshold gracefully (defaults to 0)', async () => {
      strapi._mockService.getFocusQuery.mockResolvedValue({ data: [], meta: {} });

      const ctx = makeCtx({ query: { threshold: 'abc' } });
      await actions.getFocus(ctx);

      expect(strapi._mockService.getFocusQuery).toHaveBeenCalledWith(
        expect.objectContaining({ threshold: 0 })
      );
    });
  });
});

describe('property internal route', () => {
  it('uses the service-token policy for the dedicated property write alias', () => {
    expect(propertyRoutes.routes).toContainEqual({
      method: 'PUT',
      path: '/internal/properties/:id',
      handler: 'property.internalUpdate',
      config: { auth: false, policies: ['global::service-token'] },
    });
  });
});
