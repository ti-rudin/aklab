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
import { logger, randomDelay, retryGoto } from '@aklab/service-shared';

const API_URL = 'https://torgi.gov.ru/new/api/public/lotcards/search';
const BASE_URL = 'https://torgi.gov.ru/new/public/lots/reg';
const MAX_PAGES = 30; // API отдаёт 10 на страницу (size игнорирует), 30 стр = 300 items
const ITEMS_PER_PAGE = 10;

const MOSCOW_REGIONS = new Set(['77', '50']);

function classifyPropertyType(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes('офис') || lower.includes('административн')) return 'office';
  if (lower.includes('склад') || lower.includes('хранилищ')) return 'warehouse';
  if (lower.includes('магазин') || lower.includes('торгов') || lower.includes('павильон')) return 'retail';
  if (lower.includes('производствен') || lower.includes('промышлен') || lower.includes('цех')) return 'production';
  if (lower.includes('нежилое') || lower.includes('помещение') || lower.includes('коммерческ')) return 'free_purpose';
  if (lower.includes('квартир')) return 'apartment';
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
    // torgi.gov.ru — загружаем детальную страницу лота через Playwright
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      });
      const page = await context.newPage();
      await retryGoto(page, url, 3);

      // Ждём загрузки контента
      try {
        await page.waitForSelector('.lot-card, .lot-detail, [class*="lot-card"]', { timeout: 10000 });
      } catch {
        await page.waitForTimeout(3000);
      }

      const details = await page.evaluate(() => {
        // Описание: полное описание лота
        const descSelectors = [
          '.lot-description', '.lot-card__description', '.description',
          '[class*="description"]', '.lot-detail__description',
          '.lot-card__text', '.lot-info'
        ];
        let description = '';
        for (const sel of descSelectors) {
          const el = document.querySelector(sel);
          if (el && el.textContent && el.textContent.trim().length > 30) {
            description = el.textContent.trim().slice(0, 2000);
            break;
          }
        }

        // Контакты: организатор торгов
        const contactSelectors = [
          '.lot-contacts', '.contacts', '[class*="contact"]',
          '.organizer', '.lot-card__contacts', '.lot-detail__contacts'
        ];
        let contacts = '';
        for (const sel of contactSelectors) {
          const el = document.querySelector(sel);
          if (el && el.textContent && el.textContent.trim().length > 5) {
            contacts = el.textContent.trim().slice(0, 500);
            break;
          }
        }

        // Если контакты не найдены в блоках — ищем телефон/email в тексте
        if (!contacts) {
          const bodyText = document.body.textContent || '';
          const phoneMatch = bodyText.match(/(?:\+7|8)[\s\-]?\(?\d{3}\)?[\s\-]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2}/);
          const emailMatch = bodyText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
          const parts = [];
          if (phoneMatch) parts.push(phoneMatch[0]);
          if (emailMatch) parts.push(emailMatch[0]);
          contacts = parts.join(', ');
        }

        // Координаты: ищем в data-атрибутах или скриптах
        let latitude: number | undefined;
        let longitude: number | undefined;
        const mapEl = document.querySelector('[data-lat], [data-latitude], .map-container');
        if (mapEl) {
          const lat = mapEl.getAttribute('data-lat') || mapEl.getAttribute('data-latitude');
          const lng = mapEl.getAttribute('data-lng') || mapEl.getAttribute('data-longitude');
          if (lat && lng) {
            latitude = parseFloat(lat);
            longitude = parseFloat(lng);
          }
        }

        // Координаты из скриптов (Yandex/Google Maps)
        if (!latitude) {
          const scripts = document.querySelectorAll('script');
          for (const script of Array.from(scripts)) {
            const text = script.textContent || '';
            const coordMatch = text.match(/(?:center|coordinates|coords)[:\s]*\[?(\d+\.\d+)[,\s]+(\d+\.\d+)/);
            if (coordMatch) {
              latitude = parseFloat(coordMatch[1]);
              longitude = parseFloat(coordMatch[2]);
              break;
            }
          }
        }

        // Адрес: более точный из детальной страницы
        const addressSelectors = [
          '.lot-address', '.address', '[class*="address"]',
          '.lot-card__address', '.lot-detail__address'
        ];
        let address = '';
        for (const sel of addressSelectors) {
          const el = document.querySelector(sel);
          if (el && el.textContent && el.textContent.trim().length > 5) {
            address = el.textContent.trim().slice(0, 300);
            break;
          }
        }

        // Детали аукциона: даты, шаг, задаток
        const auctionInfo: string[] = [];
        const allText = document.body.textContent || '';
        const dateMatch = allText.match(/(?:дата|начало|окончание|торги)[\s:]*(\d{2}\.\d{2}\.\d{4})/gi);
        if (dateMatch) auctionInfo.push(...dateMatch.slice(0, 3));

        const depositMatch = allText.match(/(?:задаток|гарантийный взнос)[\s:]*(\d[\d\s,.]*)(?:\s*руб|\s*₽)/i);
        if (depositMatch) auctionInfo.push(depositMatch[0]);

        const stepMatch = allText.match(/(?:шаг|шаг торгов)[\s:]*(\d[\d\s,.]*)(?:\s*руб|\s*₽)/i);
        if (stepMatch) auctionInfo.push(stepMatch[0]);

        return {
          description: description || undefined,
          contacts: contacts || undefined,
          latitude: latitude && !isNaN(latitude) ? latitude : undefined,
          longitude: longitude && !isNaN(longitude) ? longitude : undefined,
          address: address || undefined,
        };
      });

      return {
        description: details.description,
        contacts: details.contacts,
        latitude: details.latitude,
        longitude: details.longitude,
        address: details.address,
      };
    } catch (err: any) {
      logger.warn(`[torgi-gov] fetchDetails error for ${url}: ${err.message}`);
      return {};
    } finally {
      await browser.close();
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
