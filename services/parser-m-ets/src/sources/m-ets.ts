/**
 * М-ЕТС (m-ets.ru) — парсер коммерческой недвижимости.
 *
 * Использует внутренний JSON API: /ajax/api/search?category=...&page=N
 * Возвращает HTML-карточки лотов, парсим через DOMParser в контексте браузера.
 *
 * Playwright, stealth context, anti-ban.
 */
import type { SourceParser, ParsedProperty } from '@aklab/service-shared';
import { logger, randomDelay, createStealthContext, retryGoto } from '@aklab/service-shared';

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

// ─── Классификация типа недвижимости ────────────────────────────────────────

function classifyPropertyType(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes('квартир')) return 'apartment';
  if (lower.includes('офис') || lower.includes('административн')) return 'office';
  if (lower.includes('склад') || lower.includes('хранилищ')) return 'warehouse';
  if (lower.includes('магазин') || lower.includes('торгов')) return 'retail';
  if (lower.includes('производствен') || lower.includes('промышлен')) return 'production';
  if (lower.includes('нежилое') || lower.includes('помещение') || lower.includes('коммерческ') ||
      lower.includes('гараж') || lower.includes('здани')) return 'free_purpose';
  return 'other';
}

// ─── Парсинг цены ──────────────────────────────────────────────────────────

function parsePrice(text: string): number | undefined {
  if (!text) return undefined;
  // Убираем всё кроме цифр, пробелов и запятых
  const cleaned = text.replace(/[^\d,]/g, '').replace(',', '.');
  const num = parseFloat(cleaned);
  return !isNaN(num) && num > 0 ? num : undefined;
}

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

function detectCity(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes('москва') && !lower.includes('московская')) return 'moscow';
  if (lower.includes('московская') || lower.includes('подольск') || lower.includes('химки')) return 'mo';
  return 'other';
}

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

              // Номер торгов
              const regNumEl = card.querySelector('.comp-regnumber');
              const regNumber = regNumEl?.textContent?.trim() || '';

              // Регион (из карточки)
              const regionEl = card.querySelector('.search-item-location span');
              const region = regionEl?.textContent?.trim() || '';

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
                regNumber,
                region,
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

            const { href, title, region, costText, description, regNumber } = card as any;
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

            // Адрес из описания
            const addressMatch = description.match(
              /(?:адрес(?:у)?:?\s*|расположенн[аыя]?\s+по\s+адресу:\s*|местонахождение:?\s*)([^\n]+)/i,
            );
            const address = addressMatch ? addressMatch[1].trim() : region;

            // Город
            const city = detectCity(title + ' ' + region + ' ' + description);

            // external_id: используем lot_id если есть, иначе из href
            const externalId = (card as any).lot_id
              ? `m-ets-${(card as any).lot_id}`
              : `m-ets-${href.split('/').pop() || title.slice(0, 30)}`;

            allProperties.push({
              external_id: externalId,
              url: fullLink,
              title: title.slice(0, 300),
              address,
              city,
              area_sqm: area,
              price,
              minimum_price: minimumPrice,
              price_per_sqm: price && area ? Math.round(price / area) : undefined,
              property_type: classifyPropertyType(title + ' ' + description),
              auction_type: 'marketplace',
              description: description.slice(0, 1000) || undefined,
            });
          }

          // Проверяем, есть ли ещё страницы
          if (pageNum >= (meta?.pages || 1)) {
            logger.info('[m-ets] Достигнута последняя страница');
            break;
          }
        } catch (err: any) {
          logger.warn(`[m-ets] Ошибка на странице ${pageNum}: ${err.message}`);
          // Продолжаем со следующей страницы
        }
      }

      logger.info(`[m-ets] Итого: ${allProperties.length} объектов недвижимости`);
      return allProperties;
    } catch (err: any) {
      logger.error(`[m-ets] Ошибка парсинга: ${err.message}`);
      throw err;
    } finally {
      await browser.close();
    }
  }
}
