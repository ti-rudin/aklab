/**
 * Fabrikant.ru — парсер продаж (банкротство, приватизация).
 *
 * Next.js SSR, нет публичного JSON API. Парсим HTML через Playwright.
 *
 * Структура карточки (data-slot-based):
 *   [data-slot="card"][data-id="{lotId}"]
 *     [data-slot="anchor"]  — заголовок лота
 *     [data-slot="badge"]   — статус, источник
 *     [data-slot="text"]    — организатор, даты, цена
 *
 * Многолотовые процедуры: 1 лот = 1 Property с lot-view URL.
 */

import type { ParserDetailResult, SourceParser, ParsedProperty } from '@aklab/service-shared';
import {
  logger,
  safeParserErrorCode,
  randomDelay,
  createStealthContext,
  retryGoto,
  parsePrice,
  normalizeStructuredLocation,
  classifyPropertyType,
} from '@aklab/service-shared';
import {
  buildParsedPropertyFromLot,
  createFabrikantParserDiagnostics,
  extractArea,
  extractLotDetailsFromHtml,
  extractProcedureLotsFromHtml,
  extractPropertyLocationFromHtml,
  isFabrikantLotEligible,
  propertyLocationFromFields,
  EXCLUDE_KEYWORDS,
  PROPERTY_LOCATION_CONTAINER,
  PROPERTY_LOCATION_ADDRESS_FIELD,
  PROPERTY_LOCATION_REGION_FIELD,
  PROPERTY_LOCATION_OKATO_FIELD,
  LOT_PRICE_CONTAINER,
  resolveLotIdForUrl,
} from './fabrikant-extraction';
import {
  buildProcedureViewUrl,
  buildSearchUrl,
  extractProcedureIdFromUrl,
  getFabrikantBaseUrl,
  isProcedureViewUrl,
  normalizeFabrikantListingUrl,
} from './fabrikant-url';

export {
  createFabrikantParserDiagnostics,
  extractPropertyLocationFromHtml,
  extractProcedureLotsFromHtml,
  extractLotDetailsFromHtml,
  buildParsedPropertyFromLot,
  isFabrikantLotEligible,
  extractArea,
  propertyLocationFromFields,
} from './fabrikant-extraction';

const MAX_CLICKS = 100;

interface SearchCard {
  lot_id: string;
  title: string;
  price_text: string;
  proc_number: string;
  link_href: string;
  date_text: string;
}

export class FabrikantParser implements SourceParser {
  name = 'fabrikant';

  async parse(depth?: number): Promise<ParsedProperty[]> {
    const { chromium } = await import('playwright');
    const baseUrl = getFabrikantBaseUrl();
    const searchUrl = buildSearchUrl(baseUrl);
    const maxClicks = depth ? Math.ceil(depth / 10) : MAX_CLICKS;
    const maxItems = depth ?? 100;

    logger.info('[fabrikant] Starting Playwright browser...');
    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
      const context = await createStealthContext(browser);
      const page = await context.newPage();
      const rawCards: SearchCard[] = [];
      const seenCardIds = new Set<string>();
      const procedureIdsToExpand = new Set<string>();

      logger.info(`[fabrikant] Loading: ${searchUrl}`);
      await retryGoto(page, searchUrl, 3);
      try {
        await page.waitForSelector('[data-slot="card"][data-id]', { timeout: 15000 });
      } catch {
        await page.waitForTimeout(5000);
      }

      for (let click = 0; click < maxClicks; click++) {
        const cards = await page.evaluate((exclude: string[]) => {
          const results: SearchCard[] = [];
          const allCards = document.querySelectorAll('[data-slot="card"][data-id]');

          for (const card of Array.from(allCards)) {
            const el = card as HTMLElement;
            const lotId = el.getAttribute('data-id');
            if (!lotId) continue;

            const anchor = el.querySelector('[data-slot="anchor"]');
            const title = anchor?.textContent?.trim() || '';
            if (!title) continue;

            const titleLower = title.toLowerCase();
            if (exclude.some(keyword => titleLower.includes(keyword))) continue;

            const textSlots = el.querySelectorAll('[data-slot="text"]');
            let priceText = '';
            let procNumber = '';
            let dateText = '';
            for (const slot of Array.from(textSlots)) {
              const t = slot.textContent?.trim() || '';
              if (t.includes('RUB') && !priceText) priceText = t;
              if (/^\d+-\d+$/.test(t) && !procNumber) procNumber = t;
              const dateMatch = t.match(/(\d{2})\.(\d{2})\.(\d{4})/);
              if (dateMatch && !dateText) dateText = t;
            }

            const link = anchor as HTMLAnchorElement;
            results.push({
              lot_id: lotId,
              title,
              price_text: priceText,
              proc_number: procNumber,
              link_href: link?.href || '',
              date_text: dateText,
            });
          }
          return results;
        }, EXCLUDE_KEYWORDS);

        let newCount = 0;
        for (const card of cards) {
          if (seenCardIds.has(card.lot_id)) continue;
          seenCardIds.add(card.lot_id);
          newCount++;
          rawCards.push(card);

          const procedureId = extractProcedureIdFromUrl(card.link_href);
          if (procedureId && isProcedureViewUrl(card.link_href)) {
            procedureIdsToExpand.add(procedureId);
          }
        }

        const totalCards = await page.evaluate(() => document.querySelectorAll('[data-slot="card"][data-id]').length);
        logger.info(`[fabrikant] Click ${click}: ${totalCards} total cards, ${newCount} new raw cards`);

        try {
          await page.waitForSelector('button:has-text("Показать ещё")', { state: 'visible', timeout: 10000 });
        } catch {
          logger.info('[fabrikant] No "Показать ещё" button — stopping');
          break;
        }

        const prevCount = totalCards;
        await page.click('button:has-text("Показать ещё")');
        await randomDelay(3000, 5000);

        try {
          await page.waitForFunction((prev: number) => {
            return document.querySelectorAll('[data-slot="card"][data-id]').length > prev;
          }, prevCount, { timeout: 15000 });
        } catch {
          logger.info('[fabrikant] Cards didn\'t increase — stopping');
          break;
        }
      }

      const allProperties: ParsedProperty[] = [];
      const emittedLotIds = new Set<string>();

      for (const procedureId of procedureIdsToExpand) {
        if (allProperties.length >= maxItems) break;

        const procedureUrl = buildProcedureViewUrl(procedureId, baseUrl);
        logger.info(`[fabrikant] Expanding procedure ${procedureId}`);
        await retryGoto(page, procedureUrl, 3);
        try {
          await page.waitForSelector('.lot-anchor[id^="lot-"]', { timeout: 15000 });
        } catch {
          await page.waitForTimeout(3000);
        }

        const html = await page.content();
        const lots = extractProcedureLotsFromHtml(html);
        if (lots.length > 1) {
          logger.info(`[fabrikant] Procedure ${procedureId}: ${lots.length} lots`);
        }

        for (const lot of lots) {
          if (allProperties.length >= maxItems) break;
          if (emittedLotIds.has(lot.lotId)) continue;
          if (!isFabrikantLotEligible(lot.title, lot.subject ?? '', lot.hasDeliveryPlace)) continue;

          emittedLotIds.add(lot.lotId);
          allProperties.push(buildParsedPropertyFromLot(lot, procedureId, baseUrl));
        }
      }

      for (const card of rawCards) {
        if (allProperties.length >= maxItems) break;
        if (emittedLotIds.has(card.lot_id)) continue;
        if (isProcedureViewUrl(card.link_href)) continue;

        if (!isFabrikantLotEligible(card.title, '', false)) continue;

        emittedLotIds.add(card.lot_id);
        const url = normalizeFabrikantListingUrl(card.link_href, card.lot_id, baseUrl);
        const price = parsePrice(card.price_text);
        const area = extractArea(card.title);

        let publishedAt: string | undefined;
        if (card.date_text) {
          const dm = card.date_text.match(/(\d{2})\.(\d{2})\.(\d{4})/);
          if (dm) publishedAt = `${dm[3]}-${dm[2]}-${dm[1]}T00:00:00Z`;
        }

        allProperties.push({
          external_id: `fabrikant-${card.lot_id}`,
          url,
          title: card.title,
          address: '',
          city: 'other',
          property_location: normalizeStructuredLocation({
            status: 'missing',
            source_kind: 'dom_field',
            source_path: PROPERTY_LOCATION_CONTAINER,
          }),
          area_sqm: area,
          price,
          price_per_sqm: price && area ? Math.round(price / area) : undefined,
          property_type: classifyPropertyType(card.title),
          auction_type: 'bankruptcy',
          description: card.title.length > 20 ? card.title : undefined,
          published_at: publishedAt,
        });
      }

      logger.info(`[fabrikant] Total: ${allProperties.length} properties from ${seenCardIds.size} unique cards`);
      return allProperties;
    } catch (err: any) {
      logger.error(`[fabrikant] Parse error: ${safeParserErrorCode(err)}`);
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

      const lotId = resolveLotIdForUrl(url);
      try {
        if (lotId) {
          await page.waitForSelector(`#lot-${lotId}`, { timeout: 15000 });
        } else {
          await page.waitForSelector('[data-slot], .lot-info, .procedure-info, h1, h2', { timeout: 15000 });
        }
      } catch {
        await page.waitForTimeout(3000);
      }

      const details = await page.evaluate((args: {
        lotId?: string;
        container: string;
        address: string;
        region: string;
        okato: string;
        priceContainer: string;
      }) => {
        const allPlaces = document.querySelectorAll(args.container);
        const multiLotUnscoped = allPlaces.length > 1 && !args.lotId;

        let locationContainer: Element | null = null;
        let description: string | undefined;
        let priceText: string | undefined;

        if (args.lotId) {
          const lotAnchor = document.querySelector(`#lot-${args.lotId}`);
          const lotRoot = lotAnchor?.closest('.panel-default') ?? lotAnchor?.parentElement ?? null;
          if (lotRoot) {
            locationContainer = lotRoot.querySelector(args.container);
            const subjectEl = lotRoot.querySelector('[class*="lot_subject"], [class*="lot-subject"]');
            const titleEl = lotRoot.querySelector('h3, h4, .lot_head, [class*="lot_head"]');
            const subject = subjectEl?.textContent?.replace(/\s+/g, ' ').trim();
            const title = titleEl?.textContent?.replace(/\s+/g, ' ').trim();
            description = (subject && subject.length > 20 ? subject : title)?.slice(0, 2000);
            priceText = lotRoot.querySelector(args.priceContainer)?.textContent?.replace(/\s+/g, ' ').trim();
          }
        } else if (!multiLotUnscoped) {
          locationContainer = allPlaces[0] ?? null;
        }

        const locationFields = multiLotUnscoped
          ? { propertyBlockFound: true, multiLotUnscoped: true }
          : {
            propertyBlockFound: Boolean(locationContainer),
            address: locationContainer?.querySelector(args.address)?.textContent || undefined,
            region: locationContainer?.querySelector(args.region)?.textContent || undefined,
            region_code: locationContainer?.querySelector(args.okato)?.textContent || undefined,
          };

        const contactParts: string[] = [];
        const organizerRoot = document.querySelector('[class*="organizer"], .procedure-info, .procedure-header');
        const scopedText = organizerRoot?.textContent || '';
        const orgMatch = scopedText.match(/Информация\s+об\s+организаторе\s*\n?\s*(.+?)(?:\n\s*\n|\n\s*Дата)/s);
        if (orgMatch) {
          const orgName = orgMatch[1].trim().split('\n')[0].trim();
          if (orgName.length > 2 && orgName.length < 200) contactParts.push(`Организатор: ${orgName}`);
        }
        const phoneMatch = scopedText.match(/(?:тел(?:ефон)?|phone)[:\s.]+([+\d\s()-]{7,20})/i);
        if (phoneMatch) contactParts.push(`Тел: ${phoneMatch[1].trim()}`);
        const emailMatch = scopedText.match(/(?:email|e-mail|почт[аы])[:\s]+([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
        if (emailMatch) contactParts.push(`Email: ${emailMatch[1].trim()}`);

        const photoUrls: string[] = [];
        const contentImgs = document.querySelectorAll('img[src*="upload"], img[src*="lot"], img[src*="photo"], img[src*="image"]');
        for (const img of Array.from(contentImgs).slice(0, 10)) {
          const src = (img as HTMLImageElement).src;
          if (src && src.startsWith('http') && !src.includes('logo') && !src.includes('icon')) photoUrls.push(src);
        }

        return {
          description,
          contacts: contactParts.length > 0 ? contactParts.join(', ') : undefined,
          locationFields,
          priceText,
          photo_urls: photoUrls.length > 0 ? photoUrls : undefined,
        };
      }, {
        lotId,
        container: PROPERTY_LOCATION_CONTAINER,
        address: PROPERTY_LOCATION_ADDRESS_FIELD,
        region: PROPERTY_LOCATION_REGION_FIELD,
        okato: PROPERTY_LOCATION_OKATO_FIELD,
        priceContainer: LOT_PRICE_CONTAINER,
      });

      const propertyLocation = propertyLocationFromFields(details.locationFields);
      const price = parsePrice(details.priceText ?? '');

      return {
        description: details.description,
        contacts: details.contacts,
        ...(price ? { price } : {}),
        property_location: propertyLocation,
        parser_diagnostics: createFabrikantParserDiagnostics(details.locationFields),
        photo_urls: details.photo_urls,
      };
    } catch (err: any) {
      logger.warn(`[fabrikant] fetchDetails failed (${safeParserErrorCode(err)})`);
      throw err;
    } finally {
      if (page) try { await page.close(); } catch {}
      if (ownBrowser) try { await ownBrowser.close(); } catch {}
    }
  }
}
