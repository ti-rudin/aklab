/**
 * Alfot — парсер коммерческой недвижимости.
 *
 * SPA на ecosystem.alfalot.ru, Playwright.
 * Search: /showcase/list?categories=1 (Недвижимость)
 * 12 карточек на страницу, ~217 страниц.
 * Площадь из badges: title="Площадь: 112.00"
 */
import type { ParserDetailResult, PropertyLocation, SourceParser, ParsedProperty } from '@aklab/service-shared';
import {
  classifyPropertyType,
  createParserExtractionDiagnostics,
  createStealthContext,
  derivePropertyRegion,
  extractAddressFromBoundedPropertyText,
  logger,
  safeParserErrorCode,
  normalizeStructuredLocation,
  parsePrice,
  projectLegacyAddress,
  randomDelay,
  retryGoto,
} from '@aklab/service-shared';

const BASE_URL = 'https://ecosystem.alfalot.ru';
const SEARCH_URL = `${BASE_URL}/showcase/list?categories=1`;
const MAX_PAGES = 10;
const MAX_AGE_HOURS = 24;

export interface AlfalotPropertyLocationFields {
  propertyBlockFound?: boolean;
  /** Separate current-lot region field rendered on the card. */
  cardRegion?: string;
  /** Separate property-bound address field rendered on the detail page. */
  detailAddress?: string;
  /** Bounded current-lot `Описание` field; organizer lives in another tab. */
  propertyDescription?: string;
}

/** Browser-safe extraction from hydrated property-domain containers only. */
export function extractAlfalotPropertyLocationFields(documentLike?: Document): AlfalotPropertyLocationFields {
  const doc = documentLike ?? document;
  const propertyBlockFound = Boolean(doc.querySelector('.location-block, .tab-content[data-page="lot-info"]'));
  const detailAddress = doc.querySelector('.location-block > p.address')?.textContent
    ?.replace(/\s+/g, ' ')
    .trim() || undefined;
  let propertyDescription: string | undefined;
  const lotInfo = doc.querySelector('.tab-content[data-page="lot-info"]');
  if (lotInfo) {
    for (const heading of Array.from(lotInfo.querySelectorAll('h3'))) {
      const label = (heading.textContent ?? '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('ru-RU');
      if (label !== 'описание') continue;
      const next = heading.nextElementSibling;
      const value = next?.tagName === 'P' ? next.textContent?.replace(/\s+/g, ' ').trim() : undefined;
      if (value && value.length > 20) propertyDescription = value.slice(0, 2000);
      break;
    }
  }
  return {
    propertyBlockFound,
    ...(detailAddress && detailAddress.length > 3 ? { detailAddress } : {}),
    ...(propertyDescription ? { propertyDescription } : {}),
  };
}

function cleanLocationField(value: string | undefined): string | undefined {
  const trimmed = value?.replace(/\s+/g, ' ').trim();
  return trimmed || undefined;
}

/**
 * Extract geography only from Alfalot's semantically bounded lot fields.
 * The card field is a region, never a full address; detail
 * `.location-block > p.address` is the property-bound full address.
 * Description/title/organizer text is excluded.
 */
export function extractAlfalotPropertyLocation(fields: AlfalotPropertyLocationFields): PropertyLocation {
  const detailAddress = cleanLocationField(fields.detailAddress);
  if (detailAddress) {
    return normalizeStructuredLocation({
      address: detailAddress,
      status: 'confirmed_address',
      source_kind: 'dom_field',
      source_path: '.location-block > p.address',
    });
  }

  const descriptionAddress = extractAddressFromBoundedPropertyText(fields.propertyDescription);
  if (descriptionAddress) {
    return normalizeStructuredLocation({
      address: descriptionAddress,
      status: 'confirmed_address',
      source_kind: 'dom_field',
      source_path: '.tab-content[data-page="lot-info"].field.Описание.address',
    });
  }

  const cardRegion = cleanLocationField(fields.cardRegion);
  if (cardRegion) {
    return normalizeStructuredLocation({
      region: cardRegion,
      status: 'confirmed_region_only',
      source_kind: 'dom_field',
      source_path: '.card-info > p',
    });
  }

  return normalizeStructuredLocation({
    status: 'missing',
    source_kind: 'dom_field',
    source_path: '.location-block > p.address',
  });
}

export class AlfalotParser implements SourceParser {
  name = 'alfalot';

  async parse(depth?: number): Promise<ParsedProperty[]> {
    const { chromium } = await import('playwright');

    logger.info('[alfalot] Starting Playwright browser...');
    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
      const context = await createStealthContext(browser);
      const page = await context.newPage();
      const allProperties: ParsedProperty[] = [];
      const seenIds = new Set<string>();

      const ITEMS_PER_PAGE = 12;
      const maxPages = depth ? Math.ceil(depth / ITEMS_PER_PAGE) : MAX_PAGES;
      for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
        const url = pageNum === 1 ? SEARCH_URL : `${SEARCH_URL}&page=${pageNum}`;
        logger.info(`[alfalot] Loading page ${pageNum}: ${url}`);

        if (pageNum > 1) {
          await randomDelay(2000, 5000);
        }

        await retryGoto(page, url, 3);
        // SPA: ждём появления карточек вместо фиксированного таймаута
        try {
          await page.waitForSelector('.lot-card', { timeout: 10000 });
        } catch {
          // Если карточки не появились — пробуем подождать ещё
          await page.waitForTimeout(5000);
        }

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
          const propertyLocation = extractAlfalotPropertyLocation({ cardRegion: card.region });

          const parts = [card.title, card.object_type, card.lot_number].filter(Boolean);
          const extId = `alfalot-${card.lot_id}`;
          if (seenIds.has(extId)) continue;
          seenIds.add(extId);
          allProperties.push({
            external_id: extId,
            url: fullLink,
            title: card.title,
            address: projectLegacyAddress(propertyLocation),
            city: derivePropertyRegion(propertyLocation),
            property_location: propertyLocation,
            area_sqm: area && area > 0 ? area : undefined,
            price,
            price_per_sqm: price && area && area > 0 ? Math.round(price / area) : undefined,
            property_type: classifyPropertyType(card.title + ' ' + card.object_type),
            auction_type: 'bankruptcy',
            description: parts.join(' | '),
          });
        }

        if (cards.length === 0) break; // последняя страница
      }

      logger.info(`[alfalot] Total: ${allProperties.length} properties`);
      return allProperties;
    } catch (err: any) {
      logger.error(`[alfalot] Parse error: ${safeParserErrorCode(err)}`);
      throw err;
    } finally {
      await browser.close();
    }
  }

  async fetchDetails(url: string, sharedContext?: any): Promise<ParserDetailResult> {
    let ownBrowser: any = undefined;
    let context: any;
    if (sharedContext) {
      // parse-handler передал готовый контекст — используем его
      context = sharedContext;
    } else {
      // Standalone запуск — создаём свой browser + context
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

      await page.waitForFunction(() => {
        const address = (document.querySelector('.location-block > p.address')?.textContent || '').trim();
        const description = Array.from(document.querySelectorAll('.tab-content[data-page="lot-info"] h3'))
          .find((heading) => (heading.textContent || '').trim().toLocaleLowerCase('ru-RU') === 'описание')
          ?.nextElementSibling?.textContent?.trim() || '';
        return address.length > 0 || description.length > 0;
      }, undefined, { timeout: 10000 });

      const locationFields = await page.evaluate(extractAlfalotPropertyLocationFields);
      const details = await page.evaluate(() => {
        // Контакты: таб organizer-info → ul li с label-value паттерном
        const contactParts: string[] = [];
        const organizerTab = document.querySelector('.tab-content[data-page="organizer-info"]');
        if (organizerTab) {
          // Имя организатора
          const orgName = organizerTab.querySelector('.font-bold.text-xl');
          if (orgName && orgName.textContent) {
            contactParts.push('Организатор: ' + orgName.textContent.trim());
          }

          // Ищем телефон и email в li элементах
          const items = organizerTab.querySelectorAll('ul li');
          for (const li of Array.from(items)) {
            const spans = li.querySelectorAll('span');
            if (spans.length >= 2) {
              const label = spans[0].textContent?.trim().toLowerCase() || '';
              const value = spans[spans.length - 1].textContent?.trim() || '';
              if (label.includes('телефон') && value) contactParts.push('Тел: ' + value);
              if (label.includes('email') && value) contactParts.push('Email: ' + value);
            }
          }
        }
        const contacts = contactParts.length > 0 ? contactParts.join(', ') : undefined;


        // Аукцион: .start_price, .current_price, .bid_end_date, .auction_start_date
        const startPrice = document.querySelector('.start_price')?.textContent?.trim();
        const currentPrice = document.querySelector('.current_price')?.textContent?.trim();
        const bidEndDate = document.querySelector('.bid_end_date')?.textContent?.trim();
        const auctionStart = document.querySelector('.auction_start_date')?.textContent?.trim();

        const auctionParts: string[] = [];
        if (startPrice) {
          auctionParts.push('Начальная цена: ' + startPrice);
        }
        if (currentPrice) auctionParts.push('Текущая цена: ' + currentPrice);
        if (bidEndDate) auctionParts.push('Окончание: ' + bidEndDate);
        if (auctionStart) auctionParts.push('Начало торгов: ' + auctionStart);

        // Задаток из таблицы цен
        const priceTable = document.querySelector('.tab-content[data-page="lot-info"] table');
        if (priceTable) {
          const rows = priceTable.querySelectorAll('tbody tr');
          for (const row of Array.from(rows)) {
            const cells = row.querySelectorAll('td');
            if (cells.length >= 4) {
              const deposit = cells[3]?.textContent?.trim();
              if (deposit && deposit !== '—') auctionParts.push('Задаток: ' + deposit);
              break; // берём только первую строку
            }
          }
        }

        return {
          contacts,
          auctionDetails: auctionParts.length > 0 ? auctionParts.join(' | ') : undefined,
        };
      });

      const propertyLocation = extractAlfalotPropertyLocation({
        detailAddress: locationFields.detailAddress,
        propertyDescription: locationFields.propertyDescription,
      });
      const locationLabelId = propertyLocation.status === 'confirmed_address'
        ? 'property.location.address'
        : propertyLocation.status === 'confirmed_region_only'
          ? 'property.location.region'
          : undefined;
      const parserDiagnostics = createParserExtractionDiagnostics({
        adapterVersion: 'alfalot.v1',
        propertyBlockFound: locationFields.propertyBlockFound === true,
        ...(locationLabelId ? { locationLabelId } : {}),
        ...(!locationLabelId && locationFields.propertyBlockFound ? { schemaMismatch: 'location_label_missing' as const } : {}),
        semanticSignals: [
          ...(locationFields.propertyBlockFound ? ['property.block'] : []),
          ...(locationFields.propertyDescription ? ['property.description'] : []),
          ...(locationFields.detailAddress ? ['property.location.address'] : []),
        ],
      });
      return {
        description: locationFields.propertyDescription,
        contacts: details.contacts,
        property_location: propertyLocation,
        parser_diagnostics: parserDiagnostics,
      };
    } catch (err: any) {
      logger.warn(`[alfalot] fetchDetails failed (${safeParserErrorCode(err)})`);
      throw err;
    } finally {
      // ВАЖНО: закрываем page после каждого вызова — иначе zombie процессы
      if (page) try { await page.close(); } catch {}
      if (ownBrowser) try { await ownBrowser.close(); } catch {}
    }
  }
}
