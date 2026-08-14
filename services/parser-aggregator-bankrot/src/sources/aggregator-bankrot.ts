/**
 * Агрегатор банкрот (xn----etbpba5admdlad.xn--p1ai) — парсер коммерческой недвижимости.
 *
 * HTML scraping через Playwright. Сайт без anti-bot.
 * Search: /search?trades-section[0]=commercial
 * 27 карточек на страницу, ~48 страниц.
 * Площадь из excerpt текста: "Общая площадь: 274.4 м²"
 */
import type { ParserDetailResult, PropertyLocation, SourceParser, ParsedProperty } from '@aklab/service-shared';
import {
  classifyPropertyType,
  createParserExtractionDiagnostics,
  derivePropertyRegion,
  extractAddressFromBoundedPropertyText,
  logger,
  safeParserErrorCode,
  normalizeStructuredLocation,
  parsePrice,
  projectLegacyAddress,
  randomDelay,
  createStealthContext,
  retryGoto,
} from '@aklab/service-shared';

const BASE_URL = 'https://xn----etbpba5admdlad.xn--p1ai';
const SEARCH_URL = `${BASE_URL}/search?trades-section%5B0%5D=commercial&history_only=0`;

// Марки автомобилей — фильтруем транспорт из выдачи "коммерческой недвижимости"
const CAR_BRANDS = [
  'ваз', 'lada', 'vaz', 'toyota', 'ford', 'bmw', 'mercedes', 'hyundai',
  'kia', 'nissan', 'renault', 'mazda', 'skoda', 'chevrolet', 'jac',
  'geely', 'lexus', 'honda', 'baic', 'chery', 'haval', 'great wall',
  'opel', 'volkswagen', 'peugeot', 'citroen', 'volvo', 'suzuki',
  'mitsubishi', 'subaru', 'infiniti', 'acura', 'datsun', 'uaz',
  'gaz', 'kamaz', 'маз', 'газ', 'камаз',
];

// Триггеры не-недвижимости в заголовке
const TITLE_EXCLUDE_PATTERNS = [
  'л.с.', 'л.с,', 'л.с ', 'лошадин', // мощность двигателя
  'объем двигател', 'объём двигател', 'vin:', 'vin ', // автомобильные
  'палета', 'гель для стирки', 'бытовая химия', 'стиральн', // бытовые
  'авточасти', 'запчаст', 'шина', 'диск колесн', // автозапчасти
];

const PROPERTY_LOCATION_CONTAINER = '#info';
const PROPERTY_LOCATION_ADDRESS_FIELD = '#info.field.Адрес местонахождения';
const PROPERTY_LOCATION_DESCRIPTION_FIELD = '#info.field.Общая информация.address';
const PROPERTY_LOCATION_REGION_FIELD = '#info.field.Регион';

interface PropertyLocationElement {
  textContent?: string | null;
  querySelector(selector: string): PropertyLocationElement | null;
}

interface PropertyLocationDocument {
  querySelectorAll(selector: string): ArrayLike<PropertyLocationElement>;
}

export interface AggregatorPropertyLocationFields {
  propertyBlockFound?: boolean;
  address?: string;
  region?: string;
  propertyText?: string;
}

/** Read only exact labelled fields from the current lot's `#info` panel. */
export function extractAggregatorPropertyLocationFields(
  document?: PropertyLocationDocument,
): AggregatorPropertyLocationFields {
  const documentLike = document ?? globalThis.document as unknown as PropertyLocationDocument;
  const rows = documentLike?.querySelectorAll('#info .panel__wrapper p') ?? [];
  const fields: AggregatorPropertyLocationFields = { propertyBlockFound: false };
  for (const row of Array.from(rows)) {
    const label = (typeof row.querySelector('span.text-grey')?.textContent === 'string'
      ? row.querySelector('span.text-grey')?.textContent?.replace(/\s+/g, ' ').trim()
      : undefined)
      ?.replace(/:$/, '')
      .toLocaleLowerCase('ru-RU');
    const rawValue = row.querySelector('span.js-share-search')?.textContent;
    const value = typeof rawValue === 'string'
      ? rawValue.replace(/\s+/g, ' ').trim() || undefined
      : undefined;
    if (label === 'адрес местонахождения' || label === 'регион' || label === 'общая информация') {
      fields.propertyBlockFound = true;
    }
    if (!value) continue;
    if (label === 'адрес местонахождения') fields.address = value;
    if (label === 'регион') fields.region = value;
    if (label === 'общая информация') fields.propertyText = value;
  }
  return fields;
}

export function normalizeAggregatorPropertyLocation(
  fields: AggregatorPropertyLocationFields,
): PropertyLocation {
  const address = fields.address ?? extractAddressFromBoundedPropertyText(fields.propertyText);
  if (address) {
    return normalizeStructuredLocation({
      address,
      ...(fields.region ? { region: fields.region } : {}),
      status: 'confirmed_address',
      source_kind: 'dom_field',
      source_path: fields.address
        ? PROPERTY_LOCATION_ADDRESS_FIELD
        : PROPERTY_LOCATION_DESCRIPTION_FIELD,
    });
  }
  if (fields.region) {
    return normalizeStructuredLocation({
      region: fields.region,
      status: 'confirmed_region_only',
      source_kind: 'dom_field',
      source_path: PROPERTY_LOCATION_REGION_FIELD,
    });
  }

  return normalizeStructuredLocation({
    status: 'missing',
    source_kind: 'dom_field',
    source_path: PROPERTY_LOCATION_CONTAINER,
  });
}

function extractArea(text: string): number | undefined {
  // "Общая площадь: 274.4 м²" or "Общая площадь: 274,4 м²"
  const match = text.match(/(?:общая\s+)?площад[ьи]?\s*:?\s*(\d[\d\s]*[,.]?\d*)\s*(?:кв\.?\s*м|м²|м2)/i);
  if (match) {
    const cleaned = match[1].replace(/\s/g, '').replace(',', '.');
    const num = parseFloat(cleaned);
    if (!isNaN(num) && num > 0) return num;
  }
  // Fallback: "9484 кв.м" без слова "площадь" (часто в title)
  const fallback = text.match(/(\d[\d\s]*[,.]?\d*)\s*(?:кв\.?\s*м|м²|м2)/i);
  if (fallback) {
    const cleaned = fallback[1].replace(/\s/g, '').replace(',', '.');
    const num = parseFloat(cleaned);
    if (!isNaN(num) && num > 0) return num;
  }
  // Сотки: "9 сот." → 900 м² (1 сотка = 100 м²)
  const sotka = text.match(/(\d[\d\s]*[,.]?\d*)\s*(?:сот\.?|соток|сотки|сотка)/i);
  if (sotka) {
    const cleaned = sotka[1].replace(/\s/g, '').replace(',', '.');
    const num = parseFloat(cleaned) * 100;
    if (!isNaN(num) && num > 0) return num;
  }
  return undefined;
}

export class AggregatorBankrotParser implements SourceParser {
  name = 'aggregator-bankrot';

  async parse(depth?: number): Promise<ParsedProperty[]> {
    const { chromium } = await import('playwright');

    logger.info('[aggregator-bankrot] Starting Playwright browser...');
    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
      const context = await createStealthContext(browser);
      const page = await context.newPage();
      const allProperties: ParsedProperty[] = [];
      const seenIds = new Set<string>();

      const ITEMS_PER_PAGE = 27;
      const DEFAULT_MAX_PAGES = 10;
      const maxPages = depth ? Math.ceil(depth / ITEMS_PER_PAGE) : DEFAULT_MAX_PAGES;

      for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
        const url = pageNum === 1 ? SEARCH_URL : `${SEARCH_URL}&page=${pageNum}`;
        logger.info(`[aggregator-bankrot] Loading page ${pageNum}: ${url}`);

        // Пауза между страницами
        if (pageNum > 1) {
          await randomDelay(2000, 5000);
        }

        await retryGoto(page, url, 3);
        await page.waitForTimeout(3000);

        const cards = await page.evaluate(() => {
          const results: Array<{
            lot_id: string;
            title: string;
            link: string;
            price_text: string;
            excerpt: string;
          }> = [];

          const items = document.querySelectorAll('li.search-page-cards__item');
          for (const item of Array.from(items)) {
            const card = item.querySelector('article.card');
            if (!card) continue;

            const idEl = card.querySelector('.card-meta__item b.text-primary');
            const lotId = idEl?.textContent?.trim() || '';
            if (!lotId) continue;

            const titleEl = card.querySelector('h3.card__title a') as HTMLAnchorElement;
            const title = titleEl?.textContent?.trim() || '';
            const link = titleEl?.href || '';

            const bidsEl = card.querySelector('.card__bids');
            const currentBid = bidsEl?.getAttribute('data-current-bid') || '';
            const startBid = bidsEl?.getAttribute('data-start-bid') || '';
            const priceDisplay = card.querySelector('.bid__value')?.textContent?.trim() || '';
            const priceText = currentBid || startBid || priceDisplay;

            const excerpt = card.querySelector('.card__excerpt a')?.textContent?.trim() || '';

            results.push({ lot_id: lotId, title, link, price_text: priceText, excerpt });
          }
          return results;
        });

        logger.info(`[aggregator-bankrot] Page ${pageNum}: ${cards.length} cards`);

        let pageNewCount = 0;
        for (const card of cards) {
          // Ранняя фильтрация: пропускаем автомобили, бытовые товары и прочее не-недвижимое
          const titleLower = card.title.toLowerCase();
          const isCar = CAR_BRANDS.some(brand => titleLower.includes(brand));
          const hasExcludePattern = TITLE_EXCLUDE_PATTERNS.some(pat => titleLower.includes(pat));
          if (isCar || hasExcludePattern) {
            logger.debug(`[aggregator-bankrot] Skipping non-realty: ${card.title.slice(0, 60)}`);
            continue;
          }

          // Приоритет: title (там "9484 кв.м"), потом excerpt (может быть площадь отдельного помещения)
          const area = extractArea(card.title) || extractArea(card.excerpt);
          const price = parsePrice(card.price_text);
          const propertyLocation = normalizeAggregatorPropertyLocation({});

          const extId = `aggregator-bankrot-${card.lot_id}`;
          if (seenIds.has(extId)) continue;
          seenIds.add(extId);

          allProperties.push({
            external_id: extId,
            url: card.link.startsWith('http') ? card.link : `${BASE_URL}${card.link}`,
            title: card.title,
            address: projectLegacyAddress(propertyLocation),
            city: derivePropertyRegion(propertyLocation),
            property_location: propertyLocation,
            area_sqm: area,
            price,
            price_per_sqm: price && area ? Math.round(price / area) : undefined,
            property_type: classifyPropertyType(card.title + ' ' + card.excerpt),
            auction_type: 'bankruptcy',
            description: card.excerpt.length > 20 ? card.excerpt.slice(0, 500) : undefined,
          });
          pageNewCount++;
        }

        if (cards.length === 0) break;
      }

      logger.info(`[aggregator-bankrot] Total: ${allProperties.length} properties`);
      return allProperties;
    } catch (err: any) {
      logger.error(`[aggregator-bankrot] Parse error: ${safeParserErrorCode(err)}`);
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

      await page.waitForFunction(() => Array.from(document.querySelectorAll('#info .panel__wrapper p')).some((row) => (
        /^(адрес местонахождения|регион|общая информация)$/iu.test(
          (row.querySelector('span.text-grey')?.textContent || '').replace(/:\s*$/u, '').trim(),
        ) && (row.textContent || '').trim().length > 0
      )), undefined, { timeout: 10000 });

      const locationFields = await page.evaluate(extractAggregatorPropertyLocationFields);
      const details = await page.evaluate(() => {
        // Описание: #description .panel__wrapper p.js-share-search
        let description = '';
        const descPanel = document.querySelector('#description .panel__wrapper p.js-share-search');
        if (descPanel && descPanel.textContent && descPanel.textContent.trim().length > 20) {
          description = descPanel.textContent.trim().slice(0, 2000);
        }

        // Контакты: #trade-organizer → label (span.text-grey) + value (span.js-share-search)
        const contactParts: string[] = [];
        const orgPanel = document.querySelector('#trade-organizer');
        if (orgPanel) {
          const paragraphs = orgPanel.querySelectorAll('.panel__wrapper p');
          for (const p of Array.from(paragraphs)) {
            const label = p.querySelector('span.text-grey')?.textContent?.trim().toLowerCase() || '';
            const value = p.querySelector('span.js-share-search')?.textContent?.trim() || '';
            if (!value) continue;
            if (label.includes('наименование')) contactParts.push('Организатор: ' + value);
            if (label.includes('e-mail') && !label.includes('контакт')) contactParts.push('Email: ' + value);
            if (label.includes('телефон') && !label.includes('контакт')) contactParts.push('Тел: ' + value);
            if (label.includes('фио контакт')) contactParts.push('Контактное лицо: ' + value);
            if (label.includes('телефон контакт')) contactParts.push('Тел контакта: ' + value);
            if (label.includes('e-mail контакт')) contactParts.push('Email контакта: ' + value);
          }
        }
        const contacts = contactParts.length > 0 ? contactParts.join(', ') : undefined;

        // Цена и даты: sidebar .lot-data__list
        const auctionParts: string[] = [];
        const bidEl = document.querySelector('.lot-card__bids');
        if (bidEl) {
          const currentBid = bidEl.getAttribute('data-current-bid');
          const startBid = bidEl.getAttribute('data-start-bid');
          if (startBid) {
            auctionParts.push('Начальная цена: ' + startBid);
          }
          if (currentBid && currentBid !== startBid) auctionParts.push('Текущая цена: ' + currentBid);
        }

        // Sidebar данные
        const lotDataItems = document.querySelectorAll('.lot-data__item .lot-data__text');
        for (const el of Array.from(lotDataItems)) {
          const text = el.textContent?.trim() || '';
          if (text.includes('Начало приема ценовых')) auctionParts.push('Начало приема ставок: ' + text.replace(/.*:\s*/, ''));
          if (text.includes('Конец приема ценовых')) auctionParts.push('Конец приема ставок: ' + text.replace(/.*:\s*/, ''));
        }

        // Задаток из #info
        const infoPanel = document.querySelector('#info');
        if (infoPanel) {
          const paragraphs = infoPanel.querySelectorAll('.panel__wrapper p');
          for (const p of Array.from(paragraphs)) {
            const label = p.querySelector('span.text-grey')?.textContent?.trim().toLowerCase() || '';
            const value = p.querySelector('span.js-share-search')?.textContent?.trim() || '';
            if (label.includes('задаток') && value) auctionParts.push('Задаток: ' + value);
            if (label.includes('начальная стоимость') && value) auctionParts.push('Начальная стоимость: ' + value);
          }
        }

        return {
          description: description || undefined,
          contacts,
          auctionDetails: auctionParts.length > 0 ? auctionParts.join(' | ') : undefined,
        };
      });

      const property_location = normalizeAggregatorPropertyLocation(locationFields);
      const locationLabelId = property_location.status === 'confirmed_address'
        ? 'property.location.address'
        : property_location.status === 'confirmed_region_only'
          ? 'property.location.region'
          : undefined;
      const parserDiagnostics = createParserExtractionDiagnostics({
        adapterVersion: 'aggregator-bankrot.v1',
        propertyBlockFound: locationFields.propertyBlockFound === true,
        ...(locationLabelId ? { locationLabelId } : {}),
        ...(!locationLabelId && locationFields.propertyBlockFound ? { schemaMismatch: 'location_label_missing' as const } : {}),
        semanticSignals: [
          ...(locationFields.propertyBlockFound ? ['property.block'] : []),
          ...(locationFields.propertyText ? ['property.description'] : []),
          ...(locationFields.region ? ['property.location.region'] : []),
          ...(property_location.status === 'confirmed_address' ? ['property.location.address'] : []),
        ],
      });
      return {
        description: details.description,
        contacts: details.contacts,
        property_location,
        parser_diagnostics: parserDiagnostics,
        address: projectLegacyAddress(property_location),
        city: derivePropertyRegion(property_location),
        latitude: property_location.latitude,
        longitude: property_location.longitude,
      };
    } catch (err: any) {
      logger.warn(`[aggregator-bankrot] fetchDetails failed (${safeParserErrorCode(err)})`);
      throw err;
    } finally {
      if (page) try { await page.close(); } catch {}
      if (ownBrowser) try { await ownBrowser.close(); } catch {}
    }
  }
}
