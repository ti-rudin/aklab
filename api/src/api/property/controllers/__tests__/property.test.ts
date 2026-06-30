1|import { describe, it, expect, vi, beforeEach } from 'vitest';
2|
3|// --- Mock fs/promises ---
4|vi.mock('fs/promises', () => ({
5|  access: vi.fn(),
6|  readFile: vi.fn(),
7|}));
8|
9|// --- Capture the factory callback so tests can call custom actions directly ---
10|let capturedFactoryFn: ((context: { strapi: any }) => Record<string, any>) | null = null;
11|
12|vi.mock('@strapi/strapi', () => ({
13|  factories: {
14|    createCoreController: vi.fn((_uid: string, factoryFn: any) => {
15|      capturedFactoryFn = factoryFn;
16|      return { __uid: _uid };
17|    }),
18|  },
19|}));
20|
21|// Import after mocks (vitest hoists vi.mock)
22|import * as fs from 'fs/promises';
23|import '../property'; // triggers createCoreController → capturedFactoryFn
24|
25|// Build a mock strapi instance (fresh per test)
26|function makeStrapi() {
27|  return {
28|    db: {
29|      query: vi.fn().mockReturnValue({
30|        deleteMany: vi.fn(),
31|      }),
32|      connection: {
33|        raw: vi.fn(),
34|      },
35|    },
36|    entityService: {
37|      findMany: vi.fn(),
38|    },
39|  };
40|}
41|
42|// Build a minimal koa ctx
43|function makeCtx(overrides: Record<string, any> = {}): any {
44|  const headers: Record<string, string> = {};
45|  return {
46|    params: {},
47|    query: {},
48|    request: { body: {} },
49|    body: undefined,
50|    status: 200,
51|    set: vi.fn((key: string, val: string) => { headers[key] = val; }),
52|    _headers: headers,
53|    ...overrides,
54|  };
55|}
56|
57|describe.skip('property controller', () => {
58|  let strapi: ReturnType<typeof makeStrapi>;
59|  let actions: Record<string, (ctx: any) => Promise<void>>;
60|
61|  beforeEach(() => {
62|    strapi = makeStrapi();
63|    // Build actions from the captured factory with a fresh strapi each test
64|    expect(capturedFactoryFn).not.toBeNull();
65|    actions = capturedFactoryFn!({ strapi });
66|    vi.clearAllMocks();
67|  });
68|
69|  // =================== clearNew ===================
70|  describe('clearNew', () => {
71|    it('should return deleted count', async () => {
72|      strapi.db.query('api::property.property').deleteMany = vi.fn().mockResolvedValue({ count: 5 });
73|      const ctx = makeCtx();
74|
75|      await actions.clearNew(ctx);
76|
77|      expect(strapi.db.query).toHaveBeenCalledWith('api::property.property');
78|      expect(ctx.body).toEqual({ deleted: 5 });
79|    });
80|
81|    it('should return 0 when nothing deleted', async () => {
82|      strapi.db.query('api::property.property').deleteMany = vi.fn().mockResolvedValue({ count: 0 });
83|      const ctx = makeCtx();
84|
85|      await actions.clearNew(ctx);
86|
87|      expect(ctx.body).toEqual({ deleted: 0 });
88|    });
89|
90|    it('should pass status=new filter', async () => {
91|      const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
92|      strapi.db.query('api::property.property').deleteMany = deleteMany;
93|      const ctx = makeCtx();
94|
95|      await actions.clearNew(ctx);
96|
97|      expect(deleteMany).toHaveBeenCalledWith({ where: { status: 'new' } });
98|    });
99|  });
100|
101|  // =================== servePhoto ===================
102|  describe('servePhoto', () => {
103|    it('should serve file with correct content-type for jpg', async () => {
104|      const fileBuffer = Buffer.from('fake-jpg');
105|      (fs.access as any).mockResolvedValue(undefined);
106|      (fs.readFile as any).mockResolvedValue(fileBuffer);
107|
108|      const ctx = makeCtx({ params: { documentId: 'doc123', filename: 'photo.jpg' } });
109|      await actions.servePhoto(ctx);
110|
111|      expect(fs.access).toHaveBeenCalled();
112|      expect(fs.readFile).toHaveBeenCalled();
113|      expect(ctx.body).toBe(fileBuffer);
114|      expect(ctx.set).toHaveBeenCalledWith('Content-Type', 'image/jpeg');
115|      expect(ctx.set).toHaveBeenCalledWith('Cache-Control', 'public, max-age=86400');
116|    });
117|
118|    it('should set image/png for .png extension', async () => {
119|      (fs.access as any).mockResolvedValue(undefined);
120|      (fs.readFile as any).mockResolvedValue(Buffer.from('png'));
121|
122|      const ctx = makeCtx({ params: { documentId: 'doc1', filename: 'img.png' } });
123|      await actions.servePhoto(ctx);
124|
125|      expect(ctx.set).toHaveBeenCalledWith('Content-Type', 'image/png');
126|    });
127|
128|    it('should set image/webp for .webp extension', async () => {
129|      (fs.access as any).mockResolvedValue(undefined);
130|      (fs.readFile as any).mockResolvedValue(Buffer.from('webp'));
131|
132|      const ctx = makeCtx({ params: { documentId: 'doc1', filename: 'img.webp' } });
133|      await actions.servePhoto(ctx);
134|
135|      expect(ctx.set).toHaveBeenCalledWith('Content-Type', 'image/webp');
136|    });
137|
138|    it('should default to image/jpeg for unknown extension', async () => {
139|      (fs.access as any).mockResolvedValue(undefined);
140|      (fs.readFile as any).mockResolvedValue(Buffer.from('data'));
141|
142|      const ctx = makeCtx({ params: { documentId: 'doc1', filename: 'img.bmp' } });
143|      await actions.servePhoto(ctx);
144|
145|      expect(ctx.set).toHaveBeenCalledWith('Content-Type', 'image/jpeg');
146|    });
147|
148|    it('should return 404 when file not found', async () => {
149|      (fs.access as any).mockRejectedValue(new Error('ENOENT'));
150|
151|      const ctx = makeCtx({ params: { documentId: 'doc1', filename: 'missing.jpg' } });
152|      await actions.servePhoto(ctx);
153|
154|      expect(ctx.status).toBe(404);
155|      expect(ctx.body).toEqual({ error: 'Photo not found' });
156|    });
157|
158|    it('should block path traversal in filename (../)', async () => {
159|      (fs.access as any).mockResolvedValue(undefined);
160|      (fs.readFile as any).mockResolvedValue(Buffer.from('data'));
161|
162|      const ctx = makeCtx({ params: { documentId: 'doc1', filename: '../../etc/passwd' } });
163|      await actions.servePhoto(ctx);
164|
165|      // path.basename strips traversal — the file path should be safe
166|      const accessPath = (fs.access as any).mock.calls[0]?.[0] as string;
167|      expect(accessPath).not.toContain('../');
168|      expect(accessPath).toContain('data/photos/doc1/passwd');
169|    });
170|
171|    it('should block path traversal in documentId (../)', async () => {
172|      (fs.access as any).mockResolvedValue(undefined);
173|      (fs.readFile as any).mockResolvedValue(Buffer.from('data'));
174|
175|      const ctx = makeCtx({ params: { documentId: '../secret', filename: 'photo.jpg' } });
176|      await actions.servePhoto(ctx);
177|
178|      const accessPath = (fs.access as any).mock.calls[0]?.[0] as string;
179|      expect(accessPath).not.toContain('../secret');
180|      expect(accessPath).toContain('data/photos/secret/photo.jpg');
181|    });
182|  });
183|
184|  // =================== getFocus ===================
185|  describe('getFocus', () => {
186|    // Helper: set up raw to return count first, then data rows
187|    function setupRaw(total: number, rows: any[]) {
188|      const raw = strapi.db.connection.raw as ReturnType<typeof vi.fn>;
189|      raw
190|        .mockResolvedValueOnce({ rows: [{ total: String(total) }] }) // COUNT query
191|        .mockResolvedValueOnce({ rows }); // data query
192|    }
193|
194|    it('should return data with meta using default threshold 20', async () => {
195|      setupRaw(1, [{ id: 1, document_id: 'd1', title: 'Test', tags: '["tag1"]' }]);
196|
197|      const ctx = makeCtx({ query: {} });
198|      await actions.getFocus(ctx);
199|
200|      expect(ctx.body.meta.threshold).toBe(20);
201|      expect(ctx.body.meta.page).toBe(1);
202|      expect(ctx.body.meta.pageSize).toBe(20);
203|      expect(ctx.body.data).toHaveLength(1);
204|      expect(ctx.body.data[0].tags).toEqual(['tag1']); // JSON parsed
205|    });
206|
207|    it('should use custom threshold', async () => {
208|      setupRaw(0, []);
209|
210|      const ctx = makeCtx({ query: { threshold: '50' } });
211|      await actions.getFocus(ctx);
212|
213|      expect(ctx.body.meta.threshold).toBe(50);
214|      // The first raw call should include threshold in params
215|      const firstRawCall = (strapi.db.connection.raw as ReturnType<typeof vi.fn>).mock.calls[0];
216|      expect(firstRawCall[1]).toContain(50);
217|    });
218|
219|    it('should build single city = ? condition', async () => {
220|      setupRaw(0, []);
221|
222|      const ctx = makeCtx({ query: { city: 'moscow' } });
223|      await actions.getFocus(ctx);
224|
225|      const firstRawCall = (strapi.db.connection.raw as ReturnType<typeof vi.fn>).mock.calls[0];
226|      const sql = firstRawCall[0] as string;
227|      expect(sql).toContain('city = ?');
228|      expect(firstRawCall[1]).toContain('moscow');
229|    });
230|
231|    it('should build IN clause for comma-separated cities', async () => {
232|      setupRaw(0, []);
233|
234|      const ctx = makeCtx({ query: { city: 'moscow,spb,kazan' } });
235|      await actions.getFocus(ctx);
236|
237|      const firstRawCall = (strapi.db.connection.raw as ReturnType<typeof vi.fn>).mock.calls[0];
238|      const sql = firstRawCall[0] as string;
239|      expect(sql).toContain('city IN (?,?,?)');
240|      expect(firstRawCall[1]).toEqual(expect.arrayContaining(['moscow', 'spb', 'kazan']));
241|    });
242|
243|    it('should add property_type condition', async () => {
244|      setupRaw(0, []);
245|
246|      const ctx = makeCtx({ query: { property_type: 'apartment' } });
247|      await actions.getFocus(ctx);
248|
249|      const firstRawCall = (strapi.db.connection.raw as ReturnType<typeof vi.fn>).mock.calls[0];
250|      const sql = firstRawCall[0] as string;
251|      expect(sql).toContain('property_type = ?');
252|      expect(firstRawCall[1]).toContain('apartment');
253|    });
254|
255|    it('should build LIKE conditions for tags', async () => {
256|      setupRaw(0, []);
257|
258|      const ctx = makeCtx({ query: { tags: 'undervalued,new' } });
259|      await actions.getFocus(ctx);
260|
261|      const firstRawCall = (strapi.db.connection.raw as ReturnType<typeof vi.fn>).mock.calls[0];
262|      const sql = firstRawCall[0] as string;
263|      // Should have two LIKE conditions
264|      const likeMatches = sql.match(/tags LIKE \?/g);
265|      expect(likeMatches).toHaveLength(2);
266|      // Params should include wrapped tag strings
267|      expect(firstRawCall[1]).toEqual(expect.arrayContaining(['%"undervalued"%', '%"new"%']));
268|    });
269|
270|    it('should use default sort -focus_score → DESC focus_score', async () => {
271|      setupRaw(0, []);
272|
273|      const ctx = makeCtx({ query: {} });
274|      await actions.getFocus(ctx);
275|
276|      const dataRawCall = (strapi.db.connection.raw as ReturnType<typeof vi.fn>).mock.calls[1];
277|      const sql = dataRawCall[0] as string;
278|      expect(sql).toContain('ORDER BY focus_score DESC');
279|    });
280|
281|    it('should handle ascending sort (no - prefix)', async () => {
282|      setupRaw(0, []);
283|
284|      const ctx = makeCtx({ query: { sort: 'price_per_sqm' } });
285|      await actions.getFocus(ctx);
286|
287|      const dataRawCall = (strapi.db.connection.raw as ReturnType<typeof vi.fn>).mock.calls[1];
288|      const sql = dataRawCall[0] as string;
289|      expect(sql).toContain('ORDER BY price_per_sqm ASC');
290|    });
291|
292|    it('should handle descending sort (with - prefix)', async () => {
293|      setupRaw(0, []);
294|
295|      const ctx = makeCtx({ query: { sort: '-area_sqm' } });
296|      await actions.getFocus(ctx);
297|
298|      const dataRawCall = (strapi.db.connection.raw as ReturnType<typeof vi.fn>).mock.calls[1];
299|      const sql = dataRawCall[0] as string;
300|      expect(sql).toContain('ORDER BY area_sqm DESC');
301|    });
302|
303|    it('should ignore disallowed sort fields and use default', async () => {
304|      setupRaw(0, []);
305|
306|      const ctx = makeCtx({ query: { sort: 'hacker_field' } });
307|      await actions.getFocus(ctx);
308|
309|      const dataRawCall = (strapi.db.connection.raw as ReturnType<typeof vi.fn>).mock.calls[1];
310|      const sql = dataRawCall[0] as string;
311|      expect(sql).toContain('ORDER BY focus_score');
312|      expect(sql).not.toContain('hacker_field');
313|    });
314|
315|    it('should map createdAt to created_at column', async () => {
316|      setupRaw(0, []);
317|
318|      const ctx = makeCtx({ query: { sort: '-createdAt' } });
319|      await actions.getFocus(ctx);
320|
321|      const dataRawCall = (strapi.db.connection.raw as ReturnType<typeof vi.fn>).mock.calls[1];
322|      const sql = dataRawCall[0] as string;
323|      expect(sql).toContain('ORDER BY created_at DESC');
324|    });
325|
326|    it('should apply pagination with LIMIT and OFFSET', async () => {
327|      setupRaw(50, []);
328|
329|      const ctx = makeCtx({ query: { page: '3', pageSize: '10' } });
330|      await actions.getFocus(ctx);
331|
332|      const dataRawCall = (strapi.db.connection.raw as ReturnType<typeof vi.fn>).mock.calls[1];
333|      // params should be [...filterParams, pageSize, offset]
334|      const params = dataRawCall[1] as any[];
335|      // Last two are pageSize, offset
336|      expect(params[params.length - 2]).toBe(10); // pageSize
337|      expect(params[params.length - 1]).toBe(20); // (3-1)*10 = 20
338|    });
339|
340|    it('should compute totalPages correctly', async () => {
341|      setupRaw(25, []);
342|
343|      const ctx = makeCtx({ query: { pageSize: '10' } });
344|      await actions.getFocus(ctx);
345|
346|      expect(ctx.body.meta.totalPages).toBe(3); // ceil(25/10)
347|    });
348|
349|    it('should clamp pageSize to max 100', async () => {
350|      setupRaw(0, []);
351|
352|      const ctx = makeCtx({ query: { pageSize: '500' } });
353|      await actions.getFocus(ctx);
354|
355|      expect(ctx.body.meta.pageSize).toBe(100);
356|    });
357|
358|    it('should clamp pageSize to min 1', async () => {
359|      setupRaw(0, []);
360|
361|      const ctx = makeCtx({ query: { pageSize: '-5' } });
362|      await actions.getFocus(ctx);
363|
364|      expect(ctx.body.meta.pageSize).toBe(1);
365|    });
366|
367|    it('should clamp page to min 1', async () => {
368|      setupRaw(0, []);
369|
370|      const ctx = makeCtx({ query: { page: '-3' } });
371|      await actions.getFocus(ctx);
372|
373|      expect(ctx.body.meta.page).toBe(1);
374|    });
375|
376|    it('should handle non-numeric threshold gracefully (defaults to 20)', async () => {
377|      setupRaw(0, []);
378|
379|      const ctx = makeCtx({ query: { threshold: 'abc' } });
380|      await actions.getFocus(ctx);
381|
382|      expect(ctx.body.meta.threshold).toBe(20); // Number('abc') || 20
383|    });
384|
385|    it('should handle total from rows[0].total (non-string)', async () => {
386|      // Some DB drivers return the total as a number
387|      const raw = strapi.db.connection.raw as ReturnType<typeof vi.fn>;
388|      raw
389|        .mockResolvedValueOnce({ rows: [{ total: 42 }] })
390|        .mockResolvedValueOnce({ rows: [] });
391|
392|      const ctx = makeCtx({ query: {} });
393|      await actions.getFocus(ctx);
394|
395|      expect(ctx.body.meta.total).toBe(42);
396|    });
397|
398|    it('should handle total from flat array (no .rows wrapper)', async () => {
399|      const raw = strapi.db.connection.raw as ReturnType<typeof vi.fn>;
400|      // Some drivers return [{total: ...}] directly
401|      raw
402|        .mockResolvedValueOnce([{ total: '7' }])  // count
403|        .mockResolvedValueOnce([]);                  // data
404|
405|      const ctx = makeCtx({ query: {} });
406|      await actions.getFocus(ctx);
407|
408|      expect(ctx.body.meta.total).toBe(7);
409|    });
410|
411|    it('should pass back filters in meta', async () => {
412|      setupRaw(0, []);
413|
414|      const ctx = makeCtx({ query: { city: 'moscow', property_type: 'apartment', tags: 'new', sort: '-price_per_sqm' } });
415|      await actions.getFocus(ctx);
416|
417|      expect(ctx.body.meta.filters).toEqual({
418|        city: 'moscow',
419|        property_type: 'apartment',
420|        tags: 'new',
421|        sort: '-price_per_sqm',
422|      });
423|    });
424|  });
425|});
426|