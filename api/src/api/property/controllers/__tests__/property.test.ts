import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockCreateScopeRepository = vi.hoisted(() => vi.fn());
const mockGetQueueService = vi.hoisted(() => vi.fn());

vi.mock('../../../../services/user-property-scope', () => ({
  createUserPropertyScopeRepository: mockCreateScopeRepository,
  UserPropertyScopeValidationError: class UserPropertyScopeValidationError extends Error {},
  UserPropertyScopeNotReadyError: class UserPropertyScopeNotReadyError extends Error {},
  UserPropertyScopeMalformedError: class UserPropertyScopeMalformedError extends Error {},
  UserPropertyScopeUnavailableError: class UserPropertyScopeUnavailableError extends Error {},
  UserPropertyScopeQueryError: class UserPropertyScopeQueryError extends Error {},
}));

vi.mock('../../../../services/queueService', () => ({
  getQueueService: mockGetQueueService,
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
    upsertByIdentity: vi.fn(),
  };
  const mockDbQuery = {
    findMany: vi.fn().mockResolvedValue([]),
    findOne: vi.fn(),
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
  const photoRoot = '/tmp/aklab-property-photo-test-root';
  let previousPhotoRoot: string | undefined;
  let previousPhotoAlias: string | undefined;

  beforeEach(() => {
    previousPhotoRoot = process.env.PRIVATE_PHOTO_ROOT;
    previousPhotoAlias = process.env.PHOTOS_BASE_DIR;
    process.env.PRIVATE_PHOTO_ROOT = photoRoot;
    delete process.env.PHOTOS_BASE_DIR;
    strapi = makeStrapi();
    actions = (propertyControllerFactory as any)({ strapi });
    vi.clearAllMocks();
    mockCreateScopeRepository.mockReturnValue(strapi._scopeRepository);
  });

  afterEach(() => {
    if (previousPhotoRoot === undefined) delete process.env.PRIVATE_PHOTO_ROOT;
    else process.env.PRIVATE_PHOTO_ROOT = previousPhotoRoot;
    if (previousPhotoAlias === undefined) delete process.env.PHOTOS_BASE_DIR;
    else process.env.PHOTOS_BASE_DIR = previousPhotoAlias;
  });

  describe('removed global cleanup action', () => {
    it('does not expose clearNew from the controller', () => {
      expect(actions.clearNew).toBeUndefined();
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

  describe('internalFindOne', () => {
    it('reads a canonical property by documentId without user scope', async () => {
      const property = { documentId: 'property-doc', title: 'Service property' };
      strapi._mockDbQuery.findOne.mockResolvedValue(property);
      const ctx = makeCtx({ params: { id: 'property-doc' } });

      await actions.internalFindOne(ctx);

      expect(strapi._mockDbQuery.findOne).toHaveBeenCalledWith({ where: { documentId: 'property-doc' } });
      expect(strapi._scopeRepository.detail).not.toHaveBeenCalled();
      expect(ctx.body).toEqual({ data: property });
    });

    it('returns 404 when the canonical property does not exist', async () => {
      strapi._mockDbQuery.findOne.mockResolvedValue(null);
      const ctx = makeCtx({ params: { id: 'missing-property' } });

      await actions.internalFindOne(ctx);

      expect(ctx.status).toBe(404);
      expect(ctx.body).toEqual({ error: 'Property not found' });
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

      expect(fs.access).toHaveBeenCalledWith(`${photoRoot}/doc123/photo.jpg`);
      expect(fs.readFile).toHaveBeenCalledWith(`${photoRoot}/doc123/photo.jpg`);
      expect(ctx.body).toBe(fileBuffer);
      expect(ctx.set).toHaveBeenCalledWith('Content-Type', 'image/jpeg');
      expect(ctx.set).toHaveBeenCalledWith('Cache-Control', 'private, max-age=86400');
    });

    it('returns a safe server error when a visible photo has no configured root', async () => {
      delete process.env.PRIVATE_PHOTO_ROOT;
      delete process.env.PHOTOS_BASE_DIR;
      const ctx = makeCtx({ state: { user: { id: 7 } }, params: { documentId: 'doc1', filename: 'photo.jpg' } });
      await actions.servePhoto(ctx);

      expect(ctx.status).toBe(500);
      expect(ctx.body).toEqual({ error: 'Property scope unavailable' });
      expect(fs.access).not.toHaveBeenCalled();
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
      delete process.env.PRIVATE_PHOTO_ROOT;
      delete process.env.PHOTOS_BASE_DIR;
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

  describe('operational enrichment actions', () => {
    it('returns 404 and performs no property read or network call when geocode scope denies access', async () => {
      strapi._scopeRepository.detail.mockResolvedValue(null);
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const ctx = makeCtx({ state: { user: { id: 7 } }, params: { id: 'foreign' } });

      await actions.geocode(ctx);

      expect(strapi._scopeRepository.detail).toHaveBeenCalledWith(7, 'foreign', {});
      expect(strapi.db.query).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(ctx.status).toBe(404);
      expect(ctx.body).toEqual({ error: 'Property not found' });
    });

    it('checks scope before reading the property and calls geocoder before cache update', async () => {
      const property = { documentId: 'doc123', address: 'Москва, Тверская 1', latitude: null, longitude: null };
      strapi._mockDbQuery.findOne.mockResolvedValue(property);
      const fetchMock = vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue([{ lat: '55.75', lon: '37.61' }]),
      });
      vi.stubGlobal('fetch', fetchMock);

      const ctx = makeCtx({ state: { user: { id: 7 } }, params: { id: 'doc123' } });
      await actions.geocode(ctx);

      expect(strapi._scopeRepository.detail).toHaveBeenCalledWith(7, 'doc123', {});
      expect(strapi._mockDbQuery.findOne).toHaveBeenCalledWith({ where: { documentId: 'doc123' } });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(strapi._mockDbQuery.update).toHaveBeenCalledWith({
        where: { documentId: 'doc123' },
        data: { latitude: 55.75, longitude: 37.61 },
      });
      expect(ctx.body).toEqual({ latitude: 55.75, longitude: 37.61, cached: false });
      expect(strapi._scopeRepository.detail.mock.invocationCallOrder[0])
        .toBeLessThan(strapi._mockDbQuery.findOne.mock.invocationCallOrder[0]);
      expect(strapi._mockDbQuery.findOne.mock.invocationCallOrder[0])
        .toBeLessThan(fetchMock.mock.invocationCallOrder[0]);
      expect(fetchMock.mock.invocationCallOrder[0])
        .toBeLessThan(strapi._mockDbQuery.update.mock.invocationCallOrder[0]);
    });

    it('does not cache non-finite geocoder coordinates', async () => {
      strapi._mockDbQuery.findOne.mockResolvedValue({
        documentId: 'doc123', address: 'Москва, Тверская 1', latitude: null, longitude: null,
      });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue([{ lat: 'not-a-number', lon: '37.61' }]),
      }));

      const ctx = makeCtx({ state: { user: { id: 7 } }, params: { id: 'doc123' } });
      await actions.geocode(ctx);

      expect(strapi._mockDbQuery.update).not.toHaveBeenCalled();
      expect(ctx.status).toBe(500);
      expect(ctx.body).toEqual({ error: 'Geocoding failed' });
    });

    it('returns 404 and performs no property read or queue work when fetch-photos scope denies access', async () => {
      strapi._scopeRepository.detail.mockResolvedValue(null);
      const queue = { addToQueue: vi.fn() };
      mockGetQueueService.mockReturnValue(queue);
      const ctx = makeCtx({ state: { user: { id: 7 } }, params: { id: 'foreign' } });

      await actions.fetchPhotos(ctx);

      expect(strapi._scopeRepository.detail).toHaveBeenCalledWith(7, 'foreign', {});
      expect(strapi.db.query).not.toHaveBeenCalled();
      expect(mockGetQueueService).not.toHaveBeenCalled();
      expect(queue.addToQueue).not.toHaveBeenCalled();
      expect(ctx.status).toBe(404);
      expect(ctx.body).toEqual({ error: 'Property not found' });
    });

    it('checks scope before reading the property and queues fetch-photos only after visibility', async () => {
      const property = {
        documentId: 'doc123', photos_downloaded: false, url: 'https://source.test/lot', source: 'alfalot',
      };
      strapi._mockDbQuery.findOne.mockResolvedValue(property);
      const queue = { addToQueue: vi.fn() };
      mockGetQueueService.mockReturnValue(queue);
      const ctx = makeCtx({ state: { user: { id: 7 } }, params: { id: 'doc123' } });

      await actions.fetchPhotos(ctx);

      expect(strapi._scopeRepository.detail).toHaveBeenCalledWith(7, 'doc123', {});
      expect(strapi._mockDbQuery.findOne).toHaveBeenCalledWith({ where: { documentId: 'doc123' } });
      expect(queue.addToQueue).toHaveBeenCalledWith('fetch-photos', {
        documentId: 'doc123', url: property.url, source: property.source,
      }, { correlationId: 'photo-lazy-doc123' });
      expect(ctx.body).toEqual({ queued: true });
      expect(strapi._scopeRepository.detail.mock.invocationCallOrder[0])
        .toBeLessThan(strapi._mockDbQuery.findOne.mock.invocationCallOrder[0]);
      expect(strapi._mockDbQuery.findOne.mock.invocationCallOrder[0])
        .toBeLessThan(queue.addToQueue.mock.invocationCallOrder[0]);
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

  it('does not expose the removed clearNew route', () => {
    expect(propertyRoutes.routes).not.toContainEqual(expect.objectContaining({
      method: 'POST', path: '/properties/clear-new', handler: 'property.clearNew',
    }));
  });
});
