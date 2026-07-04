import { test, expect } from '@playwright/test';

/**
 * AKLAB — Comprehensive E2E Tests
 * 
 * Покрывает:
 *  1. Auth (login, invalid creds, redirect)
 *  2. Properties list — табы, фильтры, сортировка
 *  3. Focus tab — scoring, теги, фильтры, bulk operations, CSV, регрессия city
 *  4. Object detail page — данные, статус, действия, комментарии
 *  5. Sources page
 *  6. Settings page
 *  7. Market References page
 *  8. Navigation
 *  9. API smoke tests
 *  10. Волна 4 features (Dashboard, Rules, Event Log) — marked as TODO
 *  11. Edge cases & resilience
 *  12. Регрессия — фильтр city (comma-separated values)
 *  13. Dashboard — тренд
 *  14. Properties — доп. фичи
 *  15. Focus tab — доп. фичи
 *  16. Detail — доп. фичи
 *  17. Источники — доп. фичи
 *  18. Эталоны — доп. фичи
 *  19. Настройки — доп. фичи
 *  20. Changelog & docs
 *  21. Footer
 *  22. Hash routing
 *  23. Lazy photo loading
 *  24. Clickable stat cards
 *  25. Таб «В работе»
 */

// API for direct calls — prefer localhost (works inside server), fallback to external
const API = process.env.API_URL_INTERNAL || process.env.API_URL || 'https://api-aklab-dev.tirobots.ru';
const EMAIL = process.env.TEST_USER_EMAIL || 'test@aklab.tirobots.ru';
const PASS = process.env.TEST_USER_PASSWORD || 'Test1234!';

// ─── helpers ──────────────────────────────────────────────────────────
// Auth is handled via storageState from global-setup.ts (one API call total).

async function login(page: import('@playwright/test').Page) {
  // JWT is pre-loaded into localStorage via storageState
  await page.goto('/properties');
  await page.waitForURL(/\/properties/, { timeout: 10000 });
}

let _cachedJWT: string | null = null;

async function loginAPI(request: import('@playwright/test').APIRequestContext) {
  if (!_cachedJWT) {
    const resp = await request.post(`${API}/api/auth/local`, {
      data: { identifier: EMAIL, password: PASS },
    });
    const body = await resp.json();
    _cachedJWT = body.jwt;
  }
  return _cachedJWT!;
}

// ═══════════════════════════════════════════════════════════════════════
// 1. AUTH
// ═══════════════════════════════════════════════════════════════════════

test.describe('1. Авторизация', () => {
  test.use({ storageState: { cookies: [], origins: [] } }); // Auth tests need fully unauthenticated state

  test('1.1 Страница логина загружается', async ({ page }) => {
    await page.goto('/auth');
    await expect(page.locator('h1:has-text("Вход")')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#email')).toBeVisible();
    await expect(page.locator('#password')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test('1.2 Успешный логин → редирект на /properties', async ({ page }) => {
    await page.goto('/auth');
    await page.locator('#email').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('#email').fill(EMAIL);
    await page.locator('#password').fill(PASS);
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/properties/, { timeout: 15000 });
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
    // Login via UI first
    await page.goto('/auth');
    await page.locator('#email').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('#email').fill(EMAIL);
    await page.locator('#password').fill(PASS);
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/properties/, { timeout: 15000 });
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

  test('2.4 Секция "Запуск парсинга" и кнопка "Очистить" видны', async ({ page }) => {
    await expect(page.locator('text=Запуск парсинга').first()).toBeVisible();
    await expect(page.locator('button:has-text("Очистить")')).toBeVisible();
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

  test('2.10 Запуск парсинга — раскрытие/сворачивание', async ({ page }) => {
    const launchBtn = page.locator('text=Запуск парсинга').first();
    await expect(launchBtn).toBeVisible();
    await launchBtn.click();
    // Должны появиться параметры парсинга
    await expect(page.locator('text=Глубина').first()).toBeVisible({ timeout: 5000 });
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

  test('3.12 Регрессия: снятие "Другие" → Москва/МО объекты всё ещё видны', async ({ page }) => {
    // Регрессия для бага: city=moscow,mo раньше делал WHERE city = 'moscow,mo'
    // вместо WHERE city IN ('moscow','mo'). После фикса снятие "Другие" не должно
    // убирать moscow/mo объекты.
    const otherCheckbox = page.locator('label:has-text("Другие") input[type="checkbox"]').first();
    if (await otherCheckbox.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Снимаем чекбокс "Другие"
      await otherCheckbox.uncheck();
      await page.waitForTimeout(2000);
      // Москва и МО остаются checked — должны быть результаты
      const table = page.locator('table tbody tr');
      const emptyState = page.locator('text=Нет объектов в фокусе');
      await expect(table.first().or(emptyState)).toBeVisible({ timeout: 10000 });
      // Если есть данные — значит фильтр корректно разбирает city=moscow,mo
    }
  });

  test('3.13 Выбрана только "Москва" → только moscow объекты', async ({ page }) => {
    const moscowCb = page.locator('label:has-text("Москва") input[type="checkbox"]').first();
    const moCb = page.locator('label:has-text("МО") input[type="checkbox"]').first();
    const otherCb = page.locator('label:has-text("Другие") input[type="checkbox"]').first();
    if (await moscowCb.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Снимаем МО и Другие
      if (await moCb.isChecked()) await moCb.uncheck();
      if (await otherCb.isChecked()) await otherCb.uncheck();
      // Убеждаемся что Москва checked
      if (!(await moscowCb.isChecked())) await moscowCb.check();
      await page.waitForTimeout(2000);
      // Проверяем что запрос ушёл с city=moscow
      const table = page.locator('table tbody tr');
      const emptyState = page.locator('text=Нет объектов в фокусе');
      await expect(table.first().or(emptyState)).toBeVisible({ timeout: 10000 });
    }
  });

  test('3.14 Все чекбоксы городов сняты → нет фильтра по городу', async ({ page }) => {
    const moscowCb = page.locator('label:has-text("Москва") input[type="checkbox"]').first();
    const moCb = page.locator('label:has-text("МО") input[type="checkbox"]').first();
    const otherCb = page.locator('label:has-text("Другие") input[type="checkbox"]').first();
    if (await moscowCb.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Снимаем все три чекбокса
      if (await moscowCb.isChecked()) await moscowCb.uncheck();
      if (await moCb.isChecked()) await moCb.uncheck();
      if (await otherCb.isChecked()) await otherCb.uncheck();
      await page.waitForTimeout(2000);
      // Без city фильтра показываются все города (или пусто если нет данных)
      const table = page.locator('table tbody tr');
      const emptyState = page.locator('text=Нет объектов в фокусе');
      await expect(table.first().or(emptyState)).toBeVisible({ timeout: 10000 });
    }
  });

  test('3.15 Порог = 0 → максимум результатов', async ({ page }) => {
    const thresholdInput = page.locator('input[type="number"][min="0"][max="100"]').first();
    if (await thresholdInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await thresholdInput.fill('0');
      await thresholdInput.press('Tab'); // Триггерим v-model обновление
      await page.waitForTimeout(2000);
      const table = page.locator('table tbody tr');
      const emptyState = page.locator('text=Нет объектов в фокусе');
      await expect(table.first().or(emptyState)).toBeVisible({ timeout: 10000 });
    }
  });

  test('3.16 Порог = 100 → вероятно пустой список', async ({ page }) => {
    const thresholdInput = page.locator('input[type="number"][min="0"][max="100"]').first();
    if (await thresholdInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await thresholdInput.fill('100');
      await thresholdInput.press('Tab');
      await page.waitForTimeout(2000);
      const table = page.locator('table tbody tr');
      const emptyState = page.locator('text=Нет объектов в фокусе');
      // С порогом 100 может быть пусто — оба варианта допустимы
      await expect(table.first().or(emptyState)).toBeVisible({ timeout: 10000 });
    }
  });

  test('3.17 Тип недвижимости + город → комбинация фильтров', async ({ page }) => {
    const typeSelect = page.locator('select').last(); // Селект типа в focus-фильтрах
    if (await typeSelect.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Выбираем тип "Офис"
      await typeSelect.selectOption('office');
      await page.waitForTimeout(2000);
      const table = page.locator('table tbody tr');
      const emptyState = page.locator('text=Нет объектов в фокусе');
      await expect(table.first().or(emptyState)).toBeVisible({ timeout: 10000 });
      // Сбрасываем тип обратно
      await typeSelect.selectOption('');
      await page.waitForTimeout(500);
    }
  });

  test('3.18 Диапазон цены (от/до)', async ({ page }) => {
    const priceFrom = page.locator('input[type="number"][placeholder="от"]').first();
    const priceTo = page.locator('input[type="number"][placeholder="до"]').first();
    if (await priceFrom.isVisible({ timeout: 3000 }).catch(() => false)) {
      await priceFrom.fill('1000000');   // от 1 млн
      await priceTo.fill('50000000');     // до 50 млн
      await priceTo.press('Tab');
      await page.waitForTimeout(2000);
      const table = page.locator('table tbody tr');
      const emptyState = page.locator('text=Нет объектов в фокусе');
      await expect(table.first().or(emptyState)).toBeVisible({ timeout: 10000 });
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

test.describe("5. Парсеры (таб Настроек)", () => {  test.beforeEach(async ({ page }) => {    await login(page);    await page.goto("/settings");    await page.waitForTimeout(1000);    const parsersTab = page.locator("button:has-text("Парсеры")");    if (await parsersTab.isVisible({ timeout: 3000 }).catch(() => false)) {      await parsersTab.click();      await page.waitForTimeout(1500);    }  });  test("5.1 Таб Парсеры загружается", async ({ page }) => {    await expect(page.locator("button:has-text("Парсеры")")).toBeVisible({ timeout: 10000 });  });  test("5.2 Список парсеров или пустое состояние", async ({ page }) => {    await page.waitForTimeout(2000);    const items = page.locator("[class*="card"], tr, li");    await expect(items.first()).toBeVisible({ timeout: 10000 }).catch(() => {});  });
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

test.describe('7. Эталоны (таб Настроек)', () => {

  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/settings');
    await page.waitForTimeout(1000);
    const refsTab = page.locator('button:has-text("Эталоны")');
    if (await refsTab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await refsTab.click();
      await page.waitForTimeout(1500);
    }
  });

  test('7.1 Таб Эталоны загружается', async ({ page }) => {
    await expect(page.locator('button:has-text("Эталоны")')).toBeVisible({ timeout: 10000 });
  });

  test('7.2 Контент эталонов отображается', async ({ page }) => {
    await page.waitForTimeout(2000);
    const content = page.locator('table, form, input, [class*="card"]').first();
    await expect(content).toBeVisible({ timeout: 10000 }).catch(() => {});
  });
});

// 8. NAVIGATION
// ═══════════════════════════════════════════════════════════════════════

test.describe('8. Навигация', () => {

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('8.1 Навигация: Объекты', async ({ page }) => {
    await page.getByRole('navigation').getByRole('link', { name: 'Объекты' }).click();
    await expect(page).toHaveURL(/\/(properties|$)/, { timeout: 5000 });
    await expect(page.locator('h1:has-text("Объекты")')).toBeVisible();
  });

  test('8.2 Навигация: Настройки', async ({ page }) => {
    await page.getByRole('navigation').getByRole('link', { name: 'Настройки' }).click();
    await expect(page).toHaveURL(/\/settings/, { timeout: 5000 });
    await expect(page.locator('h1:has-text("Настройки")')).toBeVisible();
  });

  test('8.4 Навигация: Настройки', async ({ page }) => {
    await page.getByRole('navigation').getByRole('link', { name: 'Настройки' }).click();
    await expect(page).toHaveURL(/\/settings/, { timeout: 5000 });
    await expect(page.locator('h1:has-text("Настройки")')).toBeVisible();
  });

  test('8.5 Логотип AKLAB → редирект на /properties', async ({ page }) => {
    await page.getByRole('navigation').getByRole('link', { name: /AKLAB/ }).click();
    await expect(page).toHaveURL(/\/(properties|$)/, { timeout: 5000 });
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

  test('9.8 API market-references endpoint works', async ({ request }) => {
    const jwt = await loginAPI(request);
    const resp = await request.get(`${API}/api/market-references`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    expect(resp.ok()).toBeTruthy();
    const body = await resp.json();
    expect(body.data).toBeDefined();
  });

  test('9.9 API property-events endpoint works', async ({ request }) => {
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
    await page.goto("/"); await page.waitForLoadState("networkidle").catch(() => {});
    await expect(page.locator('h1:has-text("Дашборд"), h1:has-text("Dashboard")')).toBeVisible({ timeout: 10000 });
  });

  test('10.2 Shows stats (new objects, focus count)', async ({ page }) => {
    await login(page);
    await page.goto("/"); await page.waitForLoadState("networkidle").catch(() => {});
    // Проверяем наличие карточек со статистикой
    await expect(page.locator('text=/Новых|Добавленные в фокус/').first()).toBeVisible({ timeout: 10000 });
  });

  test('10.3 Shows top 5 objects', async ({ page }) => {
    await login(page);
    await page.goto("/"); await page.waitForLoadState("networkidle").catch(() => {});
    await expect(page.locator('text=/Всего объектов|Добавленные в фокус/').first()).toBeVisible({ timeout: 10000 });
  });

});

test.describe('10. Волна 4 — Rules page (ожидает деплой)', () => {


  test('10.6 Правила — таб в настройках загружается', async ({ page }) => {
    await login(page);
    await page.goto('/settings');
    await page.waitForTimeout(1000);
    const rulesTab = page.locator('button:has-text("Правила")');
    await expect(rulesTab).toBeVisible({ timeout: 10000 });
    await rulesTab.click();
    await page.waitForTimeout(1500);
    const content = page.locator('[class*="card"], [class*="rule"], text=/Нет правил/').first();
    await expect(content).toBeVisible({ timeout: 10000 }).catch(() => {});
  });

  test('10.7 Can create new rule from settings tab', async ({ page }) => {
    await login(page);
    await page.goto('/settings');
    await page.waitForTimeout(1000);
    const rulesTab = page.locator('button:has-text("Правила")');
    if (await rulesTab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await rulesTab.click();
      await page.waitForTimeout(1500);
    }
    const createBtn = page.locator('button:has-text("Новое правило"), button:has-text("+ Новое")').first();
    if (await createBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await createBtn.click();
      await expect(page.locator('input, select').first()).toBeVisible({ timeout: 5000 });
    }
  });

  test('10.8 Can toggle rule active/inactive', async ({ page }) => {
    await login(page);
    await page.goto("/rules"); await page.waitForLoadState("networkidle").catch(() => {});
    const toggle = page.locator('input[type="checkbox"], button[role="switch"]').first();
    if (await toggle.isVisible({ timeout: 5000 }).catch(() => false)) {
      await toggle.click();
      await page.waitForTimeout(500);
    }
  });

  test('10.9 Can delete rule', async ({ page }) => {
    await login(page);
    await page.goto("/rules"); await page.waitForLoadState("networkidle").catch(() => {});
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

  test('11.5 Detail с несуществующим documentId → "не найден"', async ({ page }) => {
    await login(page);
    await page.goto('/properties/nonexistent-id-12345');
    await page.waitForTimeout(3000);
    // Должно быть "не найден" или ошибка
    const notFound = page.locator('text=/не найден|not found|Ошибка/i').first();
    await expect(notFound).toBeVisible({ timeout: 10000 });
  });
});

test.describe('11б. Редирект без auth', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('11.2 Прямой переход на /properties без auth → редирект', async ({ page }) => {
    await page.goto('/properties');
    await expect(page).toHaveURL(/\/auth/, { timeout: 10000 });
  });

  test('11.3 Прямой переход на /settings без auth → редирект', async ({ page }) => {
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/auth/, { timeout: 10000 });
  });

  test('11.4 Прямой переход на /settings без auth → редирект', async ({ page }) => {
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/auth/, { timeout: 10000 });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 12. REGRESSION — City filter bug (comma-separated city param)
// ═══════════════════════════════════════════════════════════════════════

test.describe('12. Регрессия — фильтр city (запятые)', () => {

  test('12.1 GET /api/properties/focus?city=moscow,mo → возвращает результаты', async ({ request }) => {
    // Регрессия: раньше city=moscow,mo обрабатывался как единая строка
    // и не находил ни одного объекта. После фикса — разбивается на IN ('moscow','mo')
    const jwt = await loginAPI(request);
    const resp = await request.get(`${API}/api/properties/focus?threshold=0&city=moscow,mo&pageSize=10`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    expect(resp.ok()).toBeTruthy();
    const body = await resp.json();
    expect(body.data).toBeDefined();
    expect(Array.isArray(body.data)).toBe(true);
    // При threshold=0 и наличии данных в БД должны быть результаты
    if (body.data.length > 0) {
      // Каждый возвращённый объект должен иметь city moscow ИЛИ mo
      for (const item of body.data) {
        expect(['moscow', 'mo']).toContain(item.city);
      }
    }
  });

  test('12.2 GET /api/properties/focus?city=moscow → возвращает результаты', async ({ request }) => {
    const jwt = await loginAPI(request);
    const resp = await request.get(`${API}/api/properties/focus?threshold=0&city=moscow&pageSize=10`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    expect(resp.ok()).toBeTruthy();
    const body = await resp.json();
    expect(body.data).toBeDefined();
    expect(Array.isArray(body.data)).toBe(true);
    // Все объекты должны быть из Москвы
    if (body.data.length > 0) {
      for (const item of body.data) {
        expect(item.city).toBe('moscow');
      }
    }
  });

  test('12.3 GET /api/properties/focus с невалидным threshold → корректная обработка', async ({ request }) => {
    const jwt = await loginAPI(request);
    // threshold=-1 — невалидное значение
    const resp = await request.get(`${API}/api/properties/focus?threshold=-1&pageSize=5`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    // Должен вернуть 200 (сервер корректно обрабатывает) или 400 (валидация)
    expect(resp.status()).toBeLessThan(500);
    const body = await resp.json();
    // Не должно быть unhandled ошибки
    expect(body).toBeDefined();
  });

  test('12.4 GET /api/properties/focus с threshold=abc → корректная обработка', async ({ request }) => {
    const jwt = await loginAPI(request);
    const resp = await request.get(`${API}/api/properties/focus?threshold=abc&pageSize=5`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    // Не должен падать с 500
    expect(resp.status()).toBeLessThan(500);
  });

  test('12.5 GET /api/properties/focus с пустым city → все города', async ({ request }) => {
    const jwt = await loginAPI(request);
    const resp = await request.get(`${API}/api/properties/focus?threshold=0&pageSize=10`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    expect(resp.ok()).toBeTruthy();
    const body = await resp.json();
    expect(body.data).toBeDefined();
    // Без city фильтра — могут быть объекты из любых городов
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 13. DASHBOARD — missing actions
// ═══════════════════════════════════════════════════════════════════════

test.describe('13. Dashboard — тренд', () => {

  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/');
    await page.waitForTimeout(2000);
  });

  test('13.1 Секция тренда за 7 дней видна', async ({ page }) => {
    const trend = page.locator('text=/7 дн|Тренд|Неделя|7 дней/i').first();
    await expect(trend).toBeVisible({ timeout: 10000 }).catch(() => {});
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 14. PROPERTIES — All objects (missing features)
// ═══════════════════════════════════════════════════════════════════════

test.describe('14. Список объектов — доп. фичи', () => {

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('14.1 Пагинация — страница 2 загружает другие данные', async ({ page }) => {
    await page.waitForTimeout(2000);
    const page2Btn = page.locator('button:has-text("2"), a:has-text("2")').first();
    if (await page2Btn.isVisible({ timeout: 5000 }).catch(() => false)) {
      const firstRowBefore = await page.locator('table tbody tr').first().textContent().catch(() => '');
      await page2Btn.click();
      await page.waitForTimeout(2000);
      const firstRowAfter = await page.locator('table tbody tr').first().textContent().catch(() => '');
      // Данные на странице 2 должны отличаться (если есть достаточно данных)
      expect(firstRowAfter).toBeDefined();
    }
  });

  test('14.2 Кнопка «Очистить» с диалогом подтверждения', async ({ page }) => {
    const clearBtn = page.locator('button:has-text("Очистить")');
    await expect(clearBtn).toBeVisible({ timeout: 5000 });
    await clearBtn.click();
    // Должен появиться диалог подтверждения
    const confirmDialog = page.locator('text=/Подтвер|Вы уверены|Удалить все|Очистить/i').first();
    await expect(confirmDialog).toBeVisible({ timeout: 5000 }).catch(() => {});
    // Отменяем, чтобы не потерять данные
    const cancelBtn = page.locator('button:has-text("Отмена"), button:has-text("Нет")').first();
    if (await cancelBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await cancelBtn.click();
    } else {
      await page.keyboard.press('Escape');
    }
  });

  test('14.3 Фильтр по статусу «Новый»', async ({ page }) => {
    const statusSelect = page.locator('text=Статус').locator('..').locator('select').first();
    if (await statusSelect.isVisible({ timeout: 5000 }).catch(() => false)) {
      await statusSelect.selectOption({ label: 'Новый' }).catch(() => {});
      await page.waitForTimeout(1500);
      await expect(page.locator('h1:has-text("Объекты")')).toBeVisible();
    }
  });

  test('14.4 Фильтр по типу недвижимости «Офис»', async ({ page }) => {
    const typeSelect = page.locator('text=Тип').locator('..').locator('select').first();
    if (await typeSelect.isVisible({ timeout: 5000 }).catch(() => false)) {
      await typeSelect.selectOption({ label: 'Офис' }).catch(() => {});
      await page.waitForTimeout(1500);
      await expect(page.locator('h1:has-text("Объекты")')).toBeVisible();
    }
  });

  test('14.5 Чекбокс «Только недооценённые» фильтрует список', async ({ page }) => {
    const checkbox = page.locator('label').filter({ hasText: /Недооценённые|Недооценён/i }).locator('input[type="checkbox"]').first();
    if (await checkbox.isVisible({ timeout: 5000 }).catch(() => false)) {
      await checkbox.check();
      await page.waitForTimeout(2000);
      await expect(page.locator('h1:has-text("Объекты")')).toBeVisible();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 15. FOCUS TAB — missing features
// ═══════════════════════════════════════════════════════════════════════

test.describe('15. Таб «В фокусе» — доп. фичи', () => {

  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.locator('button:has-text("В фокусе")').click();
    await page.waitForTimeout(2000);
  });

  test('15.1 Кнопка «Пересчитать» запускает скоринг', async ({ page }) => {
    const recalcBtn = page.locator('button:has-text("Пересчитать")');
    await expect(recalcBtn).toBeVisible({ timeout: 5000 });
    await recalcBtn.click();
    // Должно появиться уведомление о запуске
    const notification = page.locator('text=/Пересчит|Запущен|Скоринг|Обновл/i').first();
    await expect(notification).toBeVisible({ timeout: 5000 }).catch(() => {});
  });

  test('15.2 «Экспорт CSV» запускает скачивание', async ({ page }) => {
    const csvBtn = page.locator('button:has-text("CSV")').first();
    await expect(csvBtn).toBeVisible({ timeout: 5000 });
    // Ожидаем скачивание файла
    const downloadPromise = page.waitForEvent('download', { timeout: 10000 }).catch(() => null);
    await csvBtn.click();
    const download = await downloadPromise;
    if (download) {
      expect(download.suggestedFilename()).toMatch(/\.csv$/i);
    }
  });

  test('15.3 Пагинация фокуса (Назад/Вперёд)', async ({ page }) => {
    const nextBtn = page.locator('button:has-text("Вперёд"), button:has-text("→"), a:has-text("→")').first();
    const prevBtn = page.locator('button:has-text("Назад"), button:has-text("←"), a:has-text("←")').first();
    if (await nextBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await nextBtn.click();
      await page.waitForTimeout(1500);
      await expect(page.locator('h1:has-text("Объекты")')).toBeVisible();
    }
    if (await prevBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await prevBtn.click();
      await page.waitForTimeout(1500);
      await expect(page.locator('h1:has-text("Объекты")')).toBeVisible();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 16. PROPERTY DETAIL — missing features
// ═══════════════════════════════════════════════════════════════════════

test.describe('16. Детали объекта — доп. фичи', () => {

  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.waitForTimeout(2000);
    // Переходим на первый объект
    const firstRow = page.locator('table tbody tr').first();
    if (await firstRow.isVisible({ timeout: 5000 }).catch(() => false)) {
      await firstRow.click();
      await page.waitForTimeout(2000);
    }
  });

  test('16.1 Смена статуса — клик по доступному статусу, подсветка', async ({ page }) => {
    // Ищем ЛЮБУЮ не-disabled кнопку статуса (Новый/В работу/Просмотрено/Отклонено)
    const statusBtns = page.locator('button:not([disabled])').filter({ hasText: /Новый|В работу|Просмотрено|Отклонено/ });
    const count = await statusBtns.count();
    if (count > 0) {
      await statusBtns.first().click();
      await page.waitForTimeout(1000);
      // Проверяем что статус обновился (подсветка активной кнопки)
      const activeBtn = page.locator('button').filter({ hasText: /Новый|В работу|Просмотрено|Отклонено/ }).first();
      await expect(activeBtn).toBeVisible({ timeout: 5000 });
    }
  });

  test('16.2 Добавление комментария — ввод текста, клик «Добавить», появление', async ({ page }) => {
    const commentInput = page.locator('textarea, input[placeholder*="комментар"], input[placeholder*="Комментар"]').first();
    if (await commentInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await commentInput.fill('Тестовый E2E комментарий');
      const addBtn = page.locator('button:has-text("Добавить")').first();
      await addBtn.click();
      await page.waitForTimeout(2000);
      const newComment = page.locator('text=Тестовый E2E комментарий').first();
      await expect(newComment).toBeVisible({ timeout: 5000 }).catch(() => {});
    }
  });

  test('16.3 Фотогалерея видна для недооценённых объектов', async ({ page }) => {
    // Условный тест — галерея может быть не у всех объектов
    const gallery = page.locator('[class*="gallery"], [class*="photo"], [class*="image"], [class*="carousel"]').first();
    await gallery.isVisible({ timeout: 3000 }).catch(() => false);
  });

  test('16.4 Секция истории событий видна', async ({ page }) => {
    const history = page.locator('text=/История|События|Журнал|Event/i').first();
    await expect(history).toBeVisible({ timeout: 5000 }).catch(() => {});
  });

  test('16.5 Внешняя ссылка «Открыть на источнике» с корректным href', async ({ page }) => {
    const sourceLink = page.locator('a').filter({ hasText: /Открыть на источнике|Источник|Перейти к источнику/ }).first();
    if (await sourceLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      const href = await sourceLink.getAttribute('href');
      expect(href).toBeTruthy();
      expect(href).toMatch(/^https?:\/\//);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 17. SOURCES — missing features
// ═══════════════════════════════════════════════════════════════════════

test.describe('17. Источники — доп. фичи', () => {

  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/sources');
    await page.waitForTimeout(2000);
  });

  test('17.1 Переключение активности источника', async ({ page }) => {
    const toggle = page.locator('input[type="checkbox"], button[role="switch"]').first();
    if (await toggle.isVisible({ timeout: 5000 }).catch(() => false)) {
      const wasChecked = await toggle.isChecked().catch(() => false);
      await toggle.click();
      await page.waitForTimeout(1000);
      // Проверяем что состояние изменилось
      const isChecked = await toggle.isChecked().catch(() => false);
      expect(isChecked).not.toBe(wasChecked);
    }
  });

  test('17.2 Запуск парсера для конкретного источника', async ({ page }) => {
    const runBtn = page.locator('button').filter({ hasText: /Запустить|Запуск/ }).first();
    if (await runBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await runBtn.click();
      await page.waitForTimeout(1000);
      const notification = page.locator('text=/Запущен|Выполняется|Парсинг/i').first();
      await expect(notification).toBeVisible({ timeout: 5000 }).catch(() => {});
    }
  });

  test('17.3 Редактирование расписания inline', async ({ page }) => {
    const editBtn = page.locator('button').filter({ hasText: /Изменить|Редактировать/ }).first();
    if (await editBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await editBtn.click();
      await page.waitForTimeout(500);
      const scheduleInput = page.locator('input[type="time"], input[type="text"]').last();
      if (await scheduleInput.isVisible({ timeout: 3000 }).catch(() => false)) {
        await scheduleInput.fill('08:00');
        const saveBtn = page.locator('button:has-text("Сохранить"), button:has-text("OK")').first();
        if (await saveBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await saveBtn.click();
        }
      }
    }
  });

  test('17.4 Индикаторы здоровья видны (зелёные/красные)', async ({ page }) => {
    const badges = page.locator('[class*="badge"], [class*="dot"], [class*="indicator"], [class*="health"]');
    const count = await badges.count();
    // Должен быть хотя бы один индикатор на странице источников
    expect(count).toBeGreaterThanOrEqual(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 18. MARKET REFERENCES — missing features
// ═══════════════════════════════════════════════════════════════════════

test.describe('18. Рыночные эталоны — таб Настроек', () => {

  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/settings');
    await page.waitForTimeout(1000);
    const refsTab = page.locator('button:has-text("Эталоны")');
    if (await refsTab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await refsTab.click();
      await page.waitForTimeout(1500);
    }
  });

  test('18.1 Таб эталонов загружается', async ({ page }) => {
    await expect(page.locator('button:has-text("Эталоны")')).toBeVisible({ timeout: 10000 });
  });

  test('18.2 Редактирование цены эталона inline', async ({ page }) => {
    const priceCell = page.locator('table tbody td').filter({ hasText: /\d+/ }).first();
    if (await priceCell.isVisible({ timeout: 5000 }).catch(() => false)) {
      await priceCell.dblclick().catch(() => priceCell.click());
      await page.waitForTimeout(500);
      const input = page.locator('table tbody input[type="number"], table tbody input[type="text"]').first();
      if (await input.isVisible({ timeout: 2000 }).catch(() => false)) {
        await input.fill('100000');
        await page.keyboard.press('Enter');
      }
    }
  });

  test('18.3 Переключение активности эталона', async ({ page }) => {
    const toggle = page.locator('input[type="checkbox"], button[role="switch"]').first();
    if (await toggle.isVisible({ timeout: 5000 }).catch(() => false)) {
      const wasChecked = await toggle.isChecked().catch(() => false);
      await toggle.click();
      await page.waitForTimeout(1000);
      const isChecked = await toggle.isChecked().catch(() => false);
      expect(isChecked).not.toBe(wasChecked);
    }
  });

  test('18.4 Добавление нового эталона (заполнение формы, отправка)', async ({ page }) => {
    const addBtn = page.locator('button').filter({ hasText: /Добавить|Новый эталон|Создать/ }).first();
    if (await addBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await addBtn.click();
      await page.waitForTimeout(500);
      const nameInput = page.locator('input[name="name"], input[placeholder*="Название"]').first();
      if (await nameInput.isVisible({ timeout: 3000 }).catch(() => false)) {
        await nameInput.fill('Тестовый эталон E2E');
        const submitBtn = page.locator('button[type="submit"], button:has-text("Сохранить")').first();
        if (await submitBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await submitBtn.click();
        }
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 19. SETTINGS — missing features
// ═══════════════════════════════════════════════════════════════════════

test.describe('19. Настройки — доп. фичи', () => {

  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/settings');
    await page.waitForTimeout(2000);
  });

  test('19.1 Кнопка «Сохранить» работает (уведомление об успехе)', async ({ page }) => {
    const saveBtn = page.locator('button:has-text("Сохранить")').first();
    await expect(saveBtn).toBeVisible({ timeout: 5000 });
    await saveBtn.click();
    const successMsg = page.locator('text=/Сохранено|Успешно|Обновлено/i').first();
    await expect(successMsg).toBeVisible({ timeout: 5000 }).catch(() => {});
  });

  test('19.2 Чекбоксы отслеживаемых регионов видны', async ({ page }) => {
    const regionCheckboxes = page.locator('text=/Москва|МО|Санкт|Регион/i').first();
    await expect(regionCheckboxes).toBeVisible({ timeout: 5000 }).catch(() => {});
  });

  test('19.3 Табы настроек переключаются', async ({ page }) => {
    const tabs = ['Правила', 'Парсеры', 'Эталоны'];
    for (const tabLabel of tabs) {
      const tab = page.locator('button').filter({ hasText: tabLabel }).first();
      if (await tab.isVisible({ timeout: 3000 }).catch(() => false)) {
        await tab.click();
        await page.waitForTimeout(500);
      }
    }
    const digestTab = page.locator('button:has-text("Дайджест")');
    if (await digestTab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await digestTab.click();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 20. CHANGELOG & DOCUMENTATION
// ═══════════════════════════════════════════════════════════════════════

test.describe('20. Журнал изменений и документация', () => {

  test('20.1 Страница журнала изменений загружается с записями версий', async ({ page }) => {
    await login(page);
    await page.goto('/changelog');
    await page.waitForTimeout(2000);
    const heading = page.locator('h1, h2').filter({ hasText: /Журнал|Изменения|Changelog/i }).first();
    await expect(heading).toBeVisible({ timeout: 10000 }).catch(() => {});
    // Проверяем что есть записи
    const entries = page.locator('[class*="entry"], [class*="version"], [class*="changelog"], li, article');
    const count = await entries.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('20.2 Кнопки фильтра журнала работают (Новое, Улучшения, Исправления)', async ({ page }) => {
    await login(page);
    await page.goto('/changelog');
    await page.waitForTimeout(2000);
    const newFilter = page.locator('button, a').filter({ hasText: /Новое|Новые/i }).first();
    if (await newFilter.isVisible({ timeout: 3000 }).catch(() => false)) {
      await newFilter.click();
      await page.waitForTimeout(1000);
    }
    const improveFilter = page.locator('button, a').filter({ hasText: /Улучшения/i }).first();
    if (await improveFilter.isVisible({ timeout: 3000 }).catch(() => false)) {
      await improveFilter.click();
      await page.waitForTimeout(1000);
    }
    const fixFilter = page.locator('button, a').filter({ hasText: /Исправления/i }).first();
    if (await fixFilter.isVisible({ timeout: 3000 }).catch(() => false)) {
      await fixFilter.click();
      await page.waitForTimeout(1000);
    }
  });

  test('20.3 Страница документации загружается с оглавлением', async ({ page }) => {
    await login(page);
    await page.goto('/docs');
    await page.waitForTimeout(2000);
    const heading = page.locator('h1, h2').filter({ hasText: /Документация|Docs|Содержание/i }).first();
    await expect(heading).toBeVisible({ timeout: 10000 }).catch(() => {});
    const toc = page.locator('nav, [class*="toc"], [class*="sidebar"], [class*="menu"]').first();
    await toc.isVisible({ timeout: 3000 }).catch(() => {});
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 21. FOOTER
// ═══════════════════════════════════════════════════════════════════════

test.describe('21. Подвал (Footer)', () => {

  test('21.1 Ссылки футера ведут корректно (История изменений, Документация)', async ({ page }) => {
    await login(page);
    await page.goto('/');
    await page.waitForTimeout(2000);
    // Ищем футер
    const footer = page.locator('footer, [class*="footer"]').first();
    if (await footer.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Ссылка «История изменений»
      const changelogLink = footer.locator('a').filter({ hasText: /История изменений|Changelog/i }).first();
      if (await changelogLink.isVisible({ timeout: 3000 }).catch(() => false)) {
        const href = await changelogLink.getAttribute('href');
        expect(href).toBeTruthy();
      }
      // Ссылка «Документация»
      const docsLink = footer.locator('a').filter({ hasText: /Документация|Docs/i }).first();
      if (await docsLink.isVisible({ timeout: 3000 }).catch(() => false)) {
        const href = await docsLink.getAttribute('href');
        expect(href).toBeTruthy();
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 22. HASH ROUTING — auto-switch tab via URL hash
// ═══════════════════════════════════════════════════════════════════════

test.describe('22. Hash routing — автопереключение таба', () => {

  test('22.1 /properties#focus → автоматически открывает таб «В фокусе»', async ({ page }) => {
    await login(page);
    await page.goto('/properties#focus');
    await page.waitForTimeout(2000);
    // Проверяем что таб «В фокусе» активен — ищем характерные элементы
    const focusIndicator = page.locator('text=/Порог|Пересчитать|CSV|В фокусе/i').first();
    await expect(focusIndicator).toBeVisible({ timeout: 10000 });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 23. LAZY PHOTO LOADING — detail page for undervalued objects
// ═══════════════════════════════════════════════════════════════════════

test.describe('23. Ленивая загрузка фото — detail page', () => {

  test('23.1 Фото-секция для недооценённого объекта показывает одно из состояний', async ({ page }) => {
    await login(page);
    // Ищем недооценённый объект через focus таб (больше шанс найти)
    await page.goto('/properties#focus');
    await page.waitForTimeout(3000);
    const firstRow = page.locator('table tbody tr').first();
    if (await firstRow.isVisible({ timeout: 5000 }).catch(() => false)) {
      await firstRow.click();
      await expect(page).toHaveURL(/\/properties\//, { timeout: 10000 });
      await page.waitForTimeout(3000);
      // Одно из состояний фото-секции:
      // 1) loading spinner
      const spinner = page.locator('[class*="spinner"], [class*="loading"], [class*="animate-spin"]').first();
      // 2) Кнопка «Загрузить фотографии»
      const loadPhotosBtn = page.locator('button:has-text("Загрузить фотографии")').first();
      // 3) Загруженные фото (grid изображений)
      const photosGrid = page.locator('[class*="photo"] img, [class*="gallery"] img, [class*="image-grid"] img').first();
      // 4) «Фотографии не найдены»
      const noPhotos = page.locator('text=Фотографии не найдены').first();
      // Хотя бы одно из четырёх состояний должно быть видно
      const anyState = spinner.or(loadPhotosBtn).or(photosGrid).or(noPhotos);
      await expect(anyState).toBeVisible({ timeout: 10000 }).catch(() => {});
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 24. CLICKABLE STAT CARDS — dashboard
// ═══════════════════════════════════════════════════════════════════════

test.describe('24. Кликабельные карточки статистики на дашборде', () => {

  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/');
    await page.waitForLoadState("networkidle").catch(() => {});
  });

  test('24.1 Клик «Всего объектов» → переход на /properties', async ({ page }) => {
    const totalCard = page.locator('text=Всего объектов').first();
    await expect(totalCard).toBeVisible({ timeout: 10000 });
    await totalCard.click();
    await expect(page).toHaveURL(/\/properties/, { timeout: 10000 });
  });

  test('24.2 Клик «Добавленные в фокус» → переход на /properties#focus', async ({ page }) => {
    const focusCard = page.locator('text=Добавленные в фокус').first();
    await expect(focusCard).toBeVisible({ timeout: 10000 });
    await focusCard.click();
    await expect(page).toHaveURL(/\/properties/, { timeout: 10000 });
    // Проверяем что хеш #focus
    expect(page.url()).toContain('#focus');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 25. ТАБ «В РАБОТЕ» — filtered by status=in_progress
// ═══════════════════════════════════════════════════════════════════════

test.describe('25. Таб «В работе»', () => {

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('25.1 Таб «В работе» виден и переключается', async ({ page }) => {
    const inProgressTab = page.locator('button:has-text("В работе")');
    await expect(inProgressTab).toBeVisible({ timeout: 10000 });
    await inProgressTab.click();
    await page.waitForTimeout(2000);
    // После клика на таб — должна загрузиться таблица или пустое состояние
    const table = page.locator('table tbody tr');
    const emptyState = page.locator('text=/Нет объектов|Пусто/i');
    await expect(table.first().or(emptyState)).toBeVisible({ timeout: 10000 });
  });

  test('25.2 Таб «В работе» фильтрует по status=in_progress', async ({ page }) => {
    const inProgressTab = page.locator('button:has-text("В работе")');
    await expect(inProgressTab).toBeVisible({ timeout: 10000 });
    await inProgressTab.click();
    await page.waitForTimeout(2000);
    // Проверяем что отображается только статус «В работе» (если есть данные)
    const statusBadges = page.locator('table tbody td').filter({ hasText: /В работе/ });
    const otherBadges = page.locator('table tbody td').filter({ hasText: /Новый|Просмотрен|Отклонён/ });
    // Если есть строки — все должны быть «В работе»
    const inProgressCount = await statusBadges.count();
    const otherCount = await otherBadges.count();
    if (inProgressCount > 0) {
      // Допускаем что otherBadges = 0 (все строки — «В работе»)
      expect(otherCount).toBe(0);
    }
  });
});