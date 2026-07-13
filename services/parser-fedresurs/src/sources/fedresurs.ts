/**
 * Fedresurs (fedresurs.ru / bankrot.fedresurs.ru) — парсер банкротных торгов.
 *
 * Playwright для обхода Qrator anti-bot.
 * REST API: /backend/pledged-subjects (залоговое имущество) + /backend/biddings (торги).
 * Клиентская фильтрация по Москве и коммерческой недвижимости.
 */
import type { SourceParser, ParsedProperty } from '@aklab/service-shared';
import { logger, randomDelay, createStealthContext, retryGoto, detectCity, classifyPropertyType } from '@aklab/service-shared';

const FEDRESURS_URL = 'https://fedresurs.ru';
const BANKROT_URL = 'https://bankrot.fedresurs.ru';

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

function parsePriceValue(val: any): number | undefined {
  if (typeof val === 'number' && val > 0) return val;
  if (typeof val === 'string') {
    const cleaned = val.replace(/[^\d,]/g, '').replace(',', '.');
    const num = parseFloat(cleaned);
    if (!isNaN(num) && num > 0) return num;
  }
  return undefined;
}

function isCommercialRealEstate(text: string): boolean {
  const lower = text.toLowerCase();
  // Исключаем не-недвижимость
  if (EXCLUDE_KEYWORDS.some(kw => lower.includes(kw))) return false;
  // Проверяем коммерческие ключевые слова
  return COMMERCIAL_KEYWORDS.some(kw => lower.includes(kw));
}

function isMoscow(text: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  return /(?:^|[\s,.()])москва(?:[\s,.()]|$)/i.test(text) ||
         /московск/i.test(text) ||
         /\b77\b/.test(text); // код Москвы
}

export class FedresursParser implements SourceParser {
  name = 'fedresurs';

  async parse(depth?: number): Promise<ParsedProperty[]> {
    const { chromium } = await import('playwright');

    logger.info('[fedresurs] Starting Playwright browser...');
    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
      const allProperties: ParsedProperty[] = [];

      // === STEP 1: Pledged subjects (залоговое имущество) ===
      const pledgedPage = await this.openWithQrator(browser, FEDRESURS_URL);
      try {
        const pledged = await this.fetchPledgedSubjects(pledgedPage);
        allProperties.push(...pledged);
        logger.info(`[fedresurs] Pledged subjects: ${pledged.length} Moscow commercial`);
      } finally {
        await pledgedPage.close();
      }

      // === STEP 2: Biddings → Lots (торги) ===
      await randomDelay(3000, 5000);
      const biddingsPage = await this.openWithQrator(browser, FEDRESURS_URL);
      try {
        const lots = await this.fetchBiddingLots(biddingsPage, depth);
        allProperties.push(...lots);
        logger.info(`[fedresurs] Bidding lots: ${lots.length} Moscow commercial`);
      } finally {
        await biddingsPage.close();
      }

      // Дедупликация по external_id
      const seen = new Set<string>();
      const unique = allProperties.filter(p => {
        if (seen.has(p.external_id)) return false;
        seen.add(p.external_id);
        return true;
      });

      logger.info(`[fedresurs] Total: ${unique.length} unique Moscow commercial properties`);
      return unique;
    } catch (err: any) {
      logger.error(`[fedresurs] Parse error: ${err.message}`);
      throw err;
    } finally {
      await browser.close();
    }
  }

  /**
   * Открыть страницу и дождаться Qrator cookies
   */
  private async openWithQrator(browser: any, url: string) {
    const context = await createStealthContext(browser);
    const page = await context.newPage();

    logger.info(`[fedresurs] Navigating to ${url} for Qrator challenge...`);
    await retryGoto(page, url, 3);

    // Ждём qrator_ssid2 cookie (Qrator JS challenge)
    let cookieSet = false;
    for (let i = 0; i < 30; i++) {
      const cookies = await context.cookies();
      const qrator = cookies.find((c: any) => c.name === 'qrator_ssid2' || c.name === 'qrator_jsid');
      if (qrator) {
        cookieSet = true;
        logger.info(`[fedresurs] Qrator cookie set: ${qrator.name}`);
        break;
      }
      await page.waitForTimeout(1000);
    }

    if (!cookieSet) {
      logger.warn('[fedresurs] Qrator cookie not set after 30s — continuing anyway');
    }

    return page;
  }

  /**
   * Залоговое имущество — лучший источник для недвижимости
   */
  private async fetchPledgedSubjects(page: any): Promise<ParsedProperty[]> {
    const results: ParsedProperty[] = [];
    const limit = 100;
    let offset = 0;

    while (true) {
      logger.info(`[fedresurs] Fetching pledged-subjects offset=${offset}...`);
      const data = await page.evaluate(async (off: number, lim: number) => {
        const res = await fetch(`/backend/pledged-subjects?limit=${lim}&offset=${off}&onlyAvailableToParticipate=false`, {
          headers: { 'Accept': 'application/json' },
        });
        if (!res.ok) return { error: res.status };
        return res.json();
      }, offset, limit) as any;

      if (data.error) {
        logger.warn(`[fedresurs] pledged-subjects error: HTTP ${data.error}`);
        break;
      }

      const items = data.pageData || [];
      if (items.length === 0) break;

      for (const item of items) {
        const pledge = item.pledge || {};
        const address = pledge.address || '';
        const description = pledge.description || '';
        const fullText = `${address} ${description}`;

        // Фильтр: Москва + коммерческая недвижимость
        if (!isMoscow(fullText)) continue;
        if (!isCommercialRealEstate(fullText)) continue;

        const area = extractArea(description);
        const price = parsePriceValue(item.startPrice);

        results.push({
          external_id: `fedresurs-pledged-${item.guid || item.tradeNumber}`,
          url: item.tradeLink ? `${FEDRESURS_URL}${item.tradeLink}` : `${FEDRESURS_URL}/trades/${item.tradeNumber}`,
          title: `Лот ${item.tradeNumber || ''}: ${description.slice(0, 100)}`.trim(),
          address: address || undefined,
          city: 'moscow', // уже отфильтровали по Москве
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
      await randomDelay(2000, 4000);
    }

    return results;
  }

  /**
   * Торги → лоты — больше данных, но описание в HTML
   */
  private async fetchBiddingLots(page: any, depth?: number): Promise<ParsedProperty[]> {
    const results: ParsedProperty[] = [];
    const limit = 50;
    let offset = 0;
    const maxItems = depth || 500;

    // Получаем список торгов
    while (results.length < maxItems) {
      logger.info(`[fedresurs] Fetching biddings offset=${offset}...`);
      const data = await page.evaluate(async (off: number, lim: number) => {
        const res = await fetch(`/backend/biddings?limit=${lim}&offset=${off}&onlyAvailableToParticipate=true`, {
          headers: { 'Accept': 'application/json' },
        });
        if (!res.ok) return { error: res.status };
        return res.json();
      }, offset, limit) as any;

      if (data.error) {
        logger.warn(`[fedresurs] biddings error: HTTP ${data.error}`);
        break;
      }

      const biddings = data.pageData || [];
      if (biddings.length === 0) break;

      for (const bidding of biddings) {
        if (results.length >= maxItems) break;

        // Получаем лоты торгов
        await randomDelay(1000, 2000);
        const lotsData = await page.evaluate(async (guid: string) => {
          const res = await fetch(`/backend/biddings/${guid}/lots?limit=20&offset=0`, {
            headers: { 'Accept': 'application/json' },
          });
          if (!res.ok) return { error: res.status };
          return res.json();
        }, bidding.guid) as any;

        if (lotsData.error) continue;

        const lots = lotsData.pageData || [];
        for (const lot of lots) {
          const tradeObject = lot.tradeObject || '';
          const fullText = `${tradeObject} ${bidding.debtor?.name || ''}`;

          // Фильтр: Москва + коммерческая недвижимость
          if (!isMoscow(fullText)) continue;
          if (!isCommercialRealEstate(tradeObject)) continue;

          const area = extractArea(tradeObject);
          const price = parsePriceValue(lot.startPrice);

          // Извлекаем адрес из HTML описания
          const addrMatch = tradeObject.match(/(?:адрес|расположен|находится)[:\s]*([^<\n]{5,100})/i);
          const address = addrMatch ? addrMatch[1].trim() : '';

          results.push({
            external_id: `fedresurs-lot-${lot.guid || `${bidding.guid}-${lot.number}`}`,
            url: `${FEDRESURS_URL}/TradeCard/${bidding.guid}`,
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

      offset += limit;
      if (biddings.length < limit) break;
      await randomDelay(2000, 4000);
    }

    return results;
  }

  async fetchDetails(url: string): Promise<Partial<ParsedProperty>> {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
      const page = await this.openWithQrator(browser, url);

      // Извлекаем детали со страницы торгов
      const details = await page.evaluate(() => {
        const body = document.body.innerText || '';
        const addressMatch = body.match(/адрес[:\s]*([^\n]{5,200})/i);
        const areaMatch = body.match(/(\d[\d\s]*[,.]?\d*)\s*(?:кв\.?\s*м|м²|м2)/i);

        return {
          address: addressMatch ? addressMatch[1].trim() : undefined,
          area_sqm: areaMatch ? parseFloat(areaMatch[1].replace(/\s/g, '').replace(',', '.')) : undefined,
          description: body.slice(0, 1000),
        };
      });

      // Moscow fallback
      if (details.description) {
        const moscowMatch = details.description.match(/((?:г\.?\s*)?Москва[^,\n]{0,30}(?:,\s*[^,\n]+){0,3})/i);
        if (moscowMatch && !details.address) {
          details.address = moscowMatch[1].trim().slice(0, 300);
        }
      }

      return {
        address: details.address,
        description: details.description,
        area_sqm: details.area_sqm,
      };
    } catch (err: any) {
      logger.warn(`[fedresurs] fetchDetails error for ${url}: ${err.message}`);
      return {};
    } finally {
      await browser.close();
    }
  }
}
