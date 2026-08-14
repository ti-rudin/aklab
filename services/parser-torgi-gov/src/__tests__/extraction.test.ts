import { describe, it, expect, vi } from 'vitest';
import {
  buildTorgiLotUrl,
  createTorgiParserDiagnostics,
  extractTorgiAuctionEndAt,
  extractTorgiLotId,
  extractTorgiPropertyLocation,
  fetchTorgiResponseWithRetry,
  isMonitoredTorgiRegion,
  TorgiGovParser,
} from '../sources/torgi-gov';
import { projectLegacyAddress, derivePropertyRegion } from '@aklab/service-shared';

/**
 * Тесты extraction-логики parser-torgi-gov.
 *
 * Источник: services/parser-torgi-gov/src/sources/torgi-gov.ts
 * API: JSON — torgi.gov.ru/new/api/public/lotcards/search
 *
 * Тестируем:
 * - structured property_location extraction (API fields only)
 * - price extraction (priceMin/priceMax/priceInfo)
 * - area extraction (characteristics с code "totalAreaRealty")
 * - region code → city mapping
 */

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

describe('torgi-gov: detail failure contract', () => {
  it('rejects an unsuccessful detail response instead of returning stale scan data', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 503 } as Response);
    try {
      const rejection = expect(new TorgiGovParser().fetchDetails(buildTorgiLotUrl('21000005000000031466_1')))
        .rejects.toThrow('parser.transient');
      await vi.runAllTimersAsync();
      await rejection;
    } finally {
      fetchMock.mockRestore();
      vi.useRealTimers();
    }
  });

  it('rejects a blocked list response instead of reporting a successful empty scan', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 403 } as Response);
    try {
      await expect(new TorgiGovParser().parse(1)).rejects.toThrow('parser.http_block');
    } finally {
      fetchMock.mockRestore();
    }
  });
});

describe('torgi-gov: request retry contract', () => {
  it('retries a transient 503 response and returns the successful response', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockResolvedValueOnce(new Response('{"content":[]}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));
    const sleep = vi.fn().mockResolvedValue(undefined);

    const response = await fetchTorgiResponseWithRetry(
      'https://torgi.gov.ru/new/api/public/lotcards/search?page=0',
      fetchImpl,
      sleep,
    );

    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('survives a sustained transient window and cools down after recovery', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('busy-1', { status: 503 }))
      .mockResolvedValueOnce(new Response('busy-2', { status: 503 }))
      .mockResolvedValueOnce(new Response('busy-3', { status: 503 }))
      .mockResolvedValueOnce(new Response('busy-4', { status: 503 }))
      .mockResolvedValueOnce(new Response('{"content":[]}', { status: 200 }));
    const sleep = vi.fn().mockResolvedValue(undefined);

    const response = await fetchTorgiResponseWithRetry(
      'https://torgi.gov.ru/new/api/public/lotcards/search?page=0',
      fetchImpl,
      sleep,
    );

    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(5);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([
      5_000,
      15_000,
      30_000,
      60_000,
      15_000,
    ]);
  });

  it('honors a longer Retry-After delay from the server', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('busy', {
        status: 503,
        headers: { 'retry-after': '20' },
      }))
      .mockResolvedValueOnce(new Response('{"content":[]}', { status: 200 }));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await fetchTorgiResponseWithRetry(
      'https://torgi.gov.ru/new/api/public/lotcards/search?page=0',
      fetchImpl,
      sleep,
    );

    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([20_000, 15_000]);
  });

  it('does not retry an explicit HTTP block', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 403 }));
    const sleep = vi.fn().mockResolvedValue(undefined);

    const response = await fetchTorgiResponseWithRetry(
      'https://torgi.gov.ru/new/api/public/lotcards/search?page=0',
      fetchImpl,
      sleep,
    );

    expect(response.status).toBe(403);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});

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
  lotName: 'Нежилое помещение, организатор: Москва, ул. Большая',
  lotDescription: 'Нежилое помещение в Твери; организатор зарегистрирован в Москве',
  estateAddress: 'Тверская область, г. Тверь, ул. Ленина, д. 10',
  subjectRFCode: '69',
  subjectName: 'Тверская область',
  category: { code: '200', name: 'Недвижимость' },
  biddType: { name: 'Публичное предложение' },
  createDate: '2024-01-15T00:00:00Z',
};

// --- Tests ---

describe('torgi-gov: source URL', () => {
  it('builds the current public lot route from the compound lot id', () => {
    expect(buildTorgiLotUrl('21000005000000031466_1')).toBe(
      'https://torgi.gov.ru/new/public/lots/lot/21000005000000031466_1',
    );
  });
  it('extracts the compound lot id from the current public route', () => {
    expect(
      extractTorgiLotId('https://torgi.gov.ru/new/public/lots/lot/21000005000000031466_1'),
    ).toBe('21000005000000031466_1');
  });
});

describe('torgi-gov: monitored region gate', () => {
  it('admits Moscow, Moscow Oblast, and Tver Oblast region codes', () => {
    expect(isMonitoredTorgiRegion('77')).toBe(true);
    expect(isMonitoredTorgiRegion('50')).toBe(true);
    expect(isMonitoredTorgiRegion('69')).toBe(true);
  });

  it('rejects an unrelated region code', () => {
    expect(isMonitoredTorgiRegion('16')).toBe(false);
  });
});

describe('torgi-gov: auction deadline', () => {
  it('prefers the explicit UTC application deadline from the detail API', () => {
    expect(extractTorgiAuctionEndAt({
      biddEndTime: '2026-08-21T08:00:00Z',
      auctionStartDate: '2026-08-24T08:00:00Z',
    })).toBe('2026-08-21T08:00:00.000Z');
  });

  it('does not substitute auction start time when the application deadline is absent', () => {
    expect(extractTorgiAuctionEndAt({ auctionStartDate: '2026-08-24T08:00:00Z' })).toBeUndefined();
  });
});

describe('torgi-gov: typed property location', () => {
  it('extracts a full address only from the current lot structured field', () => {
    const location = extractTorgiPropertyLocation({
      estateAddress: 'Тверская область, г. Тверь, ул. Ленина, д. 10',
      subjectRFCode: '69',
      subjectName: 'Тверская область',
      lotDescription: 'Организатор: г. Москва, ул. Тверская, д. 1',
    });

    expect(location).toEqual({
      address: 'Тверская область, г. Тверь, ул. Ленина, д. 10',
      region: 'Тверская область',
      region_code: '69',
      status: 'confirmed_address',
      source_kind: 'api_field',
      source_path: 'lot.estateAddress',
    });
    expect(projectLegacyAddress(location)).toBe(location.address);
    expect(derivePropertyRegion(location)).toBe('tver');
  });

  it('uses lotAddress as the verified structured fallback when estateAddress is absent', () => {
    const location = extractTorgiPropertyLocation({
      lotAddress: 'Московская область, г. Подольск, ул. Кирова, д. 2',
      subjectRFCode: '50',
      subjectName: 'Московская область',
    });

    expect(location.address).toBe('Московская область, г. Подольск, ул. Кирова, д. 2');
    expect(location.source_path).toBe('lot.lotAddress');
    expect(location.status).toBe('confirmed_address');
    expect(derivePropertyRegion(location)).toBe('mo');
  });

  it('returns confirmed_region_only when the lot has region data but no structured address', () => {
    const location = extractTorgiPropertyLocation({
      subjectRFCode: '69',
      subjectName: 'Тверская область',
      lotName: 'Нежилое помещение, Москва в тексте организатора',
      lotDescription: 'Описание содержит Москва, но это не адрес имущества',
    });

    expect(location).toEqual({
      region: 'Тверская область',
      region_code: '69',
      status: 'confirmed_region_only',
      source_kind: 'api_field',
      source_path: 'lot.subjectRFCode',
    });
    expect(projectLegacyAddress(location)).toBe('');
    expect(derivePropertyRegion(location)).toBe('tver_oblast');
  });

  it('returns missing instead of deriving geography from title, description, or organizer text', () => {
    const location = extractTorgiPropertyLocation({
      lotName: 'Склад в Москве',
      lotDescription: 'Организатор: Москва, ул. Тверская, д. 1',
      organizerAddress: 'Москва, ул. Тверская, д. 1',
    });

    expect(location).toEqual({
      status: 'missing',
      source_kind: 'api_field',
      source_path: 'lot.estateAddress|lot.lotAddress',
    });
    expect(projectLegacyAddress(location)).toBe('');
    expect(derivePropertyRegion(location)).toBe('other');
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
    const location = extractTorgiPropertyLocation(item);
    const address = projectLegacyAddress(location);
    const city = derivePropertyRegion(location);

    expect(price).toBe(5000000);
    expect(area).toBe(150.5);
    expect(address).toContain('Тверь');
    expect(city).toBe('tver');
    expect(location.status).toBe('confirmed_address');
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
    const location = extractTorgiPropertyLocation(item);
    expect(projectLegacyAddress(location)).toBe('');
    expect(location.status).toBe('confirmed_region_only');
    expect(location.source_path).toBe('lot.subjectRFCode');
    expect(mapRegionToCity('16')).toBe('other');
  });
});

describe('torgi-gov: parser diagnostics', () => {
  it('fingerprints allowlisted payload keys without values', () => {
    const item = { estateAddress: 'sensitive raw address', lotDescription: 'sensitive text' };
    const location = extractTorgiPropertyLocation(item);
    const diagnostic = createTorgiParserDiagnostics(item, location);
    expect(diagnostic).toMatchObject({
      property_block_found: true,
      location_label_id: 'property.location.address',
    });
    expect(diagnostic.semantic_fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(diagnostic)).not.toContain('sensitive');
  });
});
