/**
 * Alfot — парсер коммерческой недвижимости.
 *
 * SPA на ecosystem.alfalot.ru, Playwright.
 * Search: /showcase/list?categories=1 (Недвижимость)
 * 12 карточек на страницу, ~217 страниц.
 * Площадь из badges: title="Площадь: 112.00"
 */
import type { SourceParser, ParsedProperty } from '@aklab/service-shared';
import { logger, randomDelay, createStealthContext, retryGoto, detectCity } from '@aklab/service-shared';

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

      // Ждём загрузки табов
      try {
        await page.waitForSelector('.tab-content[data-page="lot-info"], .lot-title', { timeout: 10000 });
      } catch {
        await page.waitForTimeout(3000);
      }

      const details = await page.evaluate(() => {
        // Описание: <p> после <h3>Описание</h3> в табе lot-info
        const descH3 = document.querySelector('.tab-content[data-page="lot-info"] h3');
        let description = '';
        if (descH3) {
          const nextP = descH3.nextElementSibling;
          if (nextP && nextP.tagName === 'P' && nextP.textContent && nextP.textContent.trim().length > 20) {
            description = nextP.textContent.trim().slice(0, 2000);
          }
        }

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

        // Адрес: элемент .address или из описания
        const addressEl = document.querySelector('.address');
        let address = addressEl?.textContent?.trim() || '';
        if (!address || address.length < 5) {
          // Парсим из описания
          const addrMatch = description.match(/(?:адрес|расположенн?\s+по)[:\s]+([^.;]+)/i);
          if (addrMatch) address = addrMatch[1].trim();
        }

        // Аукцион: .start_price, .current_price, .bid_end_date, .auction_start_date
        const startPrice = document.querySelector('.start_price')?.textContent?.trim();
        const currentPrice = document.querySelector('.current_price')?.textContent?.trim();
        const bidEndDate = document.querySelector('.bid_end_date')?.textContent?.trim();
        const auctionStart = document.querySelector('.auction_start_date')?.textContent?.trim();

        const auctionParts: string[] = [];
        if (startPrice) auctionParts.push('Начальная цена: ' + startPrice);
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
          description: description || undefined,
          contacts,
          address: address && address.length > 3 ? address : undefined,
          latitude: undefined, // координаты не доступны на alfalot
          longitude: undefined,
          auctionDetails: auctionParts.length > 0 ? auctionParts.join(' | ') : undefined,
        };
      });

      return {
        description: details.description,
        contacts: details.contacts,
        address: details.address,
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
