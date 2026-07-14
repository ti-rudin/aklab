/**
 * Fedresurs (fedresurs.ru / bankrot.fedresurs.ru) — парсер банкротных торгов.
 *
 * curl_cffi (Python) для обхода Qrator anti-bot через /qauth endpoint.
 * REST API: /backend/pledged-subjects + /backend/biddings.
 * Клиентская фильтрация по Москве и коммерческой недвижимости.
 */
import type { SourceParser, ParsedProperty } from '@aklab/service-shared';
import { logger, classifyPropertyType } from '@aklab/service-shared';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execFileAsync = promisify(execFile);

// Ключевые слова коммерческой недвижимости
const COMMERCIAL_KEYWORDS = [
  'нежилое', 'нежилого', 'нежилые', 'нежилых',
  'коммерческ', 'офис', 'магазин', 'торгов', 'склад', 'складск',
  'помещение', 'помещения', 'здание', 'сооружение',
  'павильон', 'ангар', 'гараж', 'машино-мест', 'машиномест',
  'гостиниц', 'отель', 'мойка', 'автомойк', 'сто', 'автосалон',
  'азс', 'псн', 'производствен', 'промышлен',
  'база', 'мастерская', 'ателье', 'салон',
];

// Ключевые слова НЕ-недвижимости
const EXCLUDE_KEYWORDS = [
  'автомобил', 'транспортн', 'автобус', 'грузов', 'легков',
  'прицеп', 'полуприцеп', 'мотоцикл', 'квадроцикл',
  'земельн', 'земл', 'участок',
  'оборудован', 'станок', 'аппарат', 'механизм',
  'мебель', 'одежда', 'обувь', 'бытов',
  'акци', 'дол', 'доля', 'уставн',
  'дебитор', 'задолжен',
];

function extractArea(text: string): number | undefined {
  if (!text) return undefined;
  const match = text.match(/(\d[\d\s]*[,.]?\d*)\s*(?:кв\.?\s*м|м²|м2)/i);
  if (match) {
    const cleaned = match[1].replace(/\s/g, '').replace(',', '.');
    const num = parseFloat(cleaned);
    if (!isNaN(num) && num > 0) return num;
  }
  return undefined;
}

function isCommercialRealEstate(text: string): boolean {
  const lower = text.toLowerCase();
  if (EXCLUDE_KEYWORDS.some(kw => lower.includes(kw))) return false;
  return COMMERCIAL_KEYWORDS.some(kw => lower.includes(kw));
}

function isMoscow(text: string): boolean {
  if (!text) return false;
  return /(?:^|[\s,.()])москва(?:[\s,.()]|$)/i.test(text) ||
         /московск/i.test(text);
}

/**
 * Call Python curl_cffi client script
 */
async function callClient(command: string, ...args: string[]): Promise<any> {
  const scriptPath = path.join(__dirname, 'fedresurs_client.py');
  try {
    const { stdout, stderr } = await execFileAsync('python3', [scriptPath, command, ...args], {
      timeout: 120000,
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });
    if (stderr) {
      logger.debug(`[fedresurs] python stderr: ${stderr.slice(0, 200)}`);
    }
    return JSON.parse(stdout);
  } catch (err: any) {
    logger.error(`[fedresurs] python client error: ${err.message}`);
    throw err;
  }
}

export class FedresursParser implements SourceParser {
  name = 'fedresurs';

  async parse(depth?: number): Promise<ParsedProperty[]> {
    logger.info('[fedresurs] Starting parse via curl_cffi...');
    const allProperties: ParsedProperty[] = [];

    // === STEP 1: Pledged subjects ===
    try {
      const pledged = await this.fetchPledgedSubjects();
      allProperties.push(...pledged);
      logger.info(`[fedresurs] Pledged subjects: ${pledged.length} Moscow commercial`);
    } catch (err: any) {
      logger.error(`[fedresurs] Pledged subjects error: ${err.message}`);
    }

    // === STEP 2: Biddings → Lots ===
    try {
      const lots = await this.fetchBiddingLots(depth);
      allProperties.push(...lots);
      logger.info(`[fedresurs] Bidding lots: ${lots.length} Moscow commercial`);
    } catch (err: any) {
      logger.error(`[fedresurs] Bidding lots error: ${err.message}`);
    }

    // Дедупликация
    const seen = new Set<string>();
    const unique = allProperties.filter(p => {
      if (seen.has(p.external_id)) return false;
      seen.add(p.external_id);
      return true;
    });

    logger.info(`[fedresurs] Total: ${unique.length} unique Moscow commercial properties`);
    return unique;
  }

  private async fetchPledgedSubjects(): Promise<ParsedProperty[]> {
    const results: ParsedProperty[] = [];
    const limit = 100;
    let offset = 0;

    while (true) {
      logger.info(`[fedresurs] Fetching pledged-subjects offset=${offset}...`);
      const data = await callClient('pledged-subjects', String(limit), String(offset));

      if (data.error) {
        logger.warn(`[fedresurs] pledged-subjects error: ${JSON.stringify(data.error)}`);
        break;
      }

      const items = data.pageData || [];
      if (items.length === 0) break;

      for (const item of items) {
        const pledge = item.pledge || {};
        const address = pledge.address || '';
        const description = pledge.description || '';
        const fullText = `${address} ${description}`;

        if (!isMoscow(fullText)) continue;
        if (!isCommercialRealEstate(fullText)) continue;

        const area = extractArea(description);
        const price = typeof item.startPrice === 'number' ? item.startPrice : undefined;

        results.push({
          external_id: `fedresurs-pledged-${item.guid || item.tradeNumber}`,
          url: item.tradeLink ? `https://fedresurs.ru/TradeCard/${item.guid}` : `https://fedresurs.ru/trades/${item.tradeNumber}`,
          title: `Лот ${item.tradeNumber || ''}: ${description.slice(0, 100)}`.trim(),
          address: address || undefined,
          city: 'moscow',
          area_sqm: area,
          price,
          price_per_sqm: price && area ? Math.round(price / area) : undefined,
          property_type: classifyPropertyType(fullText),
          auction_type: 'bankruptcy',
          description: description.slice(0, 500) || undefined,
        });
      }

      offset += limit;
      if (items.length < limit) break;
    }

    return results;
  }

  private async fetchBiddingLots(depth?: number): Promise<ParsedProperty[]> {
    const results: ParsedProperty[] = [];
    const limit = 50;
    let offset = 0;
    const maxItems = depth || 500;

    while (results.length < maxItems) {
      logger.info(`[fedresurs] Fetching biddings offset=${offset}...`);
      const data = await callClient('biddings', String(limit), String(offset));

      if (data.error) {
        logger.warn(`[fedresurs] biddings error: ${JSON.stringify(data.error)}`);
        break;
      }

      const biddings = data.pageData || [];
      if (biddings.length === 0) break;

      for (const bidding of biddings) {
        if (results.length >= maxItems) break;

        // Get lots for this bidding
        try {
          const lotsData = await callClient('lots', bidding.guid);
          if (lotsData.error) continue;

          const lots = lotsData.pageData || [];
          for (const lot of lots) {
            const tradeObject = lot.tradeObject || '';
            const fullText = `${tradeObject} ${bidding.debtor?.name || ''}`;

            if (!isMoscow(fullText)) continue;
            if (!isCommercialRealEstate(tradeObject)) continue;

            const area = extractArea(tradeObject);
            const price = typeof lot.startPrice === 'number' ? lot.startPrice : undefined;
            const addrMatch = tradeObject.match(/(?:адрес|расположен|находится)[:\s]*([^<\n]{5,100})/i);
            const address = addrMatch ? addrMatch[1].trim() : '';

            results.push({
              external_id: `fedresurs-lot-${lot.guid || `${bidding.guid}-${lot.number}`}`,
              url: `https://fedresurs.ru/TradeCard/${bidding.guid}`,
              title: `Торги ${bidding.number || ''}, лот ${lot.number || ''}: ${tradeObject.replace(/<[^>]+>/g, '').slice(0, 100)}`.trim(),
              address: address || undefined,
              city: 'moscow',
              area_sqm: area,
              price,
              price_per_sqm: price && area ? Math.round(price / area) : undefined,
              property_type: classifyPropertyType(tradeObject),
              auction_type: 'bankruptcy',
              description: tradeObject.replace(/<[^>]+>/g, '').slice(0, 500) || undefined,
            });
          }
        } catch (err: any) {
          logger.debug(`[fedresurs] lots error for ${bidding.guid}: ${err.message}`);
        }
      }

      offset += limit;
      if (biddings.length < limit) break;
    }

    return results;
  }

  async fetchDetails(url: string): Promise<Partial<ParsedProperty>> {
    // Details are already fetched in parse() via API
    // This is a fallback for any URL-based detail fetching
    logger.debug(`[fedresurs] fetchDetails called for ${url} — returning empty (details in parse)`);
    return {};
  }
}
