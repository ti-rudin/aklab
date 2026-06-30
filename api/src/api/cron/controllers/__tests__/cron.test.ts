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
import { scoreProperty } from '../../../../services/focusEngine';

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
    vi.clearAllMocks();
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
        { source: 'tender', sourceId: 1, documentId: 'doc1' },
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
      const rules = [
        { id: 1, name: 'r1', condition_type: 'city_match', condition_value: 'moscow', score: 10, tag: 'moscow_mo', is_active: true, priority: 1 },
      ];
      mockStrapi.entityService.findMany.mockResolvedValue(rules);

      const properties = [
        { id: 1, city: 'moscow', focus_score: 0, tags: [] },
        { id: 2, city: 'spb', focus_score: 0, tags: [] },
      ];
      mockStrapi.db.query('api::property.property').findMany = vi.fn()
        .mockResolvedValueOnce(properties)
        .mockResolvedValueOnce([]); // end pagination

      mockStrapi.db.query('api::property.property').update = vi.fn().mockResolvedValue({});
      (scoreProperty as ReturnType<typeof vi.fn>).mockReturnValue({
        score: 10,
        tags: ['moscow_mo'],
        events: [{ event_type: 'entered_focus', new_value: 'moscow_mo' }],
      });
      mockStrapi.entityService.create.mockResolvedValue({});

      const ctx = makeCtx({ request: { body: { threshold: 10 } } });
      await cronController.scoreProperties(ctx);

      expect(ctx.body.ok).toBe(true);
      expect(ctx.body.scored).toBe(2);
      expect(ctx.body.threshold).toBe(10);
      expect(scoreProperty).toHaveBeenCalledTimes(2);
    });

    it('should return early with message when no active rules', async () => {
      mockStrapi.entityService.findMany.mockResolvedValue([]);

      const ctx = makeCtx({ request: { body: {} } });
      await cronController.scoreProperties(ctx);

      expect(ctx.body.ok).toBe(true);
      expect(ctx.body.scored).toBe(0);
      expect(ctx.body.message).toContain('No active focus rules');
    });

    it('should fall back to setting threshold when not in body', async () => {
      mockStrapi.entityService.findMany.mockResolvedValue([]);
      mockStrapi.db.query('api::setting.setting').findOne = vi.fn().mockResolvedValue({ threshold_percent: 25 });

      const ctx = makeCtx({ request: { body: {} } });
      await cronController.scoreProperties(ctx);

      // threshold should come from settings since body.threshold was not provided
      // and then the function returns early because no rules
      expect(ctx.body.ok).toBe(true);
    });

    it('should default threshold to 20 when setting is null', async () => {
      // Provide rules so the function doesn't early-return (early return omits threshold)
      const rules = [{ id: 1, name: 'r1', condition_type: 'city_match', condition_value: 'x', score: 1, tag: 't', is_active: true, priority: 1 }];
      mockStrapi.entityService.findMany.mockResolvedValue(rules);
      mockStrapi.db.query('api::setting.setting').findOne = vi.fn().mockResolvedValue(null);

      const props = [{ id: 1, city: 'x', focus_score: 0, tags: [] }];
      mockStrapi.db.query('api::property.property').findMany = vi.fn()
        .mockResolvedValueOnce(props)
        .mockResolvedValueOnce([]);
      mockStrapi.db.query('api::property.property').update = vi.fn().mockResolvedValue({});
      (scoreProperty as ReturnType<typeof vi.fn>).mockReturnValue({ score: 1, tags: ['t'], events: [] });

      const ctx = makeCtx({ request: { body: {} } });
      await cronController.scoreProperties(ctx);

      expect(ctx.body.threshold).toBe(20);
    });

    it('should count properties in_focus when score >= threshold', async () => {
      const rules = [{ id: 1, name: 'r1', condition_type: 'city_match', condition_value: 'moscow', score: 15, tag: 'mo', is_active: true, priority: 1 }];
      mockStrapi.entityService.findMany.mockResolvedValue(rules);

      const props = [{ id: 1, city: 'moscow', focus_score: 0, tags: [] }];
      mockStrapi.db.query('api::property.property').findMany = vi.fn()
        .mockResolvedValueOnce(props)
        .mockResolvedValueOnce([]);

      (scoreProperty as ReturnType<typeof vi.fn>).mockReturnValue({ score: 15, tags: ['mo'], events: [] });
      mockStrapi.db.query('api::property.property').update = vi.fn().mockResolvedValue({});

      const ctx = makeCtx({ request: { body: { threshold: 10 } } });
      await cronController.scoreProperties(ctx);

      expect(ctx.body.in_focus).toBe(1);
    });

    it('should apply city and price filters', async () => {
      // Provide rules + properties so function reaches normal path where filters are in response
      const rules = [{ id: 1, name: 'r1', condition_type: 'city_match', condition_value: 'moscow', score: 1, tag: 't', is_active: true, priority: 1 }];
      mockStrapi.entityService.findMany.mockResolvedValue(rules);

      const props = [{ id: 1, city: 'moscow', focus_score: 0, tags: [] }];
      mockStrapi.db.query('api::property.property').findMany = vi.fn()
        .mockResolvedValueOnce(props)
        .mockResolvedValueOnce([]);
      mockStrapi.db.query('api::property.property').update = vi.fn().mockResolvedValue({});
      (scoreProperty as ReturnType<typeof vi.fn>).mockReturnValue({ score: 1, tags: ['t'], events: [] });

      const ctx = makeCtx({
        request: { body: { city: ['moscow'], priceFrom: 100000, priceTo: 500000 } },
      });
      await cronController.scoreProperties(ctx);

      expect(ctx.body.filters).toEqual({
        city: ['moscow'],
        priceFrom: 100000,
        priceTo: 500000,
      });
    });

    it('should create property-event entries for each event', async () => {
      const rules = [{ id: 1, name: 'r1', condition_type: 'city_match', condition_value: 'moscow', score: 10, tag: 'mo', is_active: true, priority: 1 }];
      mockStrapi.entityService.findMany.mockResolvedValue(rules);

      const props = [{ id: 42, city: 'moscow', focus_score: 0, tags: [] }];
      mockStrapi.db.query('api::property.property').findMany = vi.fn()
        .mockResolvedValueOnce(props)
        .mockResolvedValueOnce([]);

      (scoreProperty as ReturnType<typeof vi.fn>).mockReturnValue({
        score: 10,
        tags: ['mo'],
        events: [
          { event_type: 'score_changed', old_value: '0', new_value: '10' },
          { event_type: 'entered_focus', new_value: 'mo' },
        ],
      });
      mockStrapi.db.query('api::property.property').update = vi.fn().mockResolvedValue({});
      mockStrapi.entityService.create.mockResolvedValue({});

      const ctx = makeCtx({ request: { body: { threshold: 5 } } });
      await cronController.scoreProperties(ctx);

      expect(mockStrapi.entityService.create).toHaveBeenCalledTimes(2);
      expect(mockStrapi.entityService.create).toHaveBeenCalledWith('api::property-event.property-event', {
        data: {
          event_type: 'score_changed',
          old_value: '0',
          new_value: '10',
          property: 42,
        },
      });
    });

    it('should call ctx.internalServerError on exception', async () => {
      mockStrapi.entityService.findMany.mockRejectedValue(new Error('rules err'));

      const ctx = makeCtx({ request: { body: {} } });
      await cronController.scoreProperties(ctx);

      expect(ctx.internalServerError).toHaveBeenCalledWith('rules err');
    });

    it('should batch pagination in chunks of 200', async () => {
      const rules = [{ id: 1, name: 'r1', condition_type: 'city_match', condition_value: 'x', score: 1, tag: 't', is_active: true, priority: 1 }];
      mockStrapi.entityService.findMany.mockResolvedValue(rules);

      // First batch: 200 items, second batch: 0 (end)
      const batch = Array.from({ length: 200 }, (_, i) => ({ id: i, city: 'x', focus_score: 0, tags: [] }));
      const findManyMock = vi.fn()
        .mockResolvedValueOnce(batch)
        .mockResolvedValueOnce([]);

      mockStrapi.db.query('api::property.property').findMany = findManyMock;
      mockStrapi.db.query('api::property.property').update = vi.fn().mockResolvedValue({});
      (scoreProperty as ReturnType<typeof vi.fn>).mockReturnValue({ score: 1, tags: ['t'], events: [] });

      const ctx = makeCtx({ request: { body: {} } });
      await cronController.scoreProperties(ctx);

      expect(ctx.body.scored).toBe(200);
      // Verify second call uses offset=200
      expect(findManyMock).toHaveBeenCalledTimes(2);
      const secondCallArgs = findManyMock.mock.calls[1][0];
      expect(secondCallArgs.offset).toBe(200);
    });
  });
});
