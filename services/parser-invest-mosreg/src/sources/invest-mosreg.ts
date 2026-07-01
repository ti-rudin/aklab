/**
 * Инвестиционный портал МО (invest.mosreg.ru) — парсер коммерческой недвижимости.
 *
 * Playwright, HTML scraping.
 */
import type { SourceParser, ParsedProperty } from '@aklab/service-shared';
import { logger } from '@aklab/service-shared';

const BASE_URL = 'https://invest.mosreg.ru';
const MAX_PAGES = 5;
const MAX_AGE_HOURS = 24;

function classifyPropertyType(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes('офис') || lower.includes('административн')) return 'office';
  if (lower.includes('склад') || lower.includes('хранилищ')) return 'warehouse';
  if (lower.includes('магазин') || lower.includes('торгов')) return 'retail';
  if (lower.includes('производствен') || lower.includes('промышленн')) return 'production';
  if (lower.includes('нежилое') || lower.includes('помещение') || lower.includes('коммерческ') ||
      lower.includes('гараж') || lower.includes('здани')) return 'free_purpose';
  return 'other';
}

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

export class InvestMosregParser implements SourceParser {
  name = 'invest-mosreg';

  async parse(): Promise<ParsedProperty[]> {
    const { chromium } = await import('playwright');
    logger.info('[invest-mosreg] Starting Playwright browser...');
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });

    try {
      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        locale: 'ru-RU',
      });
      const page = await context.newPage();
      const allProperties: ParsedProperty[] = [];

      // Ищем страницу с объектами недвижимости
      const searchUrls = [
        `${BASE_URL}/investicyonnaya-karta/obekty`,
        `${BASE_URL}/objects`,
        `${BASE_URL}/commercial`,
        `${BASE_URL}/property`,
      ];

      let workingUrl = BASE_URL;
      for (const url of searchUrls) {
        try {
          const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
          if (resp && resp.ok()) { workingUrl = url; break; }
        } catch { continue; }
      }

      await page.waitForTimeout(3000);

      // Универсальный сборщик карточек
      const cards = await page.evaluate(() => {
        const results: Array<{ title: string; link: string; price_text: string; excerpt: string }> = [];
        // Пробуем различные селекторы карточек
        const selectors = [
          '.card', '.object-card', '.lot-card', '.property-card',
          '.catalog-item', '.list-item', 'article', '.item',
          '[class*="card"]', '[class*="object"]', '[class*="lot"]',
        ];
        let found: Element[] = [];
        for (const sel of selectors) {
          found = Array.from(document.querySelectorAll(sel));
          if (found.length > 2) break;
        }
        for (const card of found.slice(0, 50)) {
          const el = card as HTMLElement;
          const linkEl = el.querySelector('a[href]') as HTMLAnchorElement;
          const titleEl = el.querySelector('h2, h3, h4, .title, [class*="title"], [class*="name"]');
          const priceEl = el.querySelector('.price, [class*="price"], .cost');
          const title = titleEl?.textContent?.trim() || linkEl?.textContent?.trim() || '';
          if (!title || title.length < 5) continue;
          results.push({
            title: title.slice(0, 200),
            link: linkEl?.href || '',
            price_text: priceEl?.textContent?.trim() || '',
            excerpt: el.textContent?.trim().slice(0, 500) || '',
          });
        }
        return results;
      });

      logger.info(`[invest-mosreg] Found ${cards.length} cards at ${workingUrl}`);

      for (const card of cards) {
        const area = extractArea(card.title + ' ' + card.excerpt);
        const price = parsePrice(card.price_text);
        const fullLink = card.link.startsWith('http') ? card.link : `${BASE_URL}${card.link}`;
        const excerpt = card.excerpt || '';
        const addrMatch = excerpt.match(/(?:адрес|ул\.|г\.|пр\.|просп|шоссе)[^,]*(?:,[^,]+){0,2}/i);
        const address = addrMatch ? addrMatch[0].trim() : '';

        allProperties.push({
          external_id: `invest-mosreg-${card.link.split('/').pop() || card.title.slice(0, 30)}`,
          url: fullLink,
          title: card.title,
          address,
          city: 'mo',
          area_sqm: area,
          price,
          price_per_sqm: price && area ? Math.round(price / area) : undefined,
          property_type: classifyPropertyType(card.title),
          auction_type: 'marketplace',
          description: excerpt.length > 20 ? excerpt.slice(0, 500) : undefined,
        });
      }

      logger.info(`[invest-mosreg] Total: ${allProperties.length} properties`);
      return allProperties;
    } catch (err: any) {
      logger.error(`[invest-mosreg] Parse error: ${err.message}`);
      throw err;
    } finally {
      await browser.close();
    }
  }
}
