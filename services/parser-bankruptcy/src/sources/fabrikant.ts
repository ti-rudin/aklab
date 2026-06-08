/**
 * Fabrikant.ru — парсер торгов по банкротству.
 *
 * Next.js SSR, нет публичного JSON API. Парсим HTML через Playwright.
 * URL: https://www.fabrikant.ru/procedure/search
 */

import type { SourceParser, ParsedProperty } from './types';
import { logger } from '../utils/logger';

const BASE_URL = 'https://www.fabrikant.ru';
const SEARCH_URL = `${BASE_URL}/procedure/search`;

// Типы недвижимости для фильтрации
const PROPERTY_KEYWORDS = [
  'нежилое', 'помещение', 'офис', 'склад', 'магазин', 'здание',
  'сооружение', 'гараж', 'паркинг', 'земельный участок', 'коммерческ',
  'торгов', 'административн', 'производствен', 'промышленн',
];

function classifyPropertyType(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes('офис') || lower.includes('административн')) return 'office';
  if (lower.includes('склад') || lower.includes('хранилищ')) return 'warehouse';
  if (lower.includes('магазин') || lower.includes('торгов') || lower.includes('павильон')) return 'retail';
  if (lower.includes('производствен') || lower.includes('промышленн') || lower.includes('цех')) return 'production';
  if (lower.includes('нежилое') || lower.includes('помещение') || lower.includes('коммерческ')) return 'free_purpose';
  return 'other';
}

function parsePrice(text: string): number | undefined {
  if (!text) return undefined;
  // "1 234 567,89 руб." → 1234567.89
  const cleaned = text.replace(/[^\d,.-]/g, '').replace(',', '.');
  const num = parseFloat(cleaned);
  return isNaN(num) ? undefined : num;
}

function parseArea(text: string): number | undefined {
  if (!text) return undefined;
  // "123,45 кв.м" → 123.45
  const match = text.match(/([\d\s]+[,.]?\d*)/);
  if (!match) return undefined;
  const cleaned = match[1].replace(/\s/g, '').replace(',', '.');
  const num = parseFloat(cleaned);
  return isNaN(num) ? undefined : num;
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

      // Загружаем страницу поиска с фильтром по недвижимости
      logger.info('[fabrikant] Loading search page...');
      await page.goto(SEARCH_URL, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await page.waitForTimeout(5000);

      // Извлекаем данные о процедурах из SSR HTML
      const properties = await page.evaluate(() => {
        const results: Array<{
          external_id: string;
          url: string;
          title: string;
          address: string;
          price?: number;
          lot_id: string;
        }> = [];

        // Ищем карточки процедур — Fabrikant использует data-id на элементах
        const cards = Array.from(document.querySelectorAll('[data-id], .procedure-card, .lot-card, article'));
        
        for (const card of cards) {
          const el = card as HTMLElement;
          const lotId = el.getAttribute('data-id') || el.querySelector('[data-id]')?.getAttribute('data-id');
          if (!lotId) continue;

          // Извлекаем текст
          const titleEl = el.querySelector('h2, h3, .title, .name, [class*="title"], [class*="name"]');
          const title = titleEl?.textContent?.trim() || '';
          
          // Пропускаем если нет нежилой недвижимости в тексте
          const fullText = el.textContent?.toLowerCase() || '';
          const isProperty = [
            'нежилое', 'помещение', 'офис', 'склад', 'магазин', 'здание',
            'сооружение', 'гараж', 'паркинг', 'земельный участок', 'коммерческ',
            'торгов', 'административн', 'производствен', 'кв.м', 'м²',
          ].some(kw => fullText.includes(kw));
          
          if (!isProperty) continue;

          // Цена
          const priceEl = el.querySelector('[class*="price"], [class*="cost"], .lot-price');
          const priceText = priceEl?.textContent?.trim() || '';
          const price = priceText
            ? parseFloat(priceText.replace(/[^\d,.-]/g, '').replace(',', '.'))
            : undefined;

          // Ссылка
          const linkEl = el.querySelector('a[href]');
          const href = linkEl?.getAttribute('href') || '';
          const url = href.startsWith('http') ? href : `https://www.fabrikant.ru${href}`;

          results.push({
            external_id: lotId,
            url,
            title,
            address: title, // Fabrikant обычно включает адрес в title
            price: isNaN(price as number) ? undefined : price,
            lot_id: lotId,
          });
        }

        return results;
      });

      logger.info(`[fabrikant] Found ${properties.length} property cards`);

      // Преобразуем в ParsedProperty
      const result: ParsedProperty[] = properties.map(p => {
        const pricePerSqm = p.price && p.title
          ? undefined // площадь нужно извлекать из описания
          : undefined;

        return {
          external_id: `fabrikant-${p.lot_id}`,
          url: p.url,
          title: p.title,
          address: p.address,
          city: detectCity(p.address),
          property_type: classifyPropertyType(p.title),
          auction_type: 'bankruptcy',
          price: p.price,
        };
      });

      logger.info(`[fabrikant] Parsed ${result.length} properties`);
      return result;

    } catch (err: any) {
      logger.error(`[fabrikant] Parse error: ${err.message}`);
      throw err;
    } finally {
      await browser.close();
    }
  }
}

function detectCity(address: string): string {
  const lower = address.toLowerCase();
  if (lower.includes('москва') || lower.includes('г. москва') || lower.includes('г.москва')) return 'moscow';
  if (lower.includes('московская область') || lower.includes('мо') || lower.includes('подольск') ||
      lower.includes('химки') || lower.includes('мытищи') || lower.includes('балашиха') ||
      lower.includes('одинцово') || lower.includes('пушкин') || lower.includes('серпухов')) return 'mo';
  return 'other';
}
