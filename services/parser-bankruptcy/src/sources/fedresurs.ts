/**
 * Fedresurs (bankrot.fedresurs.ru) — парсер торгов по банкротству.
 *
 * Fedresurs — Angular SPA без публичного API. Для парсинга нужен headless
 * browser (Playwright/Puppeteer) или reverse-engineering внутренних API.
 *
 * MVP: stub-реализация. Возвращает пустой массив и логирует.
 * TODO: реализовать реальный парсинг через Playwright или внутренний API.
 */

import type { SourceParser, ParsedProperty } from './types';
import { logger } from '../utils/logger';

export class FedresursParser implements SourceParser {
  name = 'fedresurs';

  async parse(): Promise<ParsedProperty[]> {
    logger.info('[fedresurs] Parsing started (stub — no real data yet)');

    // TODO: Реализовать парсинг:
    //   Вариант 1: Playwright headless → DOM → cheerio
    //   Вариант 2: Reverse-engineer внутренний API fedresurs
    //   Вариант 3: Использовать markdown.new для получения HTML
    //
    // Пример URL для торгов по недвижимости:
    //   https://bankrot.fedresurs.ru/TradeList.aspx?PropertyType=RealEstate
    //
    // Ожидаемый формат ответа: массив ParsedProperty с полями:
    //   external_id, url, title, address, city, area_sqm, price,
    //   price_per_sqm, property_type, auction_type, published_at

    logger.info('[fedresurs] Stub: returning 0 properties');
    return [];
  }
}
