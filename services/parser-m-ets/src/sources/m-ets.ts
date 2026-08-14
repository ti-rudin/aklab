/**
 * М-ЕТС (m-ets.ru) — парсер коммерческой недвижимости.
 *
 * Использует внутренний JSON API: /ajax/api/search?category=...&page=N
 * Возвращает HTML-карточки лотов, парсим через DOMParser в контексте браузера.
 *
 * Playwright, stealth context, anti-ban.
 */
import type { ParserDetailResult, PropertyLocation, SourceParser, ParsedProperty } from '@aklab/service-shared';
import {
  classifyPropertyType,
  createParserExtractionDiagnostics,
  createStealthContext,
  derivePropertyRegion,
  extractAddressFromBoundedPropertyText,
  extractAuctionEndAt,
  logger,
  safeParserErrorCode,
  normalizeStructuredLocation,
  parsePrice,
  projectLegacyAddress,
  randomDelay,
  retryGoto,
} from '@aklab/service-shared';

const BASE_URL = 'https://m-ets.ru';

/**
 * Категории недвижимости на m-ets.ru:
 *   34 = Жилой дом
 *   35 = (резерв)
 *   36 = Квартира
 *   37 = Нежилое помещение
 *   38 = Нежилое здание
 *   39 = Прочие постройки
 *   40 = Земельный участок
 *   41 = Иные сооружения
 */
const NEDVIZH_CATEGORIES = '34,35,36,37,38,39,40,41';

/** API endpoint для поиска. */
function searchApiUrl(page: number): string {
  return `${BASE_URL}/ajax/api/search?category=${NEDVIZH_CATEGORIES}&page=${page}`;
}

// Live evidence: every detail page has a bounded current-property block
// (`.lot-info-block.info-type_1`) with a description and an explicit property region.
const LISTING_PROPERTY_LOCATION_SOURCE_PATH = 'listing.property_location';
const DETAIL_PROPERTY_DESCRIPTION_SOURCE_PATH = 'details.field.Сведения об имуществе.address';
const DETAIL_PROPERTY_REGION_SOURCE_PATH = 'details.field.Регион местонахождения имущества';

export interface MetsPropertyLocationFields {
  propertyBlockFound?: boolean;
  propertyDescription?: unknown;
  propertyRegion?: unknown;
}

/** Browser-safe extraction from the bounded current-property block only. */
export function extractMetsPropertyLocationFields(documentLike?: Document): MetsPropertyLocationFields {
  const doc = documentLike ?? document;
  const propertyBlock = doc.querySelector('.lot-info-block.info-type_1');
  if (!propertyBlock) return { propertyBlockFound: false };

  const description = propertyBlock.querySelector('[itemprop="description"]')?.textContent
    ?.replace(/\s+/g, ' ')
    .trim();
  let propertyRegion: string | undefined;
  for (const item of Array.from(propertyBlock.querySelectorAll('.lot-info-item'))) {
    const label = (item.querySelector('.title')?.textContent ?? '')
      .replace(/\s+/g, ' ')
      .replace(/:$/, '')
      .trim()
      .toLocaleLowerCase('ru-RU');
    if (label !== 'регион местонахождения имущества') continue;
    propertyRegion = item.querySelector('.value')?.textContent?.replace(/\s+/g, ' ').trim() || undefined;
    break;
  }
  return {
    propertyBlockFound: true,
    ...(description ? { propertyDescription: description.slice(0, 2000) } : {}),
    ...(propertyRegion ? { propertyRegion } : {}),
  };
}

function cleanMetsField(value: unknown): string | undefined {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() || undefined : undefined;
}

export function extractMetsPropertyLocation(fields: MetsPropertyLocationFields): PropertyLocation {
  const propertyDescription = cleanMetsField(fields.propertyDescription);
  const region = cleanMetsField(fields.propertyRegion);
  const address = extractAddressFromBoundedPropertyText(propertyDescription);
  if (address) {
    return normalizeStructuredLocation({
      address,
      ...(region ? { region } : {}),
      status: 'confirmed_address',
      source_kind: 'dom_field',
      source_path: DETAIL_PROPERTY_DESCRIPTION_SOURCE_PATH,
    });
  }
  if (region) {
    return normalizeStructuredLocation({
      region,
      status: 'confirmed_region_only',
      source_kind: 'dom_field',
      source_path: DETAIL_PROPERTY_REGION_SOURCE_PATH,
    });
  }
  return missingMetsPropertyLocation(DETAIL_PROPERTY_REGION_SOURCE_PATH);
}

export function missingMetsPropertyLocation(sourcePath: string): PropertyLocation {
  return normalizeStructuredLocation({
    status: 'missing',
    source_kind: 'dom_field',
    source_path: sourcePath,
  });
}

// ─── Классификация типа недвижимости ────────────────────────────────────────

// ─── Парсинг цены ──────────────────────────────────────────────────────────

// ─── Извлечение площади ────────────────────────────────────────────────────

function extractArea(text: string): number | undefined {
  if (!text) return undefined;
  // 54.2 кв.м | 70,7 кв.м | 54,2 кв. м | 13.3 м²
  const match = text.match(/(\d[\d\s]*[,.]?\d*)\s*(?:кв\.?\s*м|м²|м2)/i);
  if (match) {
    const cleaned = match[1].replace(/\s/g, '').replace(',', '.');
    const num = parseFloat(cleaned);
    if (!isNaN(num) && num > 0) return num;
  }
  return undefined;
}

// ─── Определение города / региона ──────────────────────────────────────────


// ─── Парсер ────────────────────────────────────────────────────────────────

export class MetsParser implements SourceParser {
  name = 'm-ets';

  async parse(depth?: number): Promise<ParsedProperty[]> {
    const { chromium } = await import('playwright');
    logger.info('[m-ets] Запуск Playwright...');
    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
      const context = await createStealthContext(browser);
      const page = await context.newPage();

      // Сначала заходим на главную, чтобы получить cookies / sid
      await retryGoto(page, BASE_URL, 2);
      await page.waitForTimeout(2000);

      const allProperties: ParsedProperty[] = [];
      const maxPages = depth ? Math.ceil(depth / 20) : 5; // 20 лотов на страницу
      const maxItems = depth ?? 100;

      for (let pageNum = 1; pageNum <= maxPages && allProperties.length < maxItems; pageNum++) {
        const url = searchApiUrl(pageNum);
        logger.info(`[m-ets] Загрузка страницы ${pageNum}: ${url}`);

        try {
          await randomDelay(1500, 3500);

          // Загружаем API через page.goto — передаём cookies автоматически
          const response = await page.evaluate(async (apiUrl: string) => {
            const resp = await fetch(apiUrl);
            return resp.json();
          }, url);

          if (!response || response.code !== 200 || !response.data?.length) {
            logger.info(`[m-ets] Страница ${pageNum}: нет данных (code=${response?.code})`);
            break;
          }

          const meta = response.meta;
          logger.info(
            `[m-ets] Страница ${pageNum}/${meta?.pages}: ${response.data.length} лотов (всего: ${meta?.total})`,
          );

          // Парсим HTML-карточки в контексте браузера
          const cards = await page.evaluate((items: Array<{ lot_id: number; data: string }>) => {
            const parser = new DOMParser();
            return items.map((item) => {
              const doc = parser.parseFromString(item.data, 'text/html');
              const card = doc.querySelector('.card-so');
              if (!card) {
                return {
                  lot_id: item.lot_id,
                  error: 'no .card-so found',
                };
              }

              // Ссылка на лот
              const linkEl = card.querySelector('a[href]');
              const href = linkEl?.getAttribute('href') || '';

              // Название лота
              const titleEl =
                card.querySelector('.comp-title') ||
                card.querySelector('.info .title') ||
                card.querySelector('[itemprop="name"]');
              const title = titleEl?.textContent?.trim() || '';

              // Цена (из блока cost-block)
              const costEl = card.querySelector('.cost-info .cost span');
              const costText = costEl?.textContent?.trim() || '';

              // Тип цены (Начальная / Текущая)
              const costTypeEl = card.querySelector('.cost-info .title');
              const costType = costTypeEl?.textContent?.trim() || '';

              // Описание
              const descEl = card.querySelector('.description');
              const description = descEl?.textContent?.trim() || '';

              // Тип объявления (Торги по банкротству. Объявленные торги)
              const typeEl = card.querySelector('.comp-type');
              const auctionType = typeEl?.textContent?.trim() || '';

              // Минимальная цена (красная)
              const minPriceEl = card.querySelector('.price.min span, .price.min');
              const minPriceText = minPriceEl?.textContent?.trim() || '';

              // Текущая цена
              const currentPriceEl = card.querySelector('.price.current span, .price.current');
              const currentPriceText = currentPriceEl?.textContent?.trim() || '';

              // Дата окончания
              const dateEl = card.querySelector('.comp-dates .value');
              const endDate = dateEl?.textContent?.trim() || '';

              return {
                lot_id: item.lot_id,
                href,
                title,
                costText,
                costType,
                minPriceText,
                currentPriceText,
                description,
                auctionType,
                endDate,
              };
            });
          }, response.data);

          // Обрабатываем результаты
          for (const card of cards) {
            if ((card as any).error) continue;

            const { href, title, costText, description } = card as any;
            if (!title || title.length < 3) continue;

            const fullLink = href.startsWith('http')
              ? href
              : href.startsWith('/')
                ? `${BASE_URL}${href}`
                : `${BASE_URL}/${href}`;

            // Цена: извлекаем из текста карточки
            const priceText = (card as any).currentPriceText || costText || '';
            const price = parsePrice(priceText);

            // Минимальная цена
            const minimumPrice = parsePrice((card as any).minPriceText || '');

            // Площадь из описания + заголовка
            const fullText = title + ' ' + description;
            const area = extractArea(fullText);

            const propertyLocation = missingMetsPropertyLocation(LISTING_PROPERTY_LOCATION_SOURCE_PATH);

            // external_id: используем lot_id если есть, иначе из href
            const externalId = (card as any).lot_id
              ? `m-ets-${(card as any).lot_id}`
              : `m-ets-${href.split('/').pop() || title.slice(0, 30)}`;

            allProperties.push({
              external_id: externalId,
              url: fullLink,
              title: title.slice(0, 300),
              address: projectLegacyAddress(propertyLocation),
              city: derivePropertyRegion(propertyLocation),
              property_location: propertyLocation,
              area_sqm: area,
              price,
              minimum_price: minimumPrice,
              price_per_sqm: price && area ? Math.round(price / area) : undefined,
              property_type: classifyPropertyType(title + ' ' + description),
              auction_type: 'bankruptcy',
              description: description.slice(0, 1000) || undefined,
            });
          }

          // Проверяем, есть ли ещё страницы
          if (pageNum >= (meta?.pages || 1)) {
            logger.info('[m-ets] Достигнута последняя страница');
            break;
          }
        } catch (err: any) {
          logger.warn(`[m-ets] Ошибка на странице ${pageNum}: ${safeParserErrorCode(err)}`);
          // Продолжаем со следующей страницы
        }
      }

      logger.info(`[m-ets] Итого: ${allProperties.length} объектов недвижимости`);
      return allProperties;
    } catch (err: any) {
      logger.error(`[m-ets] Ошибка парсинга: ${safeParserErrorCode(err)}`);
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

      await page.waitForFunction(() => (
        (document.querySelector('.lot-info-block.info-type_1')?.textContent || '').trim().length > 0
      ), undefined, { timeout: 15000 });

      const locationFields = await page.evaluate(extractMetsPropertyLocationFields);
      const details = await page.evaluate(() => {
        // ─── Контакты: .lot-info-block.info-type_4 → .lot-info-item ───
        let organizerName = '';
        let phone = '';
        let email = '';

        const contactBlock = document.querySelector('.lot-info-block.info-type_4');
        if (contactBlock) {
          const items = contactBlock.querySelectorAll('.lot-info-item');
          for (const item of Array.from(items)) {
            const titleEl = item.querySelector('.title');
            const titleText = (titleEl?.textContent || '').trim();

            if (titleText.includes('Наименование')) {
              organizerName = (item.querySelector('.value')?.textContent || '').trim();
            } else if (titleText.includes('Телефон')) {
              const telLink = item.querySelector('a[href^="tel:"]');
              phone = telLink
                ? (telLink.getAttribute('href') || '').replace('tel:', '').trim()
                : (item.querySelector('.value')?.textContent || '').trim();
            } else if (titleText.includes('Адрес электронной почты') || titleText.includes('электронной почты')) {
              email = (item.querySelector('.value')?.textContent || '').trim();
            }
          }
        }

        const contactParts: string[] = [];
        if (organizerName) contactParts.push(organizerName);
        if (phone) contactParts.push(phone);
        if (email) contactParts.push(email);
        const contacts = contactParts.join(', ');


        // ─── Цена: meta[itemprop='price'] (primary) или .lot-cost-item.price .value (fallback) ───
        // meta[itemprop='price'] — цена текущего лота. .lot-cost-item.price .value — может быть первый лот на мульти-лот странице
        let priceText = '';
        const metaPrice = document.querySelector('meta[itemprop="price"]');
        if (metaPrice) {
          priceText = (metaPrice.getAttribute('content') || '').trim();
        }
        if (!priceText) {
          const priceEl = document.querySelector('.lot-cost-item.price .value');
          if (priceEl) {
            priceText = (priceEl.textContent || '').trim();
          }
        }

        // ─── Даты: .lot-cost-item.date .value ───
        let dates: string[] = [];
        const dateEls = document.querySelectorAll('.lot-cost-item.date .value');
        for (const el of Array.from(dateEls)) {
          const txt = (el.textContent || '').trim();
          if (txt) dates.push(txt);
        }

        // ─── Задаток: .lot-cost-item.zadat .value ───
        let depositText = '';
        const depositEl = document.querySelector('.lot-cost-item.zadat .value');
        if (depositEl) {
          depositText = (depositEl.textContent || '').trim();
        }

        return {
          contacts: contacts || undefined,
          priceText: priceText || undefined,
          dates: dates.length ? dates : undefined,
          auctionText: document.body.innerText || '',
          depositText: depositText || undefined,
        };
      });

      // Добавляем задаток к описанию, если найден
      let desc = locationFields.propertyDescription;
      if (details.depositText) {
        const depositNote = `Задаток: ${details.depositText}`;
        desc = desc ? `${desc}\n${depositNote}` : depositNote;
      }

      const propertyLocation = extractMetsPropertyLocation({
        propertyDescription: locationFields.propertyDescription,
        propertyRegion: locationFields.propertyRegion,
      });
      const locationLabelId = propertyLocation.status === 'confirmed_address'
        ? 'property.location.address'
        : propertyLocation.status === 'confirmed_region_only'
          ? 'property.location.region'
          : undefined;
      const parserDiagnostics = createParserExtractionDiagnostics({
        adapterVersion: 'm-ets.v1',
        propertyBlockFound: locationFields.propertyBlockFound === true,
        ...(locationLabelId ? { locationLabelId } : {}),
        ...(!locationLabelId && locationFields.propertyBlockFound ? { schemaMismatch: 'location_label_missing' as const } : {}),
        semanticSignals: [
          ...(locationFields.propertyBlockFound ? ['property.block'] : []),
          ...(locationFields.propertyDescription ? ['property.description'] : []),
          ...(locationFields.propertyRegion ? ['property.location.region'] : []),
          ...(propertyLocation.status === 'confirmed_address' ? ['property.location.address'] : []),
        ],
      });
      return {
        description: desc,
        contacts: details.contacts,
        property_location: propertyLocation,
        parser_diagnostics: parserDiagnostics,
        address: projectLegacyAddress(propertyLocation),
        city: derivePropertyRegion(propertyLocation),
        latitude: propertyLocation.latitude,
        longitude: propertyLocation.longitude,
        price: details.priceText ? parsePrice(details.priceText) : undefined,
        auction_end_at: extractAuctionEndAt(details.auctionText),
      };
    } catch (err: any) {
      logger.warn(`[m-ets] fetchDetails failed (${safeParserErrorCode(err)})`);
      throw err;
    } finally {
      if (page) try { await page.close(); } catch {}
      if (ownBrowser) try { await ownBrowser.close(); } catch {}
    }
  }
}
