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
 * Пагинация: ?page=N (10 карточек на страницу)
 */

import type { SourceParser, ParsedProperty } from '@aklab/service-shared';
import { logger, randomDelay, createStealthContext, retryGoto, detectCity } from '@aklab/service-shared';

const BASE_URL = 'https://www.fabrikant.ru';
const SEARCH_URL = `${BASE_URL}/procedure/search/sales`;
const MAX_PAGES = 10; // 10 карточек на страницу, 10 стр = 100 items
const ITEMS_PER_PAGE = 10;

// Ключевые слова коммерческой недвижимости — фильтруем нерелевантные лоты
const PROPERTY_KEYWORDS = [
  'нежилое', 'нежилого', 'нежилых', 'помещение', 'помещения', 'офис', 'склад', 'здание', 'здания',
  'сооружение', 'коммерческ',
  'торгов', 'административн', 'производствен', 'промышленн',
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

function classifyPropertyType(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes('офис') || lower.includes('административн')) return 'office';
  if (lower.includes('склад') || lower.includes('хранилищ')) return 'warehouse';
  if (lower.includes('магазин') || lower.includes('торгов') || lower.includes('павильон')) return 'retail';
  if (lower.includes('производствен') || lower.includes('промышленн') || lower.includes('цех')) return 'production';
  if (lower.includes('нежилое') || lower.includes('помещение') || lower.includes('коммерческ') ||
      lower.includes('гараж') || lower.includes('бокс') || lower.includes('паркинг')) return 'free_purpose';
  if (lower.includes('квартир')) return 'apartment';
  return 'other';
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

      for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
        const url = pageNum === 1 ? SEARCH_URL : `${SEARCH_URL}?page=${pageNum}`;
        logger.info(`[fabrikant] Loading page ${pageNum}: ${url}`);

        // Пауза между страницами (имитация человека, 3-6 сек)
        if (pageNum > 1) {
          await randomDelay(3000, 6000);
        }

        await retryGoto(page, url, 3);
        await page.waitForTimeout(3000);

        const pageProperties = await page.evaluate((args: { kw: string[]; exclude: string[]; cutoff: number }) => {
          const results: Array<{
            lot_id: string;
            title: string;
            price_text: string;
            proc_number: string;
            link_href: string;
            date_text: string;
          }> = [];

          const cards = document.querySelectorAll('[data-slot="card"][data-id]');

          for (const card of Array.from(cards)) {
            const el = card as HTMLElement;
            const lotId = el.getAttribute('data-id');
            if (!lotId) continue;

            const anchor = el.querySelector('[data-slot="anchor"]');
            const title = anchor?.textContent?.trim() || '';
            if (!title) continue;

            const fullText = el.textContent?.toLowerCase() || '';
            const isProperty = args.kw.some(k => fullText.includes(k));
            if (!isProperty) continue;

            const isExcluded = args.exclude.some(k => fullText.includes(k));
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
              // Ищем дату в формате DD.MM.YYYY или "X дней/часов назад"
              const dateMatch = t.match(/(\d{2})\.(\d{2})\.(\d{4})/);
              if (dateMatch && !dateText) {
                dateText = t;
              }
            }

            const link = anchor as HTMLAnchorElement;
            const href = link?.href || '';

            results.push({
              lot_id: lotId,
              title,
              price_text: priceText,
              proc_number: procNumber,
              link_href: href,
              date_text: dateText,
            });
          }

          return results;
        }, { kw: PROPERTY_KEYWORDS, exclude: EXCLUDE_KEYWORDS, cutoff: Date.now() - 24 * 3600 * 1000 });

        logger.info(`[fabrikant] Page ${pageNum}: found ${pageProperties.length} property cards`);

        for (const p of pageProperties) {
          let price: number | undefined;
          if (p.price_text) {
            const cleaned = p.price_text.replace(/[^\d,]/g, '').replace(',', '.');
            const num = parseFloat(cleaned);
            if (!isNaN(num) && num > 0) price = num;
          }

          const address = extractAddress(p.title);
          const area = extractArea(p.title);
          const pricePerSqm = price && area ? Math.round(price / area) : undefined;

          // published_at из date_text (DD.MM.YYYY → ISO)
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

        if (pageProperties.length === 0) break;
      }

      logger.info(`[fabrikant] Total: ${allProperties.length} properties`);
      return allProperties;

    } catch (err: any) {
      logger.error(`[fabrikant] Parse error: ${err.message}`);
      throw err;
    } finally {
      await browser.close();
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
