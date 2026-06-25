import { test, expect } from '@playwright/test';

const FRONTEND = process.env.FRONTEND_URL || 'http://localhost:5174';
const API = process.env.API_URL || 'http://localhost:1338';
const EMAIL = process.env.TEST_USER_EMAIL || 'test@aklab.tirobots.ru';
const PASS = process.env.TEST_USER_PASSWORD || 'Test1234!';

async function login(page: any) {
  await page.goto(FRONTEND);
  await page.locator('input[type="email"], input[type="text"]').first().fill(EMAIL);
  await page.locator('input[type="password"]').first().fill(PASS);
  await page.locator('button[type="submit"]').click();
  await expect(page.locator('h1:has-text("Объекты")')).toBeVisible({ timeout: 15000 });
}

test.describe('AKLAB E2E', () => {

  test('frontend loads and shows login', async ({ page }) => {
    await page.goto(FRONTEND);
    await expect(page.locator('h1:has-text("Вход")')).toBeVisible({ timeout: 10000 });
  });

  test('login and see dashboard', async ({ page }) => {
    await login(page);
  });

  test('properties table has data', async ({ page }) => {
    await login(page);
    const rows = page.locator('table tbody tr');
    await expect(rows.first()).toBeVisible({ timeout: 10000 });
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
  });

  test('sources page loads', async ({ page }) => {
    await login(page);
    await page.getByRole('navigation').getByRole('link', { name: 'Источники' }).click();
    await expect(page.locator('h1:has-text("Источники")')).toBeVisible({ timeout: 10000 });
  });

  test('settings page loads', async ({ page }) => {
    await login(page);
    await page.getByRole('navigation').getByRole('link', { name: 'Настройки' }).click();
    await expect(page.locator('h1:has-text("Настройки")')).toBeVisible({ timeout: 10000 });
  });

  test('API health returns 204', async ({ request }) => {
    const resp = await request.get(`${API}/_health`);
    expect(resp.status()).toBe(204);
  });

  test('API sources returns list', async ({ request }) => {
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
