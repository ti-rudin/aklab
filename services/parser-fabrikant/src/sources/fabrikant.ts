/**
 * Fabrikant.ru — парсер продаж (банкротство, приватизация).
 *
 * Next.js SSR, нет публичного JSON API. Парсим HTML через Playwright.
 * URL: https://www.fabrikant.ru/procedure/search/sales
 *
 * Структура карточки (data-slot-based):
 *   [data-slot="card"][data-id="{lotId}"]
 *     [data-slot="anchor"]  — заголовок лота
 *     [data-slot="badge"]   — статус, источник
 *     [data-slot="text"]    — организатор, даты, цена
 *
 * Пагинация: "Показать ещё 10" кнопка (rc-pagination НЕ рендерит
 * кнопки страниц в headless — только активная). Кликаем "Показать ещё"
 * пока не наберём depth карточек или кнопка не исчезнет.
 */

import { classifyPropertyType } from '@aklab/service-shared';
import type { SourceParser, ParsedProperty } from '@aklab/service-shared';
import { logger, randomDelay, createStealthContext, retryGoto, detectCity } from '@aklab/service-shared';

const BASE_URL = 'https://www.fabrikant.ru';
const SEARCH_URL = `${BASE_URL}/procedure/search/sales`;
const MAX_CLICKS = 100; // 100 кликов × 10 = 1000 карточек

// Ключевые слова коммерческой недвижимости — фильтруем нерелевантные лоты
const PROPERTY_KEYWORDS = [
 'нежилое', 'нежилого', 'нежилых', 'помещение', 'помещения',
 'офис', 'склад', 'здание', 'здания', 'сооружение',
 'коммерческ', 'торгов', 'магазин', 'административн',
 'доля нежилого',
];

// Исключаем жильё, транспорт, оборудование
const EXCLUDE_KEYWORDS = [
  'жилой', 'жилого', 'жилые', 'жилых', 'жилую', 'жилая',
  'лпх', 'ижс', 'личное подсобное хозяйство',
  'дачный', 'дачного', 'дачные', 'дачных',
  'земельный участок', 'земельного участка', 'земельные участки',
  'гараж', 'паркинг',
  'транспортн', 'автомобил', 'легков', 'грузов',
  'автобус', 'прицеп', 'мотоцикл',
  'volkswagen', 'toyota', 'ford', 'bmw', 'mercedes',
  'оборудовани', 'станок', 'прибор', 'инвентар',
];

export class FabrikantParser implements SourceParser {
  name = 'fabrikant';

  async parse(depth?: number): Promise<ParsedProperty[]> {
    const { chromium } = await import('playwright');

    const maxClicks = depth ? Math.ceil(depth / 10) : MAX_CLICKS;
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

      // Кликаем "Показать ещё" для загрузки карточек
      for (let click = 0; click < maxClicks; click++) {
        // Извлекаем ВСЕ карточки, фильтруем по keywords
        const cards = await page.evaluate((args: { kw: string[]; exclude: string[] }) => {
          const results: Array<{
            lot_id: string; title: string; price_text: string;
            proc_number: string; link_href: string; date_text: string;
          }> = [];

          const allCards = document.querySelectorAll('[data-slot="card"][data-id]');
          for (const card of Array.from(allCards)) {
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
              if (t.includes('RUB') && !priceText) priceText = t;
              if (/^\d+-\d+$/.test(t) && !procNumber) procNumber = t;
              const dateMatch = t.match(/(\d{2})\.(\d{2})\.(\d{4})/);
              if (dateMatch && !dateText) dateText = t;
            }

            const link = anchor as HTMLAnchorElement;
            results.push({ lot_id: lotId, title, price_text: priceText, proc_number: procNumber, link_href: link?.href || '', date_text: dateText });
          }
          return results;
        }, { kw: PROPERTY_KEYWORDS, exclude: EXCLUDE_KEYWORDS });

        // Добавляем только новые
        let newCount = 0;
        for (const p of cards) {
          if (seenIds.has(p.lot_id)) continue;
          seenIds.add(p.lot_id);
          newCount++;

          let price: number | undefined;
          if (p.price_text) {
            const cleaned = p.price_text.replace(/[^\d,]/g, '').replace(',', '.');
            const num = parseFloat(cleaned);
            if (!isNaN(num) && num > 0) price = num;
          }

          const address = extractAddress(p.title);
          const area = extractArea(p.title);
          let publishedAt: string | undefined;
          if (p.date_text) {
            const dm = p.date_text.match(/(\d{2})\.(\d{2})\.(\d{4})/);
            if (dm) publishedAt = `${dm[3]}-${dm[2]}-${dm[1]}T00:00:00Z`;
          }

          allProperties.push({
            external_id: `fabrikant-${p.lot_id}`,
            url: p.link_href || SEARCH_URL,
            title: p.title,
            address,
            city: detectCity(address || p.title),
            area_sqm: area,
            price,
            price_per_sqm: price && area ? Math.round(price / area) : undefined,
            property_type: classifyPropertyType(p.title),
            auction_type: 'bankruptcy',
            description: p.title.length > 20 ? p.title : undefined,
            published_at: publishedAt,
          });
        }

        const totalCards = await page.evaluate(() => document.querySelectorAll('[data-slot="card"][data-id]').length);
        logger.info(`[fabrikant] Click ${click}: ${totalCards} total cards, ${newCount} new property (all: ${allProperties.length})`);

        // Кликаем "Показать ещё"
        try {
          await page.waitForSelector('button:has-text("Показать ещё")', { state: 'visible', timeout: 10000 });
        } catch {
          logger.info('[fabrikant] No "Показать ещё" button — stopping');
          break;
        }

        const prevCount = totalCards;
        await page.click('button:has-text("Показать ещё")');
        await randomDelay(3000, 5000);

        // Ждём пока количество карточек увеличится
        try {
          await page.waitForFunction((prev: number) => {
            return document.querySelectorAll('[data-slot="card"][data-id]').length > prev;
          }, prevCount, { timeout: 15000 });
        } catch {
          logger.info('[fabrikant] Cards didn\'t increase — stopping');
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
          if (orgName && orgName.length > 2 && orgName.length < 200) contactParts.push('Организатор: ' + orgName);
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
          if (m && m[1] && m[1].trim().length > 5) { address = m[1].trim().slice(0, 300); break; }
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
          if (src && src.startsWith('http') && !src.includes('logo') && !src.includes('icon')) photoUrls.push(src);
        }

        return { description: description || undefined, contacts, address: address.length > 3 ? address : undefined, photo_urls: photoUrls.length > 0 ? photoUrls : undefined, minimum_price };
      });

      return { description: details.description, contacts: details.contacts, address: details.address, photo_urls: details.photo_urls, minimum_price: details.minimum_price };
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
  if (match) { const n = parseFloat(match[1].replace(/\s/g, '').replace(',', '.')); if (!isNaN(n) && n > 0) return n; }
  match = title.match(/площад[ьь]ю\s+(\d[\d\s]*[,.]?\d*)/i);
  if (match) { const n = parseFloat(match[1].replace(/\s/g, '').replace(',', '.')); if (!isNaN(n) && n > 0) return n; }
  match = title.match(/пл\.\s*(\d[\d\s]*[,.]?\d*)/);
  if (match) { const n = parseFloat(match[1].replace(/\s/g, '').replace(',', '.')); if (!isNaN(n) && n > 0) return n; }
  return undefined;
}
