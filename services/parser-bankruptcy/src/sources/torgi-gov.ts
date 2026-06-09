/**
 * torgi.gov.ru — ГИС Торги, реестр лотов.
 *
 * Публичный JSON API:
 *   GET /new/api/public/lotcards/search?lotStatus=PUBLISHED,APPLICATIONS_SUBMISSION&size=N
 *
 * Фильтры (параметры URL):
 *   lotStatus=PUBLISHED,APPLICATIONS_SUBMISSION — активные лоты
 *   text=<search> — текстовый поиск
 *   withFacets=true — включить фасеты (категории)
 *   size=N — количество (макс 100)
 *   sort=firstVersionPublicationDate,desc — сортировка
 *
 * Фильтрация по региону — в коде (API параметр subjectRFCode не работает).
 * Регион = 77 (Москва), 50 (МО).
 *
 * Категории имущества (из facets):
 *   11 — Нежилые помещения
 *   20 — Здания, сооружения
 *   301 — Земли населённых пунктов
 *   307 — Земельные участки (не образованы)
 */

import type { SourceParser, ParsedProperty } from './types';
import { logger } from '../utils/logger';

const API_URL = 'https://torgi.gov.ru/new/api/public/lotcards/search';
const BASE_URL = 'https://torgi.gov.ru/new/public/lots/reg';
const PAGE_SIZE = 100;
const MAX_PAGES = 5;

// Регионы Москвы и МО
const MOSCOW_REGIONS = new Set(['77', '50']);

// Категории, которые нас интересуют (нежилая недвижимость)
const PROPERTY_CATEGORIES = new Set(['11', '20', '21', '22', '23']);

function classifyPropertyType(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes('офис') || lower.includes('административн')) return 'office';
  if (lower.includes('склад') || lower.includes('хранилищ')) return 'warehouse';
  if (lower.includes('магазин') || lower.includes('торгов') || lower.includes('павильон')) return 'retail';
  if (lower.includes('производствен') || lower.includes('промышленн') || lower.includes('цех')) return 'production';
  if (lower.includes('нежилое') || lower.includes('помещение') || lower.includes('коммерческ')) return 'free_purpose';
  return 'other';
}

function extractAddress(item: any): string {
  // Из lotDescription или location
  const desc = item.lotDescription || item.lotName || '';
  const match = desc.match(/(?:по адресу|адрес|расположенн?\s+по)[:\s]+(.+?)(?:[,;]|$)/i);
  if (match) return match[1].trim();

  // Из subjectName
  const subject = item.subjectName || '';
  return subject || desc.substring(0, 100);
}

export class TorgiGovParser implements SourceParser {
  name = 'torgi-gov';

  async parse(): Promise<ParsedProperty[]> {
    logger.info('[torgi-gov] Starting parse...');
    const allProperties: ParsedProperty[] = [];

    // Текстовый поиск по коммерческой недвижимости в Москве/МО
    const searchQueries = [
      'нежилое помещение',
      'нежилое здание',
      'офисное помещение',
      'торговое помещение',
      'складское помещение',
    ];

    for (const query of searchQueries) {
      try {
        const properties = await this.searchQuery(query);
        allProperties.push(...properties);
      } catch (err: any) {
        logger.warn(`[torgi-gov] Search "${query}" failed: ${err.message}`);
      }
    }

    // Дедупликация по external_id
    const seen = new Set<string>();
    const unique = allProperties.filter(p => {
      if (seen.has(p.external_id)) return false;
      seen.add(p.external_id);
      return true;
    });

    logger.info(`[torgi-gov] Total: ${unique.length} unique properties`);
    return unique;
  }

  private async searchQuery(query: string): Promise<ParsedProperty[]> {
    const results: ParsedProperty[] = [];

    for (let page = 0; page < MAX_PAGES; page++) {
      const params = new URLSearchParams({
        lotStatus: 'PUBLISHED,APPLICATIONS_SUBMISSION',
        text: query,
        size: String(PAGE_SIZE),
        sort: 'firstVersionPublicationDate,desc',
        withFacets: 'false',
      });

      const url = `${API_URL}?${params}`;
      logger.info(`[torgi-gov] Fetching: ${query} (page ${page})`);

      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      });

      if (!response.ok) {
        logger.warn(`[torgi-gov] API returned ${response.status}`);
        break;
      }

      const data = await response.json() as any;
      const items = data?.content || [];

      if (!items.length) break;

      for (const item of items) {
        const regionCode = String(item.subjectRFCode || '');
        if (!MOSCOW_REGIONS.has(regionCode)) continue;

        const catCode = String(item.category?.code || '');
        // Пропускаем земли (301, 307) — нас интересуют здания и помещения
        if (catCode === '301' || catCode === '307') continue;

        const lotName = item.lotName || '';
        const description = item.lotDescription || lotName;
        const fullText = `${lotName} ${description}`.toLowerCase();

        // Фильтр — только недвижимость
        const isProperty = ['нежилое', 'помещение', 'здание', 'сооружение',
          'офис', 'склад', 'магазин', 'торгов', 'гараж', 'коммерческ',
          'административн', 'производствен'].some(kw => fullText.includes(kw));
        if (!isProperty) continue;

        // Цена из priceInfo
        const priceInfo = item.priceInfo || {};
        const price = priceInfo.startPrice || priceInfo.currentPrice || priceInfo.price;

        // Площадь из characteristics
        let area: number | undefined;
        const chars = item.characteristics || [];
        for (const ch of chars) {
          if (ch.code === 'totalAreaRealty' || ch.code === 'SquareZU' || ch.code === 'Square' || ch.code === 'TotalArea') {
            const val = parseFloat(String(ch.characteristicValue));
            if (!isNaN(val) && val > 0) area = val;
          }
        }

        // Площадь из title (fallback): "95,3 кв.м" / "211 кв. м"
        if (!area) {
          const areaMatch = lotName.match(/(\d[\d\s]*[,.]?\d*)\s*кв\.?\s*м/i);
          if (areaMatch) {
            const cleaned = areaMatch[1].replace(/\s/g, '').replace(',', '.');
            const num = parseFloat(cleaned);
            if (!isNaN(num) && num > 0) area = num;
          }
        }

        const lotId = item.id || `${item.noticeNumber}_${item.lotNumber}`;
        const noticeNum = item.noticeNumber || '';

        results.push({
          external_id: `torgi-gov-${lotId}`,
          url: `${BASE_URL}/lot-card/${noticeNum}/${item.lotNumber || 1}`,
          title: lotName || description.substring(0, 200),
          address: extractAddress(item),
          city: regionCode === '77' ? 'moscow' : regionCode === '50' ? 'mo' : 'other',
          area_sqm: area,
          price: typeof price === 'number' ? price : undefined,
          price_per_sqm: price && area ? Math.round(price / area) : undefined,
          property_type: classifyPropertyType(fullText),
          auction_type: item.biddType?.name?.includes('продаж') ? 'marketplace' : 'privatization',
        });
      }

      // Пагинация
      if (page >= data.totalPages - 1 || items.length < PAGE_SIZE) break;
    }

    logger.info(`[torgi-gov] Query "${query}": ${results.length} properties`);
    return results;
  }
}
