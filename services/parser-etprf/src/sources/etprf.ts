/***
 * ETPRF — парсер площадки etprf.ru.
 *
 * SPA-сайт, jQuery + Playwright.
 * Search: /Notification (список извещений)
 * fetchDetails: открывает /Notification/id/{id} — 4 таба с .details-table
 */

import type { PropertyLocation, SourceParser, ParsedProperty } from '@aklab/service-shared';
import {
  classifyPropertyType,
  derivePropertyRegion,
  logger,
  normalizeStructuredLocation,
  parsePrice,
  projectLegacyAddress,
  randomDelay,
  createStealthContext,
  retryGoto,
} from '@aklab/service-shared';

const BASE_URL = 'https://sale.etprf.ru';
const SEARCH_URL = `${BASE_URL}/Notification`;
const MAX_PAGES = 10;
const PROPERTY_REGION_LABEL = 'Регион местонахождения имущества';
const LISTING_LOCATION_SOURCE_PATH = 'listing.property_location';
const DETAIL_LOCATION_SOURCE_PATH = `details.field.${PROPERTY_REGION_LABEL}`;

function extractArea(text: string): number | undefined {
  const match = text.match(/(\d[\d\s]*[,.]?\d*)\s*(?:кв\.?\s*м|м²|м2)/i);
  if (!match) return undefined;
  return parseFloat(match[1].replace(/\s/g, '').replace(',', '.'));
}

function structuredText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

/** Listing subject/notification are not property-location fields. */
export function extractEtprfListingLocation(_fields?: {
  subject?: unknown;
  notification?: unknown;
}): PropertyLocation {
  return normalizeStructuredLocation({
    status: 'missing',
    source_kind: 'dom_field',
    source_path: LISTING_LOCATION_SOURCE_PATH,
  });
}

/** Extract geography only from ETPRF's explicit current-property region field. */
export function extractEtprfPropertyLocation(fields: Record<string, unknown>): PropertyLocation {
  const region = structuredText(fields.propertyRegion);
  if (region) {
    return normalizeStructuredLocation({
      region,
      status: 'confirmed_region_only',
      source_kind: 'dom_field',
      source_path: DETAIL_LOCATION_SOURCE_PATH,
    });
  }

  return normalizeStructuredLocation({
    status: 'missing',
    source_kind: 'dom_field',
    source_path: DETAIL_LOCATION_SOURCE_PATH,
  });
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
          const propertyLocation = extractEtprfListingLocation(row);

          allProperties.push({
            external_id: `etprf-${row.lot_id}`,
            url: detailUrl,
            title: row.subject || row.notification,
            address: projectLegacyAddress(propertyLocation),
            city: derivePropertyRegion(propertyLocation),
            property_location: propertyLocation,
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

  async fetchDetails(url: string, sharedContext?: any): Promise<Partial<ParsedProperty>> {
    let ownBrowser: any = undefined;
    let context: any;
    if (sharedContext) {
      context = sharedContext;
    } else {
      const { chromium } = await import('playwright');
      ownBrowser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
      context = await createStealthContext(ownBrowser);
    }
    let page: any;

    try {
      page = await context.newPage();
      await retryGoto(page, url, 3);

      // Ждём загрузки таблиц (details-table — актуальный селектор)
      try {
        await page.waitForSelector('.details-table', { timeout: 15000 });
      } catch {
        await page.waitForTimeout(3000);
      }

      const details = await page.evaluate((propertyRegionLabel: string) => {
        // Утилита: найти значение поля по labelText во ВСЕХ .details-table
        function getFieldValue(labelText: string): string | undefined {
          const rows = document.querySelectorAll('.details-table tr');
          for (const row of Array.from(rows)) {
            const label = row.querySelector('.td-label');
            if (label && label.textContent?.trim().includes(labelText)) {
              return row.querySelector('.td-value')?.textContent?.trim() || undefined;
            }
          }
          return undefined;
        }

        // Утилита: найти email из mailto ссылки
        function getFieldEmail(labelText: string): string | undefined {
          const rows = document.querySelectorAll('.details-table tr');
          for (const row of Array.from(rows)) {
            const label = row.querySelector('.td-label');
            if (label && label.textContent?.trim().includes(labelText)) {
              const mailtoLink = row.querySelector('.td-value a[href^="mailto:"]') as HTMLAnchorElement;
              if (mailtoLink) {
                return mailtoLink.getAttribute('href')?.replace('mailto:', '')?.trim() || undefined;
              }
              return row.querySelector('.td-value')?.textContent?.trim() || undefined;
            }
          }
          return undefined;
        }

        const result: {
          description?: string;
          contacts?: string;
          latitude?: number;
          longitude?: number;
          price?: number;
          propertyRegion?: string;
        } = {};

        // === Контакты: организатор + email + телефон ===
        const organizer = getFieldValue('Организатор торгов');
        const email = getFieldEmail('Адрес электронной почты');
        const phone = getFieldValue('Номер контактного телефона');
        const contactParts: string[] = [];
        if (organizer) contactParts.push(organizer);
        if (phone) contactParts.push(phone);
        if (email) contactParts.push(email);
        if (contactParts.length > 0) {
          result.contacts = contactParts.join(', ');
        }

        // === Описание: подробное описание имущества ===
        const detailedDesc = getFieldValue('Сведения об имуществе');
        const briefDesc = getFieldValue('Краткие сведения об имуществе');
        const desc = detailedDesc || briefDesc;
        if (desc) {
          result.description = desc.slice(0, 2000);
        }

        // === Начальная цена продажи ===
        const priceText = getFieldValue('Начальная цена продажи');
        if (priceText) {
          const num = parsePrice(priceText);
          if (num !== undefined) {
            result.price = num;
          }
        }

        // Geography comes only from the explicit current-property field.
        // Description, "Почтовый адрес", and organizer fields are not location.
        result.propertyRegion = getFieldValue(propertyRegionLabel);

        // Координаты: на etprf.ru НЕТ координат в карточках
        result.latitude = undefined;
        result.longitude = undefined;

        return result;
      }, PROPERTY_REGION_LABEL);

      const propertyLocation = extractEtprfPropertyLocation({
        propertyRegion: details.propertyRegion,
      });

      return {
        description: details.description,
        contacts: details.contacts,
        latitude: details.latitude,
        longitude: details.longitude,
        property_location: propertyLocation,
        address: projectLegacyAddress(propertyLocation),
        city: derivePropertyRegion(propertyLocation),
        price: details.price,
      };
    } catch (err: any) {
      logger.warn(`[etprf] fetchDetails error for ${url}: ${err.message}`);
      return {};
    } finally {
      if (page) try { await page.close(); } catch {}
      if (ownBrowser) try { await ownBrowser.close(); } catch {}
    }
  }
}
