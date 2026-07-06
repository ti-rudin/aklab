import { describe, it, expect } from 'vitest';

/**
 * Тесты extraction-логики parser-torgi-gov.
 *
 * Источник: services/parser-torgi-gov/src/sources/torgi-gov.ts
 * API: JSON — torgi.gov.ru/new/api/public/lotcards/search
 *
 * Тестируем:
 * - extractAddress (воспроизведён из модуля)
 * - price extraction (priceMin/priceMax/priceInfo)
 * - area extraction (characteristics с code "totalAreaRealty")
 * - region code → city mapping
 */

// --- Replicated extraction functions from torgi-gov.ts ---

function extractAddress(item: any): string {
  const desc = item.lotDescription || item.lotName || '';
  const match = desc.match(/(?:по адресу|адрес|расположенн?\s+по)[:\s]+(.+?)(?:[,;]|$)/i);
  if (match) return match[1].trim();
  const subject = item.subjectName || '';
  return subject || desc.substring(0, 100);
}

function extractPrice(item: any): number | undefined {
  const price = item.priceMin || item.priceMax || item.priceInfo?.startPrice || item.priceInfo?.currentPrice;
  return typeof price === 'number' ? price : undefined;
}

function extractArea(item: any): number | undefined {
  const chars = item.characteristics || [];
  for (const ch of chars) {
    if (ch.code === 'totalAreaRealty' || ch.code === 'SquareZU' || ch.code === 'Square' || ch.code === 'TotalArea') {
      const val = parseFloat(String(ch.characteristicValue));
      if (!isNaN(val) && val > 0) return val;
    }
  }
  // Fallback: extract from lotName
  const lotName = item.lotName || '';
  const areaMatch = lotName.match(/(\d[\d\s]*[,.]?\d*)\s*кв\.?\s*м/i);
  if (areaMatch) {
    const cleaned = areaMatch[1].replace(/\s/g, '').replace(',', '.');
    const num = parseFloat(cleaned);
    if (!isNaN(num) && num > 0) return num;
  }
  return undefined;
}

function mapRegionToCity(regionCode: string): 'moscow' | 'mo' | 'other' {
  if (regionCode === '77') return 'moscow';
  if (regionCode === '50') return 'mo';
  return 'other';
}

// --- JSON fixtures (real API response structure from torgi.gov.ru) ---

const baseLotItem = {
  id: 'test-lot-001',
  noticeNumber: '20240001',
  lotNumber: 1,
  lotName: 'Нежилое помещение, расположенное по адресу: г. Москва, ул. Тверская, д. 10',
  lotDescription: 'Нежилое помещение, расположенное по адресу: г. Москва, ул. Тверская, д. 10, площадь 150 кв.м',
  subjectRFCode: '77',
  subjectName: 'г. Москва',
  category: { code: '200', name: 'Недвижимость' },
  biddType: { name: 'Публичное предложение' },
  createDate: '2024-01-15T00:00:00Z',
};

// --- Tests ---

describe('torgi-gov: extractAddress', () => {
  it('should extract address from lotDescription with "по адресу"', () => {
    const item = {
      lotDescription: 'Нежилое помещение, расположенное по адресу: г. Москва, ул. Тверская, д. 10',
    };
    const addr = extractAddress(item);
    // Regex captures non-greedily to first comma: "г. Москва"
    expect(addr).toContain('Москва');
  });

  it('should extract address from lotDescription with "адрес"', () => {
    const item = {
      lotDescription: 'Помещение адрес: Московская обл., г. Подольск',
    };
    const addr = extractAddress(item);
    expect(addr).toContain('Московская обл.');
  });

  it('should extract address from lotDescription with "расположенн по"', () => {
    const item = {
      lotDescription: 'Здание, расположенн по ул. Ленина, д. 5, г. Химки',
    };
    const addr = extractAddress(item);
    expect(addr).toContain('ул. Ленина');
  });

  it('should fallback to subjectName when no address pattern', () => {
    const item = {
      lotName: 'Склад',
      subjectName: 'Московская область',
    };
    const addr = extractAddress(item);
    expect(addr).toBe('Московская область');
  });

  it('should fallback to truncated description when nothing available', () => {
    const longDesc = 'А'.repeat(200);
    const item = { lotDescription: longDesc };
    const addr = extractAddress(item);
    expect(addr.length).toBeLessThanOrEqual(100);
  });
});

describe('torgi-gov: extractPrice', () => {
  it('should extract priceMin', () => {
    const item = { priceMin: 1500000, priceMax: 2000000 };
    expect(extractPrice(item)).toBe(1500000);
  });

  it('should extract priceMax when priceMin is 0', () => {
    const item = { priceMin: 0, priceMax: 2000000 };
    // 0 is falsy, so || will skip to priceMax
    expect(extractPrice(item)).toBe(2000000);
  });

  it('should extract from priceInfo.startPrice', () => {
    const item = { priceInfo: { startPrice: 500000 } };
    expect(extractPrice(item)).toBe(500000);
  });

  it('should extract from priceInfo.currentPrice', () => {
    const item = { priceInfo: { currentPrice: 750000 } };
    expect(extractPrice(item)).toBe(750000);
  });

  it('should return undefined when no price fields', () => {
    expect(extractPrice({})).toBeUndefined();
  });

  it('should return undefined when price is string', () => {
    expect(extractPrice({ priceMin: '1500000' })).toBeUndefined();
  });
});

describe('torgi-gov: extractArea', () => {
  it('should extract area from characteristics with code "totalAreaRealty"', () => {
    const item = {
      characteristics: [
        { code: 'totalAreaRealty', characteristicValue: '150.5' },
      ],
    };
    expect(extractArea(item)).toBe(150.5);
  });

  it('should extract area from characteristics with code "SquareZU"', () => {
    const item = {
      characteristics: [
        { code: 'SquareZU', characteristicValue: '1000' },
      ],
    };
    expect(extractArea(item)).toBe(1000);
  });

  it('should extract area from characteristics with code "TotalArea"', () => {
    const item = {
      characteristics: [
        { code: 'TotalArea', characteristicValue: '274.4' },
      ],
    };
    expect(extractArea(item)).toBe(274.4);
  });

  it('should extract area from lotName as fallback', () => {
    const item = {
      characteristics: [],
      lotName: 'Нежилое помещение 150 кв.м',
    };
    expect(extractArea(item)).toBe(150);
  });

  it('should extract area from lotName with comma decimal', () => {
    const item = {
      characteristics: [],
      lotName: 'Помещение 85,3 кв.м',
    };
    expect(extractArea(item)).toBe(85.3);
  });

  it('should return undefined when no area found', () => {
    const item = {
      characteristics: [{ code: 'other', characteristicValue: '100' }],
      lotName: 'Склад',
    };
    expect(extractArea(item)).toBeUndefined();
  });

  it('should skip characteristics with zero value', () => {
    const item = {
      characteristics: [
        { code: 'totalAreaRealty', characteristicValue: '0' },
      ],
    };
    expect(extractArea(item)).toBeUndefined();
  });
});

describe('torgi-gov: region code → city mapping', () => {
  it('should map region 77 to moscow', () => {
    expect(mapRegionToCity('77')).toBe('moscow');
  });

  it('should map region 50 to mo', () => {
    expect(mapRegionToCity('50')).toBe('mo');
  });

  it('should map other regions to other', () => {
    expect(mapRegionToCity('16')).toBe('other'); // Татарстан
    expect(mapRegionToCity('78')).toBe('other'); // Санкт-Петербург
  });
});

describe('torgi-gov: full item extraction simulation', () => {
  it('should extract complete property from API item', () => {
    const item = {
      ...baseLotItem,
      priceMin: 5000000,
      priceMax: 7000000,
      characteristics: [
        { code: 'totalAreaRealty', characteristicValue: '150.5' },
      ],
    };

    const price = extractPrice(item);
    const area = extractArea(item);
    const address = extractAddress(item);
    const city = mapRegionToCity(String(item.subjectRFCode));

    expect(price).toBe(5000000);
    expect(area).toBe(150.5);
    expect(address).toContain('Москва');
    expect(city).toBe('moscow');
  });

  it('should handle item with no characteristics and no price', () => {
    const item = {
      lotName: 'Склад',
      lotDescription: 'Складское помещение',
      subjectRFCode: '16',
      subjectName: 'Республика Татарстан',
      characteristics: [],
    };

    expect(extractPrice(item)).toBeUndefined();
    expect(extractArea(item)).toBeUndefined();
    expect(extractAddress(item)).toBe('Республика Татарстан');
    expect(mapRegionToCity('16')).toBe('other');
  });
});
