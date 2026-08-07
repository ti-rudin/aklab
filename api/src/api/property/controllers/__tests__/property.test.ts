import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreateScopeRepository = vi.hoisted(() => vi.fn());

vi.mock('../../../../services/user-property-scope', () => ({
  createUserPropertyScopeRepository: mockCreateScopeRepository,
  UserPropertyScopeValidationError: class UserPropertyScopeValidationError extends Error {},
  UserPropertyScopeNotReadyError: class UserPropertyScopeNotReadyError extends Error {},
  UserPropertyScopeMalformedError: class UserPropertyScopeMalformedError extends Error {},
  UserPropertyScopeUnavailableError: class UserPropertyScopeUnavailableError extends Error {},
  UserPropertyScopeQueryError: class UserPropertyScopeQueryError extends Error {},
}));

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
  const scopeRepository = {
    list: vi.fn().mockResolvedValue({ data: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 } }),
    detail: vi.fn().mockResolvedValue({ documentId: 'doc123' }),
    stats: vi.fn().mockResolvedValue({ total: 0, inFocus: 0, hot: 0, undervalued: 0, newToday: 0, typeBreakdown: {} }),
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
    _scopeRepository: scopeRepository,
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
    mockCreateScopeRepository.mockReturnValue(strapi._scopeRepository);
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

  describe('scoped read actions', () => {
    it('uses the exact authenticated actor and canonical request for list', async () => {
      const result = { data: [{ documentId: 'doc-7' }], meta: { page: 2, pageSize: 25, total: 1, totalPages: 1 } };
      strapi._scopeRepository.list.mockResolvedValue(result);
      const ctx = makeCtx({
        state: { user: { id: 7 } },
        query: {
          city: 'moscow,mo',
          property_type: 'office,warehouse',
          status: 'new,viewed',
          search: 'needle',
          sort: '-focus_score',
          page: '2',
          pageSize: '25',
        },
      });

      await actions.find(ctx);

      expect(mockCreateScopeRepository).toHaveBeenCalledWith(strapi);
      expect(strapi._scopeRepository.list).toHaveBeenCalledWith(7, {
        city: ['moscow', 'mo'],
        propertyType: ['office', 'warehouse'],
        status: ['new', 'viewed'],
        search: 'needle',
        sort: '-focus_score',
        page: 2,
        pageSize: 25,
      });
      expect(ctx.body).toBe(result);
    });

    it('rejects populate, fields, and unknown query keys without a scope query', async () => {
      const ctx = makeCtx({ state: { user: { id: 7 } }, query: { populate: 'comments' } });

      await actions.find(ctx);

      expect(ctx.status).toBe(400);
      expect(ctx.body).toEqual({ error: 'Invalid property query' });
      expect(strapi._scopeRepository.list).not.toHaveBeenCalled();
    });

    it('returns an indistinguishable 404 for a detail outside the actor scope', async () => {
      strapi._scopeRepository.detail.mockResolvedValue(null);
      const ctx = makeCtx({ state: { user: { id: 7 } }, params: { id: 'hidden-property' } });

      await actions.findOne(ctx);

      expect(strapi._scopeRepository.detail).toHaveBeenCalledWith(7, 'hidden-property', {});
      expect(ctx.status).toBe(404);
      expect(ctx.body).toEqual({ error: 'Property not found' });
    });

    it('uses the same scoped list predicate for focus and adds only a threshold', async () => {
      const result = { data: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 } };
      strapi._scopeRepository.list.mockResolvedValue(result);
      const ctx = makeCtx({
        state: { user: { id: 7 } },
        query: { threshold: '50', city: 'moscow', sort: '-focus_score', page: '1', pageSize: '20' },
      });

      await actions.getFocus(ctx);

      expect(strapi._scopeRepository.list).toHaveBeenCalledWith(7, {
        city: ['moscow'],
        focusThreshold: 50,
        sort: '-focus_score',
        page: 1,
        pageSize: 20,
      });
      expect(ctx.body).toBe(result);
    });

    it('uses scoped stats and never performs unscoped Query Engine counts', async () => {
      const stats = { total: 2, inFocus: 1, hot: 1, undervalued: 2, newToday: 1, typeBreakdown: { office: 2 } };
      strapi._scopeRepository.stats.mockResolvedValue(stats);
      const ctx = makeCtx({ state: { user: { id: 7 } } });

      await actions.getStats(ctx);

      expect(strapi._scopeRepository.stats).toHaveBeenCalledWith(7, expect.any(Date));
      expect(ctx.body).toBe(stats);
      expect(strapi.db.query).not.toHaveBeenCalled();
    });

    it('maps scope failures to safe status responses without leaking details', async () => {
      strapi._scopeRepository.list.mockRejectedValue(new Error('SQL contains private data'));
      const ctx = makeCtx({ state: { user: { id: 7 } } });

      await actions.find(ctx);

      expect(ctx.status).toBe(500);
      expect(ctx.body).toEqual({ error: 'Property scope unavailable' });
      expect(JSON.stringify(ctx.body)).not.toContain('private data');
    });
  });

  // =================== servePhoto ===================
  describe('servePhoto', () => {
    it('should serve file with correct content-type for jpg', async () => {
      const fileBuffer = Buffer.from('fake-jpg');
      (fs.access as any).mockResolvedValue(undefined);
      (fs.readFile as any).mockResolvedValue(fileBuffer);

      const ctx = makeCtx({ state: { user: { id: 7 } }, params: { documentId: 'doc123', filename: 'photo.jpg' } });
      await actions.servePhoto(ctx);

      expect(fs.access).toHaveBeenCalled();
      expect(fs.readFile).toHaveBeenCalled();
      expect(ctx.body).toBe(fileBuffer);
      expect(ctx.set).toHaveBeenCalledWith('Content-Type', 'image/jpeg');
      expect(ctx.set).toHaveBeenCalledWith('Cache-Control', 'private, max-age=86400');
    });

    it('should set image/png for .png extension', async () => {
      (fs.access as any).mockResolvedValue(undefined);
      (fs.readFile as any).mockResolvedValue(Buffer.from('png'));

      const ctx = makeCtx({ state: { user: { id: 7 } }, params: { documentId: 'doc1', filename: 'img.png' } });
      await actions.servePhoto(ctx);

      expect(ctx.set).toHaveBeenCalledWith('Content-Type', 'image/png');
    });

    it('should set image/webp for .webp extension', async () => {
      (fs.access as any).mockResolvedValue(undefined);
      (fs.readFile as any).mockResolvedValue(Buffer.from('webp'));

      const ctx = makeCtx({ state: { user: { id: 7 } }, params: { documentId: 'doc1', filename: 'img.webp' } });
      await actions.servePhoto(ctx);

      expect(ctx.set).toHaveBeenCalledWith('Content-Type', 'image/webp');
    });

    it('rejects non-image extensions before filesystem access', async () => {
      (fs.access as any).mockResolvedValue(undefined);
      (fs.readFile as any).mockResolvedValue(Buffer.from('data'));

      const ctx = makeCtx({ state: { user: { id: 7 } }, params: { documentId: 'doc1', filename: 'img.bmp' } });
      await actions.servePhoto(ctx);

      expect(ctx.status).toBe(400);
      expect(ctx.body).toEqual({ error: 'Invalid photo path' });
      expect(fs.access).not.toHaveBeenCalled();
    });

    it('should return 404 when file not found', async () => {
      (fs.access as any).mockRejectedValue(new Error('ENOENT'));

      const ctx = makeCtx({ state: { user: { id: 7 } }, params: { documentId: 'doc1', filename: 'missing.jpg' } });
      await actions.servePhoto(ctx);

      expect(ctx.status).toBe(404);
      expect(ctx.body).toEqual({ error: 'Photo not found' });
    });

    it('returns the same 404 and never touches fs for a photo outside scope', async () => {
      strapi._scopeRepository.detail.mockResolvedValueOnce(null);
      const ctx = makeCtx({ state: { user: { id: 7 } }, params: { documentId: 'foreign', filename: 'photo.jpg' } });
      await actions.servePhoto(ctx);

      expect(ctx.status).toBe(404);
      expect(ctx.body).toEqual({ error: 'Photo not found' });
      expect(fs.access).not.toHaveBeenCalled();
    });
    it('rejects path traversal instead of rewriting it', async () => {
      const ctx = makeCtx({ state: { user: { id: 7 } }, params: { documentId: 'doc1', filename: '../../etc/passwd' } });
      await actions.servePhoto(ctx);

      expect(ctx.status).toBe(400);
      expect(ctx.body).toEqual({ error: 'Invalid photo path' });
      expect(strapi._scopeRepository.detail).toHaveBeenCalledWith(7, 'doc1', {});
      expect(fs.access).not.toHaveBeenCalled();
    });

    it('rejects traversal in documentId without checking filesystem existence', async () => {
      const ctx = makeCtx({ state: { user: { id: 7 } }, params: { documentId: '../secret', filename: 'photo.jpg' } });
      await actions.servePhoto(ctx);

      expect(ctx.status).toBe(400);
      expect(ctx.body).toEqual({ error: 'Invalid photo path' });
      expect(fs.access).not.toHaveBeenCalled();
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
