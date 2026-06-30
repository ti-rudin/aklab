import { chromium, FullConfig } from '@playwright/test';

const API = process.env.API_URL || 'https://api-aklab-dev.tirobots.ru';
const FRONTEND = process.env.FRONTEND_URL || 'https://aklab-dev.tirobots.ru';
const EMAIL = process.env.TEST_USER_EMAIL || 'test@aklab.tirobots.ru';
const PASS = process.env.TEST_USER_PASSWORD || 'Test1234!';

async function globalSetup(config: FullConfig) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Get JWT via API
  const resp = await page.request.post(`${API}/api/auth/local`, {
    data: { identifier: EMAIL, password: PASS },
  });
  const body = await resp.json();
  if (!body.jwt) throw new Error('Login API failed: ' + JSON.stringify(body));

  // Set JWT in localStorage on the frontend origin
  await page.goto(FRONTEND);
  await page.evaluate(({ jwt, user }) => {
    localStorage.setItem('jwt', jwt);
    localStorage.setItem('user', JSON.stringify(user));
    localStorage.setItem('lastAuthTime', Date.now().toString());
  }, { jwt: body.jwt, user: body.user });

  // Save storage state (cookies + localStorage)
  await page.context().storageState({ path: 'tests/.auth/storage.json' });

  await browser.close();
}

export default globalSetup;
