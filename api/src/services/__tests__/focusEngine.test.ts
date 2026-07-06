import { describe, it, expect, vi, beforeEach } from 'vitest';

// We need to mock the strapi global for scoreAllProperties
const mockQueryFindMany = vi.fn();
const mockQueryUpdate = vi.fn();
const mockConnectionRaw = vi.fn().mockResolvedValue([]);
const mockTransaction = vi.fn().mockImplementation(async (cb: any) => cb({}));
const mockStrapi = {
  log: { warn: vi.fn(), info: vi.fn() },
  entityService: {
    findMany: vi.fn(),
    create: vi.fn(),
  },
  db: {
    query: vi.fn().mockReturnValue({
      findMany: mockQueryFindMany,
      update: mockQueryUpdate,
    }),
    transaction: mockTransaction,
    connection: {
      raw: mockConnectionRaw,
    },
  },
};

// @ts-ignore
global.strapi = mockStrapi;

import { scoreProperty, scoreAllProperties } from '../focusEngine';

describe('scoreProperty', () => {
  const makeRule = (overrides: Partial<any> = {}): any => ({
    id: 1,
    name: 'test-rule',
    condition_type: 'city_match',
    condition_value: 'moscow',
    score: 10,
    tag: 'test_tag',
    is_active: true,
    priority: 1,
    ...overrides,
  });

  it('should return zero score for property with no matching rules', () => {
    const property = { city: 'spb', deviation_percent: 0 };
    const rules = [makeRule({ condition_value: 'moscow' })];

    const result = scoreProperty(property, rules);

    expect(result.score).toBe(0);
    expect(result.tags).toEqual([]);
  });

  it('should skip inactive rules', () => {
    const property = { city: 'moscow' };
    const rules = [makeRule({ is_active: false })];

    const result = scoreProperty(property, rules);

    expect(result.score).toBe(0);
    expect(result.tags).toEqual([]);
  });

  // --- city_match ---
  describe('city_match rule', () => {
    it('should match when property city is in the rule list', () => {
      const property = { city: 'moscow' };
      const rules = [makeRule({ condition_type: 'city_match', condition_value: 'moscow,mo', score: 15, tag: 'moscow_mo' })];

      const result = scoreProperty(property, rules);

      expect(result.score).toBe(15);
      expect(result.tags).toContain('moscow_mo');
    });

    it('should not match when property city is not in the rule list', () => {
      const property = { city: 'spb' };
      const rules = [makeRule({ condition_type: 'city_match', condition_value: 'moscow,mo' })];

      const result = scoreProperty(property, rules);

      expect(result.score).toBe(0);
      expect(result.tags).toEqual([]);
    });
  });

  // --- has_field ---
  describe('has_field rule', () => {
    it('should match when field is present and non-empty', () => {
      const property = { minimum_price: 50000 };
      const rules = [makeRule({ condition_type: 'has_field', condition_value: 'minimum_price', score: 20, tag: 'has_minimum_price' })];

      const result = scoreProperty(property, rules);

      expect(result.score).toBe(20);
      expect(result.tags).toContain('has_minimum_price');
    });

    it('should not match when field is null', () => {
      const property = { minimum_price: null };
      const rules = [makeRule({ condition_type: 'has_field', condition_value: 'minimum_price' })];

      const result = scoreProperty(property, rules);

      expect(result.score).toBe(0);
    });

    it('should not match when field is 0', () => {
      const property = { minimum_price: 0 };
      const rules = [makeRule({ condition_type: 'has_field', condition_value: 'minimum_price' })];

      const result = scoreProperty(property, rules);

      expect(result.score).toBe(0);
    });

    it('should not match when field is empty string', () => {
      const property = { title: '' };
      const rules = [makeRule({ condition_type: 'has_field', condition_value: 'title' })];

      const result = scoreProperty(property, rules);

      expect(result.score).toBe(0);
    });

    it('should match first_seen_at when within last 24 hours', () => {
      const recentDate = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(); // 12 hours ago
      const property = { first_seen_at: recentDate };
      const rules = [makeRule({ condition_type: 'has_field', condition_value: 'first_seen_at', score: 10, tag: 'new' })];

      const result = scoreProperty(property, rules);

      expect(result.score).toBe(10);
      expect(result.tags).toContain('new');
    });

    it('should not match first_seen_at when older than 24 hours', () => {
      const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(); // 48 hours ago
      const property = { first_seen_at: oldDate };
      const rules = [makeRule({ condition_type: 'has_field', condition_value: 'first_seen_at' })];

      const result = scoreProperty(property, rules);

      expect(result.score).toBe(0);
    });
  });

  // --- deviation_threshold ---
  describe('deviation_threshold rule', () => {
    it('should match when deviation is below threshold', () => {
      const property = { deviation_percent: 30 };
      const rules = [makeRule({ condition_type: 'deviation_threshold', condition_value: '20', score: 40, tag: 'undervalued', priority: 1 })];

      const result = scoreProperty(property, rules);

      expect(result.score).toBe(40);
      expect(result.tags).toContain('undervalued');
    });

    it('should not match when deviation is above threshold', () => {
      const property = { deviation_percent: 10 };
      const rules = [makeRule({ condition_type: 'deviation_threshold', condition_value: '20', score: 40, tag: 'undervalued' })];

      const result = scoreProperty(property, rules);

      expect(result.score).toBe(0);
      expect(result.tags).toEqual([]);
    });

    it('should use only the highest priority deviation rule when multiple match', () => {
      const property = { deviation_percent: 50 };
      const rules = [
        makeRule({ id: 1, condition_type: 'deviation_threshold', condition_value: '20', score: 30, tag: 'undervalued_20', priority: 1 }),
        makeRule({ id: 2, condition_type: 'deviation_threshold', condition_value: '40', score: 50, tag: 'undervalued_40', priority: 2 }),
      ];

      const result = scoreProperty(property, rules);

      // Both match (deviation 50 >= 20 and 50 >= 40)
      // Should use the one with highest priority NUMBER (priority 2)
      expect(result.score).toBe(50);
      expect(result.tags).toContain('undervalued_40');
      expect(result.tags).not.toContain('undervalued_20');
    });

    it('should handle missing deviation_percent gracefully', () => {
      const property = {};
      const rules = [makeRule({ condition_type: 'deviation_threshold', condition_value: '20' })];

      const result = scoreProperty(property, rules);

      expect(result.score).toBe(0);
    });
  });

  // --- custom ---
  describe('custom rule', () => {
    it('should evaluate custom expression correctly', () => {
      const property = { area_sqm: 200, price: 1000000, city: 'moscow' };
      const rules = [makeRule({
        condition_type: 'custom',
        condition_value: 'area_sqm > 100',
        score: 25,
        tag: 'large_area',
      })];

      const result = scoreProperty(property, rules);

      expect(result.score).toBe(25);
      expect(result.tags).toContain('large_area');
    });

    it('should skip invalid custom expressions gracefully', () => {
      const property = { area_sqm: 200 };
      const rules = [makeRule({
        condition_type: 'custom',
        condition_value: 'invalid_function()',
        score: 25,
        tag: 'broken',
      })];

      const result = scoreProperty(property, rules);

      expect(result.score).toBe(0);
      expect(result.tags).toEqual([]);
    });
  });

  // --- multiple rules ---
  describe('multiple rules', () => {
    it('should accumulate scores from different rule types', () => {
      const property = {
        city: 'moscow',
        minimum_price: 100000,
        deviation_percent: 30,
      };
      const rules = [
        makeRule({ id: 1, condition_type: 'city_match', condition_value: 'moscow', score: 10, tag: 'moscow_mo', priority: 3 }),
        makeRule({ id: 2, condition_type: 'has_field', condition_value: 'minimum_price', score: 20, tag: 'has_minimum_price', priority: 2 }),
        makeRule({ id: 3, condition_type: 'deviation_threshold', condition_value: '20', score: 40, tag: 'undervalued', priority: 1 }),
      ];

      const result = scoreProperty(property, rules);

      expect(result.score).toBe(70); // 10 + 20 + 40
      expect(result.tags).toContain('moscow_mo');
      expect(result.tags).toContain('has_minimum_price');
      expect(result.tags).toContain('undervalued');
    });

    it('should not duplicate tags', () => {
      const property = { city: 'moscow' };
      const rules = [
        makeRule({ id: 1, condition_type: 'city_match', condition_value: 'moscow', score: 10, tag: 'moscow_mo', priority: 1 }),
        makeRule({ id: 2, condition_type: 'city_match', condition_value: 'moscow', score: 10, tag: 'moscow_mo', priority: 2 }),
      ];

      const result = scoreProperty(property, rules);

      expect(result.score).toBe(20);
      expect(result.tags.filter((t: string) => t === 'moscow_mo')).toHaveLength(1);
    });
  });

  // --- events ---
  describe('events', () => {
    it('should emit score_changed event when score differs', () => {
      const property = { city: 'moscow', focus_score: 0, tags: [] };
      const rules = [makeRule({ condition_type: 'city_match', condition_value: 'moscow', score: 10, tag: 'moscow_mo' })];

      const result = scoreProperty(property, rules);

      expect(result.events).toContainEqual({
        event_type: 'score_changed',
        old_value: '0',
        new_value: '10',
      });
    });

    it('should not emit score_changed event when score is the same', () => {
      const property = { city: 'moscow', focus_score: 10, tags: ['moscow_mo'] };
      const rules = [makeRule({ condition_type: 'city_match', condition_value: 'moscow', score: 10, tag: 'moscow_mo' })];

      const result = scoreProperty(property, rules);

      const scoreEvents = result.events.filter((e: any) => e.event_type === 'score_changed');
      expect(scoreEvents).toHaveLength(0);
    });

    it('should emit entered_focus event for new tags', () => {
      const property = { city: 'moscow', focus_score: 0, tags: [] };
      const rules = [makeRule({ condition_type: 'city_match', condition_value: 'moscow', score: 10, tag: 'moscow_mo' })];

      const result = scoreProperty(property, rules);

      expect(result.events).toContainEqual({
        event_type: 'entered_focus',
        new_value: 'moscow_mo',
      });
    });

    it('should emit left_focus event for removed tags', () => {
      const property = { city: 'spb', focus_score: 10, tags: ['moscow_mo'] };
      const rules = [makeRule({ condition_type: 'city_match', condition_value: 'moscow', score: 10, tag: 'moscow_mo' })];

      const result = scoreProperty(property, rules);

      expect(result.events).toContainEqual({
        event_type: 'left_focus',
        old_value: 'moscow_mo',
      });
    });

    it('should not emit events when nothing changed', () => {
      const property = { city: 'moscow', focus_score: 10, tags: ['moscow_mo'] };
      const rules = [makeRule({ condition_type: 'city_match', condition_value: 'moscow', score: 10, tag: 'moscow_mo' })];

      const result = scoreProperty(property, rules);

      expect(result.events).toHaveLength(0);
    });
  });

  // --- edge cases ---
  describe('edge cases', () => {
    it('should handle empty rules array', () => {
      const property = { city: 'moscow' };
      const result = scoreProperty(property, []);

      expect(result.score).toBe(0);
      expect(result.tags).toEqual([]);
      expect(result.events).toEqual([]);
    });

    it('should handle property with no focus_score or tags', () => {
      const property = { city: 'moscow' };
      const rules = [makeRule({ condition_type: 'city_match', condition_value: 'moscow', score: 10, tag: 'moscow_mo' })];

      const result = scoreProperty(property, rules);

      expect(result.score).toBe(10);
      expect(result.tags).toContain('moscow_mo');
    });

    it('should handle property with undefined city', () => {
      const property = {};
      const rules = [makeRule({ condition_type: 'city_match', condition_value: 'moscow' })];

      const result = scoreProperty(property, rules);

      expect(result.score).toBe(0);
    });

    it('should handle rule with null condition_value for city_match', () => {
      const property = { city: 'moscow' };
      const rules = [makeRule({ condition_type: 'city_match', condition_value: null })];

      const result = scoreProperty(property, rules);

      expect(result.score).toBe(0);
    });
  });
});

describe('scoreAllProperties', () => {
  const makeRule = (overrides: Partial<any> = {}): any => ({
    id: 1,
    name: 'test-rule',
    condition_type: 'city_match',
    condition_value: 'moscow',
    score: 10,
    tag: 'moscow_mo',
    is_active: true,
    priority: 1,
    ...overrides,
  });

  beforeEach(() => {
    vi.resetAllMocks();
    // Reset db.query to return fresh mocks
    mockStrapi.db.query.mockReturnValue({
      findMany: mockQueryFindMany,
      update: mockQueryUpdate,
    });
    mockConnectionRaw.mockResolvedValue([]);
    // Restore transaction mock (resetAllMocks clears implementation)
    mockTransaction.mockImplementation(async (cb: any) => cb({}));
  });

  it('should return zeros when no active rules exist', async () => {
    mockStrapi.entityService.findMany.mockResolvedValue([]);

    const result = await scoreAllProperties();

    expect(result).toEqual({ scored: 0, in_focus: 0, by_tag: {} });
    expect(mockStrapi.log.warn).toHaveBeenCalledWith(
      expect.stringContaining('No active focus rules'),
    );
  });

  it('should return zeros when rules is null', async () => {
    mockStrapi.entityService.findMany.mockResolvedValue(null);

    const result = await scoreAllProperties();

    expect(result).toEqual({ scored: 0, in_focus: 0, by_tag: {} });
  });

  it('should score all properties in a single batch', async () => {
    const rules = [makeRule()];
    mockStrapi.entityService.findMany.mockResolvedValue(rules);

    const properties = [
      { id: 1, city: 'moscow', focus_score: 0, tags: [] },
      { id: 2, city: 'spb', focus_score: 0, tags: [] },
      { id: 3, city: 'moscow', focus_score: 0, tags: [] },
    ];
    mockQueryFindMany.mockResolvedValueOnce(properties);
    // Second call: currentProps for change detection
    mockQueryFindMany.mockResolvedValueOnce([
      { id: 1, focus_score: 0, tags: '[]' },
      { id: 2, focus_score: 0, tags: '[]' },
      { id: 3, focus_score: 0, tags: '[]' },
    ]);
    // Third call: empty to end pagination
    mockQueryFindMany.mockResolvedValueOnce([]);
    mockQueryUpdate.mockResolvedValue({});
    mockStrapi.entityService.create.mockResolvedValue({});

    const result = await scoreAllProperties();

    expect(result.scored).toBe(3);
    // Properties with city='moscow' get score=10, with city='spb' get score=0
    expect(result.in_focus).toBe(3); // all properties have score >= 0 (default threshold)
    expect(result.by_tag).toEqual({ moscow_mo: 2 });

    // Verify batch update was called via Strapi ORM (parameterized queries)
    expect(mockQueryUpdate).toHaveBeenCalledTimes(3); // 3 properties
    expect(mockQueryUpdate).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { focus_score: 10, tags: JSON.stringify(['moscow_mo']) },
    });
    expect(mockQueryUpdate).toHaveBeenCalledWith({
      where: { id: 2 },
      data: { focus_score: 0, tags: JSON.stringify([]) },
    });
    expect(mockQueryUpdate).toHaveBeenCalledWith({
      where: { id: 3 },
      data: { focus_score: 10, tags: JSON.stringify(['moscow_mo']) },
    });
  });

  it('should handle batch pagination (multiple batches)', async () => {
    const rules = [makeRule()];
    mockStrapi.entityService.findMany.mockResolvedValue(rules);

    // First batch: 200 properties (full batch)
    const batch1 = Array.from({ length: 200 }, (_, i) => ({
      id: i + 1,
      city: 'moscow',
      focus_score: 0,
      tags: [],
    }));
    // Second batch: 50 properties (partial batch → ends pagination)
    const batch2 = Array.from({ length: 50 }, (_, i) => ({
      id: 200 + i + 1,
      city: 'moscow',
      focus_score: 0,
      tags: [],
    }));

    // Batch 1: properties → currentProps → (loop continues because 200 == BATCH)
    mockQueryFindMany.mockResolvedValueOnce(batch1);
    mockQueryFindMany.mockResolvedValueOnce(batch1.map(p => ({ id: p.id, focus_score: 0, tags: '[]' })));
    // Batch 2: properties → currentProps → (loop ends because 50 < BATCH)
    mockQueryFindMany.mockResolvedValueOnce(batch2);
    mockQueryFindMany.mockResolvedValueOnce(batch2.map(p => ({ id: p.id, focus_score: 0, tags: '[]' })));
    mockQueryUpdate.mockResolvedValue({});
    mockStrapi.entityService.create.mockResolvedValue({});

    const result = await scoreAllProperties();

    expect(result.scored).toBe(250);
    expect(result.in_focus).toBe(250);
    expect(result.by_tag).toEqual({ moscow_mo: 250 });

    // Verify pagination: two findMany calls for properties + two for currentProps
    expect(mockQueryFindMany).toHaveBeenCalledTimes(4);
    expect(mockQueryFindMany).toHaveBeenNthCalledWith(1, expect.objectContaining({ offset: 0, limit: 200 }));
    expect(mockQueryFindMany).toHaveBeenNthCalledWith(3, expect.objectContaining({ offset: 200, limit: 200 }));
  });

  it('should create property-event records for score changes', async () => {
    const rules = [makeRule({ score: 20, tag: 'high_value' })];
    mockStrapi.entityService.findMany.mockResolvedValue(rules);

    const properties = [
      { id: 1, city: 'moscow', focus_score: 0, tags: [] }, // score will change from 0 to 20
    ];
    mockQueryFindMany.mockResolvedValueOnce(properties);
    // currentProps: score was 0, will change to 20
    mockQueryFindMany.mockResolvedValueOnce([{ id: 1, focus_score: 0, tags: '[]' }]);
    mockQueryFindMany.mockResolvedValueOnce([]);
    mockQueryUpdate.mockResolvedValue({});
    mockStrapi.entityService.create.mockResolvedValue({});

    await scoreAllProperties();

    // Should create events: score_changed + entered_focus via entityService.create
    expect(mockStrapi.entityService.create).toHaveBeenCalledTimes(2);
    const createCalls = mockStrapi.entityService.create.mock.calls;
    expect(createCalls[0][0]).toBe('api::property-event.property-event');
    expect(createCalls[0][1].data.event_type).toBe('score_changed');
    expect(createCalls[0][1].data.new_value).toBe('20');
    expect(createCalls[1][1].data.event_type).toBe('entered_focus');
    expect(createCalls[1][1].data.new_value).toBe('high_value');
  });

  it('should create events for tag changes', async () => {
    const rules = [makeRule({ score: 10, tag: 'moscow_mo' })];
    mockStrapi.entityService.findMany.mockResolvedValue(rules);

    // Property has different old score so events will fire
    const properties = [
      { id: 1, city: 'moscow', focus_score: 5, tags: ['old_tag'] },
    ];
    mockQueryFindMany.mockResolvedValueOnce(properties);
    // currentProps: old score was 5, will change to 10
    mockQueryFindMany.mockResolvedValueOnce([{ id: 1, focus_score: 5, tags: '["old_tag"]' }]);
    mockQueryFindMany.mockResolvedValueOnce([]);
    mockQueryUpdate.mockResolvedValue({});
    mockStrapi.entityService.create.mockResolvedValue({});

    await scoreAllProperties();

    // Should emit entered_focus for moscow_mo and left_focus for old_tag via entityService.create
    const createCalls = mockStrapi.entityService.create.mock.calls;
    const eventTypes = createCalls.map((c: any[]) => c[1].data.event_type);
    const eventValues = createCalls.map((c: any[]) => c[1].data.new_value || c[1].data.old_value);
    expect(eventTypes).toContain('entered_focus');
    expect(eventValues).toContain('moscow_mo');
    expect(eventTypes).toContain('left_focus');
    expect(eventValues).toContain('old_tag');
  });

  it('should not create events when nothing changed', async () => {
    const rules = [makeRule({ score: 10, tag: 'moscow_mo' })];
    mockStrapi.entityService.findMany.mockResolvedValue(rules);

    const properties = [
      { id: 1, city: 'moscow', focus_score: 10, tags: ['moscow_mo'] },
    ];
    mockQueryFindMany.mockResolvedValueOnce(properties);
    mockQueryFindMany.mockResolvedValueOnce([]);
    mockQueryUpdate.mockResolvedValue({});

    await scoreAllProperties();

    // No events created — entityService.create not called for property-event
    const eventCreates = mockStrapi.entityService.create.mock.calls.filter(
      (c: any[]) => c[0] === 'api::property-event.property-event'
    );
    expect(eventCreates.length).toBe(0);
  });

  it('should aggregate by_tag correctly', async () => {
    const rules = [
      makeRule({ id: 1, condition_type: 'city_match', condition_value: 'moscow', score: 10, tag: 'moscow_mo', priority: 1 }),
      makeRule({ id: 2, condition_type: 'has_field', condition_value: 'minimum_price', score: 5, tag: 'has_min', priority: 2 }),
    ];
    mockStrapi.entityService.findMany.mockResolvedValue(rules);

    const properties = [
      { id: 1, city: 'moscow', minimum_price: 100000, focus_score: 0, tags: [] },
      { id: 2, city: 'moscow', minimum_price: null, focus_score: 0, tags: [] },
      { id: 3, city: 'spb', minimum_price: 50000, focus_score: 0, tags: [] },
    ];
    mockQueryFindMany.mockResolvedValueOnce(properties);
    mockQueryFindMany.mockResolvedValueOnce([]);
    mockQueryUpdate.mockResolvedValue({});
    mockStrapi.entityService.create.mockResolvedValue({});

    const result = await scoreAllProperties();

    expect(result.by_tag).toEqual({ moscow_mo: 2, has_min: 2 });
    // id=1: moscow + has_min, id=2: moscow only, id=3: has_min only
  });

  it('should use threshold parameter for in_focus counting', async () => {
    const rules = [
      makeRule({ id: 1, condition_type: 'city_match', condition_value: 'moscow', score: 10, tag: 'moscow_mo', priority: 1 }),
    ];
    mockStrapi.entityService.findMany.mockResolvedValue(rules);

    const properties = [
      { id: 1, city: 'moscow', focus_score: 0, tags: [] }, // score will be 10
      { id: 2, city: 'spb', focus_score: 0, tags: [] },    // score will be 0
    ];
    mockQueryFindMany.mockResolvedValueOnce(properties);
    // currentProps for first call
    mockQueryFindMany.mockResolvedValueOnce([
      { id: 1, focus_score: 0, tags: '[]' },
      { id: 2, focus_score: 0, tags: '[]' },
    ]);
    mockQueryUpdate.mockResolvedValue({});
    mockStrapi.entityService.create.mockResolvedValue({});

    // With threshold=15, neither property is in focus (scores are 10 and 0)
    const result = await scoreAllProperties(15);

    expect(result.scored).toBe(2);
    expect(result.in_focus).toBe(0);

    // With threshold=5, one property is in focus (score 10 >= 5)
    mockQueryFindMany.mockResolvedValueOnce([...properties]);
    // currentProps for second call
    mockQueryFindMany.mockResolvedValueOnce([
      { id: 1, focus_score: 10, tags: '["moscow_mo"]' },
      { id: 2, focus_score: 0, tags: '[]' },
    ]);

    const result2 = await scoreAllProperties(5);

    expect(result2.scored).toBe(2);
    expect(result2.in_focus).toBe(1);
  });

  it('should handle empty properties list', async () => {
    const rules = [makeRule()];
    mockStrapi.entityService.findMany.mockResolvedValue(rules);
    mockQueryFindMany.mockResolvedValue([]);

    const result = await scoreAllProperties();

    expect(result).toEqual({ scored: 0, in_focus: 0, by_tag: {} });
    expect(mockConnectionRaw).not.toHaveBeenCalled();
  });

  it('should query with status=new filter', async () => {
    const rules = [makeRule()];
    mockStrapi.entityService.findMany.mockResolvedValue(rules);
    mockQueryFindMany.mockResolvedValue([]);

    await scoreAllProperties();

    expect(mockQueryFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'new' },
        orderBy: { id: 'asc' },
      }),
    );
  });
});
