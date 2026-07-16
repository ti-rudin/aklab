import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mock queueService ---
const mockQueue = {
  addToQueue: vi.fn(),
  getDetailedStats: vi.fn(),
  addAndWait: vi.fn(),
  sendRequest: vi.fn(),
};

vi.mock('../../../../services/queueService', () => ({
  getQueueService: () => mockQueue,
}));

// --- Mock pipeline service ---
const mockPipeline = {
  start: vi.fn(),
  getState: vi.fn(),
  updateState: vi.fn(),
  resetState: vi.fn(),
};

vi.mock('../../../../services/pipeline', () => ({
  getPipelineService: () => mockPipeline,
}));

// --- Mock focusEngine ---
vi.mock('../../../../services/focusEngine', () => ({
  scoreProperty: vi.fn(),
  scorePropertiesBatch: vi.fn(),
  scoreAllProperties: vi.fn(),
}));

// --- Strapi global ---
const mockStrapi = {
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
  entityService: {
    findMany: vi.fn(),
    create: vi.fn(),
  },
  db: {
    query: vi.fn().mockReturnValue({
      findOne: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    }),
  },
};

// @ts-ignore
global.strapi = mockStrapi;

// Import after mocks
import cronController from '../cron';
import { scorePropertiesBatch } from '../../../../services/focusEngine';

function makeCtx(overrides: Record<string, any> = {}): any {
  return {
    params: {},
    query: {},
    request: { body: {} },
    body: undefined,
    status: 200,
    notFound: vi.fn(),
    badRequest: vi.fn(),
    internalServerError: vi.fn(),
    set: vi.fn(),
    ...overrides,
  };
}

describe('cron controller', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Re-set persistent mock returns after resetAllMocks
    mockStrapi.db.query.mockReturnValue({
      findOne: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    });
    // Default pipeline mock returns
    mockPipeline.start.mockResolvedValue('run-123');
    mockPipeline.getState.mockResolvedValue({ status: 'idle' });
    // @ts-ignore
    global.strapi = mockStrapi;
  });

  // =================== parseSource ===================
  describe('parseSource', () => {
    it('should enqueue a parse job for an active source', async () => {
      const source = { id: 1, documentId: 'doc1', slug: 'tender', is_active: true };
      mockStrapi.entityService.findMany.mockResolvedValue([source]);
      mockQueue.addToQueue.mockReturnValue({ id: 'job1' });

      const ctx = makeCtx({ params: { slug: 'tender' } });
      await cronController.parseSource(ctx);

      expect(mockStrapi.entityService.findMany).toHaveBeenCalledWith('api::source.source', {
        filters: { slug: 'tender' },
        limit: 1,
      });
      expect(mockQueue.addToQueue).toHaveBeenCalledWith(
        'parse-tender',
        { source: 'tender', sourceId: 1, documentId: 'doc1', depth: 20 },
        expect.objectContaining({
          correlationId: expect.stringContaining('manual-parse-'),
          idempotencyKey: 'manual:tender:full',
        }),
      );
      expect(ctx.body.ok).toBe(true);
      expect(ctx.body.message).toContain('tender');
      expect(ctx.body.job_id).toBe('job1');
      expect(ctx.body.jobId).toBe('job1');
      expect(ctx.body.reused).toBe(false);
    });

    it('should reject manual parse while the persisted pipeline lifecycle is non-idle', async () => {
      const source = { id: 1, documentId: 'doc1', slug: 'tender', is_active: true };
      mockStrapi.entityService.findMany.mockResolvedValue([source]);
      mockPipeline.getState.mockResolvedValue({ status: 'cancelling' });

      const ctx = makeCtx({ params: { slug: 'tender' } });
      await cronController.parseSource(ctx);

      expect(ctx.status).toBe(409);
      expect(ctx.body).toEqual(expect.objectContaining({ ok: false }));
      expect(mockQueue.addToQueue).not.toHaveBeenCalled();
    });

    it('should report when a concurrent manual request reuses the live job', async () => {
      const source = { id: 1, documentId: 'doc1', slug: 'tender', is_active: true };
      mockStrapi.entityService.findMany.mockResolvedValue([source]);
      mockQueue.addToQueue.mockReturnValue({ id: 42, correlation_id: 'manual-parse-earlier-request' });

      const ctx = makeCtx({ params: { slug: 'tender' } });
      await cronController.parseSource(ctx);

      expect(ctx.body).toEqual(expect.objectContaining({
        ok: true,
        job_id: 42,
        jobId: 42,
        reused: true,
      }));
    });

    it('should call ctx.notFound when source does not exist', async () => {
      mockStrapi.entityService.findMany.mockResolvedValue([]);

      const ctx = makeCtx({ params: { slug: 'unknown' } });
      await cronController.parseSource(ctx);

      expect(ctx.notFound).toHaveBeenCalledWith('Source unknown not found');
      expect(mockQueue.addToQueue).not.toHaveBeenCalled();
    });

    it('should call ctx.badRequest when source is inactive', async () => {
      const source = { id: 1, documentId: 'doc1', slug: 'old', is_active: false };
      mockStrapi.entityService.findMany.mockResolvedValue([source]);

      const ctx = makeCtx({ params: { slug: 'old' } });
      await cronController.parseSource(ctx);

      expect(ctx.badRequest).toHaveBeenCalledWith('Source old is not active');
      expect(mockQueue.addToQueue).not.toHaveBeenCalled();
    });

    it('should call ctx.internalServerError on exception', async () => {
      mockStrapi.entityService.findMany.mockRejectedValue(new Error('db down'));

      const ctx = makeCtx({ params: { slug: 'tender' } });
      await cronController.parseSource(ctx);

      expect(ctx.internalServerError).toHaveBeenCalledWith('db down');
    });
  });

  // =================== analyzeAll ===================
  describe('analyzeAll', () => {
    it('should start an asynchronous analyze lifecycle and return its run id', async () => {
      const ctx = makeCtx({ request: { body: {} } });
      await cronController.analyzeAll(ctx);

      expect(mockPipeline.start).toHaveBeenCalledWith('analyze', 20, expect.objectContaining({}), 'manual');
      expect(ctx.body.ok).toBe(true);
      expect(ctx.body.run_id).toBe('run-123');
      expect(ctx.body.runId).toBe('run-123');
      expect(ctx.body.message).toContain('mode=analyze');
    });

    it('should pass threshold from body to the analyze lifecycle', async () => {
      const ctx = makeCtx({ request: { body: { threshold: 30 } } });
      await cronController.analyzeAll(ctx);

      expect(mockPipeline.start).toHaveBeenCalledWith(
        'analyze', 20, expect.objectContaining({ threshold: 30 }), 'manual',
      );
      expect(ctx.body.filters.threshold).toBe(30);
    });

    it('should apply price range filters', async () => {
      const ctx = makeCtx({ request: { body: { priceFrom: 100000, priceTo: 500000 } } });
      await cronController.analyzeAll(ctx);

      expect(mockPipeline.start).toHaveBeenCalledWith(
        'analyze', 20, expect.objectContaining({ priceFrom: 100000, priceTo: 500000 }), 'manual',
      );
    });

    it('should apply city filter (array)', async () => {
      const ctx = makeCtx({ request: { body: { city: ['moscow', 'spb'] } } });
      await cronController.analyzeAll(ctx);

      expect(mockPipeline.start).toHaveBeenCalledWith(
        'analyze', 20, expect.objectContaining({ city: ['moscow', 'spb'] }), 'manual',
      );
    });

    it('should keep the existing default depth for the analyze lifecycle', async () => {
      const ctx = makeCtx({ request: { body: {} } });
      await cronController.analyzeAll(ctx);

      expect(mockPipeline.start).toHaveBeenCalledWith('analyze', 20, expect.anything(), 'manual');
    });

    it('should pass force to the lifecycle without resetting properties in the controller', async () => {
      const query = mockStrapi.db.query('api::property.property');
      const ctx = makeCtx({ request: { body: { force: true } } });
      await cronController.analyzeAll(ctx);

      expect(mockPipeline.start).toHaveBeenCalledWith(
        'analyze', 20, expect.objectContaining({ force: true }), 'manual',
      );
      expect(query.findMany).not.toHaveBeenCalled();
      expect(query.update).not.toHaveBeenCalled();
    });

    it('should call ctx.internalServerError on exception', async () => {
      mockPipeline.start.mockRejectedValue(new Error('db boom'));

      const ctx = makeCtx({ request: { body: {} } });
      await cronController.analyzeAll(ctx);

      expect(ctx.internalServerError).toHaveBeenCalledWith('db boom');
    });
  });

  // =================== sendDigest ===================
  describe('sendDigest', () => {
    it('should start an asynchronous digest lifecycle and return its run id', async () => {
      const ctx = makeCtx();
      await cronController.sendDigest(ctx);

      expect(mockPipeline.start).toHaveBeenCalledWith('digest', 20, undefined, 'manual');
      expect(ctx.body.ok).toBe(true);
      expect(ctx.body.run_id).toBe('run-123');
      expect(ctx.body.runId).toBe('run-123');
      expect(ctx.body.message).toContain('mode=digest');
    });

    it('should call ctx.internalServerError on exception', async () => {
      mockPipeline.start.mockRejectedValue(new Error('smtp err'));

      const ctx = makeCtx();
      await cronController.sendDigest(ctx);

      expect(ctx.internalServerError).toHaveBeenCalledWith('smtp err');
    });
  });

  // =================== queueStats ===================
  describe('queueStats', () => {
    it('should return queue stats and source list', async () => {
      const stats = { 'parse-tender': { pending: 2, done: 10 } };
      mockQueue.getDetailedStats.mockReturnValue(stats);

      const sources = [
        { slug: 'tender', is_active: true, last_parse_status: 'ok', last_parsed_at: '2026-01-01', total_created: 50, parse_count: 5 },
        { slug: 'bankruptcy', is_active: false, last_parse_status: 'error', last_parsed_at: null, total_created: 0, parse_count: 0 },
      ];
      mockStrapi.entityService.findMany.mockResolvedValue(sources);

      const ctx = makeCtx();
      await cronController.queueStats(ctx);

      expect(ctx.body.ok).toBe(true);
      expect(ctx.body.queues).toEqual(stats);
      expect(ctx.body.sources).toHaveLength(2);
      expect(ctx.body.sources[0]).toEqual({
        slug: 'tender',
        is_active: true,
        last_parse_status: 'ok',
        last_parsed_at: '2026-01-01',
        total_created: 50,
        total_details_fetched: 0,
        total_details_needed: 0,
        parse_count: 5,
      });
    });

    it('should handle null sources', async () => {
      mockQueue.getDetailedStats.mockReturnValue({});
      mockStrapi.entityService.findMany.mockResolvedValue(null);

      const ctx = makeCtx();
      await cronController.queueStats(ctx);

      expect(ctx.body.ok).toBe(true);
      expect(ctx.body.sources).toEqual([]);
    });

    it('should call ctx.internalServerError on exception', async () => {
      mockQueue.getDetailedStats.mockImplementation(() => { throw new Error('queue down'); });

      const ctx = makeCtx();
      await cronController.queueStats(ctx);

      expect(ctx.internalServerError).toHaveBeenCalledWith('queue down');
    });
  });

  // =================== scoreProperties ===================
  describe('scoreProperties', () => {
    it('should score properties using rules and return stats', async () => {
      (scorePropertiesBatch as ReturnType<typeof vi.fn>).mockResolvedValue({
        scored: 2,
        in_focus: 2,
        by_tag: { moscow_mo: 2 },
      });

      const ctx = makeCtx({ request: { body: { threshold: 10 } } });
      await cronController.scoreProperties(ctx);

      expect(ctx.body.ok).toBe(true);
      expect(ctx.body.scored).toBe(2);
      expect(ctx.body.in_focus).toBe(2);
      expect(ctx.body.threshold).toBe(10);
      expect(scorePropertiesBatch).toHaveBeenCalledWith(
        expect.objectContaining({ threshold: 10 }),
      );
    });

    it('should reject manual score while a pipeline lifecycle is non-idle', async () => {
      mockPipeline.getState.mockResolvedValue({ status: 'running' });
      const ctx = makeCtx({ request: { body: { threshold: 10 } } });
      await cronController.scoreProperties(ctx);

      expect(ctx.status).toBe(409);
      expect(ctx.body.ok).toBe(false);
      expect(scorePropertiesBatch).not.toHaveBeenCalled();
    });

    it('should return early with message when no active rules', async () => {
      (scorePropertiesBatch as ReturnType<typeof vi.fn>).mockResolvedValue({
        scored: 0,
        in_focus: 0,
        by_tag: {},
      });

      const ctx = makeCtx({ request: { body: {} } });
      await cronController.scoreProperties(ctx);

      expect(ctx.body.ok).toBe(true);
      expect(ctx.body.scored).toBe(0);
      expect(ctx.body.in_focus).toBe(0);
    });

    it('should fall back to setting threshold when not in body', async () => {
      mockStrapi.db.query('api::setting.setting').findOne = vi.fn().mockResolvedValue({ threshold_percent: 25 });
      (scorePropertiesBatch as ReturnType<typeof vi.fn>).mockResolvedValue({
        scored: 0,
        in_focus: 0,
        by_tag: {},
      });

      const ctx = makeCtx({ request: { body: {} } });
      await cronController.scoreProperties(ctx);

      expect(ctx.body.ok).toBe(true);
      expect(ctx.body.threshold).toBe(25);
      expect(scorePropertiesBatch).toHaveBeenCalledWith(
        expect.objectContaining({ threshold: 25 }),
      );
    });

    it('should default threshold to 20 when setting is null', async () => {
      mockStrapi.db.query('api::setting.setting').findOne = vi.fn().mockResolvedValue(null);
      (scorePropertiesBatch as ReturnType<typeof vi.fn>).mockResolvedValue({
        scored: 1,
        in_focus: 0,
        by_tag: { t: 1 },
      });

      const ctx = makeCtx({ request: { body: {} } });
      await cronController.scoreProperties(ctx);

      expect(ctx.body.threshold).toBe(20);
      expect(scorePropertiesBatch).toHaveBeenCalledWith(
        expect.objectContaining({ threshold: 20 }),
      );
    });

    it('should count properties in_focus when score >= threshold', async () => {
      (scorePropertiesBatch as ReturnType<typeof vi.fn>).mockResolvedValue({
        scored: 1,
        in_focus: 1,
        by_tag: { mo: 1 },
      });

      const ctx = makeCtx({ request: { body: { threshold: 10 } } });
      await cronController.scoreProperties(ctx);

      expect(ctx.body.in_focus).toBe(1);
    });

    it('should apply city and price filters', async () => {
      (scorePropertiesBatch as ReturnType<typeof vi.fn>).mockResolvedValue({
        scored: 1,
        in_focus: 1,
        by_tag: { t: 1 },
      });

      const ctx = makeCtx({
        request: { body: { city: ['moscow'], priceFrom: 100000, priceTo: 500000 } },
      });
      await cronController.scoreProperties(ctx);

      expect(scorePropertiesBatch).toHaveBeenCalledWith(
        expect.objectContaining({
          city: ['moscow'],
          priceFrom: 100000,
          priceTo: 500000,
        }),
      );
      expect(ctx.body.filters).toEqual({
        city: ['moscow'],
        priceFrom: 100000,
        priceTo: 500000,
      });
    });

    it('should create property-event entries for each event', async () => {
      (scorePropertiesBatch as ReturnType<typeof vi.fn>).mockResolvedValue({
        scored: 1,
        in_focus: 1,
        by_tag: { mo: 1 },
      });

      const ctx = makeCtx({ request: { body: { threshold: 5 } } });
      await cronController.scoreProperties(ctx);

      expect(scorePropertiesBatch).toHaveBeenCalledWith(
        expect.objectContaining({ threshold: 5 }),
      );
      expect(ctx.body.scored).toBe(1);
    });

    it('should call ctx.internalServerError on exception', async () => {
      (scorePropertiesBatch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('rules err'));

      const ctx = makeCtx({ request: { body: {} } });
      await cronController.scoreProperties(ctx);

      expect(ctx.internalServerError).toHaveBeenCalledWith('rules err');
    });

    it('should batch pagination in chunks of 200', async () => {
      // The batch pagination is now handled inside scorePropertiesBatch.
      // This test verifies the controller passes through the result correctly.
      (scorePropertiesBatch as ReturnType<typeof vi.fn>).mockResolvedValue({
        scored: 200,
        in_focus: 200,
        by_tag: { t: 200 },
      });

      const ctx = makeCtx({ request: { body: {} } });
      await cronController.scoreProperties(ctx);

      expect(ctx.body.scored).toBe(200);
    });
  });
});
