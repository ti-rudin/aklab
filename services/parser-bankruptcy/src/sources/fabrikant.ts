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

import type { SourceParser, ParsedProperty } from './types';
import { logger } from '../utils/logger';

const BASE_URL = 'https://www.fabrikant.ru';
const SEARCH_URL = `${BASE_URL}/procedure/search/sales`;
const MAX_PAGES = 5; // 50 карточек за запуск

// Ключевые слова недвижимости — фильтруем нерелевантные лоты
const PROPERTY_KEYWORDS = [
  'нежилое', 'помещение', 'офис', 'склад', 'магазин', 'здание',
  'сооружение', 'гараж', 'паркинг', 'земельный участок', 'коммерческ',
  'торгов', 'административн', 'производствен', 'промышленн',
  'кв.м', 'м²', 'кв.м.', 'метров', 'нежилого', 'нежилых',
  'доля нежилого', 'доля земельного',
];

// Исключаем жильё, транспорт, оборудование и прочее не-коммерческое
const EXCLUDE_KEYWORDS = [
  'жилое', 'жилого', 'жилых', 'квартир', 'квартира', 'жилой',
  'транспортн', 'автомобил', 'vehiclewagen', 'легков', 'грузов',
  'автобус', 'прицеп', 'мотоцикл',
  'оборудовани', 'станок', 'машин', 'прибор', 'инвентар',
];

function classifyPropertyType(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes('офис') || lower.includes('административн')) return 'office';
  if (lower.includes('склад') || lower.includes('хранилищ')) return 'warehouse';
  if (lower.includes('магазин') || lower.includes('торгов') || lower.includes('павильон')) return 'retail';
  if (lower.includes('производствен') || lower.includes('промышленн') || lower.includes('цех')) return 'production';
  if (lower.includes('нежилое') || lower.includes('помещение') || lower.includes('коммерческ') ||
      lower.includes('гараж') || lower.includes('бокс') || lower.includes('паркинг')) return 'free_purpose';
  return 'other';
}

function detectCity(address: string): string {
  const lower = address.toLowerCase();
  if (lower.includes('москва') && !lower.includes('московская')) return 'moscow';
  if (lower.includes('московская область') || lower.includes('московская обл') ||
      lower.includes('подольск') || lower.includes('химки') || lower.includes('мытищи') ||
      lower.includes('балашиха') || lower.includes('одинцово') || lower.includes('пушкино') ||
      lower.includes('пушкин') || lower.includes('серпухов') || lower.includes('котельники') ||
      lower.includes('луховицк') || lower.includes('домодедов') || lower.includes('люберц')) return 'mo';
  return 'other';
}

export class FabrikantParser implements SourceParser {
  name = 'fabrikant';

  async parse(): Promise<ParsedProperty[]> {
    const { chromium } = await import('playwright');

    logger.info('[fabrikant] Starting Playwright browser...');
    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        locale: 'ru-RU',
      });
      const page = await context.newPage();
      const allProperties: ParsedProperty[] = [];

      for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
        const url = pageNum === 1 ? SEARCH_URL : `${SEARCH_URL}?page=${pageNum}`;
        logger.info(`[fabrikant] Loading page ${pageNum}: ${url}`);

        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(3000);

        // Извлекаем данные из SSR HTML через data-slot селекторы
        const pageProperties = await page.evaluate((args: { kw: string[]; exclude: string[] }) => {
          const results: Array<{
            lot_id: string;
            title: string;
            price_text: string;
            proc_number: string;
            link_href: string;
          }> = [];

          const cards = document.querySelectorAll('[data-slot="card"][data-id]');

          for (const card of Array.from(cards)) {
            const el = card as HTMLElement;
            const lotId = el.getAttribute('data-id');
            if (!lotId) continue;

            // Title — первый [data-slot="anchor"]
            const anchor = el.querySelector('[data-slot="anchor"]');
            const title = anchor?.textContent?.trim() || '';
            if (!title) continue;

            // Фильтр по ключевым словам недвижимости
            const fullText = el.textContent?.toLowerCase() || '';
            const isProperty = args.kw.some(k => fullText.includes(k));
            if (!isProperty) continue;

            // Исключаем жильё, транспорт, оборудование
            const isExcluded = args.exclude.some(k => fullText.includes(k));
            if (isExcluded) continue;

            // Цена — ищем текст с "RUB"
            const textSlots = el.querySelectorAll('[data-slot="text"]');
            let priceText = '';
            for (const slot of Array.from(textSlots)) {
              const t = slot.textContent?.trim() || '';
              if (t.includes('RUB')) {
                priceText = t;
                break;
              }
            }

            // Номер процедуры
            let procNumber = '';
            for (const slot of Array.from(textSlots)) {
              const t = slot.textContent?.trim() || '';
              if (/^\d+-\d+$/.test(t)) {
                procNumber = t;
                break;
              }
            }

            // Ссылка
            const link = anchor as HTMLAnchorElement;
            const href = link?.href || '';

            results.push({
              lot_id: lotId,
              title,
              price_text: priceText,
              proc_number: procNumber,
              link_href: href,
            });
          }

          return results;
        }, { kw: PROPERTY_KEYWORDS, exclude: EXCLUDE_KEYWORDS });

        logger.info(`[fabrikant] Page ${pageNum}: found ${pageProperties.length} property cards`);

        // Преобразуем в ParsedProperty
        for (const p of pageProperties) {
          // Парсим цену: "648 000,00 RUB" → 648000
          let price: number | undefined;
          if (p.price_text) {
            const cleaned = p.price_text.replace(/[^\d,]/g, '').replace(',', '.');
            const num = parseFloat(cleaned);
            if (!isNaN(num) && num > 0) price = num;
          }

          // Извлекаем адрес из title
          const address = extractAddress(p.title);

          // Извлекаем площадь из title: "36,2 кв.м" или "пл. 769"
          const area = extractArea(p.title);

          // Price per sqm
          const pricePerSqm = price && area ? Math.round(price / area) : undefined;

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
          });
        }

        // Если на странице меньше 10 карточек — дальше пусто
        if (pageProperties.length < 10) break;
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

/**
 * Извлекает адрес из заголовка лота.
 * Паттерны:
 *   "по адресу: Московская обл., г. Подольск, ..."
 *   "адрес: г. Москва, ул. ..."
 *   "расположенный по адресу: ..."
 */
function extractAddress(title: string): string {
  // Паттерн 1: "по адресу: ..."
  let match = title.match(/(?:по\s+адресу|адрес)[:\s]+(.+?)(?:,\s*(?:общ\.|пл\.|к\/н|собств\.|цена|$))/i);
  if (match) return match[1].trim();

  // Паттерн 2: "в <город>, <улица>" (для заголовков типа "Нежилое помещение в г. Москва, ...")
  match = title.match(/(?:в|г\.)\s+((?:г\.?\s*)?(?:Москва|Московская\s+обл\.?)[^,]*(?:,\s*[^,]+){0,3})/i);
  if (match) return match[1].trim();

  // Паттерн 3: весь title как fallback
  return title;
}

/**
 * Извлекает площадь из заголовка.
 * Паттерны:
 *   "36,2 кв.м" / "36,2 кв.м."
 *   "пл. 769" / "площадью 36,2 кв.м"
 *   "общ. пл. 19,3 кв.м"
 */
function extractArea(title: string): number | undefined {
  // Паттерн: число + кв.м
  let match = title.match(/(\d[\d\s]*[,.]?\d*)\s*кв\.?\s*м/i);
  if (match) {
    const cleaned = match[1].replace(/\s/g, '').replace(',', '.');
    const num = parseFloat(cleaned);
    if (!isNaN(num) && num > 0) return num;
  }

  // Паттерн: "площадью N"
  match = title.match(/площад[ьь]ю\s+(\d[\d\s]*[,.]?\d*)/i);
  if (match) {
    const cleaned = match[1].replace(/\s/g, '').replace(',', '.');
    const num = parseFloat(cleaned);
    if (!isNaN(num) && num > 0) return num;
  }

  // Паттерн: "пл. N"
  match = title.match(/пл\.\s*(\d[\d\s]*[,.]?\d*)/);
  if (match) {
    const cleaned = match[1].replace(/\s/g, '').replace(',', '.');
    const num = parseFloat(cleaned);
    if (!isNaN(num) && num > 0) return num;
  }

  return undefined;
}
