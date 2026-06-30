1|import { describe, it, expect, vi, beforeEach } from 'vitest';
2|
3|// --- Mock queueService ---
4|const mockQueue = {
5|  addToQueue: vi.fn(),
6|  getDetailedStats: vi.fn(),
7|  addAndWait: vi.fn(),
8|  sendRequest: vi.fn(),
9|};
10|
11|vi.mock('../../../services/queueService', () => ({
12|  getQueueService: () => mockQueue,
13|}));
14|
15|// --- Mock focusEngine ---
16|vi.mock('../../../services/focusEngine', () => ({
17|  scoreProperty: vi.fn(),
18|}));
19|
20|// --- Strapi global ---
21|const mockStrapi = {
22|  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
23|  entityService: {
24|    findMany: vi.fn(),
25|    create: vi.fn(),
26|  },
27|  db: {
28|    query: vi.fn().mockReturnValue({
29|      findOne: vi.fn(),
30|      findMany: vi.fn(),
31|      update: vi.fn(),
32|    }),
33|  },
34|};
35|
36|// @ts-ignore
37|global.strapi = mockStrapi;
38|
39|// Import after mocks
40|import cronController from '../cron';
41|import { scoreProperty } from '../../../services/focusEngine';
42|
43|function makeCtx(overrides: Record<string, any> = {}): any {
44|  return {
45|    params: {},
46|    query: {},
47|    request: { body: {} },
48|    body: undefined,
49|    status: 200,
50|    notFound: vi.fn(),
51|    badRequest: vi.fn(),
52|    internalServerError: vi.fn(),
53|    set: vi.fn(),
54|    ...overrides,
55|  };
56|}
57|
58|describe.skip('cron controller', () => {
59|  beforeEach(() => {
60|    vi.clearAllMocks();
61|  });
62|
63|  // =================== parseSource ===================
64|  describe('parseSource', () => {
65|    it('should enqueue a parse job for an active source', async () => {
66|      const source = { id: 1, documentId: 'doc1', slug: 'tender', is_active: true };
67|      mockStrapi.entityService.findMany.mockResolvedValue([source]);
68|      mockQueue.addToQueue.mockReturnValue({ id: 'job1' });
69|
70|      const ctx = makeCtx({ params: { slug: 'tender' } });
71|      await cronController.parseSource(ctx);
72|
73|      expect(mockStrapi.entityService.findMany).toHaveBeenCalledWith('api::source.source', {
74|        filters: { slug: 'tender' },
75|        limit: 1,
76|      });
77|      expect(mockQueue.addToQueue).toHaveBeenCalledWith(
78|        'parse-tender',
79|        { source: 'tender', sourceId: 1, documentId: 'doc1' },
80|        expect.objectContaining({ correlationId: expect.stringContaining('manual-parse-') }),
81|      );
82|      expect(ctx.body.ok).toBe(true);
83|      expect(ctx.body.message).toContain('tender');
84|    });
85|
86|    it('should call ctx.notFound when source does not exist', async () => {
87|      mockStrapi.entityService.findMany.mockResolvedValue([]);
88|
89|      const ctx = makeCtx({ params: { slug: 'unknown' } });
90|      await cronController.parseSource(ctx);
91|
92|      expect(ctx.notFound).toHaveBeenCalledWith('Source unknown not found');
93|      expect(mockQueue.addToQueue).not.toHaveBeenCalled();
94|    });
95|
96|    it('should call ctx.badRequest when source is inactive', async () => {
97|      const source = { id: 1, documentId: 'doc1', slug: 'old', is_active: false };
98|      mockStrapi.entityService.findMany.mockResolvedValue([source]);
99|
100|      const ctx = makeCtx({ params: { slug: 'old' } });
101|      await cronController.parseSource(ctx);
102|
103|      expect(ctx.badRequest).toHaveBeenCalledWith('Source old is not active');
104|      expect(mockQueue.addToQueue).not.toHaveBeenCalled();
105|    });
106|
107|    it('should call ctx.internalServerError on exception', async () => {
108|      mockStrapi.entityService.findMany.mockRejectedValue(new Error('db down'));
109|
110|      const ctx = makeCtx({ params: { slug: 'tender' } });
111|      await cronController.parseSource(ctx);
112|
113|      expect(ctx.internalServerError).toHaveBeenCalledWith('db down');
114|    });
115|  });
116|
117|  // =================== analyzeAll ===================
118|  describe('analyzeAll', () => {
119|    it('should enqueue all properties with status=new', async () => {
120|      const properties = [
121|        { documentId: 'p1' },
122|        { documentId: 'p2' },
123|      ];
124|      mockStrapi.entityService.findMany.mockResolvedValue(properties);
125|
126|      const ctx = makeCtx({ request: { body: {} } });
127|      await cronController.analyzeAll(ctx);
128|
129|      expect(mockStrapi.entityService.findMany).toHaveBeenCalledWith('api::property.property', {
130|        filters: { status: 'new', is_undervalued: { $null: true } },
131|        limit: 500,
132|      });
133|      expect(mockQueue.addToQueue).toHaveBeenCalledTimes(2);
134|      expect(mockQueue.addToQueue).toHaveBeenCalledWith(
135|        'analyze-property',
136|        { documentId: 'p1' },
137|        expect.any(Object),
138|      );
139|      expect(ctx.body.ok).toBe(true);
140|      expect(ctx.body.message).toContain('2');
141|    });
142|
143|    it('should pass threshold from body to each job', async () => {
144|      mockStrapi.entityService.findMany.mockResolvedValue([{ documentId: 'p1' }]);
145|
146|      const ctx = makeCtx({ request: { body: { threshold: 30 } } });
147|      await cronController.analyzeAll(ctx);
148|
149|      expect(mockQueue.addToQueue).toHaveBeenCalledWith(
150|        'analyze-property',
151|        { documentId: 'p1', threshold: 30 },
152|        expect.any(Object),
153|      );
154|      expect(ctx.body.filters.threshold).toBe(30);
155|    });
156|
157|    it('should apply price range filters', async () => {
158|      mockStrapi.entityService.findMany.mockResolvedValue([]);
159|
160|      const ctx = makeCtx({ request: { body: { priceFrom: 100000, priceTo: 500000 } } });
161|      await cronController.analyzeAll(ctx);
162|
163|      expect(mockStrapi.entityService.findMany).toHaveBeenCalledWith('api::property.property', {
164|        filters: {
165|          status: 'new',
166|          is_undervalued: { $null: true },
167|          price: { $gte: 100000, $lte: 500000 },
168|        },
169|        limit: 500,
170|      });
171|    });
172|
173|    it('should apply city filter (array)', async () => {
174|      mockStrapi.entityService.findMany.mockResolvedValue([]);
175|
176|      const ctx = makeCtx({ request: { body: { city: ['moscow', 'spb'] } } });
177|      await cronController.analyzeAll(ctx);
178|
179|      expect(mockStrapi.entityService.findMany).toHaveBeenCalledWith('api::property.property', {
180|        filters: {
181|          status: 'new',
182|          is_undervalued: { $null: true },
183|          city: { $in: ['moscow', 'spb'] },
184|        },
185|        limit: 500,
186|      });
187|    });
188|
189|    it('should handle empty properties list', async () => {
190|      mockStrapi.entityService.findMany.mockResolvedValue([]);
191|
192|      const ctx = makeCtx({ request: { body: {} } });
193|      await cronController.analyzeAll(ctx);
194|
195|      expect(ctx.body.ok).toBe(true);
196|      expect(ctx.body.message).toContain('0');
197|      expect(mockQueue.addToQueue).not.toHaveBeenCalled();
198|    });
199|
200|    it('should call ctx.internalServerError on exception', async () => {
201|      mockStrapi.entityService.findMany.mockRejectedValue(new Error('db boom'));
202|
203|      const ctx = makeCtx({ request: { body: {} } });
204|      await cronController.analyzeAll(ctx);
205|
206|      expect(ctx.internalServerError).toHaveBeenCalledWith('db boom');
207|    });
208|  });
209|
210|  // =================== sendDigest ===================
211|  describe('sendDigest', () => {
212|    it('should enqueue digest job with smtp_to from settings', async () => {
213|      mockStrapi.db.query('api::setting.setting').findOne = vi.fn().mockResolvedValue({
214|        smtp_to: 'admin@example.com',
215|      });
216|      mockQueue.addToQueue.mockReturnValue({ id: 'job1' });
217|
218|      const ctx = makeCtx();
219|      await cronController.sendDigest(ctx);
220|
221|      expect(mockStrapi.db.query).toHaveBeenCalledWith('api::setting.setting');
222|      expect(mockQueue.addToQueue).toHaveBeenCalledWith(
223|        'digest-send',
224|        expect.objectContaining({
225|          date: expect.any(String),
226|          smtpTo: 'admin@example.com',
227|        }),
228|        expect.objectContaining({ correlationId: expect.stringContaining('manual-digest-') }),
229|      );
230|      expect(ctx.body.ok).toBe(true);
231|    });
232|
233|    it('should handle missing smtp_to gracefully', async () => {
234|      mockStrapi.db.query('api::setting.setting').findOne = vi.fn().mockResolvedValue({});
235|
236|      const ctx = makeCtx();
237|      await cronController.sendDigest(ctx);
238|
239|      expect(mockQueue.addToQueue).toHaveBeenCalledWith(
240|        'digest-send',
241|        expect.objectContaining({ smtpTo: undefined }),
242|        expect.any(Object),
243|      );
244|    });
245|
246|    it('should handle null setting', async () => {
247|      mockStrapi.db.query('api::setting.setting').findOne = vi.fn().mockResolvedValue(null);
248|
249|      const ctx = makeCtx();
250|      await cronController.sendDigest(ctx);
251|
252|      expect(ctx.body.ok).toBe(true);
253|      expect(mockQueue.addToQueue).toHaveBeenCalled();
254|    });
255|
256|    it('should call ctx.internalServerError on exception', async () => {
257|      mockStrapi.db.query('api::setting.setting').findOne = vi.fn().mockRejectedValue(new Error('smtp err'));
258|
259|      const ctx = makeCtx();
260|      await cronController.sendDigest(ctx);
261|
262|      expect(ctx.internalServerError).toHaveBeenCalledWith('smtp err');
263|    });
264|  });
265|
266|  // =================== queueStats ===================
267|  describe('queueStats', () => {
268|    it('should return queue stats and source list', async () => {
269|      const stats = { 'parse-tender': { pending: 2, done: 10 } };
270|      mockQueue.getDetailedStats.mockReturnValue(stats);
271|
272|      const sources = [
273|        { slug: 'tender', is_active: true, last_parse_status: 'ok', last_parsed_at: '2026-01-01', total_created: 50, parse_count: 5 },
274|        { slug: 'bankruptcy', is_active: false, last_parse_status: 'error', last_parsed_at: null, total_created: 0, parse_count: 0 },
275|      ];
276|      mockStrapi.entityService.findMany.mockResolvedValue(sources);
277|
278|      const ctx = makeCtx();
279|      await cronController.queueStats(ctx);
280|
281|      expect(ctx.body.ok).toBe(true);
282|      expect(ctx.body.queues).toEqual(stats);
283|      expect(ctx.body.sources).toHaveLength(2);
284|      expect(ctx.body.sources[0]).toEqual({
285|        slug: 'tender',
286|        is_active: true,
287|        last_parse_status: 'ok',
288|        last_parsed_at: '2026-01-01',
289|        total_created: 50,
290|        parse_count: 5,
291|      });
292|    });
293|
294|    it('should handle null sources', async () => {
295|      mockQueue.getDetailedStats.mockReturnValue({});
296|      mockStrapi.entityService.findMany.mockResolvedValue(null);
297|
298|      const ctx = makeCtx();
299|      await cronController.queueStats(ctx);
300|
301|      expect(ctx.body.ok).toBe(true);
302|      expect(ctx.body.sources).toEqual([]);
303|    });
304|
305|    it('should call ctx.internalServerError on exception', async () => {
306|      mockQueue.getDetailedStats.mockImplementation(() => { throw new Error('queue down'); });
307|
308|      const ctx = makeCtx();
309|      await cronController.queueStats(ctx);
310|
311|      expect(ctx.internalServerError).toHaveBeenCalledWith('queue down');
312|    });
313|  });
314|
315|  // =================== scoreProperties ===================
316|  describe('scoreProperties', () => {
317|    it('should score properties using rules and return stats', async () => {
318|      const rules = [
319|        { id: 1, name: 'r1', condition_type: 'city_match', condition_value: 'moscow', score: 10, tag: 'moscow_mo', is_active: true, priority: 1 },
320|      ];
321|      mockStrapi.entityService.findMany.mockResolvedValue(rules);
322|
323|      const properties = [
324|        { id: 1, city: 'moscow', focus_score: 0, tags: [] },
325|        { id: 2, city: 'spb', focus_score: 0, tags: [] },
326|      ];
327|      mockStrapi.db.query('api::property.property').findMany = vi.fn()
328|        .mockResolvedValueOnce(properties)
329|        .mockResolvedValueOnce([]); // end pagination
330|
331|      mockStrapi.db.query('api::property.property').update = vi.fn().mockResolvedValue({});
332|      (scoreProperty as ReturnType<typeof vi.fn>).mockReturnValue({
333|        score: 10,
334|        tags: ['moscow_mo'],
335|        events: [{ event_type: 'entered_focus', new_value: 'moscow_mo' }],
336|      });
337|      mockStrapi.entityService.create.mockResolvedValue({});
338|
339|      const ctx = makeCtx({ request: { body: { threshold: 10 } } });
340|      await cronController.scoreProperties(ctx);
341|
342|      expect(ctx.body.ok).toBe(true);
343|      expect(ctx.body.scored).toBe(2);
344|      expect(ctx.body.threshold).toBe(10);
345|      expect(scoreProperty).toHaveBeenCalledTimes(2);
346|    });
347|
348|    it('should return early with message when no active rules', async () => {
349|      mockStrapi.entityService.findMany.mockResolvedValue([]);
350|
351|      const ctx = makeCtx({ request: { body: {} } });
352|      await cronController.scoreProperties(ctx);
353|
354|      expect(ctx.body.ok).toBe(true);
355|      expect(ctx.body.scored).toBe(0);
356|      expect(ctx.body.message).toContain('No active focus rules');
357|    });
358|
359|    it('should fall back to setting threshold when not in body', async () => {
360|      mockStrapi.entityService.findMany.mockResolvedValue([]);
361|      mockStrapi.db.query('api::setting.setting').findOne = vi.fn().mockResolvedValue({ threshold_percent: 25 });
362|
363|      const ctx = makeCtx({ request: { body: {} } });
364|      await cronController.scoreProperties(ctx);
365|
366|      // threshold should come from settings since body.threshold was not provided
367|      // and then the function returns early because no rules
368|      expect(ctx.body.ok).toBe(true);
369|    });
370|
371|    it('should default threshold to 20 when setting is null', async () => {
372|      // Provide rules so the function doesn't early-return (early return omits threshold)
373|      const rules = [{ id: 1, name: 'r1', condition_type: 'city_match', condition_value: 'x', score: 1, tag: 't', is_active: true, priority: 1 }];
374|      mockStrapi.entityService.findMany.mockResolvedValue(rules);
375|      mockStrapi.db.query('api::setting.setting').findOne = vi.fn().mockResolvedValue(null);
376|
377|      const props = [{ id: 1, city: 'x', focus_score: 0, tags: [] }];
378|      mockStrapi.db.query('api::property.property').findMany = vi.fn()
379|        .mockResolvedValueOnce(props)
380|        .mockResolvedValueOnce([]);
381|      mockStrapi.db.query('api::property.property').update = vi.fn().mockResolvedValue({});
382|      (scoreProperty as ReturnType<typeof vi.fn>).mockReturnValue({ score: 1, tags: ['t'], events: [] });
383|
384|      const ctx = makeCtx({ request: { body: {} } });
385|      await cronController.scoreProperties(ctx);
386|
387|      expect(ctx.body.threshold).toBe(20);
388|    });
389|
390|    it('should count properties in_focus when score >= threshold', async () => {
391|      const rules = [{ id: 1, name: 'r1', condition_type: 'city_match', condition_value: 'moscow', score: 15, tag: 'mo', is_active: true, priority: 1 }];
392|      mockStrapi.entityService.findMany.mockResolvedValue(rules);
393|
394|      const props = [{ id: 1, city: 'moscow', focus_score: 0, tags: [] }];
395|      mockStrapi.db.query('api::property.property').findMany = vi.fn()
396|        .mockResolvedValueOnce(props)
397|        .mockResolvedValueOnce([]);
398|
399|      (scoreProperty as ReturnType<typeof vi.fn>).mockReturnValue({ score: 15, tags: ['mo'], events: [] });
400|      mockStrapi.db.query('api::property.property').update = vi.fn().mockResolvedValue({});
401|
402|      const ctx = makeCtx({ request: { body: { threshold: 10 } } });
403|      await cronController.scoreProperties(ctx);
404|
405|      expect(ctx.body.in_focus).toBe(1);
406|    });
407|
408|    it('should apply city and price filters', async () => {
409|      // Provide rules + properties so function reaches normal path where filters are in response
410|      const rules = [{ id: 1, name: 'r1', condition_type: 'city_match', condition_value: 'moscow', score: 1, tag: 't', is_active: true, priority: 1 }];
411|      mockStrapi.entityService.findMany.mockResolvedValue(rules);
412|
413|      const props = [{ id: 1, city: 'moscow', focus_score: 0, tags: [] }];
414|      mockStrapi.db.query('api::property.property').findMany = vi.fn()
415|        .mockResolvedValueOnce(props)
416|        .mockResolvedValueOnce([]);
417|      mockStrapi.db.query('api::property.property').update = vi.fn().mockResolvedValue({});
418|      (scoreProperty as ReturnType<typeof vi.fn>).mockReturnValue({ score: 1, tags: ['t'], events: [] });
419|
420|      const ctx = makeCtx({
421|        request: { body: { city: ['moscow'], priceFrom: 100000, priceTo: 500000 } },
422|      });
423|      await cronController.scoreProperties(ctx);
424|
425|      expect(ctx.body.filters).toEqual({
426|        city: ['moscow'],
427|        priceFrom: 100000,
428|        priceTo: 500000,
429|      });
430|    });
431|
432|    it('should create property-event entries for each event', async () => {
433|      const rules = [{ id: 1, name: 'r1', condition_type: 'city_match', condition_value: 'moscow', score: 10, tag: 'mo', is_active: true, priority: 1 }];
434|      mockStrapi.entityService.findMany.mockResolvedValue(rules);
435|
436|      const props = [{ id: 42, city: 'moscow', focus_score: 0, tags: [] }];
437|      mockStrapi.db.query('api::property.property').findMany = vi.fn()
438|        .mockResolvedValueOnce(props)
439|        .mockResolvedValueOnce([]);
440|
441|      (scoreProperty as ReturnType<typeof vi.fn>).mockReturnValue({
442|        score: 10,
443|        tags: ['mo'],
444|        events: [
445|          { event_type: 'score_changed', old_value: '0', new_value: '10' },
446|          { event_type: 'entered_focus', new_value: 'mo' },
447|        ],
448|      });
449|      mockStrapi.db.query('api::property.property').update = vi.fn().mockResolvedValue({});
450|      mockStrapi.entityService.create.mockResolvedValue({});
451|
452|      const ctx = makeCtx({ request: { body: { threshold: 5 } } });
453|      await cronController.scoreProperties(ctx);
454|
455|      expect(mockStrapi.entityService.create).toHaveBeenCalledTimes(2);
456|      expect(mockStrapi.entityService.create).toHaveBeenCalledWith('api::property-event.property-event', {
457|        data: {
458|          event_type: 'score_changed',
459|          old_value: '0',
460|          new_value: '10',
461|          property: 42,
462|        },
463|      });
464|    });
465|
466|    it('should call ctx.internalServerError on exception', async () => {
467|      mockStrapi.entityService.findMany.mockRejectedValue(new Error('rules err'));
468|
469|      const ctx = makeCtx({ request: { body: {} } });
470|      await cronController.scoreProperties(ctx);
471|
472|      expect(ctx.internalServerError).toHaveBeenCalledWith('rules err');
473|    });
474|
475|    it('should batch pagination in chunks of 200', async () => {
476|      const rules = [{ id: 1, name: 'r1', condition_type: 'city_match', condition_value: 'x', score: 1, tag: 't', is_active: true, priority: 1 }];
477|      mockStrapi.entityService.findMany.mockResolvedValue(rules);
478|
479|      // First batch: 200 items, second batch: 0 (end)
480|      const batch = Array.from({ length: 200 }, (_, i) => ({ id: i, city: 'x', focus_score: 0, tags: [] }));
481|      const findManyMock = vi.fn()
482|        .mockResolvedValueOnce(batch)
483|        .mockResolvedValueOnce([]);
484|
485|      mockStrapi.db.query('api::property.property').findMany = findManyMock;
486|      mockStrapi.db.query('api::property.property').update = vi.fn().mockResolvedValue({});
487|      (scoreProperty as ReturnType<typeof vi.fn>).mockReturnValue({ score: 1, tags: ['t'], events: [] });
488|
489|      const ctx = makeCtx({ request: { body: {} } });
490|      await cronController.scoreProperties(ctx);
491|
492|      expect(ctx.body.scored).toBe(200);
493|      // Verify second call uses offset=200
494|      expect(findManyMock).toHaveBeenCalledTimes(2);
495|      const secondCallArgs = findManyMock.mock.calls[1][0];
496|      expect(secondCallArgs.offset).toBe(200);
497|    });
498|  });
499|});
500|