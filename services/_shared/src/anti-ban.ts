/**
 * Анти-бан модуль для парсеров.
 * Random delay, UA ротация, retryGoto, stealth context.
 */

import type { Browser, BrowserContext, Page } from 'playwright';

/** Пул реалистичных User-Agent строк (Chrome / Firefox). */
export const USER_AGENTS: string[] = [
  // Chrome — Windows
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  // Chrome — macOS
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  // Chrome — Linux
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  // Firefox — Windows
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
  // Firefox — macOS
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:126.0) Gecko/20100101 Firefox/126.0',
  // Firefox — Linux
  'Mozilla/5.0 (X11; Linux x86_64; rv:126.0) Gecko/20100101 Firefox/126.0',
  'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0',
];

/**
 * Случайная задержка (мс).
 * Используется между запросами для имитации поведения человека.
 */
export function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((resolve) => setTimeout(resolve, delay));
}

/** Возвращает случайный User-Agent из пула. */
export function getRandomUA(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/**
 * Переход на страницу с retry и экспоненциальным backoff.
 */
export async function retryGoto(
  page: Page,
  url: string,
  maxAttempts: number = 3,
): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      return;
    } catch (err) {
      if (attempt === maxAttempts) throw err;
      const backoff = 2 ** attempt * 1000 + Math.random() * 1000;
      await randomDelay(backoff, backoff + 500);
    }
  }
}

/**
 * Создаёт stealth-контекст браузера:
 * случайный UA, локаль ru-RU, stealth-заголовки.
 */
export async function createStealthContext(browser: Browser): Promise<BrowserContext> {
  const ua = getRandomUA();

  const context = await browser.newContext({
    userAgent: ua,
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
    extraHTTPHeaders: {
      'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
      'sec-ch-ua': '"Chromium";v="125", "Google Chrome";v="125"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
    },
  });

  return context;
}
