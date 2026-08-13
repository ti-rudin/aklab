/**
 * Сбербанк-АСТ (utp.sberbank-ast.ru) — парсер коммерческой недвижимости.
 *
 * Данные встроены в HTML в скрытом input#xmlData в формате XML.
 * Парсим XML напрямую, без ожидания JS-рендеринга таблицы.
 *
 * ~6600 лотов, ~332 страницы.
 */
import type { SourceParser, ParsedProperty, PropertyLocation } from '@aklab/service-shared';
import {
  classifyPropertyType,
  createStealthContext,
  derivePropertyRegion,
  logger,
  normalizeStructuredLocation,
  parseAuctionEndAt,
  parsePrice,
  projectLegacyAddress,
  randomDelay,
  retryGoto,
} from '@aklab/service-shared';

const BASE_URL = 'https://utp.sberbank-ast.ru';
const SEARCH_URL = `${BASE_URL}/Property/List/BidListComReal`;
const MAX_PAGES = 10;
const ITEMS_PER_PAGE = 20;

function extractArea(text: string): number | undefined {
  const match = text.match(/(\d[\d\s]*[,.]?\d*)\s*(?:кв\.?\s*м|м²|м2)/i);
  if (match) {
    const cleaned = match[1].replace(/\s/g, '').replace(',', '.');
    const num = parseFloat(cleaned);
    if (!isNaN(num) && num > 0) return num;
  }
  return undefined;
}

const PROPERTY_LOCATION_SOURCE_PATH = 'textAddress|GeoDataAddress';

function cleanXmlText(value: string): string | undefined {
  const decoded = value
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .trim();
  return decoded || undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readXmlTag(xml: string, tag: string): string | undefined {
  const match = xml.match(new RegExp(`<${escapeRegExp(tag)}\\b[^>]*>([\\s\\S]*?)</${escapeRegExp(tag)}>`, 'i'));
  return match ? cleanXmlText(match[1].replace(/<[^>]+>/g, ' ')) : undefined;
}

function readFirstXmlTag(xml: string, tags: readonly string[]): { value?: string; tag?: string } {
  for (const tag of tags) {
    const value = readXmlTag(xml, tag);
    if (value) return { value, tag };
  }
  return {};
}

function readXmlCoordinate(xml: string, tags: readonly string[]): number | undefined {
  const value = readFirstXmlTag(xml, tags).value;
  if (!value) return undefined;
  const number = Number(value.replace(',', '.'));
  return Number.isFinite(number) ? number : undefined;
}

function buildPropertyLocation(fields: {
  address?: string;
  addressPath?: string;
  latitude?: number;
  longitude?: number;
}): PropertyLocation {
  const address = fields.address?.trim() || undefined;
  const latitude = fields.latitude;
  const longitude = fields.longitude;
  const hasCoordinatePair = latitude !== undefined && longitude !== undefined;

  return normalizeStructuredLocation({
    ...(address ? { address } : {}),
    ...(hasCoordinatePair ? { latitude, longitude } : {}),
    status: address ? 'confirmed_address' : hasCoordinatePair ? 'confirmed_region_only' : 'missing',
    source_kind: 'xml_field',
    source_path: address
      ? fields.addressPath || PROPERTY_LOCATION_SOURCE_PATH
      : hasCoordinatePair
        ? 'Latitude|Longitude'
        : PROPERTY_LOCATION_SOURCE_PATH,
  });
}

/** Extract only property-bound XML fields; party and free-text fields are ignored. */
export function extractPropertyLocationFromXml(xml: string): PropertyLocation {
  const address = readFirstXmlTag(xml, ['textAddress', 'GeoDataAddress']);
  return buildPropertyLocation({
    address: address.value,
    addressPath: address.tag,
    latitude: readXmlCoordinate(xml, ['Latitude', 'latitude']),
    longitude: readXmlCoordinate(xml, ['Longitude', 'longitude']),
  });
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
            amount: string; property_location: {
              address?: string; latitude?: number; longitude?: number;
              status: 'confirmed_address' | 'confirmed_region_only' | 'missing';
              source_kind: 'xml_field'; source_path: string;
            };
            branch?: string;
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
            const propertyAddressFields = [
              ['GeoDataAddress', row.querySelector('GeoDataAddress')?.textContent?.trim() || ''],
              ['textAddress', row.querySelector('textAddress')?.textContent?.trim() || ''],
            ] as const;
            const propertyAddressField = propertyAddressFields.find(([, value]) => value.length > 0);
            const geoAddress = propertyAddressField?.[1] || '';
            const propertyAddressPath = propertyAddressField?.[0] || 'GeoDataAddress|textAddress';
            const detailHref = row.querySelector('bidHrefTerm')?.textContent?.trim() || '';
            const latStr = row.querySelector('Latitude')?.textContent?.trim();
            const lngStr = row.querySelector('Longitude')?.textContent?.trim();
            const branchName = row.querySelector('BranchNameNew')?.textContent?.trim() || '';

            if (!purchaseName && !bidName) continue;

            const title = purchaseName || bidName;
            const detailUrl = detailHref || `${window.location.origin}/Property/NBT/PurchaseView/43/0/0/${purchaseId}`;
            const hasCoordinates = latStr && lngStr && Number.isFinite(Number(latStr)) && Number.isFinite(Number(lngStr));
            const coordinates = hasCoordinates
              ? { latitude: Number(latStr), longitude: Number(lngStr) }
              : {};
            const propertyLocation = {
              ...(geoAddress ? { address: geoAddress } : {}),
              ...coordinates,
              status: geoAddress
                ? 'confirmed_address' as const
                : hasCoordinates
                  ? 'confirmed_region_only' as const
                  : 'missing' as const,
              source_kind: 'xml_field' as const,
              source_path: geoAddress
                ? propertyAddressPath
                : hasCoordinates
                  ? 'Latitude|Longitude'
                  : 'GeoDataAddress|textAddress',
            };

            results.push({
              purchase_id: purchaseId,
              title,
              price_text: currentAmount || amount,
              status: purchaseState,
              detail_url: detailUrl,
              organizer: orgName,
              amount: currentAmount || amount,
              property_location: propertyLocation,
              branch: branchName,
            });
          }

          return results;
        });

        logger.info(`[sberbank-ast] Page ${pageNum}: ${lots.length} lots`);

        for (const lot of lots) {
          const price = parsePrice(lot.price_text);
          const propertyLocation = normalizeStructuredLocation(lot.property_location);
          allProperties.push({
            external_id: `sberbank-ast-${lot.purchase_id || lot.title.slice(0, 50)}`,
            url: lot.detail_url.startsWith('http') ? lot.detail_url : `${BASE_URL}${lot.detail_url}`,
            title: lot.title,
            address: projectLegacyAddress(propertyLocation),
            city: derivePropertyRegion(propertyLocation),
            property_location: propertyLocation,
            property_type: classifyPropertyType(`${lot.title} ${lot.branch || ''}`),
            auction_type: 'bankruptcy',
            price,
            area_sqm: extractArea(lot.title),
            latitude: propertyLocation.latitude,
            longitude: propertyLocation.longitude,
            description: lot.title.length > 20 ? lot.title : undefined,
            contacts: lot.organizer || undefined,
          });
        }

        // AJAX pagination — кликаем "следующая"
        const nextBtn = page.locator('span.pager-button.pagerElem').filter({ hasText: '›' }).first();
        const btnCount = await nextBtn.count();
        if (btnCount > 0) {
          try {
            const isVisible = await nextBtn.isVisible();
            logger.info(`[sberbank-ast] Next page button found (visible: ${isVisible})`);
            if (!isVisible) {
              await page.evaluate(() => {
                const btn = document.querySelector('span.pager-button.pagerElem');
                if (btn) (btn as HTMLElement).scrollIntoView();
              });
              await page.waitForTimeout(1000);
            }
            await nextBtn.click();
            await randomDelay(2000, 5000);
            await page.waitForTimeout(3000);
          } catch (e: any) {
            logger.warn(`[sberbank-ast] Pagination click failed: ${e.message}`);
            break;
          }
        } else {
          logger.info(`[sberbank-ast] No next page button — stopping after ${pageNum} pages`);
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

      // Ждём загрузки данных
      try {
        await page.waitForSelector('#xmlData, #Bids_BidName, #OrganizatorInfo_OrgName', { timeout: 15000 });
      } catch {
        await page.waitForTimeout(5000);
      }

      const details = await page.evaluate(() => {
        // Данные хранятся в #xmlData как XML-escaped HTML
        // Парсим через DOMParser
        function getXmlDoc(): Document | null {
          const xmlEl = document.getElementById('xmlData') as HTMLInputElement;
          if (!xmlEl || !xmlEl.value) return null;
          const parser = new DOMParser();
          return parser.parseFromString(xmlEl.value, 'text/html');
        }

        const xmlDoc = getXmlDoc();

        // Функция извлечения значения по ID элемента на странице
        function getById(id: string): string {
          const el = document.getElementById(id);
          if (el) return el.textContent?.trim() || '';
          // Fallback: ищем в XML
          if (xmlDoc) {
            const xmlEl = xmlDoc.getElementById(id);
            if (xmlEl) return xmlEl.textContent?.trim() || '';
          }
          return '';
        }

        // Функция извлечения из XML по тегу
        function getXmlTag(tag: string): string {
          if (!xmlDoc) return '';
          const el = xmlDoc.querySelector(tag);
          return el?.textContent?.trim() || '';
        }

        // Описание: BidComment + BidName
        const bidName = getById('Bids_BidName');
        const bidComment = getById('Bids_BidComment');
        const description = [bidName, bidComment].filter(s => s.length > 10).join(' | ').slice(0, 2000);

        // Контакты: OrganizatorInfo
        const contactParts: string[] = [];
        const orgName = getById('OrganizatorInfo_OrgName') || getXmlTag('orgname');
        const orgPhone = getById('OrganizatorInfo_OrgPhone') || getXmlTag('orgphone');
        const orgEmail = getById('OrganizatorInfo_OrgEmail') || getXmlTag('orgemail');
        const orgContact = getById('OrganizatorInfo_OrgContactPerson');
        if (orgName) contactParts.push('Организатор: ' + orgName);
        if (orgPhone) contactParts.push('Тел: ' + orgPhone);
        if (orgEmail) contactParts.push('Email: ' + orgEmail);
        if (orgContact) contactParts.push('Контактное лицо: ' + orgContact);
        const contacts = contactParts.length > 0 ? contactParts.join(', ') : undefined;

        // Каноническая география: только property-bound XML fields.
        // Адреса организатора/customer и полный текст страницы намеренно не читаются.
        const propertyAddressFields = [
          ['textAddress', getXmlTag('textAddress')],
          ['GeoDataAddress', getXmlTag('GeoDataAddress')],
        ] as const;
        const propertyAddressField = propertyAddressFields.find(([, value]) => value.length > 0);
        // Координаты: только связанные XML-теги текущего имущества
        const latStr = getXmlTag('Latitude') || getXmlTag('latitude');
        const lonStr = getXmlTag('Longitude') || getXmlTag('longitude');
        const latitude = latStr ? parseFloat(latStr) : undefined;
        const longitude = lonStr ? parseFloat(lonStr) : undefined;
        const hasCoordinates = latitude !== undefined && longitude !== undefined
          && Number.isFinite(latitude) && Number.isFinite(longitude);
        const propertyAddress = propertyAddressField?.[1] || undefined;
        const propertyLocation = {
          ...(propertyAddress ? { address: propertyAddress } : {}),
          ...(hasCoordinates ? { latitude, longitude } : {}),
          status: propertyAddress
            ? 'confirmed_address' as const
            : hasCoordinates
              ? 'confirmed_region_only' as const
              : 'missing' as const,
          source_kind: 'xml_field' as const,
          source_path: propertyAddressField?.[0]
            || (hasCoordinates ? 'Latitude|Longitude' : 'textAddress|GeoDataAddress'),
        };

        // Цена: BidPriceNotReq или BidMinPrice
        const priceStr = getById('Bids_BidPriceNotReq');
        const minPriceStr = getById('Bids_BidMinPrice');

        // Даты: PurchasePlan
        const requestStart = getById('PurchasePlan_RequestStartDate');
        const requestEnd = getById('PurchasePlan_RequestStopDate');
        const auctionDate = getById('PurchasePlan_AuctionMinPeriodsDate');

        const auctionParts: string[] = [];
        if (priceStr) auctionParts.push('Начальная цена: ' + priceStr);
        if (minPriceStr && minPriceStr !== priceStr) auctionParts.push('Мин. цена: ' + minPriceStr);
        if (requestStart) auctionParts.push('Начало заявок: ' + requestStart);
        if (requestEnd) auctionParts.push('Конец заявок: ' + requestEnd);
        if (auctionDate) auctionParts.push('Дата торгов: ' + auctionDate);

        return {
          description: description || undefined,
          contacts,
          property_location: propertyLocation,
          auction_end_at: parseAuctionEndAt(requestEnd || auctionDate || ''),
        };
      });

      return {
        description: details.description,
        contacts: details.contacts,
        property_location: details.property_location,
        auction_end_at: details.auction_end_at,
      };
    } catch (err: any) {
      logger.warn(`[sberbank-ast] fetchDetails error for ${url}: ${err.message}`);
      return {};
    } finally {
      await browser.close();
    }
  }
}
