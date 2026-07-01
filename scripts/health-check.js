#!/usr/bin/env node

/**
 * Health check для AKLAB сервисов
 * Usage: node scripts/health-check.js [port]
 *   port — порт App (preview), по умолчанию 4173
 *   Также можно задать через HEALTH_CHECK_PORT env
 */

const http = require('http');

const port = process.argv[2] || process.env.HEALTH_CHECK_PORT || '4173';

const SERVICES = [
  { name: 'Strapi API', url: 'http://localhost:1338/_health' },
  { name: 'App (preview)', url: `http://localhost:${port}/` },
];

function checkService(service) {
  return new Promise((resolve) => {
    const req = http.get(service.url, { timeout: 5000 }, (res) => {
      resolve({
        name: service.name,
        url: service.url,
        status: res.statusCode,
        ok: res.statusCode >= 200 && res.statusCode < 400,
      });
    });

    req.on('error', () => {
      resolve({ name: service.name, url: service.url, status: 'unreachable', ok: false });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ name: service.name, url: service.url, status: 'timeout', ok: false });
    });
  });
}

async function main() {
  const results = await Promise.all(SERVICES.map(checkService));
  let allOk = true;

  for (const r of results) {
    const icon = r.ok ? '✅' : '❌';
    console.log(`${icon} ${r.name}: ${r.status} (${r.url})`);
    if (!r.ok) allOk = false;
  }

  process.exit(allOk ? 0 : 1);
}

main();
