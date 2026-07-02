/**
 * Сбербанк-АСТ (utp.sberbank-ast.ru) — парсер коммерческой недвижимости.
 *
 * Данные встроены в HTML в скрытом input#xmlData в формате XML.
 * Парсим XML напрямую, без ожидания JS-рендеринга таблицы.
 *
 * ~6600 лотов, ~332 страницы.
 */
import type { SourceParser, ParsedProperty } from '@aklab/service-shared';
import { logger, randomDelay, createStealthContext, retryGoto } from '@aklab/service-shared';

const BASE_URL = 'https://utp.sberbank-ast.ru';
const SEARCH_URL = `${BASE_URL}/Property/List/BidListComReal`;
const MAX_PAGES = 10;
const ITEMS_PER_PAGE = 20;

function classifyPropertyType(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes('офис') || lower.includes('административн')) return 'office';
  if (lower.includes('склад') || lower.includes('хранилищ')) return 'warehouse';
  if (lower.includes('магазин') || lower.includes('торгов') || lower.includes('павильон')) return 'retail';
  if (lower.includes('производствен') || lower.includes('промышленн')) return 'production';
  if (lower.includes('нежилое') || lower.includes('помещение') || lower.includes('коммерческ') ||
      lower.includes('гараж') || lower.includes('здани')) return 'free_purpose';
  if (lower.includes('квартир')) return 'apartment';
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

function extractArea(text: string): number | undefined {
  const match = text.match(/(\d[\d\s]*[,.]?\d*)\s*(?:кв\.?\s*м|м²|м2)/i);
  if (match) {
    const cleaned = match[1].replace(/\s/g, '').replace(',', '.');
    const num = parseFloat(cleaned);
    if (!isNaN(num) && num > 0) return num;
  }
  return undefined;
}

function extractAddress(title: string): string {
  // Try "по адресу: ..." pattern
  let match = title.match(/по\s+адресу[:\s]+([^,]+(?:,\s*[^,]+){0,3})/i);
  if (match) return match[1].trim();

  // Try "расположенн..." pattern
  match = title.match(/расположенн\w*\s+(?:по\s+адресу[:\s]*)?([^,]+(?:,\s*[^,]+){0,3})/i);
  if (match) return match[1].trim();

  // Try "адрес:" pattern
  match = title.match(/адрес[:\s]+([^,]+(?:,\s*[^,]+){0,3})/i);
  if (match) return match[1].trim();

  return '';
}

export class SberbankAstParser implements SourceParser {
  name = 'sberbank-ast';

  async parse(depth?: number): Promise<ParsedProperty[]> {
    const { chromium } = await import('playwright');

    const maxPages = depth ? Math.ceil(depth / ITEMS_PER_PAGE) : MAX_PAGES;
    logger.info('[sberbank-ast] Starting Playwright browser...');
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });

    try {
      const context = await createStealthContext(browser);
      const page = await context.newPage();
      const allProperties: ParsedProperty[] = [];

      // Retry при таймауте
      logger.info('[sberbank-ast] Loading page...');
      await retryGoto(page, SEARCH_URL, 3);
      await page.waitForTimeout(5000);

      for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
        logger.info(`[sberbank-ast] Parsing page ${pageNum}`);

        // Извлекаем данные из скрытого input#xmlData
        const lots = await page.evaluate(() => {
          const results: Array<{
            purchase_id: string; title: string; price_text: string;
            status: string; detail_url: string; organizer: string;
            address: string; amount: string;
            lat?: number; lng?: number; branch?: string;
          }> = [];

          const xmlDataInput = document.getElementById('xmlData') as HTMLInputElement;
          if (!xmlDataInput) return results;

          const xmlStr = xmlDataInput.value;
          if (!xmlStr) return results;

          // Парсим XML — структура: <datarow><hits><_source>
          const parser = new DOMParser();
          const xmlDoc = parser.parseFromString(xmlStr, 'text/xml');
          const rows = xmlDoc.querySelectorAll('_source');

          for (const row of Array.from(rows)) {
            const purchaseId = row.querySelector('PurchaseId')?.textContent?.trim() || '';
            const purchaseName = row.querySelector('purchName')?.textContent?.trim() || '';
            const bidName = row.querySelector('BidName')?.textContent?.trim() || '';
            const amount = row.querySelector('purchAmount')?.textContent?.trim() || '';
            const currentAmount = row.querySelector('CurrentAmount')?.textContent?.trim() || '';
            const purchaseState = row.querySelector('purchStateName')?.textContent?.trim() || '';
            const orgName = row.querySelector('OrgName')?.textContent?.trim() || '';
            const purchaseCode = row.querySelector('purchCode')?.textContent?.trim() || '';
            const geoAddress = row.querySelector('GeoDataAddress')?.textContent?.trim() || '';
            const detailHref = row.querySelector('bidHrefTerm')?.textContent?.trim() || '';
            const latStr = row.querySelector('Latitude')?.textContent?.trim();
            const lngStr = row.querySelector('Longitude')?.textContent?.trim();
            const branchName = row.querySelector('BranchNameNew')?.textContent?.trim() || '';

            if (!purchaseName && !bidName) continue;

            const title = purchaseName || bidName;
            const detailUrl = detailHref || `${window.location.origin}/Property/NBT/PurchaseView/43/0/0/${purchaseId}`;

            results.push({
              purchase_id: purchaseId,
              title,
              price_text: currentAmount || amount,
              status: purchaseState,
              detail_url: detailUrl,
              organizer: orgName,
              address: geoAddress,
              amount: currentAmount || amount,
              lat: latStr ? parseFloat(latStr) : undefined,
              lng: lngStr ? parseFloat(lngStr) : undefined,
              branch: branchName,
            });
          }

          return results;
        });

        logger.info(`[sberbank-ast] Page ${pageNum}: ${lots.length} lots`);

        for (const lot of lots) {
          const price = parsePrice(lot.price_text);
          const address = lot.address || extractAddress(lot.title);
          allProperties.push({
            external_id: `sberbank-ast-${lot.purchase_id || lot.title.slice(0, 50)}`,
            url: lot.detail_url.startsWith('http') ? lot.detail_url : `${BASE_URL}${lot.detail_url}`,
            title: lot.title,
            address,
            city: detectCity(address || lot.title),
            property_type: classifyPropertyType(`${lot.title} ${lot.branch || ''}`),
            auction_type: 'bankruptcy',
            price,
            area_sqm: extractArea(lot.title),
            latitude: lot.lat,
            longitude: lot.lng,
            description: lot.title.length > 20 ? lot.title : undefined,
            contacts: lot.organizer || undefined,
          });
        }

        // AJAX pagination — кликаем "следующая"
        const nextBtn = page.locator('span.pager-button.pagerElem').filter({ hasText: '›' }).first();
        if (await nextBtn.count() > 0) {
          try {
            await nextBtn.click();
            await randomDelay(2000, 5000);
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
