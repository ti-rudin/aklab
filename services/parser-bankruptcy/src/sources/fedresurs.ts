/**
 * Fedresurs (bankrot.fedresurs.ru) — парсер торгов по банкротству.
 *
 * Стратегия: navigate → page.goto() с JSON-эндпоинтом.
 * Qrator пропускает page.goto() (полная навигация), но блокирует
 * page.evaluate(fetch()) и page.request.get().
 *
 * Требует русский IP (geo-block HTTP 451 с нерусских).
 */

import type { SourceParser, ParsedProperty } from './types';
import { logger } from '../utils/logger';

const FEDRESURS_URL = 'https://bankrot.fedresurs.ru';

function classifyPropertyType(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes('офис') || lower.includes('административн')) return 'office';
  if (lower.includes('склад') || lower.includes('хранилищ')) return 'warehouse';
  if (lower.includes('магазин') || lower.includes('торгов') || lower.includes('павильон')) return 'retail';
  if (lower.includes('производствен') || lower.includes('промышленн') || lower.includes('цех')) return 'production';
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
          waitUntil: 'networkidle',
          timeout: 30000,
        });
        logger.info('[fedresurs] Session warmed up');
      } catch (e: any) {
        logger.warn(`[fedresurs] Warm-up failed: ${e.message}`);
      }

      // Стратегия: перехватываем API ответы при навигации на страницу банкротств
      const allProperties: ParsedProperty[] = [];
      const apiResponses: any[] = [];

      // Перехватываем ответы от API
      page.on('response', async (response) => {
        const url = response.url();
        if (url.includes('/backend/cmpbankrupts') || url.includes('/backend/SearchDebtors')) {
          try {
            const data = await response.json();
            apiResponses.push({ url, data });
            logger.info(`[fedresurs] Intercepted API: ${url} → ${JSON.stringify(data).substring(0, 200)}`);
          } catch {}
        }
      });

      // Навигация на страницу поиска банкротств
      logger.info('[fedresurs] Navigating to bankruptcy search page...');
      try {
        await page.goto(`${FEDRESURS_URL}/CompanySearch.aspx?attempt=1`, {
          waitUntil: 'networkidle',
          timeout: 30000,
        });
        await page.waitForTimeout(5000);
      } catch (e: any) {
        logger.warn(`[fedresurs] Navigation failed: ${e.message}`);
      }

      // Если перехватили API ответы — обрабатываем
      if (apiResponses.length > 0) {
        logger.info(`[fedresurs] Intercepted ${apiResponses.length} API responses`);
        for (const resp of apiResponses) {
          const items = resp.data?.pageData || resp.data?.items || resp.data || [];
          if (Array.isArray(items)) {
            for (const item of items) {
              // Обработка банкротов — ищем торги
              const guid = item.guid || item.id;
              if (!guid) continue;

              try {
                // Для получения торгов — навигация на страницу компании
                const tradesUrl = `${FEDRESURS_URL}/backend/companies/${guid}/trades?limit=20&offset=0`;
                // Попробуем page.evaluate(fetch) — с cookies от навигации
                const tradesData = await page.evaluate(async (url) => {
                  try {
                    const resp = await fetch(url, {
                      headers: { 'Accept': 'application/json', 'Referer': window.location.href },
                    });
                    if (!resp.ok) return null;
                    return await resp.json();
                  } catch { return null; }
                }, tradesUrl);

                if (!tradesData) continue;
                const trades = tradesData?.pageData || tradesData?.items || tradesData || [];

                for (const trade of trades) {
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

                await page.waitForTimeout(300);
              } catch (err: any) {
                logger.warn(`[fedresurs] Failed trades for ${guid}: ${err.message}`);
              }
            }
          }
        }
      } else {
        // Fallback: прямой page.goto на API URL (Qrator может пропустить)
        logger.info('[fedresurs] No API intercepted, trying direct goto...');
        const limit = 50;
        let offset = 0;

        for (let attempt = 0; attempt < 10 && offset < 500; attempt++) {
          const apiUrl = `${FEDRESURS_URL}/backend/cmpbankrupts?isActiveLegalCase=true&limit=${limit}&offset=${offset}`;
          try {
            const response = await page.goto(apiUrl, { timeout: 20000 });
            if (!response || !response.ok()) {
              logger.warn(`[fedresurs] Direct goto returned ${response?.status()}`);
              break;
            }

            const body = await response.text();
            let data: any;
            try { data = JSON.parse(body); } catch {
              logger.warn('[fedresurs] Response is not JSON');
              break;
            }

            const items = data?.pageData || data?.items || data || [];
            if (!Array.isArray(items) || items.length === 0) break;

            logger.info(`[fedresurs] Got ${items.length} items at offset ${offset}`);

            for (const item of items) {
              const description = item.description || item.name || '';
              const address = item.address || '';
              const tradeId = item.guid || item.id;
              if (!tradeId) continue;

              const fullText = `${description} ${address}`.toLowerCase();
              const isProperty = [
                'нежилое', 'помещение', 'офис', 'склад', 'магазин', 'здание',
                'сооружение', 'гараж', 'паркинг', 'земельный участок',
                'коммерческ', 'торгов', 'административн', 'производствен',
                'кв.м', 'м²', 'недвижим',
              ].some(kw => fullText.includes(kw));

              if (!isProperty) continue;

              const price = item.startPrice || item.price;
              const area = item.area || item.lotArea;

              allProperties.push({
                external_id: `fedresurs-${tradeId}`,
                url: `${FEDRESURS_URL}/TradeCard.aspx?id=${tradeId}`,
                title: description || `Банкрот ${tradeId}`,
                address: address || 'Адрес не указан',
                city: detectCity(address || description),
                area_sqm: typeof area === 'number' ? area : undefined,
                price: typeof price === 'number' ? price : undefined,
                price_per_sqm: price && area ? Math.round(price / area) : undefined,
                property_type: classifyPropertyType(fullText),
                auction_type: 'bankruptcy',
              });
            }

            offset += limit;
          } catch (err: any) {
            logger.error(`[fedresurs] Direct goto failed: ${err.message}`);
            break;
          }
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
