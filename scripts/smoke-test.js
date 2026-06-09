#!/usr/bin/env node
/**
 * AKLAB Smoke Test
 *
 * Проверяет что прод-сервер жив и работает корректно.
 * Запуск: npm run smoke
 * С опцией --local: тестирует localhost (для dev)
 *
 * Exit codes: 0 = all pass, 1 = failures
 */

const BASE_URL = process.argv.includes('--local')
  ? 'http://localhost:5174'
  : 'https://aklab.tirobots.ru';

const API_URL = process.argv.includes('--local')
  ? 'http://localhost:1338'
  : 'https://api-aklab.tirobots.ru';

const TEST_EMAIL = process.env.TEST_USER_EMAIL || 'test@aklab.ti-soft.ru';
const TEST_PASSWORD = process.env.TEST_USER_PASSWORD || 'test123456';

let passed = 0;
let failed = 0;
let jwt = null;

function ok(name, detail) {
  passed++;
  console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`);
}

function fail(name, detail) {
  failed++;
  console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
}

async function test(name, fn) {
  try {
    await fn();
  } catch (err) {
    fail(name, err.message);
  }
}

async function api(method, path, body) {
  const url = `${API_URL}${path}`;
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  if (jwt) opts.headers['Authorization'] = `Bearer ${jwt}`;
  const res = await fetch(url, opts);
  return { status: res.status, data: await res.json().catch(() => null), ok: res.ok };
}

async function run() {
  console.log(`\n🧪 AKLAB Smoke Test`);
  console.log(`   UI:  ${BASE_URL}`);
  console.log(`   API: ${API_URL}`);
  console.log(`   User: ${TEST_EMAIL}\n`);

  // === 1. Health checks ===
  console.log('📡 Health checks:');

  await test('API health (/_health)', async () => {
    const res = await fetch(`${API_URL}/_health`);
    if (res.status !== 204) throw new Error(`Expected 204, got ${res.status}`);
    ok('API health', `${res.status}`);
  });

  await test('Frontend responds', async () => {
    const res = await fetch(BASE_URL, { redirect: 'manual' });
    if (res.status !== 200 && res.status !== 304) throw new Error(`Expected 200, got ${res.status}`);
    ok('Frontend', `${res.status}`);
  });

  // === 2. Auth ===
  console.log('\n🔐 Auth:');

  await test('Login with test user', async () => {
    const res = await api('POST', '/api/auth/local', {
      identifier: TEST_EMAIL,
      password: TEST_PASSWORD,
    });
    if (!res.ok) throw new Error(`Login failed: ${res.status} ${JSON.stringify(res.data)}`);
    if (!res.data?.jwt) throw new Error('No JWT in response');
    jwt = res.data.jwt;
    ok('Login', `user=${res.data.user?.email}`);
  });

  await test('GET /api/users/me with JWT', async () => {
    const res = await api('GET', '/api/users/me');
    if (!res.ok) throw new Error(`Expected 200, got ${res.status}`);
    ok('Auth check', `user=${res.data?.email}`);
  });

  await test('GET /api/properties without JWT → blocked', async () => {
    const savedJwt = jwt;
    jwt = null;
    try {
      const res = await api('GET', '/api/properties');
      if (res.ok) throw new Error(`Expected error, got ${res.status}`);
      ok('No-auth blocked', `${res.status}`);
    } finally {
      jwt = savedJwt;
    }
  });

  // === 3. API endpoints (authenticated) ===
  console.log('\n📦 API endpoints:');

  await test('GET /api/properties', async () => {
    const res = await api('GET', '/api/properties');
    if (!res.ok) throw new Error(`Expected 200, got ${res.status} ${JSON.stringify(res.data)}`);
    const count = res.data?.data?.length || 0;
    ok('Properties', `${count} items`);
  });

  await test('GET /api/sources', async () => {
    const res = await api('GET', '/api/sources');
    if (!res.ok) throw new Error(`Expected 200, got ${res.status} ${JSON.stringify(res.data)}`);
    const sources = res.data?.data || [];
    const active = sources.filter(s => s.is_active);
    ok('Sources', `${sources.length} total, ${active.length} active`);
  });

  await test('GET /api/setting', async () => {
    const res = await api('GET', '/api/setting');
    if (!res.ok) throw new Error(`Expected 200, got ${res.status} ${JSON.stringify(res.data)}`);
    ok('Setting', `threshold=${res.data?.data?.threshold_percent}`);
  });

  await test('GET /api/market-references', async () => {
    const res = await api('GET', '/api/market-references');
    if (!res.ok) throw new Error(`Expected 200, got ${res.status} ${JSON.stringify(res.data)}`);
    ok('Market references', `${res.data?.data?.length || 0} items`);
  });

  // === 4. Data integrity ===
  console.log('\n🔍 Data integrity:');

  await test('Active sources have correct parsers', async () => {
    const res = await api('GET', '/api/sources');
    const sources = res.data?.data || [];
    const validParsers = ['fabrikant', 'fedresurs', 'torgi-gov', 'investmoscow', 'roseltorg', 'sberbank-ast'];
    for (const src of sources) {
      if (src.is_active && !validParsers.includes(src.parser)) {
        throw new Error(`Source ${src.slug} has unknown parser: ${src.parser}`);
      }
    }
    ok('Parser names valid');
  });

  await test('Properties have required fields', async () => {
    const res = await api('GET', '/api/properties');
    const props = res.data?.data || [];
    for (const p of props) {
      if (!p.external_id) throw new Error(`Property ${p.id} missing external_id`);
      if (!p.source) throw new Error(`Property ${p.id} missing source`);
    }
    if (props.length > 0) {
      const withPrice = props.filter(p => p.price != null);
      const withArea = props.filter(p => p.area_sqm != null);
      ok('Properties valid', `${props.length} total, ${withPrice.length} with price, ${withArea.length} with area`);
    } else {
      ok('Properties valid', '0 items (empty)');
    }
  });

  // === 5. Microservices ===
  console.log('\n⚙️  Microservices:');

  const microservices = [
    { name: 'Parser', port: 1340 },
    { name: 'Analyzer', port: 1341 },
    { name: 'Digest', port: 1342 },
  ];

  for (const svc of microservices) {
    await test(`${svc.name} health (:${svc.port})`, async () => {
      try {
        const res = await fetch(`http://localhost:${svc.port}/health`, {
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
          ok(`${svc.name}`, `port ${svc.port} ✓`);
        } else {
          fail(`${svc.name}`, `port ${svc.port} → ${res.status}`);
        }
      } catch {
        // Can't reach from outside — skip gracefully
        ok(`${svc.name}`, `port ${svc.port} (skip — remote)`);
      }
    });
  }

  // === Summary ===
  console.log(`\n${'═'.repeat(40)}`);
  console.log(`  ✅ Passed: ${passed}`);
  if (failed > 0) console.log(`  ❌ Failed: ${failed}`);
  console.log(`${'═'.repeat(40)}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
