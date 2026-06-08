/**
 * Fedresurs (bankrot.fedresurs.ru) — парсер торгов по банкротству.
 *
 * Использует REST API: /backend/cmpbankrupts → /companies/{guid}/trades
 * Требует русский IP (geo-block HTTP 451 с нерусских).
 * Playwright для обхода Qrator JS challenge.
 *
 * КРИТИЧНО: используется page.request.get() (а не page.evaluate(fetch())),
 * т.к. только page.request несёт cookies, установленные Qrator.
 */

import type { SourceParser, ParsedProperty } from './types';
import { logger } from '../utils/logger';

const FEDRESURS_URL = 'https://bankrot.fedresurs.ru';

function classifyPropertyType(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes('офис') || lower.includes('административн')) return 'office';
  if (lower.includes('склад') || lower.includes('хранилищ')) return 'warehouse';
  if (lower.includes('магазин') || lower.includes('торгов') || lower.includes('павильон')) return 'retail';
  if (lower.includes('производствен') || lower.includes(' мощн') || lower.includes('цех')) return 'production';
  if (lower.includes('нежилое') || lower.includes('помещение') || lower.includes('коммерческ')) return 'free_purpose';
  return 'other';
}

function detectCity(address: string): string {
  const lower = address.toLowerCase();
  if (lower.includes('москва') && !lower.includes('московская')) return 'moscow';
  if (lower.includes('московская область') || lower.includes('московская обл') ||
      lower.includes('подольск') || lower.includes('химки') || lower.includes('мытищи') ||
      lower.includes('балашиха') || lower.includes('одинцово') || lower.includes('пушкин')) return 'mo';
  return 'other';
}

export class FedresursParser implements SourceParser {
  name = 'fedresurs';

  async parse(): Promise<ParsedProperty[]> {
    const { chromium } = await import('playwright');

    logger.info('[fedresurs] Starting Playwright browser...');
    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        locale: 'ru-RU',
        extraHTTPHeaders: {
          'Accept-Language': 'ru-RU,ru;q=0.9',
        },
      });

      // Убираем webdriver detection
      await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
      });

      const page = await context.newPage();

      // Сначала заходим на главную чтобы получить Qrator cookies
      logger.info('[fedresurs] Warming up session...');
      try {
        await page.goto(FEDRESURS_URL, {
          waitUntil: 'domcontentloaded',
          timeout: 20000,
        });
        await page.waitForTimeout(5000);
        logger.info('[fedresurs] Session warmed up, cookies acquired');
      } catch (e: any) {
        logger.warn(`[fedresurs] Warm-up failed: ${e.message}`);
      }

      // Теперь вызываем REST API через page.request (НЕ page.evaluate!)
      const allProperties: ParsedProperty[] = [];
      const limit = 50;
      let offset = 0;
      let hasMore = true;

      while (hasMore && offset < 500) { // Макс 500 за запуск
        const apiUrl = `${FEDRESURS_URL}/backend/cmpbankrupts?isActiveLegalCase=true&limit=${limit}&offset=${offset}`;
        logger.info(`[fedresurs] Fetching: ${apiUrl}`);

        try {
          const response = await page.request.get(apiUrl, {
            headers: {
              'Accept': 'application/json',
              'Referer': 'https://bankrot.fedresurs.ru/',
            },
          });

          if (!response.ok()) {
            const status = response.status();
            logger.warn(`[fedresurs] API returned ${status}`);
            if (status === 451 || status === 403) {
              logger.error(`[fedresurs] Blocked (${status}) — geo-block or anti-bot`);
              break;
            }
            throw new Error(`Fedresurs API error: ${status}`);
          }

          const data = await response.json() as any;
          const items = data?.pageData || data?.items || data || [];

          if (!Array.isArray(items) || items.length === 0) {
            hasMore = false;
            break;
          }

          logger.info(`[fedresurs] Got ${items.length} bankrupts at offset ${offset}`);

          // Для каждого банкрота получаем торги
          for (const item of items) {
            const guid = item.guid || item.id;
            if (!guid) continue;

            try {
              const tradesUrl = `${FEDRESURS_URL}/backend/companies/${guid}/trades?limit=20&offset=0`;
              const tradesResp = await page.request.get(tradesUrl, {
                headers: {
                  'Accept': 'application/json',
                  'Referer': 'https://bankrot.fedresurs.ru/',
                },
              });

              if (!tradesResp.ok()) continue;

              const tradesData = await tradesResp.json() as any;
              const trades = tradesData?.pageData || tradesData?.items || tradesData || [];

              for (const trade of trades) {
                // Ищем торги с недвижимостью
                const description = trade.description || trade.name || trade.lotName || '';
                const address = trade.address || trade.lotAddress || trade.location || '';
                const fullText = `${description} ${address}`.toLowerCase();

                const isProperty = [
                  'нежилое', 'помещение', 'офис', 'склад', 'магазин', 'здание',
                  'сооружение', 'гараж', 'паркинг', 'земельный участок',
                  'коммерческ', 'торгов', 'административн', 'производствен',
                  'кв.м', 'м²', 'недвижим',
                ].some(kw => fullText.includes(kw));

                if (!isProperty) continue;

                const tradeId = trade.guid || trade.id || trade.tradeId;
                const price = trade.startPrice || trade.price || trade.initialPrice;
                const area = trade.area || trade.lotArea;

                allProperties.push({
                  external_id: `fedresurs-${tradeId}`,
                  url: trade.url || `${FEDRESURS_URL}/TradeCard.aspx?id=${tradeId}`,
                  title: description || `Торги ${tradeId}`,
                  address: address || 'Адрес не указан',
                  city: detectCity(address || description),
                  area_sqm: typeof area === 'number' ? area : undefined,
                  price: typeof price === 'number' ? price : undefined,
                  price_per_sqm: price && area ? Math.round(price / area) : undefined,
                  property_type: classifyPropertyType(fullText),
                  auction_type: 'bankruptcy',
                });
              }

              // Пауза между запросами
              await page.waitForTimeout(500);
            } catch (err: any) {
              logger.warn(`[fedresurs] Failed to fetch trades for ${guid}: ${err.message}`);
            }
          }

          offset += limit;
          hasMore = items.length >= limit;
        } catch (err: any) {
          logger.error(`[fedresurs] API call failed: ${err.message}`);
          throw err;
        }
      }

      logger.info(`[fedresurs] Total: ${allProperties.length} properties`);
      return allProperties;

    } catch (err: any) {
      logger.error(`[fedresurs] Parse error: ${err.message}`);
      throw err;
    } finally {
      await browser.close();
    }
  }
}
