/**
 * torgi.gov.ru — ГИС Торги, реестр лотов.
 *
 * Публичный JSON API:
 *   GET /new/api/public/lotcards/search?lotStatus=PUBLISHED,APPLICATIONS_SUBMISSION&size=N
 *
 * Фильтрация по региону — в коде (API параметр subjectRFCode не работает).
 * Регион = 77 (Москва), 50 (МО).
 */

import { classifyPropertyType } from '@aklab/service-shared';
import type { SourceParser, ParsedProperty } from '@aklab/service-shared';
import { logger, randomDelay } from '@aklab/service-shared';

const API_URL = 'https://torgi.gov.ru/new/api/public/lotcards/search';
const BASE_URL = 'https://torgi.gov.ru/new/public/lots/reg';
const MAX_PAGES = 30; // API отдаёт 10 на страницу (size игнорирует), 30 стр = 300 items
const ITEMS_PER_PAGE = 10;

const MOSCOW_REGIONS = new Set(['77', '50']);

function extractAddress(item: any): string {
  const desc = item.lotDescription || item.lotName || '';
  const match = desc.match(/(?:по адресу|адрес|расположенн?\s+по)[:\s]+(.+?)(?:[,;]|$)/i);
  if (match) return match[1].trim();
  const subject = item.subjectName || '';
  return subject || desc.substring(0, 100);
}

export class TorgiGovParser implements SourceParser {
  name = 'torgi-gov';

  async parse(depth?: number): Promise<ParsedProperty[]> {
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
        const properties = await this.searchQuery(query, depth);
        allProperties.push(...properties);
      } catch (err: any) {
        logger.warn(`[torgi-gov] Search "${query}" failed: ${err.message}`);
      }
      // Пауза между поисковыми запросами (3-6 сек)
      await randomDelay(3000, 6000);
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

  async fetchDetails(url: string): Promise<Partial<ParsedProperty>> {
    // torgi.gov.ru — Angular SPA, HTML пустой. Используем JSON API.
    // URL: https://torgi.gov.ru/new/public/lots/reg/lot-card/{noticeNumber}/{lotNumber}
    // API: GET https://torgi.gov.ru/new/api/public/lotcards/{noticeNumber}_{lotNumber}

    try {
      const urlMatch = url.match(/lot-card\/(\d+)\/(\d+)/);
      if (!urlMatch) {
        logger.warn(`[torgi-gov] Cannot extract noticeNumber/lotNumber from URL: ${url}`);
        return {};
      }

      const noticeNumber = urlMatch[1];
      const lotNumber = urlMatch[2];
      const apiUrl = `https://torgi.gov.ru/new/api/public/lotcards/${noticeNumber}_${lotNumber}`;

      logger.info(`[torgi-gov] fetchDetails via JSON API: ${apiUrl}`);

      const response = await fetch(apiUrl, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      });

      if (!response.ok) {
        logger.warn(`[torgi-gov] API returned ${response.status} for ${apiUrl}`);
        return {};
      }

      const data = await response.json() as any;

      // Описание
      const description = data.lotDescription || data.lotName || undefined;

      // Адрес
      const address = data.estateAddress || data.lotAddress || undefined;

      // Координаты
      const latitude = data.point?.lat && !isNaN(Number(data.point.lat))
        ? Number(data.point.lat)
        : undefined;
      const longitude = data.point?.lon && !isNaN(Number(data.point.lon))
        ? Number(data.point.lon)
        : undefined;

      // Контакты: организатор торгов
      const contacts = data.depositRecipientName || undefined;

      return { description, contacts, address, latitude, longitude };
    } catch (err: any) {
      logger.warn(`[torgi-gov] fetchDetails error for ${url}: ${err.message}`);
      return {};
    }
  }

  private async searchQuery(query: string, depth?: number): Promise<ParsedProperty[]> {
    const results: ParsedProperty[] = [];
    const maxPages = depth ? Math.ceil(depth / ITEMS_PER_PAGE) : MAX_PAGES;
    let consecutiveOld = 0; // счётчик страниц без свежих объектов

    for (let page = 0; page < maxPages; page++) {
      const params = new URLSearchParams({
        lotStatus: 'PUBLISHED,APPLICATIONS_SUBMISSION',
        text: query,
        size: '10', // API всегда отдаёт 10, параметр формальный
        sort: 'firstVersionPublicationDate,desc',
        withFacets: 'false',
        page: String(page),
      });

      const url = `${API_URL}?${params}`;
      logger.info(`[torgi-gov] Fetching: ${query} (page ${page})`);

      // Пауза между запросами (имитация человека, 2-5 сек)
      if (page > 0) {
        await randomDelay(2000, 5000);
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

        // API v2: priceMin/priceMax на верхнем уровне (не в priceInfo)
        const price = item.priceMin || item.priceMax || item.priceInfo?.startPrice || item.priceInfo?.currentPrice;

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

      // Ранний выход: если 10 страниц подряд без свежих объектов — дальше только старые
      if (pageNewCount === 0) {
        consecutiveOld++;
        if (consecutiveOld >= 10) {
          logger.info(`[torgi-gov] 10 consecutive pages with no recent items — stopping`);
          break;
        }
      } else {
        consecutiveOld = 0;
      }

      if (page >= data.totalPages - 1) break;
      if (items.length < 10) {
        logger.info(`[torgi-gov] Page ${page}: only ${items.length} items (less than 10) — last page`);
        break;
      }
    }

    logger.info(`[torgi-gov] Query "${query}": ${results.length} properties`);
    return results;
  }
}
