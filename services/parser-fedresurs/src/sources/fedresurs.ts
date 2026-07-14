/**
 * Fedresurs — парсер банкротных торгов.
 * curl_cffi Python subprocess — batch mode (один вызов, все данные).
 */
import type { SourceParser, ParsedProperty } from '@aklab/service-shared';
import { logger, classifyPropertyType } from '@aklab/service-shared';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execFileAsync = promisify(execFile);

const COMMERCIAL_KEYWORDS = [
  'нежилое', 'нежилого', 'нежилые', 'нежилых',
  'коммерческ', 'офис', 'магазин', 'торгов', 'склад', 'складск',
  'помещение', 'помещения', 'здание', 'сооружение',
  'павильон', 'ангар', 'гараж', 'машино-мест', 'машиномест',
  'гостиниц', 'отель', 'мойка', 'автомойк', 'сто', 'автосалон',
  'азс', 'псн', 'производствен', 'промышлен',
  'база', 'мастерская', 'ателье', 'салон',
];

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

async function fetchAll(maxBiddings?: number): Promise<any> {
  const scriptPath = path.join(__dirname, 'fedresurs_client.py');
  const args = [scriptPath];
  if (maxBiddings) args.push(String(maxBiddings));

  logger.info(`[fedresurs] Calling Python client (maxBiddings=${maxBiddings || 'default'})...`);
  const { stdout, stderr } = await execFileAsync('python3', args, {
    timeout: 600000, // 10 min
    maxBuffer: 50 * 1024 * 1024, // 50MB
  });
  if (stderr) {
    logger.debug(`[fedresurs] python stderr: ${stderr.slice(0, 300)}`);
  }
  return JSON.parse(stdout);
}

export class FedresursParser implements SourceParser {
  name = 'fedresurs';

  async parse(depth?: number): Promise<ParsedProperty[]> {
    logger.info('[fedresurs] Starting batch parse via curl_cffi...');
    const allProperties: ParsedProperty[] = [];

    let data: any;
    try {
      data = await fetchAll(depth);
    } catch (err: any) {
      logger.error(`[fedresurs] Python client failed: ${err.message}`);
      return [];
    }

    if (data.errors?.length) {
      for (const err of data.errors) {
        logger.warn(`[fedresurs] API error: ${err}`);
      }
    }

    // === Process pledged subjects ===
    for (const item of (data.pledged_subjects || [])) {
      const pledge = item.pledge || {};
      const address = pledge.address || '';
      const description = pledge.description || '';
      const fullText = `${address} ${description}`;

      if (!isMoscow(fullText)) continue;
      if (!isCommercialRealEstate(fullText)) continue;

      const area = extractArea(description);
      const price = typeof item.startPrice === 'number' ? item.startPrice : undefined;

      allProperties.push({
        external_id: `fedresurs-pledged-${item.guid || item.tradeNumber}`,
        url: `https://fedresurs.ru/TradeCard/${item.guid || item.startMessage?.guid}`,
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

    // === Process biddings + lots ===
    for (const bidding of (data.biddings || [])) {
      const lots = bidding._lots || [];
      for (const lot of lots) {
        const tradeObject = lot.tradeObject || '';
        const fullText = `${tradeObject} ${bidding.debtor?.name || ''}`;

        if (!isMoscow(fullText)) continue;
        if (!isCommercialRealEstate(tradeObject)) continue;

        const area = extractArea(tradeObject);
        const price = typeof lot.startPrice === 'number' ? lot.startPrice : undefined;
        const addrMatch = tradeObject.match(/(?:адрес|расположен|находится)[:\s]*([^<\n]{5,100})/i);
        const address = addrMatch ? addrMatch[1].trim() : '';

        allProperties.push({
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

  async fetchDetails(_url: string): Promise<Partial<ParsedProperty>> {
    return {};
  }
}
