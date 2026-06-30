import { defineConfig } from '@playwright/test';
import * as fs from 'fs';

// Ensure .auth directory exists
if (!fs.existsSync('tests/.auth')) {
  fs.mkdirSync('tests/.auth', { recursive: true });
}

export default defineConfig({
  globalSetup: './tests/global-setup.ts',
  testDir: './tests',
  timeout: 30000,
  expect: { timeout: 10000 },
  use: {
    baseURL: process.env.FRONTEND_URL || 'https://aklab-dev.tirobots.ru',
    headless: true,
    screenshot: 'only-on-failure',
    storageState: 'tests/.auth/storage.json',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
});
