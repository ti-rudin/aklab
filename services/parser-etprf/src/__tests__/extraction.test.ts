import { describe, it, expect } from 'vitest';

/**
 * Тесты extraction-логики parser-etprf.
 *
 * Функции parsePrice и extractArea — приватные модулю.
 * Для тестирования воспроизводим их логику как standalone-функции.
 * Источник: services/parser-etprf/src/sources/etprf.ts
 */

// --- Replicated extraction functions from etprf.ts ---

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

// --- Tests ---

describe('etprf: parsePrice', () => {
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
    expect(parsePrice('0 RUB')).toBeUndefined();
  });

  it('should strip sign and parse absolute value (parser behavior)', () => {
    // The regex replace(/[^\d,]/g, '') strips the minus sign — this is actual behavior
    expect(parsePrice('-100')).toBe(100);
  });
});

describe('etprf: extractArea', () => {
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

  it('should extract area from "кв м" without dot', () => {
    expect(extractArea('Помещение 50 кв м')).toBe(50);
  });

  it('should return undefined for text without area', () => {
    expect(extractArea('Склад')).toBeUndefined();
  });

  it('should return undefined for empty string', () => {
    expect(extractArea('')).toBeUndefined();
  });

  it('should not match area of 0', () => {
    expect(extractArea('0 кв.м')).toBeUndefined();
  });
});

describe('etprf: table row extraction simulation', () => {
  /**
   * Simulate the page.evaluate() logic that extracts data from
   * <table class="reporttable"> rows on etprf.ru
   */

  interface TableRow {
    lot_id: string;
    notification: string;
    subject: string;
    price_text: string;
    status: string;
    detail_url: string;
  }

  function extractFromTableHtml(html: string): TableRow[] {
    // Simulates the DOM extraction logic from etprf.ts page.evaluate()
    const results: TableRow[] = [];

    const tableMatch = html.match(/<table[^>]*class="reporttable"[^>]*>([\s\S]*?)<\/table>/i);
    if (!tableMatch) return results;

    const tableHtml = tableMatch[1];
    const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let trMatch: RegExpExecArray | null;
    let isFirst = true;

    while ((trMatch = trRegex.exec(tableHtml)) !== null) {
      if (isFirst) { isFirst = false; continue; } // skip header row

      const trContent = trMatch[1];
      const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      const tds: string[] = [];
      let tdMatch: RegExpExecArray | null;
      while ((tdMatch = tdRegex.exec(trContent)) !== null) {
        tds.push(tdMatch[1].replace(/<[^>]+>/g, '').trim());
      }

      if (tds.length < 4) continue;

      const lotId = tds[0];
      const notification = tds[1];
      const subject = tds[2];
      const priceText = tds[3];
      const status = tds.length >= 9 ? tds[8] : '';

      const linkMatch = trContent.match(/href="([^"]*\/Notification\/id\/[^"]*)"/);
      const detailUrl = linkMatch ? linkMatch[1] : '';

      if (!lotId) continue;
      results.push({ lot_id: lotId, notification, subject, price_text: priceText, status, detail_url: detailUrl });
    }

    return results;
  }

  it('should extract lot data from table HTML', () => {
    const html = `
      <table class="reporttable">
        <tr><th>ID</th><th>Уведомление</th><th>Предмет</th><th>Цена</th><th></th><th></th><th></th><th></th><th>Статус</th></tr>
        <tr>
          <td>12345</td>
          <td>Торги №100</td>
          <td>Нежилое помещение 150 кв.м, г. Москва</td>
          <td>648 000,00 RUB</td>
          <td></td><td></td><td></td><td></td>
          <td>Активен</td>
        </tr>
      </table>
    `;
    const rows = extractFromTableHtml(html);
    expect(rows).toHaveLength(1);
    expect(rows[0].lot_id).toBe('12345');
    expect(rows[0].price_text).toBe('648 000,00 RUB');
    expect(rows[0].subject).toContain('150 кв.м');
  });

  it('should skip rows with fewer than 4 columns', () => {
    const html = `
      <table class="reporttable">
        <tr><th>A</th><th>B</th><th>C</th><th>D</th></tr>
        <tr><td>1</td><td>2</td><td>3</td></tr>
      </table>
    `;
    expect(extractFromTableHtml(html)).toHaveLength(0);
  });

  it('should return empty array when no table found', () => {
    expect(extractFromTableHtml('<div>No table here</div>')).toHaveLength(0);
  });

  it('should skip header row and process data rows', () => {
    const html = `
      <table class="reporttable">
        <tr><th>H1</th><th>H2</th><th>H3</th><th>H4</th></tr>
        <tr>
          <td>001</td>
          <td>Уведомление</td>
          <td>Помещение 85,3 м²</td>
          <td>500 000</td>
        </tr>
      </table>
    `;
    const rows = extractFromTableHtml(html);
    expect(rows).toHaveLength(1);
    expect(rows[0].lot_id).toBe('001');
    expect(rows[0].price_text).toBe('500 000');
  });
});
