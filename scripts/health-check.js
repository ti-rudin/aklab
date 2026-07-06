#!/usr/bin/env node

/**
 * Health check для всех AKLAB сервисов.
 *
 * Динамически загружает services.json и проверяет доступность каждого сервиса
 * через HTTP GET на его health-endpoint.
 *
 * Usage: node scripts/health-check.js
 *
 * Exit codes:
 *   0 — все сервисы онлайн
 *   1 — хотя бы один сервис недоступен
 */

const path = require('path');
const fs = require('fs');

// ─── Загрузка манифеста ───────────────────────────────────────────────

const manifestPath = path.resolve(__dirname, '..', 'services', 'services.json');

let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
} catch (err) {
  console.error(`❌ Не удалось загрузить ${manifestPath}: ${err.message}`);
  process.exit(1);
}

// ─── Построение списка сервисов ───────────────────────────────────────

/**
 * Определяет health-URL для сервиса.
 * - API (Strapi) использует /_health на порту 1338
 * - App (preview) — корневой путь /
 * - Остальные — /health на health_port (или port)
 */
function buildServiceList(m) {
  const services = [];

  // Core
  for (const svc of m.core || []) {
    if (svc.slug === 'api') {
      services.push({ name: 'api (Strapi)', url: `http://localhost:${svc.port}/_health`, critical: true });
    } else if (svc.slug === 'app') {
      services.push({ name: 'app (preview)', url: `http://localhost:${svc.port}/`, critical: true });
    } else {
      const port = svc.health_port || svc.port;
      services.push({ name: svc.slug, url: `http://localhost:${port}/health`, critical: true });
    }
  }

  // Parsers
  for (const svc of m.parsers || []) {
    const port = svc.health_port || svc.port;
    services.push({ name: svc.slug, url: `http://localhost:${port}/health`, critical: false });
  }

  // Workers
  for (const svc of m.workers || []) {
    const port = svc.health_port || svc.port;
    services.push({ name: svc.slug, url: `http://localhost:${port}/health`, critical: false });
  }

  return services;
}

// ─── HTTP проверка ────────────────────────────────────────────────────

/**
 * Проверяет доступность сервиса через HTTP GET.
 * Использует native fetch() (Node 18+).
 */
async function checkService(service) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch(service.url, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });
    clearTimeout(timeout);
    return {
      name: service.name,
      url: service.url,
      status: res.status,
      ok: res.status >= 200 && res.status < 400,
      critical: service.critical,
    };
  } catch (err) {
    clearTimeout(timeout);
    const status = err.name === 'AbortError' ? 'timeout' : 'unreachable';
    return { name: service.name, url: service.url, status, ok: false, critical: service.critical };
  }
}

// ─── Main ─────────────────────────────────────────────────────────────

async function main() {
  const services = buildServiceList(manifest);

  console.log(`\n🩺 AKLAB Health Check — проверяем ${services.length} сервисов...\n`);

  const results = await Promise.all(services.map(checkService));

  // Вывод результатов
  const online = [];
  const offline = [];

  for (const r of results) {
    if (r.ok) {
      online.push(r);
      console.log(`  ✅ ${r.name}: ${r.status}  (${r.url})`);
    } else {
      offline.push(r);
      const criticalTag = r.critical ? ' [CRITICAL]' : '';
      console.log(`  ❌ ${r.name}: ${r.status}  (${r.url})${criticalTag}`);
    }
  }

  // Сводка
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`  Всего: ${results.length}  |  Онлайн: ${online.length}  |  Офлайн: ${offline.length}`);

  if (offline.length > 0) {
    console.log(`\n  ⚠️  Недоступные сервисы:`);
    for (const r of offline) {
      const criticalTag = r.critical ? ' [CRITICAL]' : '';
      console.log(`    • ${r.name} — ${r.status}${criticalTag}`);
    }
  }

  console.log('');

  // Exit code: 1 если хотя бы один сервис недоступен
  const anyDown = offline.length > 0;
  process.exit(anyDown ? 1 : 0);
}

main();
