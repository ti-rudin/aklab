/**
 * @module anti-ban
 *
 * Утилиты для снижения вероятности блокировки при парсинге веб-сайтов.
 * Предоставляет: ротацию User-Agent, случайные задержки между запросами,
 * retry с экспоненциальным backoff и создание stealth-контекста браузера.
 *
 * ## Что модуль МОЖЕТ обработать
 * - Мягкий rate-limiting (429) — через retry + backoff
 * - Базовая детектация ботов по User-Agent — через ротацию UA из пула
 * - Простые fingerprint-проверки заголовков — через stealth-заголовки (sec-ch-ua, Accept-Language)
 * - Локаль и часовой пояс — через контекст браузера (ru-RU, Europe/Moscow)
 *
 * ## Чего модуль НЕ МОЖЕТ обработать
 * - TLS fingerprinting (JA3/JA4) — Playwright использует фиксированный TLS-стек Chromium,
 *   который тривиально детектится на уровне handshake
 * - Продвинутые WAF (Qrator, Cloudflare, Akamai) — требуют headless-обходы,
 *   управление cookies, решение JS-челленджей
 * - CAPTCHA (reCAPTCHA, hCaptcha, FunCaptcha) — требуется ручное решение
 *   или интеграция с сервисом решения капч
 * - Поведенческий анализ (курсор, скролл, время на странице) — не эмулируется
 * - WebGL/Canvas fingerprint — не подменяется
 * - IP-based блокировки — модуль не управляет прокси
 *
 * @example
 * ```ts
 * import { createStealthContext, retryGoto, randomDelay } from './anti-ban';
 *
 * const context = await createStealthContext(browser);
 * const page = await context.newPage();
 * await retryGoto(page, 'https://example.com');
 * await randomDelay(1000, 3000);
 * ```
 */

import type { Browser, BrowserContext, Page } from 'playwright';

/**
 * Пул реалистичных User-Agent строк (Chrome / Firefox).
 *
 * Содержит 10 вариантов UA для Windows, macOS и Linux.
 * Используется {@link getRandomUA} для равномерной ротации.
 *
 * @remarks
 * UA-строки соответствуют реальным браузерам Chrome 124-125 и Firefox 125-126.
 * Пул следует обновлять каждые несколько месяцев, чтобы UA не устаревали.
 */
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
 * Случайная задержка для имитации поведения человека между запросами.
 *
 * **Обрабатывает:** мягкий rate-limiting — увеличивает интервал между запросами,
 * снижая вероятность получения 429.
 *
 * **Не обрабатывает:** серверные rate-limit на основе IP (требует прокси),
 * rate-limit на уровне сессии/токена.
 *
 * @param minMs - Минимальная задержка в миллисекундах
 * @param maxMs - Максимальная задержка в миллисекундах
 * @returns Promise, который резолвится после случайной задержки в диапазоне [minMs, maxMs]
 *
 * @example
 * ```ts
 * // Случайная пауза от 1 до 3 секунд между запросами
 * await randomDelay(1000, 3000);
 * ```
 */
export function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((resolve) => setTimeout(resolve, delay));
}

/**
 * Возвращает случайный User-Agent из пула {@link USER_AGENTS}.
 *
 * **Обрабатывает:** базовую UA-детектацию — сервер не видит один и тот же UA
 * на каждом запросе, что снижает вероятность блокировки.
 *
 * **Не обрабатывает:** продвинутую UA-валидацию (например, проверку соответствия
 * UA и TLS fingerprint), браузерные свойства `navigator.userAgent`.
 *
 * @returns Случайная UA-строка из пула (Chrome или Firefox, Windows/macOS/Linux)
 *
 * @example
 * ```ts
 * const ua = getRandomUA();
 * // 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ...'
 * ```
 */
export function getRandomUA(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/**
 * Переход на страницу с retry и экспоненциальным backoff.
 *
 * Пытается загрузить страницу до `maxAttempts` раз. При каждой неудачной попытке
 * (кроме последней) ждёт экспоненциально увеличивающееся время: `2^attempt * 1000 + random(0..1000)` мс.
 *
 * **Обрабатывает:** сетевые таймауты, временные 5xx ошибки, нестабильные соединения.
 *
 * **Не обрабатывает:** целенаправленные блокировки (403, CAPTCHA-редиректы) —
 * в этом случае все попытки провалятся и будет выброшен последний error.
 * Также не обрабатывает Qrator/Cloudflare JS-челленджи — page.goto не выполняет
 * JavaScript-защиту, которая может требовать ожидания.
 *
 * @param page - Экземпляр Playwright Page для навигации
 * @param url - URL для перехода
 * @param maxAttempts - Максимальное количество попыток (по умолчанию 3)
 * @returns Promise, который резолвится при успешной загрузке или реджектится после исчерпания попыток
 * @throws {Error} Последняя ошибка page.goto, если все попытки провалились
 *
 * @example
 * ```ts
 * const page = await context.newPage();
 * await retryGoto(page, 'https://example.com/page', 5);
 * // Страница загружена или ошибка после 5 попыток
 * ```
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
 * Создаёт stealth-контекст браузера с реалистичными настройками.
 *
 * Настраивает контекст Playwright для имитации реального браузера:
 * - Случайный User-Agent из пула
 * - Локаль ru-RU, часовой пояс Europe/Moscow
 * - HTTP-заголовки sec-ch-ua, Accept-Language
 *
 * **Обрабатывает:** базовые проверки заголовков, локали и часового пояса.
 *
 * **Не обрабатывает:**
 * - TLS fingerprinting (JA3/JA4) — Playwright/Chromium имеет фиксированный TLS-стек
 * - WebGL/Canvas fingerprint — не подменяет `canvas.toDataURL()` или `WebGLRenderingContext`
 * - Navigator properties — не патчит `navigator.webdriver`, `navigator.plugins` и т.д.
 * - Продвинутые WAF (Qrator, Cloudflare) — требуют дополнительные обходы
 *
 * @param browser - Экземпляр Playwright Browser
 * @returns BrowserContext с настроенными stealth-параметрами
 *
 * @example
 * ```ts
 * const browser = await chromium.launch({ headless: true });
 * const context = await createStealthContext(browser);
 * const page = await context.newPage();
 * ```
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
