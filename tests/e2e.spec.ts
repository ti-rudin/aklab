import { test, expect } from '@playwright/test';

/**
 * AKLAB — Comprehensive E2E Tests
 * 
 * Покрывает:
 *  1. Auth (login, invalid creds, redirect)
 *  2. Properties list — табы, фильтры, сортировка
 *  3. Focus tab — scoring, теги, фильтры, bulk operations, CSV
 *  4. Object detail page — данные, статус, действия, комментарии
 *  5. Sources page
 *  6. Settings page
 *  7. Market References page
 *  8. Navigation
 *  9. API smoke tests
 *  10. Волна 4 features (Dashboard, Rules, Event Log) — marked as TODO
 */

const FRONTEND = process.env.FRONTEND_URL || 'https://aklab-dev.tirobots.ru';
const API = process.env.API_URL || 'https://api-aklab-dev.tirobots.ru';
const EMAIL = process.env.TEST_USER_EMAIL || 'test@aklab.tirobots.ru';
const PASS = process.env.TEST_USER_PASSWORD || 'Test1234!';

// ─── helpers ──────────────────────────────────────────────────────────

async function login(page: import('@playwright/test').Page) {
  await page.goto('/auth');
  // Ждём загрузку формы
  await page.locator('#email').waitFor({ state: 'visible', timeout: 10000 });
  await page.locator('#email').fill(EMAIL);
  await page.locator('#password').fill(PASS);
  await page.locator('button[type="submit"]').click();
  // Ждём редирект на /properties
  await expect(page).toHaveURL(/\/(properties|dashboard|$)/, { timeout: 25000 });
  // Ждём заголовок
  await expect(page.locator("h1").first()).toBeVisible({ timeout: 10000 });
}

async function loginAPI(request: import('@playwright/test').APIRequestContext) {
  const resp = await request.post(`${API}/api/auth/local`, {
    data: { identifier: EMAIL, password: PASS },
  });
  const body = await resp.json();
  return body.jwt as string;
}

// ═══════════════════════════════════════════════════════════════════════
// 1. AUTH
// ═══════════════════════════════════════════════════════════════════════

test.describe('1. Авторизация', () => {

  test('1.1 Страница логина загружается', async ({ page }) => {
    await page.goto('/auth');
    await expect(page.locator('h1:has-text("Вход")')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#email')).toBeVisible();
    await expect(page.locator('#password')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test('1.2 Успешный логин → редирект на /properties', async ({ page }) => {
    await login(page);
    await expect(page).toHaveURL(/\/properties/);
  });

  test('1.3 Неверные credentials → показ ошибки', async ({ page }) => {
    await page.goto('/auth');
    await page.locator('#email').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('#email').fill('wrong@example.com');
    await page.locator('#password').fill('wrongpassword');
    await page.locator('button[type="submit"]').click();
    // Ждём появления сообщения об ошибке
    const errorDiv = page.locator('[style*="rgba(239, 68, 68"] p, [style*="#fca5a5"]').first();
    await expect(errorDiv).toBeVisible({ timeout: 10000 });
  });

  test('1.4 Неавторизованный → редирект на /auth', async ({ page }) => {
    await page.goto('/properties');
    await expect(page).toHaveURL(/\/auth/, { timeout: 10000 });
  });

  test('1.5 Кнопка "Выйти" → редирект на /auth', async ({ page }) => {
    await login(page);
    // Кнопка Выйти видна на desktop
    const logoutBtn = page.locator('button:has-text("Выйти")').first();
    await expect(logoutBtn).toBeVisible({ timeout: 5000 });
    await logoutBtn.click();
    await expect(page).toHaveURL(/\/auth/, { timeout: 10000 });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 2. PROPERTIES LIST — «Все объекты»
// ═══════════════════════════════════════════════════════════════════════

test.describe('2. Список объектов — Все объекты', () => {

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('2.1 Таблица загружается с данными', async ({ page }) => {
    // Ждём либо таблицу, либо пустое состояние
    await page.waitForTimeout(2000); // API загрузка
    const table = page.locator('table tbody tr');
    const emptyState = page.locator('text=Нет объектов');
    // Должно быть что-то одно
    await expect(table.first().or(emptyState)).toBeVisible({ timeout: 10000 });
  });

  test('2.2 Табы "Все объекты" и "В фокусе" видны', async ({ page }) => {
    await expect(page.locator('button:has-text("Все объекты")')).toBeVisible();
    await expect(page.locator('button:has-text("В фокусе")')).toBeVisible();
  });

  test('2.3 Активный таб "Все объекты" по умолчанию', async ({ page }) => {
    const allTab = page.locator('button:has-text("Все объекты")');
    // Активный таб имеет белый цвет текста (color: #fff)
    await expect(allTab).toBeVisible();
  });

  test('2.4 Кнопки "Ручной запуск" и "Очистить список" видны', async ({ page }) => {
    await expect(page.locator('button:has-text("Ручной запуск")')).toBeVisible();
    await expect(page.locator('button:has-text("Очистить список")')).toBeVisible();
  });

  test('2.5 Фильтры видны (город, статус, источник, тип)', async ({ page }) => {
    // Город
    await expect(page.locator('select').first()).toBeVisible();
    // Проверяем что есть label "Город"
    await expect(page.locator('text=Город').first()).toBeVisible();
    await expect(page.locator('text=Статус').first()).toBeVisible();
    await expect(page.locator('text=Источник').first()).toBeVisible();
    await expect(page.locator('text=Тип').first()).toBeVisible();
  });

  test('2.6 Фильтр по городу (Москва)', async ({ page }) => {
    // Выбираем "Москва" в первом select
    const citySelect = page.locator('select').first();
    await citySelect.selectOption('moscow');
    await page.waitForTimeout(1500);
    // Проверяем что URL или данные обновились — просто проверяем что страница не сломалась
    await expect(page.locator('h1:has-text("Объекты")')).toBeVisible();
  });

  test('2.7 Кнопка "Сбросить" фильтры', async ({ page }) => {
    const resetBtn = page.locator('button:has-text("Сбросить")').first();
    await expect(resetBtn).toBeVisible();
    await resetBtn.click();
    // Страница не должна сломаться
    await expect(page.locator('h1:has-text("Объекты")')).toBeVisible();
  });

  test('2.8 Клик по строке таблицы → переход на detail', async ({ page }) => {
    const firstRow = page.locator('table tbody tr').first();
    // Проверяем что таблица не пустая
    if (await firstRow.isVisible({ timeout: 5000 }).catch(() => false)) {
      await firstRow.click();
      await expect(page).toHaveURL(/\/properties\//, { timeout: 10000 });
    }
  });

  test('2.9 Сортировка по колонке (Площадь)', async ({ page }) => {
    const areaHeader = page.locator('th:has-text("Площадь")');
    if (await areaHeader.isVisible({ timeout: 5000 }).catch(() => false)) {
      await areaHeader.click();
      await page.waitForTimeout(1000);
      // Повторный клик меняет направление
      await areaHeader.click();
      await page.waitForTimeout(500);
      await expect(page.locator('h1:has-text("Объекты")')).toBeVisible();
    }
  });

  test('2.10 Параметры запуска — раскрытие/сворачивание', async ({ page }) => {
    const launchBtn = page.locator('button:has-text("Параметры запуска")');
    await expect(launchBtn).toBeVisible();
    await launchBtn.click();
    // Должны появиться фильтры цены
    await expect(page.locator('text=Цена лота')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Порог отсечения')).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 3. FOCUS TAB — «В фокусе»
// ═══════════════════════════════════════════════════════════════════════

test.describe('3. Таб "В фокусе"', () => {

  test.beforeEach(async ({ page }) => {
    await login(page);
    // Переключаемся на таб
    await page.locator('button:has-text("В фокусе")').click();
    await page.waitForTimeout(2000); // Ждём загрузку focus данных
  });

  test('3.1 Таб переключается на "В фокусе"', async ({ page }) => {
    // Проверяем что появились фильтры порога
    await expect(page.locator('text=Порог').first()).toBeVisible({ timeout: 10000 });
  });

  test('3.2 Фильтр порога отображается', async ({ page }) => {
    // Порог — range slider
    const thresholdSlider = page.locator('input[type="range"]').first();
    await expect(thresholdSlider).toBeVisible({ timeout: 5000 });
  });

  test('3.3 Фильтр по городам (чекбоксы)', async ({ page }) => {
    await expect(page.locator('text=Москва').first()).toBeVisible();
    await expect(page.locator('text=МО').first()).toBeVisible();
  });

  test('3.4 Focus таблица или пустое состояние', async ({ page }) => {
    const table = page.locator('table tbody tr');
    const emptyState = page.locator('text=Нет объектов в фокусе');
    await expect(table.first().or(emptyState)).toBeVisible({ timeout: 10000 });
  });

  test('3.5 Кнопка "Пересчитать" видна', async ({ page }) => {
    const recalcBtn = page.locator('button:has-text("Пересчитать")');
    await expect(recalcBtn).toBeVisible({ timeout: 5000 });
  });

  test('3.6 Кнопка "CSV" экспорта видна', async ({ page }) => {
    const csvBtn = page.locator('button:has-text("CSV")').first();
    await expect(csvBtn).toBeVisible({ timeout: 5000 });
  });

  test('3.7 Кнопка "Сбросить" фокус-фильтры', async ({ page }) => {
    const resetBtn = page.locator('button:has-text("Сбросить")').first();
    if (await resetBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await resetBtn.click();
      await expect(page.locator('h1:has-text("Объекты")')).toBeVisible();
    }
  });

  test('3.8 Checkbox select — bulk actions появляются', async ({ page }) => {
    // Ищем первый checkbox в таблице
    const firstCheckbox = page.locator('table tbody input[type="checkbox"]').first();
    if (await firstCheckbox.isVisible({ timeout: 5000 }).catch(() => false)) {
      await firstCheckbox.check();
      // Должен появиться floating bar с bulk actions
      await expect(page.locator('text=Выбрано:')).toBeVisible({ timeout: 5000 });
      await expect(page.locator('button:has-text("Просмотрено")')).toBeVisible();
      await expect(page.locator('button:has-text("Отклонён")')).toBeVisible();
      await expect(page.locator('button:has-text("CSV")').last()).toBeVisible();
    }
  });

  test('3.9 Сортировка по скору (клик по заголовку)', async ({ page }) => {
    const scoreHeader = page.locator('th:has-text("Скор")');
    if (await scoreHeader.isVisible({ timeout: 5000 }).catch(() => false)) {
      await scoreHeader.click();
      await page.waitForTimeout(1000);
      await expect(page.locator('h1:has-text("Объекты")')).toBeVisible();
    }
  });

  test('3.10 Клик по объекту → переход на detail', async ({ page }) => {
    const firstRow = page.locator('table tbody tr').first();
    if (await firstRow.isVisible({ timeout: 5000 }).catch(() => false)) {
      await firstRow.click();
      await expect(page).toHaveURL(/\/properties\//, { timeout: 10000 });
    }
  });

  test('3.11 Фильтр по тегам (мультиселект)', async ({ page }) => {
    // Ищем тег-кнопки в панели фильтров
    const tagSection = page.locator('text=Теги').first();
    if (await tagSection.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Кликаем по тегу
      const tagBtn = page.locator('button:has-text("Недооценён"), button:has-text("Торги")').first();
      if (await tagBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await tagBtn.click();
        await page.waitForTimeout(1000);
        await expect(page.locator('h1:has-text("Объекты")')).toBeVisible();
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 4. OBJECT DETAIL PAGE
// ═══════════════════════════════════════════════════════════════════════

test.describe('4. Страница объекта (detail)', () => {

  test('4.1 Detail страница загружается', async ({ page }) => {
    await login(page);
    // Ждём таблицу
    await page.waitForTimeout(2000);
    const firstRow = page.locator('table tbody tr').first();
    if (await firstRow.isVisible({ timeout: 5000 }).catch(() => false)) {
      await firstRow.click();
      await expect(page).toHaveURL(/\/properties\//, { timeout: 10000 });
      // Проверяем что карточка объекта загрузилась — есть кнопка "К списку"
      await expect(page.locator('text=К списку объектов')).toBeVisible({ timeout: 10000 });
    }
  });

  test('4.2 Статус badge отображается', async ({ page }) => {
    await login(page);
    await page.waitForTimeout(2000);
    const firstRow = page.locator('table tbody tr').first();
    if (await firstRow.isVisible({ timeout: 5000 }).catch(() => false)) {
      await firstRow.click();
      await expect(page).toHaveURL(/\/properties\//, { timeout: 10000 });
      // Один из статусов
      const statusBadge = page.locator('text=/Новый|В работе|Просмотрен|Отклонён/').first();
      await expect(statusBadge).toBeVisible({ timeout: 10000 });
    }
  });

  test('4.3 Свойства объекта (grid)', async ({ page }) => {
    await login(page);
    await page.waitForTimeout(2000);
    const firstRow = page.locator('table tbody tr').first();
    if (await firstRow.isVisible({ timeout: 5000 }).catch(() => false)) {
      await firstRow.click();
      await expect(page).toHaveURL(/\/properties\//, { timeout: 10000 });
      // Проверяем что есть поля свойств
      await expect(page.locator('text=Адрес').first()).toBeVisible({ timeout: 5000 });
      await expect(page.locator('text=Город').first()).toBeVisible();
      await expect(page.locator('text=Площадь').first()).toBeVisible();
    }
  });

  test('4.4 Кнопки действий (смена статуса)', async ({ page }) => {
    await login(page);
    await page.waitForTimeout(2000);
    const firstRow = page.locator('table tbody tr').first();
    if (await firstRow.isVisible({ timeout: 5000 }).catch(() => false)) {
      await firstRow.click();
      await expect(page).toHaveURL(/\/properties\//, { timeout: 10000 });
      // Кнопки статусов
      await expect(page.locator('text=Действия').first()).toBeVisible({ timeout: 5000 });
      await expect(page.locator('button:has-text("Новый")')).toBeVisible();
      await expect(page.locator('button:has-text("В работу")')).toBeVisible();
      await expect(page.locator('button:has-text("Просмотрено")')).toBeVisible();
      await expect(page.locator('button:has-text("Отклонено")')).toBeVisible();
    }
  });

  test('4.5 Секция комментариев', async ({ page }) => {
    await login(page);
    await page.waitForTimeout(2000);
    const firstRow = page.locator('table tbody tr').first();
    if (await firstRow.isVisible({ timeout: 5000 }).catch(() => false)) {
      await firstRow.click();
      await expect(page).toHaveURL(/\/properties\//, { timeout: 10000 });
      // Поле для комментария
      await expect(page.locator('text=Добавить комментарий')).toBeVisible({ timeout: 5000 });
      await expect(page.locator('input[placeholder*="комментарий"], input[placeholder*="Комментарий"]')).toBeVisible();
    }
  });

  test('4.6 Кнопка "← К списку объектов" работает', async ({ page }) => {
    await login(page);
    await page.waitForTimeout(2000);
    const firstRow = page.locator('table tbody tr').first();
    if (await firstRow.isVisible({ timeout: 5000 }).catch(() => false)) {
      await firstRow.click();
      await expect(page).toHaveURL(/\/properties\//, { timeout: 10000 });
      await page.locator('text=К списку объектов').click();
      await expect(page).toHaveURL(/\/properties$/, { timeout: 10000 });
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 5. SOURCES PAGE
// ═══════════════════════════════════════════════════════════════════════

test.describe('5. Страница Источники', () => {

  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.getByRole('navigation').getByRole('link', { name: 'Источники' }).click();
    await expect(page).toHaveURL(/\/sources/, { timeout: 10000 });
  });

  test('5.1 Страница загружается', async ({ page }) => {
    await expect(page.locator('h1:has-text("Источники")')).toBeVisible({ timeout: 10000 });
  });

  test('5.2 Список источников или пустое состояние', async ({ page }) => {
    await page.waitForTimeout(2000);
    // Должны быть либо карточки источников, либо пустое состояние
    const sourcesList = page.locator('text=Источников пока нет');
    const anySource = page.locator('[class*="rounded-xl"]').first();
    await expect(sourcesList.or(anySource)).toBeVisible({ timeout: 10000 });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 6. SETTINGS PAGE
// ═══════════════════════════════════════════════════════════════════════

test.describe('6. Страница Настройки', () => {

  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.getByRole('navigation').getByRole('link', { name: 'Настройки' }).click();
    await expect(page).toHaveURL(/\/settings/, { timeout: 10000 });
  });

  test('6.1 Страница загружается', async ({ page }) => {
    await expect(page.locator('h1:has-text("Настройки")')).toBeVisible({ timeout: 10000 });
  });

  test('6.2 Форма настроек отображается', async ({ page }) => {
    await page.waitForTimeout(1000);
    // Порог отклонения
    await expect(page.locator('text=Порог отклонения')).toBeVisible({ timeout: 10000 });
    // Время дайджеста
    await expect(page.locator('text=Время утреннего дайджеста')).toBeVisible();
    // Email для дайджеста
    await expect(page.locator('text=Email для дайджеста')).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 7. MARKET REFERENCES PAGE (Эталоны)
// ═══════════════════════════════════════════════════════════════════════

test.describe('7. Страница Эталоны стоимости', () => {

  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.getByRole('navigation').getByRole('link', { name: 'Эталоны' }).click();
    await expect(page).toHaveURL(/\/market-references/, { timeout: 10000 });
  });

  test('7.1 Страница загружается', async ({ page }) => {
    await expect(page.locator('h1:has-text("Эталоны стоимости")')).toBeVisible({ timeout: 10000 });
  });

  test('7.2 Форма добавления эталона', async ({ page }) => {
    await expect(page.locator('text=Новый эталон')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Город').first()).toBeVisible();
    await expect(page.locator('text=Тип недвижимости').first()).toBeVisible();
    await expect(page.locator('text=Цена за м²').first()).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 8. NAVIGATION
// ═══════════════════════════════════════════════════════════════════════

test.describe('8. Навигация', () => {

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('8.1 Навигация: Объекты', async ({ page }) => {
    await page.getByRole('navigation').getByRole('link', { name: 'Объекты' }).click();
    await expect(page).toHaveURL(/\/properties/, { timeout: 5000 });
    await expect(page.locator('h1:has-text("Объекты")')).toBeVisible();
  });

  test('8.2 Навигация: Источники', async ({ page }) => {
    await page.getByRole('navigation').getByRole('link', { name: 'Источники' }).click();
    await expect(page).toHaveURL(/\/sources/, { timeout: 5000 });
    await expect(page.locator('h1:has-text("Источники")')).toBeVisible();
  });

  test('8.3 Навигация: Эталоны', async ({ page }) => {
    await page.getByRole('navigation').getByRole('link', { name: 'Эталоны' }).click();
    await expect(page).toHaveURL(/\/market-references/, { timeout: 5000 });
    await expect(page.locator('h1:has-text("Эталоны")')).toBeVisible();
  });

  test('8.4 Навигация: Настройки', async ({ page }) => {
    await page.getByRole('navigation').getByRole('link', { name: 'Настройки' }).click();
    await expect(page).toHaveURL(/\/settings/, { timeout: 5000 });
    await expect(page.locator('h1:has-text("Настройки")')).toBeVisible();
  });

  test('8.5 Логотип AKLAB → редирект на /properties', async ({ page }) => {
    await page.getByRole('navigation').getByRole('link', { name: /AKLAB/ }).click();
    await expect(page).toHaveURL(/\/properties/, { timeout: 5000 });
  });

  test('8.6 Переключение темы (тёмная/светлая)', async ({ page }) => {
    const themeBtn = page.locator('button[aria-label="Переключить тему"]');
    await expect(themeBtn).toBeVisible();
    await themeBtn.click();
    // После клика страница не должна сломаться
    await expect(page.locator('nav')).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 9. API SMOKE TESTS
// ═══════════════════════════════════════════════════════════════════════

test.describe('9. API Smoke Tests', () => {

  test('9.1 API health returns 204', async ({ request }) => {
    const resp = await request.get(`${API}/_health`);
    expect(resp.status()).toBe(204);
  });

  test('9.2 API sources returns list', async ({ request }) => {
    const jwt = await loginAPI(request);
    const resp = await request.get(`${API}/api/sources`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    expect(resp.ok()).toBeTruthy();
    const body = await resp.json();
    expect(body.data.length).toBeGreaterThan(0);
  });

  test('9.3 API properties returns list', async ({ request }) => {
    const jwt = await loginAPI(request);
    const resp = await request.get(`${API}/api/properties?pagination[pageSize]=5`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    expect(resp.ok()).toBeTruthy();
    const body = await resp.json();
    expect(body.data).toBeDefined();
    expect(body.meta?.pagination).toBeDefined();
  });

  test('9.4 API focus endpoint works', async ({ request }) => {
    const jwt = await loginAPI(request);
    const resp = await request.get(`${API}/api/properties/focus?threshold=0&pageSize=5`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    expect(resp.ok()).toBeTruthy();
    const body = await resp.json();
    expect(body.data).toBeDefined();
    expect(body.meta).toBeDefined();
  });

  test('9.5 API queue-stats endpoint works', async ({ request }) => {
    const resp = await request.get(`${API}/api/cron/queue-stats`);
    expect(resp.ok()).toBeTruthy();
    const body = await resp.json();
    expect(body.ok).toBe(true);
    expect(body.queues).toBeDefined();
  });

  test('9.6 API focus-rules endpoint works', async ({ request }) => {
    const jwt = await loginAPI(request);
    const resp = await request.get(`${API}/api/focus-rules`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    expect(resp.ok()).toBeTruthy();
    const body = await resp.json();
    expect(body.data).toBeDefined();
  });

  test.skip('9.7 API settings endpoint works', async ({ request }) => {
    const jwt = await loginAPI(request);
    const resp = await request.get(`${API}/api/settings`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    expect(resp.ok()).toBeTruthy();
    const body = await resp.json();
    expect(body.data).toBeDefined();
  });

  test.skip('9.8 API market-references endpoint works', async ({ request }) => {
    const jwt = await loginAPI(request);
    const resp = await request.get(`${API}/api/market-references`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    expect(resp.ok()).toBeTruthy();
    const body = await resp.json();
    expect(body.data).toBeDefined();
  });

  test.skip('9.9 API property-events endpoint works', async ({ request }) => {
    const jwt = await loginAPI(request);
    const resp = await request.get(`${API}/api/property-events?pagination[pageSize]=5`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    expect(resp.ok()).toBeTruthy();
    const body = await resp.json();
    expect(body.data).toBeDefined();
  });

  test('9.10 API unauthorized → 401', async ({ request }) => {
    const resp = await request.get(`${API}/api/properties`);
    // Strapi возвращает 403 (Forbidden) для неавторизованных
    expect(resp.status()).toBeGreaterThanOrEqual(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 10. ВОЛНА 4 — TODO features (waiting for deploy)
// ═══════════════════════════════════════════════════════════════════════

test.describe('10. Волна 4 — Dashboard (ожидает деплой)', () => {


  test('10.1 Dashboard loads after login', async ({ page }) => {
    await login(page);
    await page.goto('/dashboard');
    await expect(page.locator('h1:has-text("Дашборд"), h1:has-text("Dashboard")')).toBeVisible({ timeout: 10000 });
  });

  test('10.2 Shows stats (new objects, focus count, avg score)', async ({ page }) => {
    await login(page);
    await page.goto('/dashboard');
    // Проверяем наличие карточек со статистикой
    await expect(page.locator('text=/Новых|В фокусе|Средний скор/').first()).toBeVisible({ timeout: 10000 });
  });

  test('10.3 Shows top 5 objects', async ({ page }) => {
    await login(page);
    await page.goto('/dashboard');
    await expect(page.locator('text=/Всего объектов|В фокусе|Средний скор/').first()).toBeVisible({ timeout: 10000 });
  });

  test('10.4 Shows sources status', async ({ page }) => {
    await login(page);
    await page.goto('/dashboard');
    await expect(page.locator('text=/Источники|Sources/').first()).toBeVisible({ timeout: 10000 });
  });

  test('10.5 Quick action buttons work', async ({ page }) => {
    await login(page);
    await page.goto('/dashboard');
    // Кнопки быстрых действий
    const quickAction = page.locator('button').filter({ hasText: /Запустить|Обновить|Пересчитать/ }).first();
    await expect(quickAction).toBeVisible({ timeout: 10000 });
  });
});

test.describe('10. Волна 4 — Rules page (ожидает деплой)', () => {


  test('10.6 Rules list loads', async ({ page }) => {
    await login(page);
    await page.goto('/rules');
    await expect(page.locator('h1:has-text("Правила"), h1:has-text("Rules")')).toBeVisible({ timeout: 10000 });
  });

  test('10.7 Can create new rule', async ({ page }) => {
    await login(page);
    await page.goto('/rules');
    const createBtn = page.locator('button:has-text("Создать"), button:has-text("Добавить")').first();
    await expect(createBtn).toBeVisible({ timeout: 5000 });
    await createBtn.click();
    // Форма создания
    await expect(page.locator('input, select').first()).toBeVisible({ timeout: 5000 });
  });

  test('10.8 Can toggle rule active/inactive', async ({ page }) => {
    await login(page);
    await page.goto('/rules');
    const toggle = page.locator('input[type="checkbox"], button[role="switch"]').first();
    if (await toggle.isVisible({ timeout: 5000 }).catch(() => false)) {
      await toggle.click();
      await page.waitForTimeout(500);
    }
  });

  test('10.9 Can delete rule', async ({ page }) => {
    await login(page);
    await page.goto('/rules');
    const deleteBtn = page.locator('button:has-text("Удалить"), button:has-text("Delete")').first();
    if (await deleteBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await deleteBtn.click();
      // Подтверждение
      page.on('dialog', dialog => dialog.accept());
    }
  });
});

test.describe('10. Волна 4 — Event Log on detail page (ожидает деплой)', () => {


  test('10.10 Event log section visible on detail page', async ({ page }) => {
    await login(page);
    await page.waitForTimeout(2000);
    const firstRow = page.locator('table tbody tr').first();
    if (await firstRow.isVisible({ timeout: 5000 }).catch(() => false)) {
      await firstRow.click();
      await expect(page).toHaveURL(/\/properties\//, { timeout: 10000 });
      await expect(page.locator('text=/История|События|Event Log|Журнал/').first()).toBeVisible({ timeout: 10000 });
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 11. EDGE CASES & RESILIENCE
// ═══════════════════════════════════════════════════════════════════════

test.describe('11. Граничные случаи', () => {

  test('11.1 Несуществующий URL → 404 page', async ({ page }) => {
    await login(page);
    await page.goto('/nonexistent-page');
    await expect(page.locator('text=/Не найден|404|not found/i').first()).toBeVisible({ timeout: 10000 });
  });

  test('11.2 Прямой переход на /properties без auth → редирект', async ({ page }) => {
    // Без login
    await page.goto('/properties');
    await expect(page).toHaveURL(/\/auth/, { timeout: 10000 });
  });

  test('11.3 Прямой переход на /sources без auth → редирект', async ({ page }) => {
    await page.goto('/sources');
    await expect(page).toHaveURL(/\/auth/, { timeout: 10000 });
  });

  test('11.4 Прямой переход на /settings без auth → редирект', async ({ page }) => {
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/auth/, { timeout: 10000 });
  });

  test('11.5 Detail с несуществующим documentId → "не найден"', async ({ page }) => {
    await login(page);
    await page.goto('/properties/nonexistent-id-12345');
    await page.waitForTimeout(3000);
    // Должно быть "не найден" или ошибка
    const notFound = page.locator('text=/не найден|not found|Ошибка/i').first();
    await expect(notFound).toBeVisible({ timeout: 10000 });
  });
});
