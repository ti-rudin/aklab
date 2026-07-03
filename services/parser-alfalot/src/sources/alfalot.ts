/**
 * Alfot — парсер коммерческой недвижимости.
 *
 * SPA на ecosystem.alfalot.ru, Playwright.
 * Search: /showcase/list?categories=1 (Недвижимость)
 * 12 карточек на страницу, ~217 страниц.
 * Площадь из badges: title="Площадь: 112.00"
 */
import type { SourceParser, ParsedProperty } from '@aklab/service-shared';
import { logger, randomDelay, createStealthContext, retryGoto } from '@aklab/service-shared';

const BASE_URL = 'https://ecosystem.alfalot.ru';
const SEARCH_URL = `${BASE_URL}/showcase/list?categories=1`;
const MAX_PAGES = 10;
const MAX_AGE_HOURS = 24;

function classifyPropertyType(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes('офис') || lower.includes('административн')) return 'office';
  if (lower.includes('склад') || lower.includes('хранилищ')) return 'warehouse';
  if (lower.includes('магазин') || lower.includes('торгов') || lower.includes('павильон')) return 'retail';
  if (lower.includes('производствен') || lower.includes('промышленн')) return 'production';
  if (lower.includes('нежилое') || lower.includes('помещение') || lower.includes('коммерческ') ||
      lower.includes('гараж') || lower.includes('земельн')) return 'free_purpose';
  if (lower.includes('квартир')) return 'apartment';
  return 'other';
}

function detectCity(address: string): string {
  const lower = address.toLowerCase();
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

          const parts = [card.title, card.object_type, card.lot_number].filter(Boolean);
          allProperties.push({
            external_id: `alfalot-${card.lot_id}`,
            url: fullLink,
            title: card.title,
            address: card.region,
            city: detectCity(card.region),
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
      logger.error(`[alfalot] Parse error: ${err.message}`);
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

      // Ждём загрузки контента
      try {
        await page.waitForSelector('.lot-detail, .lot-info, .description, [class*="description"]', { timeout: 10000 });
      } catch {
        await page.waitForTimeout(3000);
      }

      const details = await page.evaluate(() => {
        // Описание: ищем блоки с текстом описания
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

        // Контакты: телефон, email, организатор
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

        // Если контакты не найдены в блоках — ищем телефон/email в тексте
        if (!contacts) {
          const bodyText = document.body.textContent || '';
          const phoneMatch = bodyText.match(/(?:\+7|8)[\s\-]?\(?\d{3}\)?[\s\-]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2}/);
          const emailMatch = bodyText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
          const parts = [];
          if (phoneMatch) parts.push(phoneMatch[0]);
          if (emailMatch) parts.push(emailMatch[0]);
          contacts = parts.join(', ');
        }

        // Координаты: ищем в data-атрибутах или скриптах
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

        // Координаты из скриптов (Yandex/Google Maps)
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

        // Детали аукциона: даты, шаг, задаток
        const auctionInfo: string[] = [];
        const allText = document.body.textContent || '';
        const dateMatch = allText.match(/(?:дата|начало|окончание|торги)[\s:]*(\d{2}\.\d{2}\.\d{4})/gi);
        if (dateMatch) auctionInfo.push(...dateMatch.slice(0, 3));

        const depositMatch = allText.match(/(?:задаток|гарантийный взнос)[\s:]*(\d[\d\s,.]*)(?:\s*руб|\s*₽)/i);
        if (depositMatch) auctionInfo.push(depositMatch[0]);

        const stepMatch = allText.match(/(?:шаг|шаг торгов)[\s:]*(\d[\d\s,.]*)(?:\s*руб|\s*₽)/i);
        if (stepMatch) auctionInfo.push(stepMatch[0]);

        return {
          description: description || undefined,
          contacts: contacts || undefined,
          latitude: latitude && !isNaN(latitude) ? latitude : undefined,
          longitude: longitude && !isNaN(longitude) ? longitude : undefined,
          auctionDetails: auctionInfo.length > 0 ? auctionInfo.join(' | ') : undefined,
        };
      });

      return {
        description: details.description,
        contacts: details.contacts,
        latitude: details.latitude,
        longitude: details.longitude,
      };
    } catch (err: any) {
      logger.warn(`[alfalot] fetchDetails error for ${url}: ${err.message}`);
      return {};
    } finally {
      await browser.close();
    }
  }
}
