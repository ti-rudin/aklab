#!/usr/bin/env node

/**
 * Проверка критических environment переменных перед деплоем
 * Usage: node scripts/check-env.js
 */

require('dotenv').config();

const requiredVars = [
  'APP_KEYS',
  'JWT_SECRET',
  'ADMIN_JWT_SECRET',
  'API_TOKEN_SALT',
  'TRANSFER_TOKEN_SALT',
  'STRAPI_API_TOKEN',
  'DATABASE_FILENAME',
];

const recommendedVars = [
  'EMAIL_SMTP_HOST',
  'EMAIL_SMTP_USER',
  'EMAIL_SMTP_PASS',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_CHAT_ID',
];

const missing = requiredVars.filter(v => !process.env[v]);
if (missing.length > 0) {
  console.error('❌ Отсутствуют критические env переменные:');
  missing.forEach(v => console.error(`   - ${v}`));
  process.exit(1);
}

const missingRecommended = recommendedVars.filter(v => !process.env[v]);
if (missingRecommended.length > 0) {
  console.warn('⚠️  Отсутствуют рекомендуемые env переменные:');
  missingRecommended.forEach(v => console.warn(`   - ${v}`));
}

// Проверка placeholder-значений
const placeholders = [
  { key: 'JWT_SECRET', patterns: ['change_me_', 'tobemodified', 'toBeModified'] },
  { key: 'APP_KEYS', patterns: ['change_me_', 'tobemodified', 'toBeModified'] },
  { key: 'ADMIN_JWT_SECRET', patterns: ['change_me_', 'tobemodified'] },
  { key: 'API_TOKEN_SALT', patterns: ['change_me_', 'tobemodified'] },
  { key: 'TRANSFER_TOKEN_SALT', patterns: ['change_me_', 'tobemodified'] },
  { key: 'ENCRYPTION_KEY', patterns: ['change_me_', 'tobemodified'] },
];

const hasPlaceholders = placeholders.filter(d =>
  d.patterns.some(p => process.env[d.key]?.includes(p))
);

if (hasPlaceholders.length > 0) {
  console.error('❌ Обнаружены placeholder-значения в env:');
  hasPlaceholders.forEach(d => console.error(`   - ${d.key} содержит шаблонное значение`));
  process.exit(1);
}

// Проверка формата APP_KEYS (4 ключа через запятую)
const appKeys = process.env.APP_KEYS?.split(',') || [];
if (appKeys.length !== 4) {
  console.error(`❌ APP_KEYS должно содержать 4 ключа через запятую (сейчас: ${appKeys.length})`);
  process.exit(1);
}

// Проверка NODE_ENV
const nodeEnv = process.env.NODE_ENV || 'development';
if (!['development', 'production'].includes(nodeEnv)) {
  console.error(`❌ NODE_ENV должен быть "development" или "production" (сейчас: "${nodeEnv}")`);
  process.exit(1);
}

console.log('✅ Все критические env переменные настроены корректно');
console.log(`   NODE_ENV: ${nodeEnv}`);
console.log(`   APP_KEYS: ${appKeys.length} ключей`);
process.exit(0);
