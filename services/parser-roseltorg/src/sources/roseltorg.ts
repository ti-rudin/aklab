/**
 * Росэлторг (roseltorg.ru) — парсер коммерческой недвижимости.
 *
 * Playwright, HTML scraping. Таймаут с Mac — проверяем с сервера.
 */
import type { SourceParser, ParsedProperty } from '@aklab/service-shared';
import { logger } from '@aklab/service-shared';

const BASE_URL = 'https://roseltorg.ru';
const MAX_PAGES = 5;

function classifyPropertyType(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes('офис') || lower.includes('административн')) return 'office';
  if (lower.includes('склад') || lower.includes('хранилищ')) return 'warehouse';
  if (lower.includes('магазин') || lower.includes('торгов')) return 'retail';
  if (lower.includes('производствен') || lower.includes('промышлен')) return 'production';
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

export class RoseltorgParser implements SourceParser {
  name = 'roseltorg';

  async parse(): Promise<ParsedProperty[]> {
    const { chromium } = await import('playwright');
    logger.info('[roseltorg] Starting Playwright browser...');
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });

    try {
      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        locale: 'ru-RU',
      });
      const page = await context.newPage();
      const allProperties: ParsedProperty[] = [];

      const searchUrls = [
        `${BASE_URL}/lot-search`,
        `${BASE_URL}/search`,
        `${BASE_URL}/lots`,
        `${BASE_URL}/trades`,
        BASE_URL,
      ];

      let workingUrl = BASE_URL;
      for (const url of searchUrls) {
        try {
          const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
          if (resp && resp.ok()) { workingUrl = url; break; }
        } catch { continue; }
      }

      await page.waitForTimeout(5000);

      const cards = await page.evaluate(() => {
        const results: Array<{ title: string; link: string; price_text: string; excerpt: string }> = [];
        const selectors = [
          '.card', '.lot-card', '.trade-card', '.search-result',
          '.list-item', 'article', 'tr', '[class*="card"]', '[class*="lot"]',
        ];
        let found: Element[] = [];
        for (const sel of selectors) {
          found = Array.from(document.querySelectorAll(sel));
          if (found.length > 2) break;
        }
        for (const card of found.slice(0, 50)) {
          const el = card as HTMLElement;
          const linkEl = el.querySelector('a[href]') as HTMLAnchorElement;
          const titleEl = el.querySelector('h2, h3, h4, .title, [class*="title"], [class*="name"], td:nth-child(2)');
          const priceEl = el.querySelector('.price, [class*="price"], .cost, td:nth-child(3)');
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

      logger.info(`[roseltorg] Found ${cards.length} cards at ${workingUrl}`);

      for (const card of cards) {
        const area = extractArea(card.title + ' ' + card.excerpt);
        const price = parsePrice(card.price_text);
        const fullLink = card.link.startsWith('http') ? card.link : `${BASE_URL}${card.link}`;
        const excerpt = card.excerpt || '';
        const addrMatch = excerpt.match(/(?:адрес|ул\.|г\.|пр\.|просп|шоссе)[^,]*(?:,[^,]+){0,2}/i);
        const address = addrMatch ? addrMatch[0].trim() : '';

        allProperties.push({
          external_id: `roseltorg-${card.link.split('/').pop() || card.title.slice(0, 30)}`,
          url: fullLink,
          title: card.title,
          address,
          city: detectCity(card.title + ' ' + excerpt),
          area_sqm: area,
          price,
          price_per_sqm: price && area ? Math.round(price / area) : undefined,
          property_type: classifyPropertyType(card.title),
          auction_type: 'marketplace',
          description: excerpt.length > 20 ? excerpt.slice(0, 500) : undefined,
        });
      }

      logger.info(`[roseltorg] Total: ${allProperties.length} properties`);
      return allProperties;
    } catch (err: any) {
      logger.error(`[roseltorg] Parse error: ${err.message}`);
      throw err;
    } finally {
      await browser.close();
    }
  }
}

function detectCity(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes('москва') && !lower.includes('московская')) return 'moscow';
  if (lower.includes('московская') || lower.includes('подольск') || lower.includes('химки')) return 'mo';
  return 'other';
}
