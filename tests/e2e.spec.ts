import { test, expect } from '@playwright/test';

const FRONTEND = process.env.FRONTEND_URL || 'http://localhost:5174';
const API = process.env.API_URL || 'http://localhost:1338';
const EMAIL = process.env.TEST_USER_EMAIL || 'test@aklab.tirobots.ru';
const PASS = process.env.TEST_USER_PASS || 'Test1234!';

test.describe('AKLAB E2E', () => {

  test('frontend loads and shows login', async ({ page }) => {
    await page.goto(FRONTEND);
    // Should redirect to login or show login form
    await expect(page.locator('input[type="text"], input[type="email"]').first()).toBeVisible({ timeout: 10000 });
  });

  test('login and see dashboard', async ({ page }) => {
    await page.goto(FRONTEND);

    // Fill login form
    await page.locator('input[type="text"], input[type="email"]').first().fill(EMAIL);
    await page.locator('input[type="password"]').first().fill(PASS);
    await page.locator('button[type="submit"]').click();

    // Should redirect to properties table
    await expect(page.locator('text=Объекты, text=Properties, table').first()).toBeVisible({ timeout: 15000 });
  });

  test('properties table has data', async ({ page }) => {
    // Login first
    await page.goto(FRONTEND);
    await page.locator('input[type="text"], input[type="email"]').first().fill(EMAIL);
    await page.locator('input[type="password"]').first().fill(PASS);
    await page.locator('button[type="submit"]').click();
    await expect(page.locator('text=Объекты, text=Properties, table').first()).toBeVisible({ timeout: 15000 });

    // Table should have rows
    const rows = page.locator('table tbody tr, [class*="row"], [class*="card"]');
    await expect(rows.first()).toBeVisible({ timeout: 10000 });
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
  });

  test('sources page loads', async ({ page }) => {
    // Login
    await page.goto(FRONTEND);
    await page.locator('input[type="text"], input[type="email"]').first().fill(EMAIL);
    await page.locator('input[type="password"]').first().fill(PASS);
    await page.locator('button[type="submit"]').click();
    await expect(page.locator('text=Объекты, text=Properties, table').first()).toBeVisible({ timeout: 15000 });

    // Navigate to sources
    const sourcesLink = page.locator('a[href*="source"], a:has-text("Источники"), a:has-text("Sources")').first();
    if (await sourcesLink.isVisible().catch(() => false)) {
      await sourcesLink.click();
      await expect(page.locator('text=Источники, text=Sources, table').first()).toBeVisible({ timeout: 10000 });
    }
  });

  test('settings page loads', async ({ page }) => {
    // Login
    await page.goto(FRONTEND);
    await page.locator('input[type="text"], input[type="email"]').first().fill(EMAIL);
    await page.locator('input[type="password"]').first().fill(PASS);
    await page.locator('button[type="submit"]').click();
    await expect(page.locator('text=Объекты, text=Properties, table').first()).toBeVisible({ timeout: 15000 });

    // Navigate to settings
    const settingsLink = page.locator('a[href*="setting"], a:has-text("Настройки"), a:has-text("Settings")').first();
    if (await settingsLink.isVisible().catch(() => false)) {
      await settingsLink.click();
      await expect(page.locator('text=Настройки, text=Settings, input, form').first()).toBeVisible({ timeout: 10000 });
    }
  });

  test('API health returns 204', async ({ request }) => {
    const resp = await request.get(`${API}/_health`);
    expect(resp.status()).toBe(204);
  });

  test('API sources returns list', async ({ request }) => {
    // Login to get JWT
    const loginResp = await request.post(`${API}/api/auth/local`, {
      data: { identifier: EMAIL, password: PASS },
    });
    const { jwt } = await loginResp.json();

    const resp = await request.get(`${API}/api/sources`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    expect(resp.ok()).toBeTruthy();
    const body = await resp.json();
    expect(body.data.length).toBeGreaterThan(0);
  });
});
