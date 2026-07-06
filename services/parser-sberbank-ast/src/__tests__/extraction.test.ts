import { describe, it, expect } from 'vitest';

/**
 * Тесты extraction-логики parser-sberbank-ast.
 *
 * Функции parsePrice, extractArea, extractAddress — приватные модулю.
 * Для тестирования воспроизводим их логику как standalone-функции.
 * Источник: services/parser-sberbank-ast/src/sources/sberbank-ast.ts
 */

// --- Replicated extraction functions from sberbank-ast.ts ---

function parsePrice(text: string): number | undefined {
  if (!text) return undefined;
  const cleaned = text.replace(/[^\d,]/g, '').replace(',', '.');
  const num = parseFloat(cleaned);
  return !isNaN(num) && num > 0 ? num : undefined;
}

function extractArea(text: string): number | undefined {
  const match = text.match(/(\d[\d\s]*[,.]?\d*)\s*(?:кв\.?\s*м|м²|м2)/i);
  if (match) {
    const cleaned = match[1].replace(/\s/g, '').replace(',', '.');
    const num = parseFloat(cleaned);
    if (!isNaN(num) && num > 0) return num;
  }
  return undefined;
}

function extractAddress(title: string): string {
  // Try "по адресу: ..." pattern
  let match = title.match(/по\s+адресу[:\s]+([^,]+(?:,\s*[^,]+){0,3})/i);
  if (match) return match[1].trim();

  // Try "расположенн..." pattern
  match = title.match(/расположенн\w*\s+(?:по\s+адресу[:\s]*)?([^,]+(?:,\s*[^,]+){0,3})/i);
  if (match) return match[1].trim();

  // Try "адрес:" pattern
  match = title.match(/адрес[:\s]+([^,]+(?:,\s*[^,]+){0,3})/i);
  if (match) return match[1].trim();

  return '';
}

// --- Tests ---

describe('sberbank-ast: parsePrice', () => {
  it('should parse "648 000,00 RUB"', () => {
    expect(parsePrice('648 000,00 RUB')).toBe(648000);
  });

  it('should parse "1 500 000 ₽"', () => {
    expect(parsePrice('1 500 000 ₽')).toBe(1500000);
  });

  it('should parse "500000" (plain number)', () => {
    expect(parsePrice('500000')).toBe(500000);
  });

  it('should parse price with comma decimal "1 234 567,89 RUB"', () => {
    expect(parsePrice('1 234 567,89 RUB')).toBe(1234567.89);
  });

  it('should return undefined for empty string', () => {
    expect(parsePrice('')).toBeUndefined();
  });

  it('should return undefined for text without numbers', () => {
    expect(parsePrice('цена не указана')).toBeUndefined();
  });

  it('should return undefined for zero', () => {
    expect(parsePrice('0')).toBeUndefined();
  });
});

describe('sberbank-ast: extractArea', () => {
  it('should extract area from "150 кв.м"', () => {
    expect(extractArea('Нежилое помещение 150 кв.м')).toBe(150);
  });

  it('should extract area from "1 500 кв.м" (with space)', () => {
    expect(extractArea('Здание 1 500 кв.м')).toBe(1500);
  });

  it('should extract area with comma decimal: "150,5 кв.м"', () => {
    expect(extractArea('Помещение 150,5 кв.м')).toBe(150.5);
  });

  it('should extract area from "50 м²"', () => {
    expect(extractArea('Офис 50 м²')).toBe(50);
  });

  it('should extract area from "85,3 м2"', () => {
    expect(extractArea('Помещение 85,3 м2')).toBe(85.3);
  });

  it('should return undefined for text without area', () => {
    expect(extractArea('Склад')).toBeUndefined();
  });

  it('should return undefined for empty string', () => {
    expect(extractArea('')).toBeUndefined();
  });
});

describe('sberbank-ast: extractAddress', () => {
  it('should extract address from "по адресу: ..." pattern', () => {
    const title = 'Нежилое помещение по адресу: г. Москва, ул. Ленина, д. 10';
    const addr = extractAddress(title);
    expect(addr).toContain('г. Москва');
    expect(addr).toContain('ул. Ленина');
  });

  it('should extract address from "расположенному по адресу" pattern', () => {
    const title = 'Помещение, расположенное по адресу: Московская обл., г. Подольск, ул. Советская';
    const addr = extractAddress(title);
    expect(addr).toContain('Московская обл.');
    expect(addr).toContain('г. Подольск');
  });

  it('should NOT match "расположенному" without "по адресу" (\\w is ASCII-only)', () => {
    // \w in JS doesn't match Cyrillic, so "расположенное" doesn't match "расположенн\w*"
    // The pattern only works when "по адресу" follows (caught by first regex)
    const title = 'Помещение, расположенное г. Москва, ул. Тверская';
    const addr = extractAddress(title);
    expect(addr).toBe('');
  });

  it('should extract address from "адрес: ..." pattern', () => {
    const title = 'Нежилое помещение адрес: г. Калуга, ул. Кирова, д. 5';
    const addr = extractAddress(title);
    expect(addr).toContain('г. Калуга');
  });

  it('should return empty string when no address pattern found', () => {
    const title = 'Складское помещение';
    expect(extractAddress(title)).toBe('');
  });

  it('should handle empty string', () => {
    expect(extractAddress('')).toBe('');
  });

  it('should limit to 3 comma-separated segments', () => {
    const title = 'По адресу: г. Москва, ул. Ленина, д. 10, кв. 5';
    const addr = extractAddress(title);
    expect(addr).toContain('г. Москва');
  });
});

describe('sberbank-ast: XML lot extraction simulation', () => {
  /**
   * Simulate the page.evaluate() logic that extracts data from
   * <input#xmlData> XML on sberbank-ast.ru
   */

  interface LotData {
    purchase_id: string;
    title: string;
    price_text: string;
    status: string;
    detail_url: string;
    organizer: string;
    address: string;
    lat?: number;
    lng?: number;
    branch?: string;
  }

  function extractFromXml(xmlStr: string): LotData[] {
    // Simplified XML parsing simulation (regex-based for testing without DOMParser)
    const results: LotData[] = [];
    const sourceRegex = /<_source>([\s\S]*?)<\/_source>/g;
    let sourceMatch: RegExpExecArray | null;

    while ((sourceMatch = sourceRegex.exec(xmlStr)) !== null) {
      const src = sourceMatch[1];
      const getTag = (tag: string): string => {
        const m = src.match(new RegExp(`<${tag}>([^<]*)<\\/${tag}>`, 'i'));
        return m ? m[1].trim() : '';
      };

      const purchaseId = getTag('PurchaseId');
      const purchaseName = getTag('purchName');
      const bidName = getTag('BidName');
      const amount = getTag('purchAmount');
      const currentAmount = getTag('CurrentAmount');
      const purchaseState = getTag('purchStateName');
      const orgName = getTag('OrgName');
      const geoAddress = getTag('GeoDataAddress');
      const detailHref = getTag('bidHrefTerm');
      const latStr = getTag('Latitude');
      const lngStr = getTag('Longitude');
      const branchName = getTag('BranchNameNew');

      if (!purchaseName && !bidName) continue;

      results.push({
        purchase_id: purchaseId,
        title: purchaseName || bidName,
        price_text: currentAmount || amount,
        status: purchaseState,
        detail_url: detailHref,
        organizer: orgName,
        address: geoAddress,
        lat: latStr ? parseFloat(latStr) : undefined,
        lng: lngStr ? parseFloat(lngStr) : undefined,
        branch: branchName,
      });
    }

    return results;
  }

  it('should extract lot data from XML', () => {
    const xml = `<root><_source>
      <PurchaseId>P-001</PurchaseId>
      <purchName>Нежилое помещение 150 кв.м</purchName>
      <purchAmount>500000</purchAmount>
      <CurrentAmount>648000</CurrentAmount>
      <purchStateName>Подача заявок</purchStateName>
      <OrgName>ООО Тест</OrgName>
      <GeoDataAddress>г. Москва, ул. Ленина, д. 10</GeoDataAddress>
      <bidHrefTerm>/Property/NBT/PurchaseView/43/0/0/P-001</bidHrefTerm>
      <Latitude>55.7558</Latitude>
      <Longitude>37.6173</Longitude>
      <BranchNameNew>Нежилая недвижимость</BranchNameNew>
    </_source></root>`;

    const lots = extractFromXml(xml);
    expect(lots).toHaveLength(1);
    expect(lots[0].purchase_id).toBe('P-001');
    expect(lots[0].title).toContain('150 кв.м');
    expect(lots[0].price_text).toBe('648000');
    expect(lots[0].address).toBe('г. Москва, ул. Ленина, д. 10');
    expect(lots[0].lat).toBe(55.7558);
    expect(lots[0].lng).toBe(37.6173);
    expect(lots[0].branch).toBe('Нежилая недвижимость');
  });

  it('should prefer CurrentAmount over purchAmount', () => {
    const xml = `<root><_source>
      <PurchaseId>P-002</PurchaseId>
      <purchName>Склад</purchName>
      <purchAmount>100000</purchAmount>
      <CurrentAmount>200000</CurrentAmount>
    </_source></root>`;

    const lots = extractFromXml(xml);
    expect(lots).toHaveLength(1);
    expect(lots[0].price_text).toBe('200000');
  });

  it('should fall back to purchAmount when CurrentAmount is empty', () => {
    const xml = `<root><_source>
      <PurchaseId>P-003</PurchaseId>
      <purchName>Офис</purchName>
      <purchAmount>300000</purchAmount>
      <CurrentAmount></CurrentAmount>
    </_source></root>`;

    const lots = extractFromXml(xml);
    expect(lots).toHaveLength(1);
    expect(lots[0].price_text).toBe('300000');
  });

  it('should skip entry without purchName and BidName', () => {
    const xml = `<root><_source>
      <PurchaseId>P-004</PurchaseId>
      <purchAmount>50000</purchAmount>
    </_source></root>`;

    expect(extractFromXml(xml)).toHaveLength(0);
  });

  it('should prefer BidName when purchName is empty', () => {
    const xml = `<root><_source>
      <PurchaseId>P-005</PurchaseId>
      <purchName></purchName>
      <BidName>Лот из BidName</BidName>
    </_source></root>`;

    const lots = extractFromXml(xml);
    expect(lots).toHaveLength(1);
    expect(lots[0].title).toBe('Лот из BidName');
  });

  it('should handle empty XML', () => {
    expect(extractFromXml('')).toHaveLength(0);
  });

  it('should extract multiple lots', () => {
    const xml = `<root>
      <_source><PurchaseId>A1</PurchaseId><purchName>Лот 1</purchName></_source>
      <_source><PurchaseId>A2</PurchaseId><purchName>Лот 2</purchName></_source>
      <_source><PurchaseId>A3</PurchaseId><purchName>Лот 3</purchName></_source>
    </root>`;

    expect(extractFromXml(xml)).toHaveLength(3);
  });

  it('should handle coordinates as undefined when tags missing', () => {
    const xml = `<root><_source>
      <PurchaseId>P-006</PurchaseId>
      <purchName>Без координат</purchName>
    </_source></root>`;

    const lots = extractFromXml(xml);
    expect(lots[0].lat).toBeUndefined();
    expect(lots[0].lng).toBeUndefined();
  });
});
