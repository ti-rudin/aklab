/***
 * ETPRF — парсер площадки etprf.ru.
 *
 * SPA-сайт, jQuery + Playwright.
 * Search: /Notification (список извещений)
 * fetchDetails: открывает /Notification/id/{id} — 4 таба с .details-table
 */

import type { SourceParser, ParsedProperty } from '@aklab/service-shared';
import { logger, randomDelay, createStealthContext, retryGoto, detectCity, classifyPropertyType } from '@aklab/service-shared';

const BASE_URL = 'https://sale.etprf.ru';
const SEARCH_URL = `${BASE_URL}/Notification`;
const MAX_PAGES = 10;

function parsePrice(text: string): number | undefined {
  if (!text) return undefined;
  const cleaned = text.replace(/[^\d,]/g, '').replace(',', '.');
  const num = parseFloat(cleaned);
  return !isNaN(num) && num > 0 ? num : undefined;
}

function extractArea(text: string): number | undefined {
  const match = text.match(/(\d[\d\s]*[,.]?\d*)\s*(?:кв\.?\s*м|м²|м2)/i);
  if (!match) return undefined;
  return parseFloat(match[1].replace(/\s/g, '').replace(',', '.'));
}

export class EtprfParser implements SourceParser {
  name = 'etprf';

  async parse(depth?: number): Promise<ParsedProperty[]> {
    const { chromium } = await import('playwright');

    logger.info('[etprf] Starting Playwright browser...');
    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
      const context = await createStealthContext(browser);
      const page = await context.newPage();
      const allProperties: ParsedProperty[] = [];

      // Загружаем страницу
      await retryGoto(page, SEARCH_URL, 3);
      await page.waitForTimeout(3000);

      // Применяем фильтр по категории "Коммерческая недвижимость" если доступен
      try {
        const filterCategory = page.locator('#Filter_PurchaseSubjectCategory');
        if (await filterCategory.count() > 0) {
          await filterCategory.selectOption('4');
          const applyBtn = page.locator('[id^="bt_filter_update"]');
          if (await applyBtn.count() > 0) {
            await applyBtn.click();
            await page.waitForTimeout(3000);
          }
        }
      } catch {
        // Фильтр может не быть — продолжаем без него
      }

      const ITEMS_PER_PAGE = 20;
      const maxPages = depth ? Math.ceil(depth / ITEMS_PER_PAGE) : MAX_PAGES;
      for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
        logger.info(`[etprf] Parsing page ${pageNum}`);

        const rows = await page.evaluate(() => {
          const results: Array<{
            lot_id: string;
            notification: string;
            subject: string;
            price_text: string;
            status: string;
            detail_url: string;
          }> = [];

          const table = document.querySelector('table.reporttable');
          if (!table) return results;

          const trs = table.querySelectorAll('tr');
          // Skip header row (first)
          for (let i = 1; i < trs.length; i++) {
            const tr = trs[i];
            const tds = tr.querySelectorAll('td');
            if (tds.length < 4) continue;

            const lotId = tds[0]?.textContent?.trim() || '';
            const notification = tds[1]?.textContent?.trim() || '';
            const subject = tds[2]?.textContent?.trim() || '';
            const priceText = tds[3]?.textContent?.trim() || '';
            const status = tds.length >= 9 ? tds[8]?.textContent?.trim() || '' : '';

            // Ссылка на детальную страницу
            const linkEl = tr.querySelector('a[href*="/Notification/id/"]') as HTMLAnchorElement;
            const detailUrl = linkEl?.getAttribute('href') || '';

            if (!lotId) continue;
            results.push({ lot_id: lotId, notification, subject, price_text: priceText, status, detail_url: detailUrl });
          }
          return results;
        });

        logger.info(`[etprf] Page ${pageNum}: ${rows.length} rows`);

        for (const row of rows) {
          const price = parsePrice(row.price_text);
          const area = extractArea(row.subject);
          const detailUrl = row.detail_url.startsWith('http') ? row.detail_url : `${BASE_URL}${row.detail_url}`;
          const fullText = `${row.notification} ${row.subject}`;
          const addrMatch = fullText.match(/(?:адрес|ул\.|г\.|пр\.)[^,]*(?:,[^,]+){0,2}/i);
          const address = addrMatch ? addrMatch[0].trim() : '';

          allProperties.push({
            external_id: `etprf-${row.lot_id}`,
            url: detailUrl,
            title: row.subject || row.notification,
            address,
            city: detectCity(row.subject),
            area_sqm: area,
            price,
            price_per_sqm: price && area ? Math.round(price / area) : undefined,
            property_type: classifyPropertyType(row.subject),
            auction_type: 'bankruptcy',
            description: row.subject.length > 20 ? row.subject : undefined,
          });
        }

        // Пагинация: кликаем "следующая страница"
        const nextBtn = page.locator('.pager-button-next');
        if (await nextBtn.count() > 0 && !(await nextBtn.getAttribute('disabled'))) {
          await nextBtn.click();
          await randomDelay(2000, 5000);
          await page.waitForTimeout(2000);
        } else {
          break;
        }
      }

      logger.info(`[etprf] Total: ${allProperties.length} properties`);
      return allProperties;
    } catch (err: any) {
      logger.error(`[etprf] Parse error: ${err.message}`);
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

      // Ждём загрузки таблиц (details-table — актуальный селектор)
      try {
        await page.waitForSelector('.details-table', { timeout: 15000 });
      } catch {
        await page.waitForTimeout(3000);
      }

      const details = await page.evaluate(() => {
        // Утилита: найти значение поля по labelText во ВСЕХ .details-table
        function getFieldValue(labelText: string): string | undefined {
          const rows = document.querySelectorAll('.details-table tr');
          for (const row of Array.from(rows)) {
            const label = row.querySelector('.td-label');
            if (label && label.textContent?.trim().includes(labelText)) {
              return row.querySelector('.td-value')?.textContent?.trim() || undefined;
            }
          }
          return undefined;
        }

        // Утилита: найти email из mailto ссылки
        function getFieldEmail(labelText: string): string | undefined {
          const rows = document.querySelectorAll('.details-table tr');
          for (const row of Array.from(rows)) {
            const label = row.querySelector('.td-label');
            if (label && label.textContent?.trim().includes(labelText)) {
              const mailtoLink = row.querySelector('.td-value a[href^="mailto:"]') as HTMLAnchorElement;
              if (mailtoLink) {
                return mailtoLink.getAttribute('href')?.replace('mailto:', '')?.trim() || undefined;
              }
              return row.querySelector('.td-value')?.textContent?.trim() || undefined;
            }
          }
          return undefined;
        }

        const result: {
          description?: string;
          contacts?: string;
          latitude?: number;
          longitude?: number;
          address?: string;
          price?: number;
          minimum_price?: number;
        } = {};

        // === Контакты: организатор + email + телефон ===
        const organizer = getFieldValue('Организатор торгов');
        const email = getFieldEmail('Адрес электронной почты');
        const phone = getFieldValue('Номер контактного телефона');
        const contactParts: string[] = [];
        if (organizer) contactParts.push(organizer);
        if (phone) contactParts.push(phone);
        if (email) contactParts.push(email);
        if (contactParts.length > 0) {
          result.contacts = contactParts.join(', ');
        }

        // === Описание: подробное описание имущества ===
        const detailedDesc = getFieldValue('Сведения об имуществе');
        const briefDesc = getFieldValue('Краткие сведения об имуществе');
        const desc = detailedDesc || briefDesc;
        if (desc) {
          result.description = desc.slice(0, 2000);
        }

        // === Начальная цена продажи ===
        const priceText = getFieldValue('Начальная цена продажи');
        if (priceText) {
          const cleaned = priceText.replace(/[^\d,]/g, '').replace(',', '.');
          const num = parseFloat(cleaned);
          if (!isNaN(num) && num > 0) {
            result.price = num;
            result.minimum_price = num;
          }
        }

        // === Адрес: ищем в описании имущества, НЕ на всей странице ===
        // На странице есть "Почтовый адрес" организатора — это НЕ адрес объекта.
        // Реальный адрес в поле "Сведения об имуществе" / "Краткие сведения".
        const descForAddr = result.description || '';
        // Паттерн 1: "Адрес: ..." из описания
        const addrMatch = descForAddr.match(/(?:Адрес|адрес):\s*([^;]+)/i);
        if (addrMatch && addrMatch[1] && addrMatch[1].trim().length > 5) {
          result.address = addrMatch[1].trim().slice(0, 300);
        }
        // Паттерн 2: "по адресу: ..." из краткого описания
        if (!result.address && briefDesc) {
          const addrMatch2 = briefDesc.match(/по\s+адресу:\s*([^.]+)/i);
          if (addrMatch2 && addrMatch2[1] && addrMatch2[1].trim().length > 5) {
            result.address = addrMatch2[1].trim().slice(0, 300);
          }
        }
        // Fallback: "Регион местонахождения имущества" из таблицы
        if (!result.address) {
          const region = getFieldValue('Регион местонахождения имущества');
          if (region) result.address = region;
        }

        // Координаты: на etprf.ru НЕТ координат в карточках
        result.latitude = undefined;
        result.longitude = undefined;

        return result;
      });

      return {
        description: details.description,
        contacts: details.contacts,
        latitude: details.latitude,
        longitude: details.longitude,
        address: details.address,
        price: details.price,
        minimum_price: details.minimum_price,
      };
    } catch (err: any) {
      logger.warn(`[etprf] fetchDetails error for ${url}: ${err.message}`);
      return {};
    } finally {
      await browser.close();
    }
  }
}
