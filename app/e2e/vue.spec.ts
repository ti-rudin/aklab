import { test, expect } from '@playwright/test'

const TEST_EMAIL = process.env.TEST_USER_EMAIL || 'test@aklab.tirobots.ru'
const TEST_PASSWORD = process.env.TEST_USER_PASSWORD || ''

/**
 * Helper: авторизация через UI.
 * После логина Auth.vue делает router.push('/properties').
 */
async function login(page: import('@playwright/test').Page) {
  await page.goto('/auth')
  await page.locator('#email').fill(TEST_EMAIL)
  await page.locator('#password').fill(TEST_PASSWORD)
  await page.locator('button[type="submit"]').click()
  await expect(page).toHaveURL(/\/properties/, { timeout: 15000 })
}

// ========================================
// 1. Unauthenticated navigation
// ========================================
test.describe('Unauthenticated navigation', () => {
  test('root redirects to /auth', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/auth/)
  })

  test('auth page shows login form', async ({ page }) => {
    await page.goto('/auth')
    await expect(page.locator('#email')).toBeVisible()
    await expect(page.locator('#password')).toBeVisible()
    await expect(page.locator('button[type="submit"]')).toBeVisible()
    await expect(page.locator('text=Вход в личный кабинет')).toBeVisible()
  })

  test('settings redirects to /auth', async ({ page }) => {
    await page.goto('/settings')
    await expect(page).toHaveURL(/\/auth/)
  })

  test('properties redirects to /auth', async ({ page }) => {
    await page.goto('/properties')
    await expect(page).toHaveURL(/\/auth/)
  })

  test('property detail redirects to /auth', async ({ page }) => {
    await page.goto('/properties/some-document-id')
    await expect(page).toHaveURL(/\/auth/)
  })

  test('changelog redirects to /auth', async ({ page }) => {
    await page.goto('/changelog')
    await expect(page).toHaveURL(/\/auth/)
  })

  test('documentation redirects to /auth', async ({ page }) => {
    await page.goto('/documentation')
    await expect(page).toHaveURL(/\/auth/)
  })
})

// ========================================
// 2. Auth flow
// ========================================
test.describe('Auth flow', () => {
  test('login with valid credentials → /properties', async ({ page }) => {
    await page.goto('/auth')
    await page.locator('#email').fill(TEST_EMAIL)
    await page.locator('#password').fill(TEST_PASSWORD)
    await page.locator('button[type="submit"]').click()
    await expect(page).toHaveURL(/\/properties/, { timeout: 15000 })
  })

  test('login with invalid credentials shows error', async ({ page }) => {
    await page.goto('/auth')
    await page.locator('#email').fill('wrong@example.com')
    await page.locator('#password').fill('wrongpassword')
    await page.locator('button[type="submit"]').click()
    // Должны остаться на /auth и увидеть ошибку
    await expect(page).toHaveURL(/\/auth/)
    // Auth.vue показывает ошибку в div с красным фоном
    await expect(page.locator('text=Ошибка').or(page.locator('text=Invalid')).or(page.locator('[style*="rgba(239"]'))).toBeVisible({ timeout: 10000 })
  })

  test('authenticated user visiting /auth redirects to /properties', async ({ page }) => {
    await login(page)
    // Теперь залогинены — заходим на /auth
    await page.goto('/auth')
    await expect(page).toHaveURL(/\/properties/, { timeout: 10000 })
  })

  test('logout redirects to /auth', async ({ page }) => {
    await login(page)
    await page.goto('/settings')
    // Кнопка «Выйти» на вкладке Дайджест
    await page.locator('button:has-text("Выйти")').click()
    await expect(page).toHaveURL(/\/auth/, { timeout: 10000 })
  })
})

// ========================================
// 3. Dashboard (после логина)
// ========================================
test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await page.goto('/')
    await expect(page).toHaveURL(/\/$/, { timeout: 10000 })
  })

  test('shows heading and statistics', async ({ page }) => {
    await expect(page.locator('h1:has-text("Дашборд")')).toBeVisible()
    await expect(page.locator('text=Всего объектов')).toBeVisible({ timeout: 15000 })
    await expect(page.locator('text=Средний скор')).toBeVisible()
  })

  test('shows property types section', async ({ page }) => {
    await expect(page.locator('h2:has-text("Объекты по типам")')).toBeVisible({ timeout: 15000 })
  })

  test('shows hot properties section', async ({ page }) => {
    await expect(page.locator('h2:has-text("Горячие объекты")')).toBeVisible({ timeout: 15000 })
  })

  test('click on property type navigates to /properties with filter', async ({ page }) => {
    // Ждём загрузки секции с типами
    const typesSection = page.locator('h2:has-text("Объекты по типам")').locator('..')
    const firstTypeButton = typesSection.locator('button').first()
    await expect(firstTypeButton).toBeVisible({ timeout: 15000 })
    await firstTypeButton.click()
    await expect(page).toHaveURL(/\/properties/, { timeout: 10000 })
  })
})

// ========================================
// 4. Properties page (после логина)
// ========================================
test.describe('Properties page', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('has 3 tabs: Все объекты, В фокусе, В работе', async ({ page }) => {
    await expect(page.locator('button:has-text("Все объекты")')).toBeVisible()
    await expect(page.locator('button:has-text("В фокусе")')).toBeVisible()
    await expect(page.locator('button:has-text("В работе")')).toBeVisible()
  })

  test('shows property table or empty state', async ({ page }) => {
    // Ждём пока загрузка завершится (скелетон пропадёт)
    const table = page.locator('table')
    const emptyState = page.locator('text=Нет объектов')
    await expect(table.or(emptyState).first()).toBeVisible({ timeout: 15000 })
  })

  test('shows filters (city, type, status, price)', async ({ page }) => {
    // Фильтры в блоке
    await expect(page.locator('text=Город').first()).toBeVisible()
    await expect(page.locator('text=Тип').first()).toBeVisible()
    await expect(page.locator('text=Статус').first()).toBeVisible()
    await expect(page.locator('text=Цена (₽)').first()).toBeVisible()
    await expect(page.locator('button:has-text("Сбросить")')).toBeVisible()
  })

  test('tab В фокусе shows focus content', async ({ page }) => {
    await page.locator('button:has-text("В фокусе")').click()
    // Focus tab shows its own stats header
    await expect(page.locator('text=В фокусе:').first()).toBeVisible({ timeout: 10000 })
  })

  test('tab В работе switches correctly', async ({ page }) => {
    await page.locator('button:has-text("В работе")').click()
    // В работе показывает тот же шаблон таблицы, что и «Все объекты»
    await page.waitForTimeout(1000)
    const table = page.locator('table')
    const emptyState = page.locator('text=Нет объектов')
    await expect(table.or(emptyState).first()).toBeVisible({ timeout: 10000 })
  })

  test('click on property row navigates to detail', async ({ page }) => {
    // Ждём таблицу
    const row = page.locator('table tbody tr').first()
    await expect(row).toBeVisible({ timeout: 15000 })
    await row.click()
    await expect(page).toHaveURL(/\/properties\/.+/, { timeout: 10000 })
  })
})

// ========================================
// 5. Settings page (после логина)
// ========================================
test.describe('Settings page', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await page.goto('/settings')
  })

  test('has 4 tabs: Дайджест, Правила, Парсеры, Эталоны', async ({ page }) => {
    await expect(page.locator('button:has-text("Дайджест")')).toBeVisible()
    await expect(page.locator('button:has-text("Правила")')).toBeVisible()
    await expect(page.locator('button:has-text("Парсеры")')).toBeVisible()
    await expect(page.locator('button:has-text("Эталоны")')).toBeVisible()
  })

  test('Дайджест tab: settings form loads', async ({ page }) => {
    await expect(page.locator('text=Порог отклонения')).toBeVisible({ timeout: 10000 })
    await expect(page.locator('text=Дайджест включён')).toBeVisible()
    await expect(page.locator('text=Время утреннего дайджеста')).toBeVisible()
    await expect(page.locator('text=Email для дайджеста')).toBeVisible()
    await expect(page.locator('button:has-text("Сохранить")')).toBeVisible()
  })

  test('Дайджест tab: has logout button', async ({ page }) => {
    await expect(page.locator('button:has-text("Выйти")')).toBeVisible({ timeout: 10000 })
  })

  test('Правила tab: ParsingRulesPanel + FocusRules load', async ({ page }) => {
    await page.locator('button:has-text("Правила")').click()
    await expect(page.locator('h2:has-text("Правила фокуса")')).toBeVisible({ timeout: 10000 })
    // ParsingRulesPanel загружается — ищем заголовок
    await expect(page.locator('text=Правила парсинга').or(page.locator('h2:has-text("Правила")')).first()).toBeVisible({ timeout: 10000 })
  })

  test('Парсеры tab: sources list loads', async ({ page }) => {
    await page.locator('button:has-text("Парсеры")').click()
    await expect(page.locator('h2:has-text("Источники парсинга")')).toBeVisible({ timeout: 10000 })
  })

  test('Эталоны tab: market references load', async ({ page }) => {
    await page.locator('button:has-text("Эталоны")').click()
    await expect(page.locator('h2:has-text("Эталоны стоимости")')).toBeVisible({ timeout: 10000 })
  })
})

// ========================================
// 6. Property detail
// ========================================
test.describe('Property detail', () => {
  test('shows property info and back link', async ({ page }) => {
    await login(page)
    await page.goto('/properties')

    // Ждём загрузку таблицы
    const row = page.locator('table tbody tr').first()
    await expect(row).toBeVisible({ timeout: 15000 })
    await row.click()

    // Должны быть на странице объекта
    await expect(page).toHaveURL(/\/properties\/.+/, { timeout: 10000 })

    // Проверяем наличие ссылки «Назад»
    await expect(page.locator('text=К списку объектов')).toBeVisible({ timeout: 10000 })

    // Карточка показывает поля: title (h1), цена, площадь
    const heading = page.locator('h1').first()
    await expect(heading).toBeVisible({ timeout: 10000 })
    await expect(heading).not.toBeEmpty()

    // Цена и площадь — в карточке есть поля
    await expect(page.locator('text=Цена').first()).toBeVisible()
    await expect(page.locator('text=Площадь').first()).toBeVisible()
  })

  test('back link navigates to properties list', async ({ page }) => {
    await login(page)
    await page.goto('/properties')

    const row = page.locator('table tbody tr').first()
    await expect(row).toBeVisible({ timeout: 15000 })
    await row.click()
    await expect(page).toHaveURL(/\/properties\/.+/, { timeout: 10000 })

    // Кликаем «← К списку объектов»
    await page.locator('a:has-text("К списку объектов")').click()
    await expect(page).toHaveURL(/\/properties$/, { timeout: 10000 })
  })
})
