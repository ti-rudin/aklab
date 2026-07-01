/**
 * Alfot — парсер коммерческой недвижимости.
 *
 * SPA на ecosystem.alfalot.ru, Playwright.
 * Search: /showcase/list?categories=1 (Недвижимость)
 * 12 карточек на страницу, ~217 страниц.
 * Площадь из badges: title="Площадь: 112.00"
 */
import type { SourceParser, ParsedProperty } from '@aklab/service-shared';
import { logger } from '@aklab/service-shared';

const BASE_URL = 'https://ecosystem.alfalot.ru';
const SEARCH_URL = `${BASE_URL}/showcase/list?categories=1`;
const MAX_PAGES = 10;
const MAX_AGE_HOURS = 24;

function classifyPropertyType(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes('офис') || lower.includes('административн')) return 'office';
  if (lower.includes('склад') || lower.includes('хранилищ')) return 'warehouse';
  if (lower.includes('магазин') || lower.includes('торгов') || lower.includes('павильон')) return 'retail';
  if (lower.includes('производствен') || lower.includes('промышленн')) return 'production';
  if (lower.includes('нежилое') || lower.includes('помещение') || lower.includes('коммерческ') ||
      lower.includes('гараж') || lower.includes('земельн')) return 'free_purpose';
  return 'other';
}

function detectCity(address: string): string {
  const lower = address.toLowerCase();
  if (lower.includes('москва') && !lower.includes('московская')) return 'moscow';
  if (lower.includes('московская') || lower.includes('подольск') || lower.includes('химки') ||
      lower.includes('мытищи') || lower.includes('балашиха')) return 'mo';
  return 'other';
}

function parsePrice(text: string): number | undefined {
  if (!text) return undefined;
  const cleaned = text.replace(/[^\d,]/g, '').replace(',', '.');
  const num = parseFloat(cleaned);
  return !isNaN(num) && num > 0 ? num : undefined;
}

export class AlfalotParser implements SourceParser {
  name = 'alfalot';

  async parse(): Promise<ParsedProperty[]> {
    const { chromium } = await import('playwright');

    logger.info('[alfalot] Starting Playwright browser...');
    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        locale: 'ru-RU',
      });
      const page = await context.newPage();
      const allProperties: ParsedProperty[] = [];

      for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
        const url = pageNum === 1 ? SEARCH_URL : `${SEARCH_URL}&page=${pageNum}`;
        logger.info(`[alfalot] Loading page ${pageNum}: ${url}`);

        if (pageNum > 1) {
          const delay = 2000 + Math.random() * 3000;
          await new Promise(r => setTimeout(r, delay));
        }

        await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForTimeout(2000);

        const cards = await page.evaluate(() => {
          const results: Array<{
            lot_id: string;
            title: string;
            link: string;
            price_text: string;
            region: string;
            area: string;
            object_type: string;
            lot_number: string;
          }> = [];

          const items = document.querySelectorAll('.lot-card');
          for (const card of Array.from(items)) {
            const titleEl = card.querySelector('.card-info > a.font-bold') as HTMLAnchorElement;
            const title = titleEl?.textContent?.trim() || '';
            const link = titleEl?.getAttribute('href') || '';
            const lotId = link.match(/\/(\d+)$/)?.[1] || '';

            const priceEl = card.querySelector('.start-price .price-value');
            const priceText = priceEl?.textContent?.trim() || '';

            const regionEl = card.querySelector('.card-info > p');
            const region = regionEl?.textContent?.trim() || '';

            const lotNumEl = card.querySelector('.bargain-data > span:first-child');
            const lotNumber = lotNumEl?.textContent?.trim() || '';

            // Badges: title="Площадь: 112.00", "Тип объекта: ..."
            const badges = card.querySelectorAll('.extensions .whitespace-nowrap');
            let area = '';
            let objectType = '';
            for (const badge of Array.from(badges)) {
              const badgeTitle = badge.getAttribute('title') || '';
              if (badgeTitle.startsWith('Площадь:')) area = badgeTitle.replace('Площадь:', '').trim();
              if (badgeTitle.startsWith('Тип объекта:')) objectType = badgeTitle.replace('Тип объекта:', '').trim();
            }

            if (!lotId || !title) continue;
            results.push({ lot_id: lotId, title, link, price_text: priceText, region, area, object_type: objectType, lot_number: lotNumber });
          }
          return results;
        });

        logger.info(`[alfalot] Page ${pageNum}: ${cards.length} cards`);

        for (const card of cards) {
          // Title-first: "Сооружение 21 кв.м" → 21, badge may contain lot/building area
          const titleAreaMatch = card.title.match(/(\d[\d\s]*[,.]?\d*)\s*(?:кв\.?\s*м|м²|м2)/i);
          let area = titleAreaMatch
            ? parseFloat(titleAreaMatch[1].replace(/\s/g, '').replace(',', '.'))
            : undefined;
          if (!area || area <= 0) {
            area = card.area ? parseFloat(card.area.replace(',', '.')) : undefined;
          }
          const price = parsePrice(card.price_text);
          const fullLink = card.link.startsWith('http') ? card.link : `${BASE_URL}${card.link}`;

          const parts = [card.title, card.object_type, card.lot_number].filter(Boolean);
          allProperties.push({
            external_id: `alfalot-${card.lot_id}`,
            url: fullLink,
            title: card.title,
            address: card.region,
            city: detectCity(card.region),
            area_sqm: area && area > 0 ? area : undefined,
            price,
            price_per_sqm: price && area && area > 0 ? Math.round(price / area) : undefined,
            property_type: classifyPropertyType(card.title + ' ' + card.object_type),
            auction_type: 'bankruptcy',
            description: parts.join(' | '),
          });
        }

        if (cards.length < 10) break;
      }

      logger.info(`[alfalot] Total: ${allProperties.length} properties`);
      return allProperties;
    } catch (err: any) {
      logger.error(`[alfalot] Parse error: ${err.message}`);
      throw err;
    } finally {
      await browser.close();
    }
  }
}
