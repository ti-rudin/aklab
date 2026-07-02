/**
 * Агрегатор банкрот (xn----etbpba5admdlad.xn--p1ai) — парсер коммерческой недвижимости.
 *
 * HTML scraping через Playwright. Сайт без anti-bot.
 * Search: /search?trades-section[0]=commercial
 * 27 карточек на страницу, ~48 страниц.
 * Площадь из excerpt текста: "Общая площадь: 274.4 м²"
 */
import type { SourceParser, ParsedProperty } from '@aklab/service-shared';
import { logger, randomDelay, createStealthContext, retryGoto } from '@aklab/service-shared';

const BASE_URL = 'https://xn----etbpba5admdlad.xn--p1ai';
const SEARCH_URL = `${BASE_URL}/search?trades-section%5B0%5D=commercial&history_only=0`;
const MAX_AGE_HOURS = 24;

function classifyPropertyType(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes('офис') || lower.includes('административн')) return 'office';
  if (lower.includes('склад') || lower.includes('хранилищ')) return 'warehouse';
  if (lower.includes('магазин') || lower.includes('торгов') || lower.includes('павильон')) return 'retail';
  if (lower.includes('производствен') || lower.includes('промышленн') || lower.includes('цех')) return 'production';
  if (lower.includes('нежилое') || lower.includes('помещение') || lower.includes('коммерческ') ||
      lower.includes('гараж') || lower.includes('бокс')) return 'free_purpose';
  return 'other';
}

function detectCity(address: string): string {
  const lower = address.toLowerCase();
  if (lower.includes('москва') && !lower.includes('московская')) return 'moscow';
  if (lower.includes('московская') || lower.includes('подольск') || lower.includes('химки') ||
      lower.includes('мытищи') || lower.includes('балашиха') || lower.includes('одинцово')) return 'mo';
  return 'other';
}

function parsePrice(text: string): number | undefined {
  if (!text) return undefined;
  const cleaned = text.replace(/[^\d,]/g, '').replace(',', '.');
  const num = parseFloat(cleaned);
  return !isNaN(num) && num > 0 ? num : undefined;
}

function extractArea(text: string): number | undefined {
  // "Общая площадь: 274.4 м²" or "Общая площадь: 274,4 м²"
  const match = text.match(/(?:общая\s+)?площад[ьи]?\s*:?\s*(\d[\d\s]*[,.]?\d*)\s*(?:кв\.?\s*м|м²|м2)/i);
  if (match) {
    const cleaned = match[1].replace(/\s/g, '').replace(',', '.');
    const num = parseFloat(cleaned);
    if (!isNaN(num) && num > 0) return num;
  }
  // Fallback: "9484 кв.м" без слова "площадь" (часто в title)
  const fallback = text.match(/(\d[\d\s]*[,.]?\d*)\s*(?:кв\.?\s*м|м²|м2)/i);
  if (fallback) {
    const cleaned = fallback[1].replace(/\s/g, '').replace(',', '.');
    const num = parseFloat(cleaned);
    if (!isNaN(num) && num > 0) return num;
  }
  // Сотки: "9 сот." → 900 м² (1 сотка = 100 м²)
  const sotka = text.match(/(\d[\d\s]*[,.]?\d*)\s*(?:сот\.?|соток|сотки|сотка)/i);
  if (sotka) {
    const cleaned = sotka[1].replace(/\s/g, '').replace(',', '.');
    const num = parseFloat(cleaned) * 100;
    if (!isNaN(num) && num > 0) return num;
  }
  return undefined;
}

export class AggregatorBankrotParser implements SourceParser {
  name = 'aggregator-bankrot';

  async parse(depth?: number): Promise<ParsedProperty[]> {
    const { chromium } = await import('playwright');

    logger.info('[aggregator-bankrot] Starting Playwright browser...');
    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
      const context = await createStealthContext(browser);
      const page = await context.newPage();
      const allProperties: ParsedProperty[] = [];
      const cutoff = Date.now() - MAX_AGE_HOURS * 3600 * 1000;

      const ITEMS_PER_PAGE = 27;
      const DEFAULT_MAX_PAGES = 10;
      const maxPages = depth ? Math.ceil(depth / ITEMS_PER_PAGE) : DEFAULT_MAX_PAGES;

      for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
        const url = pageNum === 1 ? SEARCH_URL : `${SEARCH_URL}&page=${pageNum}`;
        logger.info(`[aggregator-bankrot] Loading page ${pageNum}: ${url}`);

        // Пауза между страницами
        if (pageNum > 1) {
          await randomDelay(2000, 5000);
        }

        await retryGoto(page, url, 3);
        await page.waitForTimeout(3000);

        const cards = await page.evaluate(() => {
          const results: Array<{
            lot_id: string;
            title: string;
            link: string;
            price_text: string;
            excerpt: string;
          }> = [];

          const items = document.querySelectorAll('li.search-page-cards__item');
          for (const item of Array.from(items)) {
            const card = item.querySelector('article.card');
            if (!card) continue;

            const idEl = card.querySelector('.card-meta__item b.text-primary');
            const lotId = idEl?.textContent?.trim() || '';
            if (!lotId) continue;

            const titleEl = card.querySelector('h3.card__title a') as HTMLAnchorElement;
            const title = titleEl?.textContent?.trim() || '';
            const link = titleEl?.href || '';

            const bidsEl = card.querySelector('.card__bids');
            const currentBid = bidsEl?.getAttribute('data-current-bid') || '';
            const startBid = bidsEl?.getAttribute('data-start-bid') || '';
            const priceDisplay = card.querySelector('.bid__value')?.textContent?.trim() || '';
            const priceText = currentBid || startBid || priceDisplay;

            const excerpt = card.querySelector('.card__excerpt a')?.textContent?.trim() || '';

            results.push({ lot_id: lotId, title, link, price_text: priceText, excerpt });
          }
          return results;
        });

        logger.info(`[aggregator-bankrot] Page ${pageNum}: ${cards.length} cards`);

        let pageNewCount = 0;
        for (const card of cards) {
          // Приоритет: title (там "9484 кв.м"), потом excerpt (может быть площадь отдельного помещения)
          const area = extractArea(card.title) || extractArea(card.excerpt);
          const price = parsePrice(card.price_text);
          const address = card.excerpt.match(/(?:адрес|ул\.|ул\s|город|г\.|пос\.|дер\.)[^,]*/i)?.[0]?.trim() || '';

          allProperties.push({
            external_id: `aggregator-bankrot-${card.lot_id}`,
            url: card.link.startsWith('http') ? card.link : `${BASE_URL}${card.link}`,
            title: card.title,
            address,
            city: detectCity(address || card.title || card.excerpt),
            area_sqm: area,
            price,
            price_per_sqm: price && area ? Math.round(price / area) : undefined,
            property_type: classifyPropertyType(card.title + ' ' + card.excerpt),
            auction_type: 'bankruptcy',
            description: card.excerpt.length > 20 ? card.excerpt.slice(0, 500) : undefined,
          });
          pageNewCount++;
        }

        if (cards.length === 0) break;
      }

      logger.info(`[aggregator-bankrot] Total: ${allProperties.length} properties`);
      return allProperties;
    } catch (err: any) {
      logger.error(`[aggregator-bankrot] Parse error: ${err.message}`);
      throw err;
    } finally {
      await browser.close();
    }
  }
}
