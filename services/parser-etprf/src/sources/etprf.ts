/**
 * ETPRF — парсер площадки etprf.ru.
 *
 * SPA-сайт, jQuery + Playwright.
 * Search: /Notification (список извещений)
 * fetchDetails: /Notification/id/{id}#lot-{lotId}
 */

import type { ParserDetailResult, SourceParser, ParsedProperty } from '@aklab/service-shared';
import {
  classifyPropertyType,
  createParserExtractionDiagnostics,
  derivePropertyRegion,
  logger,
  safeParserErrorCode,
  parsePrice,
  projectLegacyAddress,
  randomDelay,
  createStealthContext,
  retryGoto,
} from '@aklab/service-shared';
import {
  appendEtprfLotScope,
  extractEtprfListingLocation,
  extractEtprfLotDetailsFromHtml,
  extractEtprfPropertyLocation,
  extractEtprfPropertyLocationFieldsFromDocument,
  extractLotIdFromEtprfUrl,
} from './etprf-extraction';
import {
  buildEtprfSearchUrl,
  getEtprfBaseUrl,
  normalizeEtprfDetailUrl,
} from './etprf-url';

export {
  extractEtprfPropertyLocationFields,
  extractEtprfPropertyLocationFieldsFromDocument,
  extractEtprfListingLocation,
  extractEtprfPropertyLocation,
  extractEtprfLotDetailsFromHtml,
  parseEtprfLotSections,
  appendEtprfLotScope,
  extractLotIdFromEtprfUrl,
} from './etprf-extraction';
export type { EtprfPropertyLocationFields, EtprfLotSection } from './etprf-extraction';

function extractArea(text: string): number | undefined {
  const match = text.match(/(\d[\d\s]*[,.]?\d*)\s*(?:кв\.?\s*м|м²|м2)/i);
  if (!match) return undefined;
  return parseFloat(match[1].replace(/\s/g, '').replace(',', '.'));
}

export class EtprfParser implements SourceParser {
  name = 'etprf';

  async parse(depth?: number): Promise<ParsedProperty[]> {
    const { chromium } = await import('playwright');
    const baseUrl = getEtprfBaseUrl();
    const searchUrl = buildEtprfSearchUrl(baseUrl);

    logger.info('[etprf] Starting Playwright browser...');
    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
      const context = await createStealthContext(browser);
      const page = await context.newPage();
      const allProperties: ParsedProperty[] = [];
      const maxItems = depth ?? 200;

      await retryGoto(page, searchUrl, 3);
      await page.waitForTimeout(3000);

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
      const maxPages = depth ? Math.ceil(depth / ITEMS_PER_PAGE) : 10;
      for (let pageNum = 1; pageNum <= maxPages && allProperties.length < maxItems; pageNum++) {
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
          for (let i = 1; i < trs.length; i++) {
            const tr = trs[i];
            const tds = tr.querySelectorAll('td');
            if (tds.length < 4) continue;

            const lotId = tds[0]?.textContent?.trim() || '';
            const notification = tds[1]?.textContent?.trim() || '';
            const subject = tds[2]?.textContent?.trim() || '';
            const priceText = tds[3]?.textContent?.trim() || '';
            const status = tds.length >= 9 ? tds[8]?.textContent?.trim() || '' : '';

            const linkEl = tr.querySelector('a[href*="/Notification/id/"]') as HTMLAnchorElement;
            const detailUrl = linkEl?.getAttribute('href') || '';

            if (!lotId) continue;
            results.push({ lot_id: lotId, notification, subject, price_text: priceText, status, detail_url: detailUrl });
          }
          return results;
        });

        logger.info(`[etprf] Page ${pageNum}: ${rows.length} rows`);

        for (const row of rows) {
          if (allProperties.length >= maxItems) break;

          const price = parsePrice(row.price_text);
          const area = extractArea(row.subject);
          const detailUrl = appendEtprfLotScope(
            normalizeEtprfDetailUrl(row.detail_url, baseUrl),
            row.lot_id,
          );
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
      logger.error(`[etprf] Parse error: ${safeParserErrorCode(err)}`);
      throw err;
    } finally {
      await browser.close();
    }
  }

  async fetchDetails(url: string, sharedContext?: any): Promise<ParserDetailResult> {
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

      await page.waitForFunction(() => Array.from(document.querySelectorAll('.details-table tr')).some((row) => {
        const label = (row.querySelector('.td-label')?.textContent || '').replace(/:\s*$/u, '').trim();
        const value = (row.querySelector('.td-value')?.textContent || '').trim();
        return ['Сведения об имуществе', 'Краткие сведения об имуществе', 'Регион местонахождения имущества']
          .includes(label) && value.length > 0;
      }), undefined, { timeout: 15000 });

      const lotId = extractLotIdFromEtprfUrl(url);
      const html = await page.content();
      const details = extractEtprfLotDetailsFromHtml(html, lotId);
      const propertyLocation = extractEtprfPropertyLocation(details.locationFields);
      const locationLabelId = propertyLocation.status === 'confirmed_address'
        ? 'property.location.address'
        : propertyLocation.status === 'confirmed_region_only'
          ? 'property.location.region'
          : undefined;
      const parserDiagnostics = createParserExtractionDiagnostics({
        adapterVersion: 'etprf.v2',
        propertyBlockFound: details.locationFields.propertyBlockFound === true,
        ...(locationLabelId ? { locationLabelId } : {}),
        ...(details.locationFields.multiLotUnscoped ? { schemaMismatch: 'location_label_missing' as const } : {}),
        ...(!locationLabelId && details.locationFields.propertyBlockFound && !details.locationFields.multiLotUnscoped
          ? { schemaMismatch: 'location_label_missing' as const }
          : {}),
        semanticSignals: [
          ...(details.locationFields.propertyBlockFound ? ['property.block'] : []),
          ...(details.locationFields.multiLotUnscoped ? ['property.multi_lot.unscoped'] : []),
          ...(details.locationFields.propertyDescription ? ['property.description'] : []),
          ...(details.locationFields.propertyRegion ? ['property.location.region'] : []),
          ...(propertyLocation.status === 'confirmed_address' ? ['property.location.address'] : []),
        ],
      });

      return {
        description: details.description,
        contacts: details.contacts,
        property_location: propertyLocation,
        parser_diagnostics: parserDiagnostics,
        address: projectLegacyAddress(propertyLocation),
        city: derivePropertyRegion(propertyLocation),
        price: details.priceText ? parsePrice(details.priceText) : undefined,
      };
    } catch (err: any) {
      logger.warn(`[etprf] fetchDetails failed (${safeParserErrorCode(err)}`);
      throw err;
    } finally {
      if (page) try { await page.close(); } catch {}
      if (ownBrowser) try { await ownBrowser.close(); } catch {}
    }
  }
}
