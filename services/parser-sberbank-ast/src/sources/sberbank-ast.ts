/**
 * Сбербанк-АСТ (utp.sberbank-ast.ru) — парсер коммерческой недвижимости.
 *
 * Таблица с AJAX-пагинацией, Playwright.
 * URL: /Property/List/BidListComReal
 * ~6600 лотов, ~332 страницы.
 */
import type { SourceParser, ParsedProperty } from '@aklab/service-shared';
import { logger } from '@aklab/service-shared';

const BASE_URL = 'https://utp.sberbank-ast.ru';
const SEARCH_URL = `${BASE_URL}/Property/List/BidListComReal`;
const MAX_PAGES = 10;
const MAX_AGE_HOURS = 24;
const GOTO_TIMEOUT = 60000;
const MAX_RETRIES = 3;

function classifyPropertyType(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes('офис') || lower.includes('административн')) return 'office';
  if (lower.includes('склад') || lower.includes('хранилищ')) return 'warehouse';
  if (lower.includes('магазин') || lower.includes('торгов') || lower.includes('павильон')) return 'retail';
  if (lower.includes('производствен') || lower.includes('промышленн')) return 'production';
  if (lower.includes('нежилое') || lower.includes('помещение') || lower.includes('коммерческ') ||
      lower.includes('гараж') || lower.includes('здани')) return 'free_purpose';
  return 'other';
}

function detectCity(text: string): string {
  const lower = text.toLowerCase();
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

export class SberbankAstParser implements SourceParser {
  name = 'sberbank-ast';

  async parse(): Promise<ParsedProperty[]> {
    const { chromium } = await import('playwright');
    logger.info('[sberbank-ast] Starting Playwright browser...');
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });

    try {
      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        locale: 'ru-RU',
      });
      const page = await context.newPage();
      const allProperties: ParsedProperty[] = [];

      // Retry при таймауте (сайт不稳定)
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          logger.info(`[sberbank-ast] Loading page (attempt ${attempt}/${MAX_RETRIES})...`);
          await page.goto(SEARCH_URL, { waitUntil: 'domcontentloaded', timeout: GOTO_TIMEOUT });
          await page.waitForTimeout(5000);
          break;
        } catch (err: any) {
          if (attempt < MAX_RETRIES && err.message?.includes('Timeout')) {
            const delay = 5000 + Math.random() * 5000;
            logger.warn(`[sberbank-ast] Timeout on attempt ${attempt}, retrying in ${Math.round(delay / 1000)}s...`);
            await new Promise(r => setTimeout(r, delay));
          } else {
            throw err;
          }
        }
      }

      for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
        logger.info(`[sberbank-ast] Parsing page ${pageNum}`);

        const lots = await page.evaluate(() => {
          const results: Array<{
            purchase_id: string; title: string; price_text: string;
            status: string; detail_url: string; organizer: string;
          }> = [];
          const rows = document.querySelectorAll('#resultTbl > tbody > tr');
          for (const row of Array.from(rows)) {
            const priceCell = row.querySelector('td:nth-child(1)');
            const infoCell = row.querySelector('td:nth-child(2)');
            if (!infoCell) continue;

            const price = priceCell?.querySelector('[content="leaf:purchAmount"]')?.textContent?.trim() || '';
            const status = priceCell?.querySelector('[content="leaf:BidStatusName"]')?.textContent?.trim() || '';
            const title = infoCell?.querySelector('[content="leaf:purchName"]')?.textContent?.trim() || '';
            const purchaseId = (infoCell?.querySelector('input[content="leaf:PurchaseId"]') as HTMLInputElement)?.value || '';
            const detailHref = (infoCell?.querySelector('input[content="leaf:objectHrefTerm"]') as HTMLInputElement)?.value || '';
            const organizer = infoCell?.querySelector('[content="leaf:OrgNameD"]')?.textContent?.trim() || '';

            if (!title) continue;
            results.push({ purchase_id: purchaseId, title, price_text: price, status, detail_url: detailHref, organizer });
          }
          return results;
        });

        logger.info(`[sberbank-ast] Page ${pageNum}: ${lots.length} lots`);

        for (const lot of lots) {
          const price = parsePrice(lot.price_text);
          const addrMatch = lot.title.match(/(?:по\s+адресу|адрес|ул\.|г\.)\s*([^,]+(?:,[^,]+){0,2})/i);
          const address = addrMatch ? addrMatch[1].trim() : '';
          allProperties.push({
            external_id: `sberbank-ast-${lot.purchase_id || lot.title.slice(0, 50)}`,
            url: lot.detail_url.startsWith('http') ? lot.detail_url : `${BASE_URL}${lot.detail_url}`,
            title: lot.title,
            address,
            city: detectCity(lot.title),
            property_type: classifyPropertyType(lot.title),
            auction_type: 'bankruptcy',
            price,
            description: lot.title.length > 20 ? lot.title : undefined,
            contacts: lot.organizer || undefined,
          });
        }

        // AJAX pagination — кликаем "следующая"
        const nextBtn = page.locator('span.pager-button.pagerElem').filter({ hasText: '›' }).first();
        if (await nextBtn.count() > 0) {
          try {
            await nextBtn.click();
            const delay = 2000 + Math.random() * 3000;
            await new Promise(r => setTimeout(r, delay));
            await page.waitForTimeout(3000);
          } catch { break; }
        } else {
          break;
        }
      }

      logger.info(`[sberbank-ast] Total: ${allProperties.length} properties`);
      return allProperties;
    } catch (err: any) {
      logger.error(`[sberbank-ast] Parse error: ${err.message}`);
      throw err;
    } finally {
      await browser.close();
    }
  }
}
