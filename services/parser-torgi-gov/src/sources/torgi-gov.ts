/**
 * torgi.gov.ru — ГИС Торги, реестр лотов.
 *
 * Публичный JSON API:
 *   GET /new/api/public/lotcards/search?lotStatus=PUBLISHED,APPLICATIONS_SUBMISSION&size=N
 *
 * Фильтрация по региону — в коде (API параметр subjectRFCode не работает).
 * Регион = 77 (Москва), 50 (МО).
 */

import type { SourceParser, ParsedProperty } from '@aklab/service-shared';
import { logger } from '@aklab/service-shared';

const API_URL = 'https://torgi.gov.ru/new/api/public/lotcards/search';
const BASE_URL = 'https://torgi.gov.ru/new/public/lots/reg';
const MAX_PAGES = 30; // API отдаёт 10 на страницу (size игнорирует), 30 стр = 300 items
const MAX_AGE_HOURS = 24; // только объекты за последние N часов

const MOSCOW_REGIONS = new Set(['77', '50']);

function classifyPropertyType(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes('офис') || lower.includes('административн')) return 'office';
  if (lower.includes('склад') || lower.includes('хранилищ')) return 'warehouse';
  if (lower.includes('магазин') || lower.includes('торгов') || lower.includes('павильон')) return 'retail';
  if (lower.includes('производствен') || lower.includes('промышлен') || lower.includes('цех')) return 'production';
  if (lower.includes('нежилое') || lower.includes('помещение') || lower.includes('коммерческ')) return 'free_purpose';
  return 'other';
}

function extractAddress(item: any): string {
  const desc = item.lotDescription || item.lotName || '';
  const match = desc.match(/(?:по адресу|адрес|расположенн?\s+по)[:\s]+(.+?)(?:[,;]|$)/i);
  if (match) return match[1].trim();
  const subject = item.subjectName || '';
  return subject || desc.substring(0, 100);
}

export class TorgiGovParser implements SourceParser {
  name = 'torgi-gov';

  async parse(): Promise<ParsedProperty[]> {
    logger.info('[torgi-gov] Starting parse...');
    const allProperties: ParsedProperty[] = [];

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
      // Пауза между поисковыми запросами (3-6 сек)
      const delay = 3000 + Math.random() * 3000;
      await new Promise(r => setTimeout(r, delay));
    }

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
    const cutoff = new Date(Date.now() - MAX_AGE_HOURS * 3600 * 1000);
    let consecutiveOld = 0; // счётчик страниц без свежих объектов

    for (let page = 0; page < MAX_PAGES; page++) {
      const params = new URLSearchParams({
        lotStatus: 'PUBLISHED,APPLICATIONS_SUBMISSION',
        text: query,
        size: '10', // API всегда отдаёт 10, параметр формальный
        sort: 'firstVersionPublicationDate,desc',
        withFacets: 'false',
      });

      const url = `${API_URL}?${params}`;
      logger.info(`[torgi-gov] Fetching: ${query} (page ${page})`);

      // Пауза между запросами (имитация человека, 2-5 сек)
      if (page > 0) {
        const delay = 2000 + Math.random() * 3000;
        await new Promise(r => setTimeout(r, delay));
      }

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

      let pageNewCount = 0;

      for (const item of items) {
        // Фильтр по дате — только объекты за последние MAX_AGE_HOURS
        const createDate = item.createDate ? new Date(item.createDate) : null;
        if (createDate && createDate < cutoff) continue;

        const regionCode = String(item.subjectRFCode || '');
        if (!MOSCOW_REGIONS.has(regionCode)) continue;

        const catCode = String(item.category?.code || '');
        if (catCode === '301' || catCode === '307') continue;

        const lotName = item.lotName || '';
        const description = item.lotDescription || lotName;
        const fullText = `${lotName} ${description}`.toLowerCase();

        const isProperty = ['нежилое', 'помещение', 'здание', 'сооружение',
          'офис', 'склад', 'магазин', 'торгов', 'гараж', 'коммерческ',
          'административн', 'производствен'].some(kw => fullText.includes(kw));
        if (!isProperty) continue;

        const priceInfo = item.priceInfo || {};
        const price = priceInfo.startPrice || priceInfo.currentPrice || priceInfo.price;

        let area: number | undefined;
        const chars = item.characteristics || [];
        for (const ch of chars) {
          if (ch.code === 'totalAreaRealty' || ch.code === 'SquareZU' || ch.code === 'Square' || ch.code === 'TotalArea') {
            const val = parseFloat(String(ch.characteristicValue));
            if (!isNaN(val) && val > 0) area = val;
          }
        }

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
          description: description.length > 20 ? description.slice(0, 1000) : undefined,
          published_at: item.createDate || undefined,
        });
        pageNewCount++;
      }

      // Ранний выход: если 3 страницы подряд без свежих объектов — дальше только старые
      if (pageNewCount === 0) {
        consecutiveOld++;
        if (consecutiveOld >= 3) {
          logger.info(`[torgi-gov] 3 consecutive pages with no recent items — stopping`);
          break;
        }
      } else {
        consecutiveOld = 0;
      }

      if (page >= data.totalPages - 1 || items.length < 10) break;
    }

    logger.info(`[torgi-gov] Query "${query}": ${results.length} properties`);
    return results;
  }
}
