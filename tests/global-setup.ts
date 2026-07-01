import { chromium, FullConfig } from '@playwright/test';
import * as fs from 'fs';

const FRONTEND = process.env.FRONTEND_URL || 'https://aklab-dev.tirobots.ru';
const EMAIL = process.env.TEST_USER_EMAIL || 'test@aklab.tirobots.ru';
const PASS = process.env.TEST_USER_PASSWORD || 'Test1234!';

// Auth API — prefer localhost (works inside server), fallback to external
const API_INTERNAL = process.env.API_URL_INTERNAL || 'http://localhost:1338';
const API_EXTERNAL = process.env.API_URL || 'https://api-aklab-dev.tirobots.ru';

async function globalSetup(config: FullConfig) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Try internal first, fallback to external
  let jwt: string | undefined;
  let user: object | undefined;

  for (const apiBase of [API_INTERNAL, API_EXTERNAL]) {
    try {
      const resp = await page.request.post(`${apiBase}/api/auth/local`, {
        data: { identifier: EMAIL, password: PASS },
        timeout: 10000,
      });
      const body = await resp.json();
      if (body.jwt) {
        jwt = body.jwt;
        user = body.user;
        break;
      }
    } catch {
      // try next
    }
  }

  if (!jwt) throw new Error('Login failed: no valid JWT from any API endpoint');

  // Set JWT in localStorage on the frontend origin
  await page.goto(FRONTEND);
  await page.evaluate(({ jwt, user }) => {
    localStorage.setItem('jwt', jwt);
    localStorage.setItem('user', JSON.stringify(user));
    localStorage.setItem('lastAuthTime', Date.now().toString());
  }, { jwt, user });

  // Save storage state (cookies + localStorage)
  await page.context().storageState({ path: 'tests/.auth/storage.json' });

  await browser.close();
}

export default globalSetup;
