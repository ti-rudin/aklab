1|import { describe, it, expect, vi, beforeEach } from 'vitest';
2|
3|// We need to mock the strapi global for scoreAllProperties
4|const mockQueryFindMany = vi.fn();
5|const mockQueryUpdate = vi.fn();
6|const mockStrapi = {
7|  log: { warn: vi.fn(), info: vi.fn() },
8|  entityService: {
9|    findMany: vi.fn(),
10|    create: vi.fn(),
11|  },
12|  db: {
13|    query: vi.fn().mockReturnValue({
14|      findMany: mockQueryFindMany,
15|      update: mockQueryUpdate,
16|    }),
17|  },
18|};
19|
20|// @ts-ignore
21|global.strapi = mockStrapi;
22|
23|import { scoreProperty, scoreAllProperties } from '../focusEngine';
24|
25|describe('scoreProperty', () => {
26|  const makeRule = (overrides: Partial<any> = {}): any => ({
27|    id: 1,
28|    name: 'test-rule',
29|    condition_type: 'city_match',
30|    condition_value: 'moscow',
31|    score: 10,
32|    tag: 'test_tag',
33|    is_active: true,
34|    priority: 1,
35|    ...overrides,
36|  });
37|
38|  it('should return zero score for property with no matching rules', () => {
39|    const property = { city: 'spb', deviation_percent: 0 };
40|    const rules = [makeRule({ condition_value: 'moscow' })];
41|
42|    const result = scoreProperty(property, rules);
43|
44|    expect(result.score).toBe(0);
45|    expect(result.tags).toEqual([]);
46|  });
47|
48|  it('should skip inactive rules', () => {
49|    const property = { city: 'moscow' };
50|    const rules = [makeRule({ is_active: false })];
51|
52|    const result = scoreProperty(property, rules);
53|
54|    expect(result.score).toBe(0);
55|    expect(result.tags).toEqual([]);
56|  });
57|
58|  // --- city_match ---
59|  describe('city_match rule', () => {
60|    it('should match when property city is in the rule list', () => {
61|      const property = { city: 'moscow' };
62|      const rules = [makeRule({ condition_type: 'city_match', condition_value: 'moscow,mo', score: 15, tag: 'moscow_mo' })];
63|
64|      const result = scoreProperty(property, rules);
65|
66|      expect(result.score).toBe(15);
67|      expect(result.tags).toContain('moscow_mo');
68|    });
69|
70|    it('should not match when property city is not in the rule list', () => {
71|      const property = { city: 'spb' };
72|      const rules = [makeRule({ condition_type: 'city_match', condition_value: 'moscow,mo' })];
73|
74|      const result = scoreProperty(property, rules);
75|
76|      expect(result.score).toBe(0);
77|      expect(result.tags).toEqual([]);
78|    });
79|  });
80|
81|  // --- has_field ---
82|  describe('has_field rule', () => {
83|    it('should match when field is present and non-empty', () => {
84|      const property = { minimum_price: 50000 };
85|      const rules = [makeRule({ condition_type: 'has_field', condition_value: 'minimum_price', score: 20, tag: 'has_minimum_price' })];
86|
87|      const result = scoreProperty(property, rules);
88|
89|      expect(result.score).toBe(20);
90|      expect(result.tags).toContain('has_minimum_price');
91|    });
92|
93|    it('should not match when field is null', () => {
94|      const property = { minimum_price: null };
95|      const rules = [makeRule({ condition_type: 'has_field', condition_value: 'minimum_price' })];
96|
97|      const result = scoreProperty(property, rules);
98|
99|      expect(result.score).toBe(0);
100|    });
101|
102|    it('should not match when field is 0', () => {
103|      const property = { minimum_price: 0 };
104|      const rules = [makeRule({ condition_type: 'has_field', condition_value: 'minimum_price' })];
105|
106|      const result = scoreProperty(property, rules);
107|
108|      expect(result.score).toBe(0);
109|    });
110|
111|    it('should not match when field is empty string', () => {
112|      const property = { title: '' };
113|      const rules = [makeRule({ condition_type: 'has_field', condition_value: 'title' })];
114|
115|      const result = scoreProperty(property, rules);
116|
117|      expect(result.score).toBe(0);
118|    });
119|
120|    it('should match first_seen_at when within last 24 hours', () => {
121|      const recentDate = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(); // 12 hours ago
122|      const property = { first_seen_at: recentDate };
123|      const rules = [makeRule({ condition_type: 'has_field', condition_value: 'first_seen_at', score: 10, tag: 'new' })];
124|
125|      const result = scoreProperty(property, rules);
126|
127|      expect(result.score).toBe(10);
128|      expect(result.tags).toContain('new');
129|    });
130|
131|    it('should not match first_seen_at when older than 24 hours', () => {
132|      const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(); // 48 hours ago
133|      const property = { first_seen_at: oldDate };
134|      const rules = [makeRule({ condition_type: 'has_field', condition_value: 'first_seen_at' })];
135|
136|      const result = scoreProperty(property, rules);
137|
138|      expect(result.score).toBe(0);
139|    });
140|  });
141|
142|  // --- deviation_threshold ---
143|  describe('deviation_threshold rule', () => {
144|    it('should match when deviation is below threshold', () => {
145|      const property = { deviation_percent: -30 };
146|      const rules = [makeRule({ condition_type: 'deviation_threshold', condition_value: '20', score: 40, tag: 'undervalued', priority: 1 })];
147|
148|      const result = scoreProperty(property, rules);
149|
150|      expect(result.score).toBe(40);
151|      expect(result.tags).toContain('undervalued');
152|    });
153|
154|    it('should not match when deviation is above threshold', () => {
155|      const property = { deviation_percent: -10 };
156|      const rules = [makeRule({ condition_type: 'deviation_threshold', condition_value: '20', score: 40, tag: 'undervalued' })];
157|
158|      const result = scoreProperty(property, rules);
159|
160|      expect(result.score).toBe(0);
161|      expect(result.tags).toEqual([]);
162|    });
163|
164|    it('should use only the highest priority deviation rule when multiple match', () => {
165|      const property = { deviation_percent: -50 };
166|      const rules = [
167|        makeRule({ id: 1, condition_type: 'deviation_threshold', condition_value: '20', score: 30, tag: 'undervalued_20', priority: 1 }),
168|        makeRule({ id: 2, condition_type: 'deviation_threshold', condition_value: '40', score: 50, tag: 'undervalued_40', priority: 2 }),
169|      ];
170|
171|      const result = scoreProperty(property, rules);
172|
173|      // Both match (deviation -50 <= -20 and -50 <= -40)
174|      // Should use the one with highest priority NUMBER (priority 2)
175|      expect(result.score).toBe(50);
176|      expect(result.tags).toContain('undervalued_40');
177|      expect(result.tags).not.toContain('undervalued_20');
178|    });
179|
180|    it('should handle missing deviation_percent gracefully', () => {
181|      const property = {};
182|      const rules = [makeRule({ condition_type: 'deviation_threshold', condition_value: '20' })];
183|
184|      const result = scoreProperty(property, rules);
185|
186|      expect(result.score).toBe(0);
187|    });
188|  });
189|
190|  // --- custom ---
191|  describe('custom rule', () => {
192|    it('should evaluate custom expression correctly', () => {
193|      const property = { area_sqm: 200, price: 1000000, city: 'moscow' };
194|      const rules = [makeRule({
195|        condition_type: 'custom',
196|        condition_value: 'area_sqm > 100',
197|        score: 25,
198|        tag: 'large_area',
199|      })];
200|
201|      const result = scoreProperty(property, rules);
202|
203|      expect(result.score).toBe(25);
204|      expect(result.tags).toContain('large_area');
205|    });
206|
207|    it('should skip invalid custom expressions gracefully', () => {
208|      const property = { area_sqm: 200 };
209|      const rules = [makeRule({
210|        condition_type: 'custom',
211|        condition_value: 'invalid_function()',
212|        score: 25,
213|        tag: 'broken',
214|      })];
215|
216|      const result = scoreProperty(property, rules);
217|
218|      expect(result.score).toBe(0);
219|      expect(result.tags).toEqual([]);
220|    });
221|  });
222|
223|  // --- multiple rules ---
224|  describe('multiple rules', () => {
225|    it('should accumulate scores from different rule types', () => {
226|      const property = {
227|        city: 'moscow',
228|        minimum_price: 100000,
229|        deviation_percent: -30,
230|      };
231|      const rules = [
232|        makeRule({ id: 1, condition_type: 'city_match', condition_value: 'moscow', score: 10, tag: 'moscow_mo', priority: 3 }),
233|        makeRule({ id: 2, condition_type: 'has_field', condition_value: 'minimum_price', score: 20, tag: 'has_minimum_price', priority: 2 }),
234|        makeRule({ id: 3, condition_type: 'deviation_threshold', condition_value: '20', score: 40, tag: 'undervalued', priority: 1 }),
235|      ];
236|
237|      const result = scoreProperty(property, rules);
238|
239|      expect(result.score).toBe(70); // 10 + 20 + 40
240|      expect(result.tags).toContain('moscow_mo');
241|      expect(result.tags).toContain('has_minimum_price');
242|      expect(result.tags).toContain('undervalued');
243|    });
244|
245|    it('should not duplicate tags', () => {
246|      const property = { city: 'moscow' };
247|      const rules = [
248|        makeRule({ id: 1, condition_type: 'city_match', condition_value: 'moscow', score: 10, tag: 'moscow_mo', priority: 1 }),
249|        makeRule({ id: 2, condition_type: 'city_match', condition_value: 'moscow', score: 10, tag: 'moscow_mo', priority: 2 }),
250|      ];
251|
252|      const result = scoreProperty(property, rules);
253|
254|      expect(result.score).toBe(20);
255|      expect(result.tags.filter((t: string) => t === 'moscow_mo')).toHaveLength(1);
256|    });
257|  });
258|
259|  // --- events ---
260|  describe('events', () => {
261|    it('should emit score_changed event when score differs', () => {
262|      const property = { city: 'moscow', focus_score: 0, tags: [] };
263|      const rules = [makeRule({ condition_type: 'city_match', condition_value: 'moscow', score: 10, tag: 'moscow_mo' })];
264|
265|      const result = scoreProperty(property, rules);
266|
267|      expect(result.events).toContainEqual({
268|        event_type: 'score_changed',
269|        old_value: '0',
270|        new_value: '10',
271|      });
272|    });
273|
274|    it('should not emit score_changed event when score is the same', () => {
275|      const property = { city: 'moscow', focus_score: 10, tags: ['moscow_mo'] };
276|      const rules = [makeRule({ condition_type: 'city_match', condition_value: 'moscow', score: 10, tag: 'moscow_mo' })];
277|
278|      const result = scoreProperty(property, rules);
279|
280|      const scoreEvents = result.events.filter((e: any) => e.event_type === 'score_changed');
281|      expect(scoreEvents).toHaveLength(0);
282|    });
283|
284|    it('should emit entered_focus event for new tags', () => {
285|      const property = { city: 'moscow', focus_score: 0, tags: [] };
286|      const rules = [makeRule({ condition_type: 'city_match', condition_value: 'moscow', score: 10, tag: 'moscow_mo' })];
287|
288|      const result = scoreProperty(property, rules);
289|
290|      expect(result.events).toContainEqual({
291|        event_type: 'entered_focus',
292|        new_value: 'moscow_mo',
293|      });
294|    });
295|
296|    it('should emit left_focus event for removed tags', () => {
297|      const property = { city: 'spb', focus_score: 10, tags: ['moscow_mo'] };
298|      const rules = [makeRule({ condition_type: 'city_match', condition_value: 'moscow', score: 10, tag: 'moscow_mo' })];
299|
300|      const result = scoreProperty(property, rules);
301|
302|      expect(result.events).toContainEqual({
303|        event_type: 'left_focus',
304|        old_value: 'moscow_mo',
305|      });
306|    });
307|
308|    it('should not emit events when nothing changed', () => {
309|      const property = { city: 'moscow', focus_score: 10, tags: ['moscow_mo'] };
310|      const rules = [makeRule({ condition_type: 'city_match', condition_value: 'moscow', score: 10, tag: 'moscow_mo' })];
311|
312|      const result = scoreProperty(property, rules);
313|
314|      expect(result.events).toHaveLength(0);
315|    });
316|  });
317|
318|  // --- edge cases ---
319|  describe('edge cases', () => {
320|    it('should handle empty rules array', () => {
321|      const property = { city: 'moscow' };
322|      const result = scoreProperty(property, []);
323|
324|      expect(result.score).toBe(0);
325|      expect(result.tags).toEqual([]);
326|      expect(result.events).toEqual([]);
327|    });
328|
329|    it('should handle property with no focus_score or tags', () => {
330|      const property = { city: 'moscow' };
331|      const rules = [makeRule({ condition_type: 'city_match', condition_value: 'moscow', score: 10, tag: 'moscow_mo' })];
332|
333|      const result = scoreProperty(property, rules);
334|
335|      expect(result.score).toBe(10);
336|      expect(result.tags).toContain('moscow_mo');
337|    });
338|
339|    it('should handle property with undefined city', () => {
340|      const property = {};
341|      const rules = [makeRule({ condition_type: 'city_match', condition_value: 'moscow' })];
342|
343|      const result = scoreProperty(property, rules);
344|
345|      expect(result.score).toBe(0);
346|    });
347|
348|    it('should handle rule with null condition_value for city_match', () => {
349|      const property = { city: 'moscow' };
350|      const rules = [makeRule({ condition_type: 'city_match', condition_value: null })];
351|
352|      const result = scoreProperty(property, rules);
353|
354|      expect(result.score).toBe(0);
355|    });
356|  });
357|});
358|
359|describe.skip('scoreAllProperties', () => {
360|  const makeRule = (overrides: Partial<any> = {}): any => ({
361|    id: 1,
362|    name: 'test-rule',
363|    condition_type: 'city_match',
364|    condition_value: 'moscow',
365|    score: 10,
366|    tag: 'moscow_mo',
367|    is_active: true,
368|    priority: 1,
369|    ...overrides,
370|  });
371|
372|  beforeEach(() => {
373|    vi.clearAllMocks();
374|    // Reset db.query to return fresh mocks
375|    mockStrapi.db.query.mockReturnValue({
376|      findMany: mockQueryFindMany,
377|      update: mockQueryUpdate,
378|    });
379|  });
380|
381|  it('should return zeros when no active rules exist', async () => {
382|    mockStrapi.entityService.findMany.mockResolvedValue([]);
383|
384|    const result = await scoreAllProperties();
385|
386|    expect(result).toEqual({ scored: 0, in_focus: 0, by_tag: {} });
387|    expect(mockStrapi.log.warn).toHaveBeenCalledWith(
388|      expect.stringContaining('No active focus rules'),
389|    );
390|  });
391|
392|  it('should return zeros when rules is null', async () => {
393|    mockStrapi.entityService.findMany.mockResolvedValue(null);
394|
395|    const result = await scoreAllProperties();
396|
397|    expect(result).toEqual({ scored: 0, in_focus: 0, by_tag: {} });
398|  });
399|
400|  it('should score all properties in a single batch', async () => {
401|    const rules = [makeRule()];
402|    mockStrapi.entityService.findMany.mockResolvedValue(rules);
403|
404|    const properties = [
405|      { id: 1, city: 'moscow', focus_score: 0, tags: [] },
406|      { id: 2, city: 'spb', focus_score: 0, tags: [] },
407|      { id: 3, city: 'moscow', focus_score: 0, tags: [] },
408|    ];
409|    mockQueryFindMany.mockResolvedValueOnce(properties);
410|    // Second call returns empty to end pagination
411|    mockQueryFindMany.mockResolvedValueOnce([]);
412|    mockQueryUpdate.mockResolvedValue({});
413|    mockStrapi.entityService.create.mockResolvedValue({});
414|
415|    const result = await scoreAllProperties();
416|
417|    expect(result.scored).toBe(3);
418|    // Properties with city='moscow' get score=10, with city='spb' get score=0
419|    expect(result.in_focus).toBe(2); // 2 moscow properties
420|    expect(result.by_tag).toEqual({ moscow_mo: 2 });
421|
422|    // Verify property updates were called
423|    expect(mockQueryUpdate).toHaveBeenCalledTimes(3);
424|    expect(mockQueryUpdate).toHaveBeenCalledWith({
425|      where: { id: 1 },
426|      data: { focus_score: 10, tags: ['moscow_mo'] },
427|    });
428|    expect(mockQueryUpdate).toHaveBeenCalledWith({
429|      where: { id: 2 },
430|      data: { focus_score: 0, tags: [] },
431|    });
432|  });
433|
434|  it('should handle batch pagination (multiple batches)', async () => {
435|    const rules = [makeRule()];
436|    mockStrapi.entityService.findMany.mockResolvedValue(rules);
437|
438|    // First batch: 200 properties (full batch)
439|    const batch1 = Array.from({ length: 200 }, (_, i) => ({
440|      id: i + 1,
441|      city: 'moscow',
442|      focus_score: 0,
443|      tags: [],
444|    }));
445|    // Second batch: 50 properties (partial batch → ends pagination)
446|    const batch2 = Array.from({ length: 50 }, (_, i) => ({
447|      id: 200 + i + 1,
448|      city: 'moscow',
449|      focus_score: 0,
450|      tags: [],
451|    }));
452|
453|    mockQueryFindMany.mockResolvedValueOnce(batch1);
454|    mockQueryFindMany.mockResolvedValueOnce(batch2);
455|    mockQueryUpdate.mockResolvedValue({});
456|    mockStrapi.entityService.create.mockResolvedValue({});
457|
458|    const result = await scoreAllProperties();
459|
460|    expect(result.scored).toBe(250);
461|    expect(result.in_focus).toBe(250);
462|    expect(result.by_tag).toEqual({ moscow_mo: 250 });
463|
464|    // Verify pagination: two findMany calls with correct offsets
465|    expect(mockQueryFindMany).toHaveBeenCalledTimes(2);
466|    expect(mockQueryFindMany).toHaveBeenNthCalledWith(1, expect.objectContaining({ offset: 0, limit: 200 }));
467|    expect(mockQueryFindMany).toHaveBeenNthCalledWith(2, expect.objectContaining({ offset: 200, limit: 200 }));
468|  });
469|
470|  it('should create property-event records for score changes', async () => {
471|    const rules = [makeRule({ score: 20, tag: 'high_value' })];
472|    mockStrapi.entityService.findMany.mockResolvedValue(rules);
473|
474|    const properties = [
475|      { id: 1, city: 'moscow', focus_score: 0, tags: [] }, // score will change from 0 to 20
476|    ];
477|    mockQueryFindMany.mockResolvedValueOnce(properties);
478|    mockQueryFindMany.mockResolvedValueOnce([]);
479|    mockQueryUpdate.mockResolvedValue({});
480|    mockStrapi.entityService.create.mockResolvedValue({});
481|
482|    await scoreAllProperties();
483|
484|    // Should create events: score_changed + entered_focus
485|    expect(mockStrapi.entityService.create).toHaveBeenCalledTimes(2);
486|    expect(mockStrapi.entityService.create).toHaveBeenCalledWith(
487|      'api::property-event.property-event',
488|      {
489|        data: {
490|          event_type: 'score_changed',
491|          old_value: '0',
492|          new_value: '20',
493|          property: 1,
494|        },
495|      },
496|    );
497|    expect(mockStrapi.entityService.create).toHaveBeenCalledWith(
498|      'api::property-event.property-event',
499|      {
500|        data: {
501|