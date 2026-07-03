/**
 * ЕТП РФ (sale.etprf.ru) — парсер коммерческой недвижимости.
 *
 * Таблица с AJAX-пагинацией, Playwright.
 * URL: /Notification (с фильтром категории=4 для коммерческой недвижимости)
 * 20 строк на страницу, ~768 страниц.
 * Площадь из детальной страницы.
 */
import type { SourceParser, ParsedProperty } from '@aklab/service-shared';
import { logger, randomDelay, createStealthContext, retryGoto } from '@aklab/service-shared';

const BASE_URL = 'https://sale.etprf.ru';
const SEARCH_URL = `${BASE_URL}/Notification`;
const MAX_PAGES = 10;
const MAX_AGE_HOURS = 24;

function classifyPropertyType(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes('офис') || lower.includes('административн')) return 'office';
  if (lower.includes('склад') || lower.includes('хранилищ')) return 'warehouse';
  if (lower.includes('магазин') || lower.includes('торгов') || lower.includes('павильон')) return 'retail';
  if (lower.includes('производствен') || lower.includes('промышленн') || lower.includes('цех')) return 'production';
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

export class EtprfParser implements SourceParser {
  name = 'etprf';

  async parse(depth?: number): Promise<ParsedProperty[]> {
    const { chromium } = await import('playwright');

    logger.info('[etprf] Starting Playwright browser...');
    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
      const context = await createStealthContext(browser);
      const page = await context.newPage();
      const allProperties: ParsedProperty[] = [];

      // Загружаем страницу
      await retryGoto(page, SEARCH_URL, 3);
      await page.waitForTimeout(3000);

      // Применяем фильтр по категории "Коммерческая недвижимость" если доступен
      try {
        const filterCategory = page.locator('#Filter_PurchaseSubjectCategory');
        if (await filterCategory.count() > 0) {
          await filterCategory.selectOption('4');
          const applyBtn = page.locator('[id^="bt_filter_update"]');
          if (await applyBtn.count() > 0) {
            await applyBtn.click();
            await page.waitForTimeout(3000);
          }
        }
      } catch {
        // Фильтр может не быть — продолжаем без него
      }

      const ITEMS_PER_PAGE = 20;
      const maxPages = depth ? Math.ceil(depth / ITEMS_PER_PAGE) : MAX_PAGES;
      for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
        logger.info(`[etprf] Parsing page ${pageNum}`);

        const rows = await page.evaluate(() => {
          const results: Array<{
            lot_id: string;
            notification: string;
            subject: string;
            price_text: string;
            status: string;
            detail_url: string;
          }> = [];

          const table = document.querySelector('table.reporttable');
          if (!table) return results;

          const trs = table.querySelectorAll('tr');
          // Skip header row (first)
          for (let i = 1; i < trs.length; i++) {
            const tr = trs[i];
            const tds = tr.querySelectorAll('td');
            if (tds.length < 4) continue;

            const lotId = tds[0]?.textContent?.trim() || '';
            const notification = tds[1]?.textContent?.trim() || '';
            const subject = tds[2]?.textContent?.trim() || '';
            const priceText = tds[3]?.textContent?.trim() || '';
            const status = tds.length >= 9 ? tds[8]?.textContent?.trim() || '' : '';

            // Ссылка на детальную страницу
            const linkEl = tr.querySelector('a[href*="/Notification/id/"]') as HTMLAnchorElement;
            const detailUrl = linkEl?.getAttribute('href') || '';

            if (!lotId) continue;
            results.push({ lot_id: lotId, notification, subject, price_text: priceText, status, detail_url: detailUrl });
          }
          return results;
        });

        logger.info(`[etprf] Page ${pageNum}: ${rows.length} rows`);

        for (const row of rows) {
          const price = parsePrice(row.price_text);
          const area = extractArea(row.subject);
          const detailUrl = row.detail_url.startsWith('http') ? row.detail_url : `${BASE_URL}${row.detail_url}`;
          const fullText = `${row.notification} ${row.subject}`;
          const addrMatch = fullText.match(/(?:адрес|ул\.|г\.|пр\.)[^,]*(?:,[^,]+){0,2}/i);
          const address = addrMatch ? addrMatch[0].trim() : '';

          allProperties.push({
            external_id: `etprf-${row.lot_id}`,
            url: detailUrl,
            title: row.subject || row.notification,
            address,
            city: detectCity(row.subject),
            area_sqm: area,
            price,
            price_per_sqm: price && area ? Math.round(price / area) : undefined,
            property_type: classifyPropertyType(row.subject),
            auction_type: 'bankruptcy',
            description: row.subject.length > 20 ? row.subject : undefined,
          });
        }

        // Пагинация: кликаем "следующая страница"
        const nextBtn = page.locator('.pager-button-next');
        if (await nextBtn.count() > 0 && !(await nextBtn.getAttribute('disabled'))) {
          await nextBtn.click();
          await randomDelay(2000, 5000);
          await page.waitForTimeout(2000);
        } else {
          break;
        }
      }

      logger.info(`[etprf] Total: ${allProperties.length} properties`);
      return allProperties;
    } catch (err: any) {
      logger.error(`[etprf] Parse error: ${err.message}`);
      throw err;
    } finally {
      await browser.close();
    }
  }

  async fetchDetails(url: string): Promise<Partial<ParsedProperty>> {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
      const context = await createStealthContext(browser);
      const page = await context.newPage();
      await retryGoto(page, url, 3);

      try {
        await page.waitForSelector('.lot-detail, .lot-info, .description, [class*="description"]', { timeout: 10000 });
      } catch {
        await page.waitForTimeout(3000);
      }

      const details = await page.evaluate(() => {
        const descSelectors = [
          '.lot-description', '.lot-detail__description', '.description',
          '[class*="description"]', '.lot-info__description',
          '.card-detail', '.lot-detail'
        ];
        let description = '';
        for (const sel of descSelectors) {
          const el = document.querySelector(sel);
          if (el && el.textContent && el.textContent.trim().length > 30) {
            description = el.textContent.trim().slice(0, 2000);
            break;
          }
        }

        const contactSelectors = [
          '.lot-contacts', '.contacts', '[class*="contact"]',
          '.organizer', '.seller', '.lot-info__contacts'
        ];
        let contacts = '';
        for (const sel of contactSelectors) {
          const el = document.querySelector(sel);
          if (el && el.textContent && el.textContent.trim().length > 5) {
            contacts = el.textContent.trim().slice(0, 500);
            break;
          }
        }

        if (!contacts) {
          const bodyText = document.body.textContent || '';
          const phoneMatch = bodyText.match(/(?:\+7|8)[\s\-]?\(?\d{3}\)?[\s\-]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2}/);
          const emailMatch = bodyText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
          const parts = [];
          if (phoneMatch) parts.push(phoneMatch[0]);
          if (emailMatch) parts.push(emailMatch[0]);
          contacts = parts.join(', ');
        }

        let latitude: number | undefined;
        let longitude: number | undefined;
        const mapEl = document.querySelector('[data-lat], [data-latitude], .map-container');
        if (mapEl) {
          const lat = mapEl.getAttribute('data-lat') || mapEl.getAttribute('data-latitude');
          const lng = mapEl.getAttribute('data-lng') || mapEl.getAttribute('data-longitude');
          if (lat && lng) {
            latitude = parseFloat(lat);
            longitude = parseFloat(lng);
          }
        }

        if (!latitude) {
          const scripts = document.querySelectorAll('script');
          for (const script of Array.from(scripts)) {
            const text = script.textContent || '';
            const coordMatch = text.match(/(?:center|coordinates|coords)[:\s]*\[?(\d+\.\d+)[,\s]+(\d+\.\d+)/);
            if (coordMatch) {
              latitude = parseFloat(coordMatch[1]);
              longitude = parseFloat(coordMatch[2]);
              break;
            }
          }
        }

        const addressSelectors = [
          '.lot-address', '.address', '[class*="address"]',
          '.lot-detail__address'
        ];
        let address = '';
        for (const sel of addressSelectors) {
          const el = document.querySelector(sel);
          if (el && el.textContent && el.textContent.trim().length > 5) {
            address = el.textContent.trim().slice(0, 300);
            break;
          }
        }

        return {
          description: description || undefined,
          contacts: contacts || undefined,
          latitude: latitude && !isNaN(latitude) ? latitude : undefined,
          longitude: longitude && !isNaN(longitude) ? longitude : undefined,
          address: address || undefined,
        };
      });

      return {
        description: details.description,
        contacts: details.contacts,
        latitude: details.latitude,
        longitude: details.longitude,
        address: details.address,
      };
    } catch (err: any) {
      logger.warn(`[etprf] fetchDetails error for ${url}: ${err.message}`);
      return {};
    } finally {
      await browser.close();
    }
  }
}
