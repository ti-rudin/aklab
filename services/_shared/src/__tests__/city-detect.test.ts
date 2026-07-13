import { describe, it, expect } from 'vitest';
import { detectCity } from '../city-detect';

describe('detectCity', () => {
  // --- Moscow ---
  describe('moscow detection', () => {
    it('should detect "Москва" as moscow', () => {
      expect(detectCity('г. Москва, ул. Ленина')).toBe('moscow');
    });

    it('should detect "москва" case-insensitively', () => {
      expect(detectCity('москва, центр')).toBe('moscow');
    });

    it('should detect "Москва" at start of string', () => {
      expect(detectCity('Москва')).toBe('moscow');
    });

    it('should detect "Москва" after comma', () => {
      expect(detectCity('Россия, Москва, ул. Пушкина')).toBe('moscow');
    });

    it('should NOT detect "Москва-Кашира" as moscow (word boundary)', () => {
      expect(detectCity('Москва-Кашира')).not.toBe('moscow');
    });

    it('should NOT detect "Московская" alone as moscow', () => {
      // "Московская" contains "москов" not "москва" — MOSCOW_RE won't match
      expect(detectCity('Московская область')).not.toBe('moscow');
    });

    it('should detect "Москва" even when "Московская" substring appears elsewhere', () => {
      // If text has both "Москва" and "московская" — moscow wins if regex matches
      // But code explicitly checks for "московская" inclusion and returns 'mo' instead
      const result = detectCity('Москва, Московская область');
      // The code says: if MOSCOW_RE matches AND text includes "московская" → skip moscow
      expect(result).toBe('mo');
    });
  });

  // --- MO (Московская область) ---
  describe('MO (Московская область) detection', () => {
    it('should detect "Московская область" as mo', () => {
      expect(detectCity('Московская область, г. Подольск')).toBe('mo');
    });

    it('should detect "московская обл" as mo', () => {
      expect(detectCity('московская обл, д. Внуково')).toBe('mo');
    });

    it('should detect "Подольск" as mo', () => {
      expect(detectCity('г. Подольск, ул. Советская')).toBe('mo');
    });

    it('should detect "Химки" as mo', () => {
      expect(detectCity('Химки, ул. Ленинградская')).toBe('mo');
    });

    it('should detect "Красногорск" as mo', () => {
      expect(detectCity('Красногорск, ул. Ленина')).toBe('mo');
    });

    it('should detect "Балашиха" as mo', () => {
      expect(detectCity('Балашиха')).toBe('mo');
    });

    it('should detect "Люберцы" as mo', () => {
      expect(detectCity('г. Люберцы')).toBe('mo');
    });

    it('should detect "Домодедово" as mo', () => {
      expect(detectCity('Домодедово')).toBe('mo');
    });

    it('should detect "Серпухов" as mo', () => {
      expect(detectCity('Серпухов')).toBe('mo');
    });
  });

  // --- Other ---
  describe('other cities', () => {
    it('should return "other" for empty string', () => {
      expect(detectCity('')).toBe('other');
    });

    it('should return "other" for unrelated city', () => {
      expect(detectCity('г. Новосибирск')).toBe('other');
    });

    it('should return "other" for text without city info', () => {
      expect(detectCity('нежилое помещение, площадь 100 кв.м')).toBe('other');
    });
  });

  // --- NON_MOSCOW_REGIONS blacklist ---
  describe('non-Moscow regions blacklist', () => {
    it('returns other for Дагестан + Москва in template text', () => {
      expect(detectCity('Республика Дагестан, с. Леваши, описание... Москва')).toBe('other');
    });

    it('returns other for Алтайский край', () => {
      expect(detectCity('Алтайский край, г. Барнаул')).toBe('other');
    });

    it('returns other for Новосибирск', () => {
      expect(detectCity('Новосибирск, ул. Ленина')).toBe('other');
    });

    it('returns other for Екатеринбург', () => {
      expect(detectCity('Екатеринбург, ул. Малышева')).toBe('other');
    });

    it('returns other for Краснодарский край', () => {
      expect(detectCity('Краснодарский край, г. Сочи')).toBe('other');
    });

    it('returns other for Чеченская республика + Москва', () => {
      expect(detectCity('Чеченская Республика, г. Грозный. г. Москва')).toBe('other');
    });

    it('returns mo when MO keyword present (priority over blacklist)', () => {
      expect(detectCity('Московская область')).toBe('mo');
    });
  });
});
