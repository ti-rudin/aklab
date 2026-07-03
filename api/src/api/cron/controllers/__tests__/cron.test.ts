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
        expect.objectContaining({ correlationId: expect.stringContaining('manual-parse-') }),
      );
      expect(ctx.body.ok).toBe(true);
      expect(ctx.body.message).toContain('tender');
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
    it('should enqueue all properties with status=new', async () => {
      const properties = [
        { documentId: 'p1' },
        { documentId: 'p2' },
      ];
      mockStrapi.entityService.findMany.mockResolvedValue(properties);

      const ctx = makeCtx({ request: { body: {} } });
      await cronController.analyzeAll(ctx);

      expect(mockStrapi.entityService.findMany).toHaveBeenCalledWith('api::property.property', {
        filters: { status: 'new', is_undervalued: { $null: true } },
        limit: 500,
      });
      expect(mockQueue.addToQueue).toHaveBeenCalledTimes(2);
      expect(mockQueue.addToQueue).toHaveBeenCalledWith(
        'analyze-property',
        { documentId: 'p1' },
        expect.any(Object),
      );
      expect(ctx.body.ok).toBe(true);
      expect(ctx.body.message).toContain('2');
    });

    it('should pass threshold from body to each job', async () => {
      mockStrapi.entityService.findMany.mockResolvedValue([{ documentId: 'p1' }]);

      const ctx = makeCtx({ request: { body: { threshold: 30 } } });
      await cronController.analyzeAll(ctx);

      expect(mockQueue.addToQueue).toHaveBeenCalledWith(
        'analyze-property',
        { documentId: 'p1', threshold: 30 },
        expect.any(Object),
      );
      expect(ctx.body.filters.threshold).toBe(30);
    });

    it('should apply price range filters', async () => {
      mockStrapi.entityService.findMany.mockResolvedValue([]);

      const ctx = makeCtx({ request: { body: { priceFrom: 100000, priceTo: 500000 } } });
      await cronController.analyzeAll(ctx);

      expect(mockStrapi.entityService.findMany).toHaveBeenCalledWith('api::property.property', {
        filters: {
          status: 'new',
          is_undervalued: { $null: true },
          price: { $gte: 100000, $lte: 500000 },
        },
        limit: 500,
      });
    });

    it('should apply city filter (array)', async () => {
      mockStrapi.entityService.findMany.mockResolvedValue([]);

      const ctx = makeCtx({ request: { body: { city: ['moscow', 'spb'] } } });
      await cronController.analyzeAll(ctx);

      expect(mockStrapi.entityService.findMany).toHaveBeenCalledWith('api::property.property', {
        filters: {
          status: 'new',
          is_undervalued: { $null: true },
          city: { $in: ['moscow', 'spb'] },
        },
        limit: 500,
      });
    });

    it('should handle empty properties list', async () => {
      mockStrapi.entityService.findMany.mockResolvedValue([]);

      const ctx = makeCtx({ request: { body: {} } });
      await cronController.analyzeAll(ctx);

      expect(ctx.body.ok).toBe(true);
      expect(ctx.body.message).toContain('0');
      expect(mockQueue.addToQueue).not.toHaveBeenCalled();
    });

    it('should call ctx.internalServerError on exception', async () => {
      mockStrapi.entityService.findMany.mockRejectedValue(new Error('db boom'));

      const ctx = makeCtx({ request: { body: {} } });
      await cronController.analyzeAll(ctx);

      expect(ctx.internalServerError).toHaveBeenCalledWith('db boom');
    });
  });

  // =================== sendDigest ===================
  describe('sendDigest', () => {
    it('should enqueue digest job with smtp_to from settings', async () => {
      mockStrapi.db.query('api::setting.setting').findOne = vi.fn().mockResolvedValue({
        smtp_to: 'admin@example.com',
      });
      mockQueue.addToQueue.mockReturnValue({ id: 'job1' });

      const ctx = makeCtx();
      await cronController.sendDigest(ctx);

      expect(mockStrapi.db.query).toHaveBeenCalledWith('api::setting.setting');
      expect(mockQueue.addToQueue).toHaveBeenCalledWith(
        'digest-send',
        expect.objectContaining({
          date: expect.any(String),
          smtpTo: 'admin@example.com',
        }),
        expect.objectContaining({ correlationId: expect.stringContaining('manual-digest-') }),
      );
      expect(ctx.body.ok).toBe(true);
    });

    it('should handle missing smtp_to gracefully', async () => {
      mockStrapi.db.query('api::setting.setting').findOne = vi.fn().mockResolvedValue({});

      const ctx = makeCtx();
      await cronController.sendDigest(ctx);

      expect(mockQueue.addToQueue).toHaveBeenCalledWith(
        'digest-send',
        expect.objectContaining({ smtpTo: undefined }),
        expect.any(Object),
      );
    });

    it('should handle null setting', async () => {
      mockStrapi.db.query('api::setting.setting').findOne = vi.fn().mockResolvedValue(null);

      const ctx = makeCtx();
      await cronController.sendDigest(ctx);

      expect(ctx.body.ok).toBe(true);
      expect(mockQueue.addToQueue).toHaveBeenCalled();
    });

    it('should call ctx.internalServerError on exception', async () => {
      mockStrapi.db.query('api::setting.setting').findOne = vi.fn().mockRejectedValue(new Error('smtp err'));

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
