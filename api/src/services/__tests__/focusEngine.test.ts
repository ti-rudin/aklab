import { describe, it, expect, vi, beforeEach } from 'vitest';

// We need to mock the strapi global for scoreAllProperties
const mockStrapi = {
  log: { warn: vi.fn(), info: vi.fn() },
  entityService: {
    findMany: vi.fn(),
    create: vi.fn(),
  },
  db: {
    query: vi.fn().mockReturnValue({
      findMany: vi.fn(),
      update: vi.fn(),
    }),
  },
};

// @ts-ignore
global.strapi = mockStrapi;

import { scoreProperty } from '../focusEngine';

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
      const property = { deviation_percent: -30 };
      const rules = [makeRule({ condition_type: 'deviation_threshold', condition_value: '20', score: 40, tag: 'undervalued', priority: 1 })];

      const result = scoreProperty(property, rules);

      expect(result.score).toBe(40);
      expect(result.tags).toContain('undervalued');
    });

    it('should not match when deviation is above threshold', () => {
      const property = { deviation_percent: -10 };
      const rules = [makeRule({ condition_type: 'deviation_threshold', condition_value: '20', score: 40, tag: 'undervalued' })];

      const result = scoreProperty(property, rules);

      expect(result.score).toBe(0);
      expect(result.tags).toEqual([]);
    });

    it('should use only the highest priority deviation rule when multiple match', () => {
      const property = { deviation_percent: -50 };
      const rules = [
        makeRule({ id: 1, condition_type: 'deviation_threshold', condition_value: '20', score: 30, tag: 'undervalued_20', priority: 1 }),
        makeRule({ id: 2, condition_type: 'deviation_threshold', condition_value: '40', score: 50, tag: 'undervalued_40', priority: 2 }),
      ];

      const result = scoreProperty(property, rules);

      // Both match (deviation -50 <= -20 and -50 <= -40)
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
        deviation_percent: -30,
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
