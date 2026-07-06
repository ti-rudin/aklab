import { describe, it, expect } from 'vitest';
import { classifyPropertyType } from '../property-classifier';

describe('classifyPropertyType', () => {
  // --- Apartments ---
  describe('apartment', () => {
    it('should classify "квартира" as apartment', () => {
      expect(classifyPropertyType('3-х комнатная квартира')).toBe('apartment');
    });

    it('should classify "апартаменты" as apartment', () => {
      expect(classifyPropertyType('Апартаменты в центре')).toBe('apartment');
    });
  });

  // --- Land ---
  describe('land', () => {
    it('should classify "земельный участок" as land', () => {
      expect(classifyPropertyType('Земельный участок 10 соток')).toBe('land');
    });

    it('should classify "участок" as land', () => {
      expect(classifyPropertyType('участок под строительство')).toBe('land');
    });
  });

  // --- Office ---
  describe('office', () => {
    it('should classify "офис" as office', () => {
      expect(classifyPropertyType('Офисное помещение 50 кв.м')).toBe('office');
    });

    it('should classify "административное" as office', () => {
      expect(classifyPropertyType('Административное здание')).toBe('office');
    });
  });

  // --- Warehouse ---
  describe('warehouse', () => {
    it('should classify "склад" as warehouse', () => {
      expect(classifyPropertyType('Складское помещение')).toBe('warehouse');
    });

    it('should classify "хранилище" as warehouse', () => {
      expect(classifyPropertyType('Хранилище')).toBe('warehouse');
    });
  });

  // --- Retail ---
  describe('retail', () => {
    it('should classify "магазин" as retail', () => {
      expect(classifyPropertyType('Магазин на первом этаже')).toBe('retail');
    });

    it('should classify "торговое" as retail', () => {
      expect(classifyPropertyType('Торговое помещение')).toBe('retail');
    });

    it('should classify "павильон" as retail', () => {
      expect(classifyPropertyType('Торговый павильон')).toBe('retail');
    });
  });

  // --- Free purpose ---
  describe('free_purpose', () => {
    it('should classify "нежилое помещение" as free_purpose', () => {
      expect(classifyPropertyType('Нежилое помещение')).toBe('free_purpose');
    });

    it('should classify "коммерческое" as free_purpose', () => {
      expect(classifyPropertyType('Коммерческое помещение')).toBe('free_purpose');
    });

    it('should classify "гараж" as free_purpose', () => {
      expect(classifyPropertyType('Гараж-бокс')).toBe('free_purpose');
    });

    it('should classify "здание" as free_purpose', () => {
      expect(classifyPropertyType('Здание')).toBe('free_purpose');
    });

    it('should classify "производственное" as free_purpose', () => {
      expect(classifyPropertyType('Производственное помещение')).toBe('free_purpose');
    });

    it('should classify "цех" as free_purpose', () => {
      expect(classifyPropertyType('Цех обработки')).toBe('free_purpose');
    });

    it('should classify "паркинг" as free_purpose', () => {
      expect(classifyPropertyType('Паркинг')).toBe('free_purpose');
    });
  });

  // --- Other ---
  describe('other', () => {
    it('should return "other" for unrecognized text', () => {
      expect(classifyPropertyType('Какой-то текст')).toBe('other');
    });

    it('should return "other" for empty string', () => {
      expect(classifyPropertyType('')).toBe('other');
    });
  });

  // --- Priority ---
  describe('priority', () => {
    it('should prioritize apartment over office when both match', () => {
      // "квартира" check comes first
      expect(classifyPropertyType('квартира в офисном здании')).toBe('apartment');
    });
  });
});
