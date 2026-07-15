/**
 * Fabrikant.ru — парсер продаж (банкротство, приватизация).
 *
 * Next.js SSR, нет публичного JSON API. Парсим HTML через Playwright.
 * URL: https://www.fabrikant.ru/procedure/search/sales
 *
 * Структура карточки (data-slot-based):
 *   [data-slot="card"][data-id="{lotId}"]
 *     [data-slot="anchor"]  — заголовок лота (содержит адрес)
 *     [data-slot="badge"]   — статус, источник
 *     [data-slot="text"]    — организатор, даты, цена ("648 000,00 RUB")
 *
 * Пагинация: rc-pagination компонент, клики по кнопкам страниц.
 * URL параметры ?page=N НЕ работают — сайт игнорирует их.
 */

import { classifyPropertyType } from '@aklab/service-shared';
import type { SourceParser, ParsedProperty } from '@aklab/service-shared';
import { logger, randomDelay, createStealthContext, retryGoto, detectCity } from '@aklab/service-shared';

const BASE_URL = 'https://www.fabrikant.ru';
const SEARCH_URL = `${BASE_URL}/procedure/search/sales`;
const MAX_PAGES = 100; // 10 карточек на страницу, 100 стр = 1000 items
const ITEMS_PER_PAGE = 10;

// Ключевые слова коммерческой недвижимости — фильтруем нерелевантные лоты
// Проверяем TITLE, не fullText — иначе промтовары (гвозди, арматура) матчатся
// через описание вида «нежилое помещение» в теле карточки
const PROPERTY_KEYWORDS = [
 'нежилое', 'нежилого', 'нежилых', 'помещение', 'помещения',
 'офис', 'склад', 'здание', 'здания', 'сооружение',
 'коммерческ', 'торгов', 'магазин', 'административн',
 'доля нежилого',
];

// Исключаем жильё, транспорт, оборудование и прочее не-коммерческое
const EXCLUDE_KEYWORDS = [
  'жилой', 'жилого', 'жилые', 'жилых', 'жилую', 'жилая', // жилые дома и помещения
  'лпх', 'ижс', 'личное подсобное хозяйство', // сельхозземли
  'дачный', 'дачного', 'дачные', 'дачных', // дачные участки
  'земельный участок', 'земельного участка', 'земельные участки', // земля без недвижимости
  'гараж', 'паркинг', // слишком широко совпадают
  'транспортн', 'автомобил', 'легков', 'грузов', // транспорт
  'автобус', 'прицеп', 'мотоцикл',
  'volkswagen', 'toyota', 'ford', 'bmw', 'mercedes',
  'оборудовани', 'станок', 'прибор', 'инвентар',
];

/** Извлекает карточки с текущей страницы (без навигации) */
async function extractCards(page: any): Promise<Array<{
  lot_id: string; title: string; price_text: string;
  proc_number: string; link_href: string; date_text: string;
}>> {
  return page.evaluate((args: { kw: string[]; exclude: string[] }) => {
    const results: Array<{
      lot_id: string; title: string; price_text: string;
      proc_number: string; link_href: string; date_text: string;
    }> = [];

    const cards = document.querySelectorAll('[data-slot="card"][data-id]');

    for (const card of Array.from(cards)) {
      const el = card as HTMLElement;
      const lotId = el.getAttribute('data-id');
      if (!lotId) continue;

      const anchor = el.querySelector('[data-slot="anchor"]');
      const title = anchor?.textContent?.trim() || '';
      if (!title) continue;

      const titleLower = title.toLowerCase();
      const isProperty = args.kw.some(k => titleLower.includes(k));
      if (!isProperty) continue;

      const isExcluded = args.exclude.some(k => titleLower.includes(k));
      if (isExcluded) continue;

      const textSlots = el.querySelectorAll('[data-slot="text"]');
      let priceText = '';
      let procNumber = '';
      let dateText = '';

      for (const slot of Array.from(textSlots)) {
        const t = slot.textContent?.trim() || '';
        if (t.includes('RUB') && !priceText) {
          priceText = t;
        }
        if (/^\d+-\d+$/.test(t) && !procNumber) {
          procNumber = t;
        }
        const dateMatch = t.match(/(\d{2})\.(\d{2})\.(\d{4})/);
        if (dateMatch && !dateText) {
          dateText = t;
        }
      }

      const link = anchor as HTMLAnchorElement;
      const href = link?.href || '';

      results.push({ lot_id: lotId, title, price_text: priceText, proc_number: procNumber, link_href: href, date_text: dateText });
    }

    return results;
  }, { kw: PROPERTY_KEYWORDS, exclude: EXCLUDE_KEYWORDS });
}

export class FabrikantParser implements SourceParser {
  name = 'fabrikant';

  async parse(depth?: number): Promise<ParsedProperty[]> {
    const { chromium } = await import('playwright');

    const maxPages = depth ? Math.ceil(depth / ITEMS_PER_PAGE) : MAX_PAGES;
    logger.info('[fabrikant] Starting Playwright browser...');
    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
      const context = await createStealthContext(browser);
      const page = await context.newPage();
      const allProperties: ParsedProperty[] = [];
      const seenIds = new Set<string>();

      // Загружаем первую страницу
      logger.info(`[fabrikant] Loading: ${SEARCH_URL}`);
      await retryGoto(page, SEARCH_URL, 3);
      try {
        await page.waitForSelector('[data-slot="card"][data-id]', { timeout: 15000 });
      } catch {
        await page.waitForTimeout(5000);
      }

      for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
        // Извлекаем карточки с текущей страницы
        const pageCards = await extractCards(page);
        let newOnPage = 0;

        for (const p of pageCards) {
          if (seenIds.has(p.lot_id)) continue;
          seenIds.add(p.lot_id);
          newOnPage++;

          let price: number | undefined;
          if (p.price_text) {
            const cleaned = p.price_text.replace(/[^\d,]/g, '').replace(',', '.');
            const num = parseFloat(cleaned);
            if (!isNaN(num) && num > 0) price = num;
          }

          const address = extractAddress(p.title);
          const area = extractArea(p.title);
          const pricePerSqm = price && area ? Math.round(price / area) : undefined;

          let publishedAt: string | undefined;
          if (p.date_text) {
            const dm = p.date_text.match(/(\d{2})\.(\d{2})\.(\d{4})/);
            if (dm) publishedAt = `${dm[3]}-${dm[2]}-${dm[1]}T00:00:00Z`;
          }

          allProperties.push({
            external_id: `fabrikant-${p.lot_id}`,
            url: p.link_href || `${BASE_URL}/procedure/search/sales`,
            title: p.title,
            address,
            city: detectCity(address || p.title),
            area_sqm: area,
            price,
            price_per_sqm: pricePerSqm,
            property_type: classifyPropertyType(p.title),
            auction_type: 'bankruptcy',
            description: p.title.length > 20 ? p.title : undefined,
            published_at: publishedAt,
          });
        }

        logger.info(`[fabrikant] Page ${pageNum}: ${pageCards.length} cards, ${newOnPage} new property (total: ${allProperties.length})`);

        // Пагинация кликом: ищем кнопку следующей страницы
        const nextpageNum = pageNum + 1;
        // Ждём появления пагинации (rc-pagination)
        try {
          await page.waitForSelector('.rc-pagination', { timeout: 5000 });
        } catch {
          logger.info(`[fabrikant] No pagination found — stopping`);
          break;
        }
        const nextBtn = await page.$(`.rc-pagination-item-${nextpageNum} a`);
        if (!nextBtn) {
          logger.info(`[fabrikant] No page ${nextpageNum} button — stopping`);
          break;
        }

        // Запоминаем ID текущих карточек, чтобы дождаться смены
        const oldFirstId = await page.evaluate(() =>
          document.querySelector('[data-slot="card"][data-id]')?.getAttribute('data-id') || ''
        );

        await nextBtn.click();
        await randomDelay(2000, 4000);

        // Ждём пока карточки изменятся (макс 15 сек)
        try {
          await page.waitForFunction((prevId: string) => {
            const current = document.querySelector('[data-slot="card"][data-id]')?.getAttribute('data-id') || '';
            return current.length > 0 && current !== prevId;
          }, oldFirstId, { timeout: 15000 });
        } catch {
          // Если карточки не изменились —可能是 последняя страница
          logger.info(`[fabrikant] Cards didn't change after click — stopping`);
          break;
        }
      }

      logger.info(`[fabrikant] Total: ${allProperties.length} properties from ${seenIds.size} unique cards`);
      return allProperties;

    } catch (err: any) {
      logger.error(`[fabrikant] Parse error: ${err.message}`);
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

      // Ждём загрузки контента
      try {
        await page.waitForSelector('[data-slot], .lot-info, .procedure-info, h1, h2', { timeout: 15000 });
      } catch {
        await page.waitForTimeout(3000);
      }

      const details = await page.evaluate(() => {
        let description = '';
        const allText = document.body.innerText || '';

        const lotMatch = allText.match(/Лот\s*№?\d*\.\s*(.+?)(?:\n\s*(?:Ожидается|Начальн|Статус|Предмет))/s);
        if (lotMatch && lotMatch[1].length > 20) {
          description = lotMatch[1].trim().slice(0, 2000);
        }

        const contactParts: string[] = [];
        const orgMatch = allText.match(/Информация\s+об\s+организаторе\s*\n\s*(.+?)(?:\n\s*\n|\n\s*Дата)/s);
        if (orgMatch) {
          const orgName = orgMatch[1].trim().split('\n')[0].trim();
          if (orgName && orgName.length > 2 && orgName.length < 200) {
            contactParts.push('Организатор: ' + orgName);
          }
        }

        const phoneMatch = allText.match(/(?:тел(?:ефон)?|phone)[:\s.]+([+\d\s()-]{7,20})/i);
        if (phoneMatch) contactParts.push('Тел: ' + phoneMatch[1].trim());

        const emailMatch = allText.match(/(?:email|e-mail|почт[аы])[:\s]+([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
        if (emailMatch) contactParts.push('Email: ' + emailMatch[1].trim());

        const contacts = contactParts.length > 0 ? contactParts.join(', ') : undefined;

        let address = '';
        const addrPatterns = [
          /(?:адрес(?:\s+местонахождения|\s+расположения)?|по\s+адресу|местонахождение(?:\s+имущества)?)[:\s]+([^\n]+?)(?:\n|$)/i,
          /(?:адрес|расположен(?:н|ие)?)[:\s]+(.+?)(?:,\s*(?:общ|пл|к\/н|собств|$))/i,
        ];
        for (const re of addrPatterns) {
          const m = allText.match(re);
          if (m && m[1] && m[1].trim().length > 5) {
            address = m[1].trim().slice(0, 300);
            break;
          }
        }
        if (!address) {
          const moscowMatch = allText.match(/((?:г\.?\s*)?Москва[^,\n]{0,30}(?:,\s*[^,\n]+){0,3})/i);
          if (moscowMatch) address = moscowMatch[1].trim().slice(0, 300);
        }

        let minimum_price: number | undefined;
        const priceMatch = allText.match(/Начальн(?:ая\s+цена|ая\s+стоимость)[:\s]+([\d\s,.]+)\s*(?:руб|RUB|₽)?/i);
        if (priceMatch) {
          const cleaned = priceMatch[1].replace(/\s/g, '').replace(',', '.');
          const num = parseFloat(cleaned);
          if (!isNaN(num) && num > 0) minimum_price = num;
        }

        const photoUrls: string[] = [];
        const contentImgs = document.querySelectorAll('img[src*="upload"], img[src*="lot"], img[src*="photo"], img[src*="image"]');
        for (const img of Array.from(contentImgs).slice(0, 10)) {
          const src = (img as HTMLImageElement).src;
          if (src && src.startsWith('http') && !src.includes('logo') && !src.includes('icon')) {
            photoUrls.push(src);
          }
        }

        return {
          description: description || undefined,
          contacts,
          address: address.length > 3 ? address : undefined,
          photo_urls: photoUrls.length > 0 ? photoUrls : undefined,
          minimum_price,
        };
      });

      return {
        description: details.description,
        contacts: details.contacts,
        address: details.address,
        photo_urls: details.photo_urls,
        minimum_price: details.minimum_price,
      };
    } catch (err: any) {
      logger.warn(`[fabrikant] fetchDetails error for ${url}: ${err.message}`);
      return {};
    } finally {
      if (page) try { await page.close(); } catch {}
      if (ownBrowser) try { await ownBrowser.close(); } catch {}
    }
  }
}

function extractAddress(title: string): string {
  let match = title.match(/(?:по\s+адресу|адрес)[:\s]+(.+?)(?:,\s*(?:общ\.|пл\.|к\/н|собств\.|цена|$))/i);
  if (match) return match[1].trim();

  match = title.match(/(?:в|г\.)\s+((?:г\.?\s*)?(?:Москва|Московская\s+обл\.?)[^,]*(?:,\s*[^,]+){0,3})/i);
  if (match) return match[1].trim();

  return title;
}

function extractArea(title: string): number | undefined {
  let match = title.match(/(\d[\d\s]*[,.]?\d*)\s*кв\.?\s*м/i);
  if (match) {
    const cleaned = match[1].replace(/\s/g, '').replace(',', '.');
    const num = parseFloat(cleaned);
    if (!isNaN(num) && num > 0) return num;
  }

  match = title.match(/площад[ьь]ю\s+(\d[\d\s]*[,.]?\d*)/i);
  if (match) {
    const cleaned = match[1].replace(/\s/g, '').replace(',', '.');
    const num = parseFloat(cleaned);
    if (!isNaN(num) && num > 0) return num;
  }

  match = title.match(/пл\.\s*(\d[\d\s]*[,.]?\d*)/);
  if (match) {
    const cleaned = match[1].replace(/\s/g, '').replace(',', '.');
    const num = parseFloat(cleaned);
    if (!isNaN(num) && num > 0) return num;
  }

  return undefined;
}
