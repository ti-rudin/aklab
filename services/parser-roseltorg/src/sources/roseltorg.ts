/**
 * Росэлторг (roseltorg.ru) — парсер коммерческой недвижимости.
 *
 * Playwright, HTML scraping. Таймаут с Mac — проверяем с сервера.
 */
import type { SourceParser, ParsedProperty } from '@aklab/service-shared';
import { logger, randomDelay, createStealthContext, retryGoto, detectCity, classifyPropertyType } from '@aklab/service-shared';

const BASE_URL = 'https://roseltorg.ru';
const MAX_PAGES = 5;

function parsePrice(text: string): number | undefined {
  if (!text) return undefined;
  const cleaned = text.replace(/[^\d,]/g, '').replace(',', '.');
  const num = parseFloat(cleaned);
  return !isNaN(num) && num > 0 ? num : undefined;
}

function extractArea(text: string): number | undefined {
  const match = text.match(/(\d[\d\s]*[,.]?\d*)\s*(?:кв\.?\s*м|м²|м2)/i);
  if (match) {
    const cleaned = match[1].replace(/\s/g, '').replace(',', '.');
    const num = parseFloat(cleaned);
    if (!isNaN(num) && num > 0) return num;
  }
  return undefined;
}

export class RoseltorgParser implements SourceParser {
  name = 'roseltorg';

  async parse(depth?: number): Promise<ParsedProperty[]> {
    const { chromium } = await import('playwright');
    logger.info('[roseltorg] Starting Playwright browser...');
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });

    try {
      const context = await createStealthContext(browser);
      const page = await context.newPage();
      const allProperties: ParsedProperty[] = [];

      const searchUrls = [
        `${BASE_URL}/lot-search`,
        `${BASE_URL}/search`,
        `${BASE_URL}/lots`,
        `${BASE_URL}/trades`,
        BASE_URL,
      ];

      let workingUrl = BASE_URL;
      for (const url of searchUrls) {
        try {
          await retryGoto(page, url, 1);
          workingUrl = url;
          break;
        } catch { continue; }
      }

      await page.waitForTimeout(5000);

      const cards = await page.evaluate(() => {
        const results: Array<{ title: string; link: string; price_text: string; excerpt: string }> = [];
        const selectors = [
          '.card', '.lot-card', '.trade-card', '.search-result',
          '.list-item', 'article', 'tr', '[class*="card"]', '[class*="lot"]',
        ];
        let found: Element[] = [];
        for (const sel of selectors) {
          found = Array.from(document.querySelectorAll(sel));
          if (found.length > 2) break;
        }
        for (const card of found.slice(0, 50)) {
          const el = card as HTMLElement;
          const linkEl = el.querySelector('a[href]') as HTMLAnchorElement;
          const titleEl = el.querySelector('h2, h3, h4, .title, [class*="title"], [class*="name"], td:nth-child(2)');
          const priceEl = el.querySelector('.price, [class*="price"], .cost, td:nth-child(3)');
          const title = titleEl?.textContent?.trim() || linkEl?.textContent?.trim() || '';
          if (!title || title.length < 5) continue;
          results.push({
            title: title.slice(0, 200),
            link: linkEl?.href || '',
            price_text: priceEl?.textContent?.trim() || '',
            excerpt: el.textContent?.trim().slice(0, 500) || '',
          });
        }
        return results;
      });

      logger.info(`[roseltorg] Found ${cards.length} cards at ${workingUrl}`);

      for (const card of cards) {
        const area = extractArea(card.title + ' ' + card.excerpt);
        const price = parsePrice(card.price_text);
        const fullLink = card.link.startsWith('http') ? card.link : `${BASE_URL}${card.link}`;
        const excerpt = card.excerpt || '';
        const addrMatch = excerpt.match(/(?:адрес|ул\.|г\.|пр\.|просп|шоссе)[^,]*(?:,[^,]+){0,2}/i);
        const address = addrMatch ? addrMatch[0].trim() : '';

        allProperties.push({
          external_id: `roseltorg-${card.link.split('/').pop() || card.title.slice(0, 30)}`,
          url: fullLink,
          title: card.title,
          address,
          city: detectCity(card.title + ' ' + excerpt),
          area_sqm: area,
          price,
          price_per_sqm: price && area ? Math.round(price / area) : undefined,
          property_type: classifyPropertyType(card.title),
          auction_type: 'marketplace',
          description: excerpt.length > 20 ? excerpt.slice(0, 500) : undefined,
        });
      }

      logger.info(`[roseltorg] Total: ${allProperties.length} properties`);
      return allProperties;
    } catch (err: any) {
      logger.error(`[roseltorg] Parse error: ${err.message}`);
      throw err;
    } finally {
      await browser.close();
    }
  }

  async fetchDetails(url: string): Promise<Partial<ParsedProperty>> {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
      const context = await createStealthContext(browser);
      const page = await context.newPage();
      await retryGoto(page, url, 3);

      // Ждём загрузки контента
      try {
        await page.waitForSelector('.lot-info, .trade-info, .card, article, h1, h2', { timeout: 15000 });
      } catch {
        await page.waitForTimeout(3000);
      }

      const details = await page.evaluate(() => {
        const allText = document.body.innerText || '';

        // Описание: ищем длинные блоки текста
        let description = '';
        const descCandidates = document.querySelectorAll('.description, .lot-description, [class*="desc"], article p, .info-block p');
        for (const el of Array.from(descCandidates)) {
          const text = (el.textContent || '').trim();
          if (text.length > 50 && text.length > description.length) {
            description = text.slice(0, 2000);
          }
        }

        // Контакты
        const contactParts: string[] = [];
        const phoneMatch = allText.match(/(?:тел(?:ефон)?|phone)[:\s.]+([+\d\s()-]{7,20})/i);
        if (phoneMatch) contactParts.push('Тел: ' + phoneMatch[1].trim());

        const emailMatch = allText.match(/(?:email|e-mail|почт[аы])[:\s]+([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
        if (emailMatch) contactParts.push('Email: ' + emailMatch[1].trim());

        const contacts = contactParts.length > 0 ? contactParts.join(', ') : undefined;

        // Адрес: ищем в тексте
        let address = '';
        const addrMatch = allText.match(/(?:адрес|расположенн?[:\s]+)(.+?)(?:,\s*(?:общ|пл|к\/н|собств|\n))/i);
        if (addrMatch) address = addrMatch[1].trim().slice(0, 300);

        // Фото
        const photoUrls: string[] = [];
        const contentImgs = document.querySelectorAll('img[src*="upload"], img[src*="lot"], img[src*="photo"], img[src*="image"], .gallery img, .slider img, [class*="carousel"] img');
        for (const img of Array.from(contentImgs).slice(0, 10)) {
          const src = (img as HTMLImageElement).src;
          if (src && src.startsWith('http') && !src.includes('logo') && !src.includes('icon')) {
            photoUrls.push(src);
          }
        }

        return {
          description: description || undefined,
          contacts,
          address: address.length > 3 ? address : undefined,
          photo_urls: photoUrls.length > 0 ? photoUrls : undefined,
        };
      });

      return {
        description: details.description,
        contacts: details.contacts,
        address: details.address,
        photo_urls: details.photo_urls,
      };
    } catch (err: any) {
      logger.warn(`[roseltorg] fetchDetails error for ${url}: ${err.message}`);
      return {};
    } finally {
      await browser.close();
    }
  }
}


