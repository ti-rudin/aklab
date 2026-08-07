#!/usr/bin/env node
'use strict';

/**
 * Safe AKLAB multi-user dev-acceptance smoke harness.
 *
 * The default run is read-only and requires explicit URLs plus three sets of
 * credentials. It never falls back to production or to legacy single-user variables.
 * Mutating checks require an explicit fixture-only confirmation and always
 * restore the one fixture property in a finally block.
 *
 * No cron/queue emulation is performed here. Cron fan-out and manual pipeline
 * execution are separate runtime-acceptance evidence items (see --print-plan).
 */

const { randomUUID } = require('node:crypto');

const ROLE_NAMES = ['admin', 'userA', 'userB'];
const DENIAL_STATUSES = [401, 403];
const ADMIN_ROLE_TYPE = 'aklab_admin';
const MUTATION_CONFIRM = 'fixture-only';
const DEFAULT_TIMEOUT_MS = 10_000;
const PRODUCTION_HOSTS = new Set(['aklab.tirobots.ru', 'api-aklab.tirobots.ru']);
const TRUSTED_TARGET_PAIRS = [
  { kind: 'dev', ui: 'https://aklab-dev.tirobots.ru', api: 'https://api-aklab-dev.tirobots.ru' },
  { kind: 'production', ui: 'https://aklab.tirobots.ru', api: 'https://api-aklab.tirobots.ru' },
  { kind: 'local', ui: 'http://127.0.0.1:5174', api: 'http://127.0.0.1:1338' },
];
const PERSONAL_STATUSES = new Set(['new', 'in_progress', 'viewed', 'rejected']);
const PROFILE_REGIONS = new Set(['moscow', 'mo', 'other']);
const PROFILE_PROPERTY_TYPES = new Set(['office', 'warehouse', 'retail', 'production', 'free_purpose', 'apartment', 'land', 'other']);
const NON_NEGATIVE_DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredEnv(env, name) {
  const value = env[name];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function optionalEnv(env, name) {
  const value = env[name];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function assertEmail(value, name) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    throw new Error(`Invalid email format in ${name}`);
  }
  return value;
}

function isProductionUrl(value) {
  try {
    return PRODUCTION_HOSTS.has(new URL(value).hostname.toLowerCase());
  } catch {
    return false;
  }
}

function normalizeBaseUrl(value, name, env) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute http(s) URL`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`${name} must use http or https`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`${name} must not contain credentials`);
  }
  if ((parsed.pathname && parsed.pathname !== '/') || parsed.search || parsed.hash) {
    throw new Error(`${name} must be an origin URL without path, query or hash`);
  }
  const loopback = new Set(['localhost', '127.0.0.1', '[::1]']);
  if (parsed.protocol !== 'https:' && !loopback.has(parsed.hostname)) {
    throw new Error(`${name} must use HTTPS for a remote target`);
  }
  if (isProductionUrl(value) && env.SMOKE_ALLOW_PRODUCTION !== '1') {
    throw new Error(`${name} points to protected production; set SMOKE_ALLOW_PRODUCTION=1 explicitly`);
  }
  return parsed.origin;
}

function validateOptIn(env, name) {
  if (env[name] !== undefined && env[name] !== '' && env[name] !== '1') {
    throw new Error(`${name} must be exactly 1 when enabled`);
  }
  return env[name] === '1';
}

function trustedTargetPair(apiBaseUrl, uiBaseUrl) {
  return TRUSTED_TARGET_PAIRS.find(pair => pair.api === apiBaseUrl && pair.ui === uiBaseUrl) || null;
}

function createSmokeConfig(env = process.env, argv = []) {
  const local = argv.includes('--local');
  const apiValue = optionalEnv(env, 'SMOKE_API_URL') || (local ? 'http://127.0.0.1:1338' : null);
  const uiValue = optionalEnv(env, 'SMOKE_UI_URL') || (local ? 'http://127.0.0.1:5174' : null);
  if (!apiValue) throw new Error('Missing required environment variable: SMOKE_API_URL');
  if (!uiValue) throw new Error('Missing required environment variable: SMOKE_UI_URL');

  const allowMutations = validateOptIn(env, 'SMOKE_ALLOW_MUTATIONS');
  const allowProduction = validateOptIn(env, 'SMOKE_ALLOW_PRODUCTION');
  if (allowProduction && !PRODUCTION_HOSTS.has(new URL(apiValue).hostname.toLowerCase()) && !PRODUCTION_HOSTS.has(new URL(uiValue).hostname.toLowerCase())) {
    throw new Error('SMOKE_ALLOW_PRODUCTION=1 is only valid when a protected production URL is configured');
  }

  const roles = {
    admin: {
      label: 'admin',
      identifier: assertEmail(requiredEnv(env, 'SMOKE_ADMIN_EMAIL'), 'SMOKE_ADMIN_EMAIL'),
      password: requiredEnv(env, 'SMOKE_ADMIN_PASSWORD'),
    },
    userA: {
      label: 'user A',
      identifier: assertEmail(requiredEnv(env, 'SMOKE_USER_A_EMAIL'), 'SMOKE_USER_A_EMAIL'),
      password: requiredEnv(env, 'SMOKE_USER_A_PASSWORD'),
    },
    userB: {
      label: 'user B',
      identifier: assertEmail(requiredEnv(env, 'SMOKE_USER_B_EMAIL'), 'SMOKE_USER_B_EMAIL'),
      password: requiredEnv(env, 'SMOKE_USER_B_PASSWORD'),
    },
  };
  const identifiers = ROLE_NAMES.map(role => roles[role].identifier);
  if (new Set(identifiers).size !== identifiers.length) {
    throw new Error('SMOKE_ADMIN_EMAIL, SMOKE_USER_A_EMAIL and SMOKE_USER_B_EMAIL must identify three distinct accounts');
  }

  const fixture = {
    propertyId: optionalEnv(env, 'SMOKE_FIXTURE_PROPERTY_ID'),
    expectedTitle: optionalEnv(env, 'SMOKE_FIXTURE_EXPECTED_TITLE'),
    photoDocumentId: optionalEnv(env, 'SMOKE_PHOTO_DOCUMENT_ID'),
    photoFilename: optionalEnv(env, 'SMOKE_PHOTO_FILENAME'),
    foreignPropertyId: optionalEnv(env, 'SMOKE_FOREIGN_PROPERTY_ID'),
  };
  if ((fixture.photoDocumentId && !fixture.photoFilename) || (!fixture.photoDocumentId && fixture.photoFilename)) {
    throw new Error('SMOKE_PHOTO_DOCUMENT_ID and SMOKE_PHOTO_FILENAME must be provided together');
  }

  if (allowMutations) {
    if (env.SMOKE_MUTATION_CONFIRM !== MUTATION_CONFIRM) {
      throw new Error(`SMOKE_MUTATION_CONFIRM must equal ${MUTATION_CONFIRM} for fixture-only checks`);
    }
    if (!fixture.propertyId) {
      throw new Error('SMOKE_FIXTURE_PROPERTY_ID is required when SMOKE_ALLOW_MUTATIONS=1');
    }
    if (!fixture.expectedTitle) {
      throw new Error('SMOKE_FIXTURE_EXPECTED_TITLE is required when SMOKE_ALLOW_MUTATIONS=1');
    }
  }

  const apiBaseUrl = normalizeBaseUrl(apiValue, 'SMOKE_API_URL', env);
  const uiBaseUrl = normalizeBaseUrl(uiValue, 'SMOKE_UI_URL', env);
  const targetPair = trustedTargetPair(apiBaseUrl, uiBaseUrl);
  if (!targetPair) throw new Error('SMOKE_API_URL and SMOKE_UI_URL must match one trusted target pair');
  if (targetPair.kind === 'local' && !local) throw new Error('Loopback target pair requires --local');
  if (targetPair.kind !== 'local' && local) throw new Error('--local requires the loopback target pair');

  return {
    apiBaseUrl,
    uiBaseUrl,
    roles,
    allowMutations,
    fixture,
    secrets: ROLE_NAMES.flatMap(role => [roles[role].identifier, roles[role].password]),
  };
}

function maskIdentifier(value) {
  const text = String(value || '');
  const at = text.indexOf('@');
  if (at <= 0) return '[redacted]';
  return `${text.slice(0, 1)}***@***`;
}

function redactText(value, secrets = []) {
  let text = String(value || '')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED_JWT]')
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[REDACTED_EMAIL]');
  for (const secret of secrets) {
    if (secret) text = text.split(secret).join('[REDACTED]');
  }
  return text;
}

function safePathSegment(value, name) {
  if (typeof value !== 'string' || value.trim() === '' || value.includes('/') || value.includes('\\') || value.includes('..')) {
    throw new Error(`${name} must be a safe path segment`);
  }
  return encodeURIComponent(value);
}

function buildManualPipelineRequest(targetUserId) {
  if (!Number.isSafeInteger(targetUserId) || targetUserId <= 0) {
    throw new Error('targetUserId must be a positive safe integer');
  }
  return {
    method: 'POST',
    path: '/api/pipeline/start',
    body: { mode: 'full', targetUserId },
  };
}

function buildSmokePlan(config) {
  return {
    mode: 'read-only by default',
    noAuth: [
      { method: 'GET', path: '/_health', expect: [204] },
      { method: 'GET', path: '/api/properties', expect: DENIAL_STATUSES },
      { method: 'GET', path: '/api/properties/stats', expect: DENIAL_STATUSES },
      { method: 'GET', path: '/api/setting', expect: DENIAL_STATUSES },
      { method: 'GET', path: '/api/sources', expect: DENIAL_STATUSES },
      { method: 'GET', path: '/api/pipeline/status', expect: DENIAL_STATUSES },
      { method: 'GET', path: '/api/photos/<documentId>/<filename>', expect: DENIAL_STATUSES },
    ],
    authenticated: [
      { role: 'admin', method: 'GET', path: '/api/me/context', expect: 200 },
      { role: 'user A', method: 'GET', path: '/api/me/context', expect: 200 },
      { role: 'user B', method: 'GET', path: '/api/me/context', expect: 200 },
      { role: 'user A/B', method: 'GET', path: '/api/properties', expect: 200, scope: 'profile' },
      { role: 'user A/B', method: 'GET', path: '/api/properties/stats', expect: 200, scope: 'profile' },
      { role: 'user A/B', method: 'GET', path: '/api/properties/:documentId', expect: '200 own / 404 foreign' },
      { role: 'admin', method: 'GET', path: '/api/admin/user-profiles/:userId', expect: 200 },
    ],
    ordinaryUserGlobalBoundary: [
      { role: 'user A', method: 'GET', path: '/api/setting', expect: 403 },
      { role: 'user A', method: 'GET', path: '/api/sources', expect: 403 },
      { role: 'user A', method: 'GET', path: '/api/pipeline/status', expect: 403 },
      { role: 'user A', method: 'PUT', path: '/api/setting', expect: 403, mutation: true },
      { role: 'user A', method: 'PUT', path: '/api/sources/<id>', expect: 403, mutation: true },
      { role: 'user A', method: 'POST', path: '/api/pipeline/start', expect: 403, mutation: true },
    ],
    fixtureMutations: [
      { role: 'user A', method: 'PUT', path: '/api/me/properties/:documentId/status', expect: 'restore in finally' },
      { role: 'user A', method: 'POST', path: '/api/me/properties/:documentId/comments', expect: 'delete in finally' },
    ],
    adminManualPipeline: {
      request: '<not executed by smoke>',
      contract: buildManualPipelineRequest(1),
      note: 'Runtime manual pipeline acceptance is separate evidence; this harness never starts cron/queue work implicitly.',
    },
    runtimeNotes: [
      'Cron/digest fan-out requires an exact supported fixture/runtime API and is not emulated through public endpoints.',
      'Manual pipeline start is a side effect and is not called by the read-only harness.',
      'Set SMOKE_ALLOW_MUTATIONS=1 plus SMOKE_MUTATION_CONFIRM=fixture-only only for an isolated fixture.',
    ],
    target: config ? { api: 'configured', ui: 'configured' } : undefined,
  };
}

function createHttpClient({ baseUrl, fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is required');
  const origin = normalizeBaseUrl(baseUrl, 'baseUrl', { SMOKE_ALLOW_PRODUCTION: '1' });

  async function requestUrl(url, method = 'GET', options = {}) {
    const headers = { Accept: 'application/json', ...(options.headers || {}) };
    const init = { method, headers };
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }
    const controller = new AbortController();
    init.signal = controller.signal;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
    let response;
    try {
      response = await fetchImpl(url, init);
    } catch {
      throw new Error(`HTTP request failed: ${method}`);
    } finally {
      clearTimeout(timer);
    }
    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    return { status: response.status, ok: response.ok, data };
  }

  async function request(method, path, options = {}) {
    if (typeof path !== 'string' || !path.startsWith('/')) throw new Error('API path must start with /');
    return requestUrl(`${origin}${path}`, method, options);
  }

  async function login(credentials) {
    const response = await request('POST', '/api/auth/local', {
      body: { identifier: credentials.identifier, password: credentials.password },
    });
    const token = response.data?.jwt;
    const userId = response.data?.user?.id;
    if (response.status !== 200 || typeof token !== 'string' || token.length < 10 || !Number.isSafeInteger(userId) || userId <= 0) {
      throw new Error('login failed');
    }
    return { token, userId };
  }

  return { request, requestUrl, login, origin };
}

function assertStatus(response, expected, name) {
  const expectedStatuses = Array.isArray(expected) ? expected : [expected];
  if (!response || !expectedStatuses.includes(response.status)) {
    throw new Error(`${name}: unexpected HTTP status`);
  }
}

function assertDenied(response, name) {
  assertStatus(response, DENIAL_STATUSES, name);
}

function assertForbidden(response, name) {
  assertStatus(response, 403, name);
}

function responseData(response, name) {
  const value = response?.data?.data;
  if (value === undefined) throw new Error(`${name}: missing data envelope`);
  return value;
}

function responseRows(response, name) {
  const value = responseData(response, name);
  if (!Array.isArray(value)) throw new Error(`${name}: expected scoped list`);
  return value;
}

function responseStats(response, name) {
  const value = response?.data?.data ?? response?.data;
  if (!isRecord(value)) throw new Error(`${name}: expected stats DTO`);
  return value;
}

function rowId(row) {
  if (!isRecord(row)) return null;
  return typeof row.documentId === 'string' && row.documentId !== '' ? row.documentId : null;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).sort().join(',')}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function normalizedProfileArray(value, allowlist = null, maxItems = 128, maxLength = 256) {
  if (!Array.isArray(value)) throw new Error('profile response is malformed');
  const normalized = value.map(item => {
    if (typeof item !== 'string') throw new Error('profile response is malformed');
    const text = item.trim().toLowerCase();
    if (text === '' || text.length > maxLength || /[\u0000-\u001f\u007f]/.test(text)
      || (allowlist && !allowlist.has(text))) {
      throw new Error('profile response is malformed');
    }
    return text;
  });
  const canonical = [...new Set(normalized)].sort();
  if (canonical.length > maxItems) throw new Error('profile response is malformed');
  return canonical;
}

function normalizedBound(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) throw new Error('profile response is malformed');
    return value;
  }
  if (typeof value === 'string' && NON_NEGATIVE_DECIMAL.test(value)) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  throw new Error('profile response is malformed');
}

function normalizedRange(from, to) {
  const lower = normalizedBound(from);
  const upper = normalizedBound(to);
  if (lower !== null && upper !== null && lower > upper) {
    throw new Error('profile response is malformed');
  }
  return [lower, upper];
}

function rangesOverlap(left, right) {
  const [leftFrom, leftTo] = left;
  const [rightFrom, rightTo] = right;
  return (leftTo === null || rightFrom === null || leftTo >= rightFrom)
    && (rightTo === null || leftFrom === null || rightTo >= leftFrom);
}

function sharedValues(left, right) {
  const rightSet = new Set(right);
  return left.filter(value => rightSet.has(value));
}

function assertProfilesDistinctWithOverlap(left, right) {
  if (!isRecord(left) || !isRecord(right)) throw new Error('profile response is malformed');
  const profileShape = profile => ({
    regions: normalizedProfileArray(profile.regions, PROFILE_REGIONS),
    property_types: normalizedProfileArray(profile.property_types, PROFILE_PROPERTY_TYPES),
    price: normalizedRange(profile.price_from, profile.price_to),
    area: normalizedRange(profile.area_from, profile.area_to),
    stop_words: normalizedProfileArray(profile.stop_words),
  });
  const leftShape = profileShape(left);
  const rightShape = profileShape(right);
  if (stableJson(leftShape) === stableJson(rightShape)) throw new Error('user A and user B profiles are identical');
  const hasSharedCandidateScope = sharedValues(leftShape.regions, rightShape.regions).length > 0
    && sharedValues(leftShape.property_types, rightShape.property_types).length > 0
    && rangesOverlap(leftShape.price, rightShape.price)
    && rangesOverlap(leftShape.area, rightShape.area);
  if (!hasSharedCandidateScope) throw new Error('user A and user B profiles have no shared candidate scope');
  return true;
}

function assertListSeparation(leftRows, rightRows) {
  const leftIds = new Set(leftRows.map(rowId).filter(Boolean));
  const rightIds = new Set(rightRows.map(rowId).filter(Boolean));
  const leftOnly = [...leftIds].filter(id => !rightIds.has(id));
  const rightOnly = [...rightIds].filter(id => !leftIds.has(id));
  const equalPayload = stableJson(leftRows) === stableJson(rightRows);
  if (leftRows.length === 0 || rightRows.length === 0) {
    throw new Error('profile separation fixture returned an empty user list');
  }
  if (leftIds.size !== leftRows.length || rightIds.size !== rightRows.length) {
    throw new Error('scoped list contains a row without a stable property id');
  }
  if (leftOnly.length === 0 || rightOnly.length === 0) {
    throw new Error('user A and user B lists have no exclusive fixture rows');
  }
  if (equalPayload) {
    throw new Error('user A and user B lists are not separated');
  }
  return { leftOnly, rightOnly, overlap: [...leftIds].filter(id => rightIds.has(id)) };
}

function assertStatsSeparation(left, right) {
  if (stableJson(left) === stableJson(right)) {
    throw new Error('user A and user B stats are not separated');
  }
}

function extractCommentId(response) {
  const value = response?.data?.data ?? response?.data;
  if (!isRecord(value)) return null;
  const id = value.id ?? value.documentId;
  return id === undefined || id === null ? null : String(id);
}

function statusValue(response) {
  const value = response?.data?.data ?? response?.data;
  if (!isRecord(value) || typeof value.status !== 'string' || !PERSONAL_STATUSES.has(value.status)) {
    throw new Error('status response is malformed');
  }
  return value.status;
}

function logLine(logger, method, text) {
  const fn = logger && typeof logger[method] === 'function' ? logger[method] : logger && typeof logger.log === 'function' ? logger.log : null;
  if (fn) fn.call(logger, text);
}

function safeErrorMessage(error, secrets) {
  return redactText(error instanceof Error ? error.message : 'check failed', secrets)
    .replace(/https?:\/\/\S+/g, '[URL]')
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, '[HOST]');
}

async function runSmoke({ config, client, uiClient, logger = console } = {}) {
  if (!config || !client) throw new Error('runSmoke requires config and client');
  const result = { passed: [], failed: [], skipped: [] };
  const check = async (name, fn) => {
    try {
      await fn();
      result.passed.push(name);
      logLine(logger, 'log', `  ✅ ${name}`);
    } catch (error) {
      const detail = safeErrorMessage(error, config.secrets);
      result.failed.push({ name, detail });
      logLine(logger, 'log', `  ❌ ${name} — ${detail}`);
    }
  };
  const skip = (name, reason) => {
    result.skipped.push({ name, reason });
    logLine(logger, 'log', `  ⏭️ ${name} — ${reason}`);
  };

  logLine(logger, 'log', '\n🧪 AKLAB multi-user smoke (read-only by default)');

  await check('API health is public', async () => {
    const response = await client.request('GET', '/_health');
    assertStatus(response, 204, 'health');
  });
  if (uiClient) {
    await check('Frontend health responds', async () => {
      const response = await uiClient.requestUrl(uiClient.origin, 'GET', { headers: { Accept: 'text/html' } });
      assertStatus(response, [200, 304], 'frontend');
    });
  } else {
    skip('Frontend health responds', 'UI client not supplied');
  }

  const noAuthChecks = [
    ['No-auth properties are denied', '/api/properties'],
    ['No-auth property stats are denied', '/api/properties/stats'],
    ['No-auth settings are denied', '/api/setting'],
    ['No-auth sources are denied', '/api/sources'],
    ['No-auth pipeline status is denied', '/api/pipeline/status'],
  ];
  for (const [name, path] of noAuthChecks) {
    await check(name, async () => assertDenied(await client.request('GET', path), name));
  }
  const photoDocumentId = config.fixture.photoDocumentId || 'smoke-document';
  const photoFilename = config.fixture.photoFilename || 'smoke.jpg';
  await check('No-auth photos are denied', async () => {
    const path = `/api/photos/${safePathSegment(photoDocumentId, 'photo document')}/${safePathSegment(photoFilename, 'photo filename')}`;
    assertDenied(await client.request('GET', path), 'photo');
  });

  const sessions = {};
  for (const role of ROLE_NAMES) {
    await check(`Login ${config.roles[role].label}`, async () => {
      sessions[role] = await client.login(config.roles[role]);
    });
  }
  if (ROLE_NAMES.some(role => !sessions[role])) {
    skip('Authenticated multi-user checks', 'one or more role logins failed');
    skip('Cron/digest runtime evidence', 'not emulated by this harness; run the separate dev acceptance procedure');
    return result;
  }

  for (const role of ROLE_NAMES) {
    await check(`${config.roles[role].label} /me/context`, async () => {
      const response = await client.request('GET', '/api/me/context', { token: sessions[role].token });
      assertStatus(response, 200, 'context');
      const context = responseData(response, 'context');
      if (!isRecord(context) || context.user?.id !== sessions[role].userId || (role !== 'admin' && context.profileReady !== true) || context.multiuserEnabled !== true) {
        throw new Error('context does not confirm active scoped multi-user session');
      }
      const roleType = context.role?.type;
      if (role === 'admin' && roleType !== ADMIN_ROLE_TYPE) throw new Error('admin role is not AKLAB Admin');
      if (role !== 'admin' && roleType === ADMIN_ROLE_TYPE) throw new Error('ordinary user has admin role');
    });
  }

  const profiles = {};
  for (const role of ['userA', 'userB']) {
    await check(`${config.roles[role].label} profile`, async () => {
      const response = await client.request('GET', '/api/me/profile', { token: sessions[role].token });
      assertStatus(response, 200, 'profile');
      const profile = responseData(response, 'profile');
      if (!isRecord(profile) || profile.user_id !== sessions[role].userId || !Array.isArray(profile.regions) || !Array.isArray(profile.property_types)) {
        throw new Error('profile ownership or filter fields are invalid');
      }
      profiles[role] = profile;
    });
  }
  if (profiles.userA && profiles.userB) {
    await check('User A and user B profiles are distinct with overlap', async () => assertProfilesDistinctWithOverlap(profiles.userA, profiles.userB));
  }

  const scoped = {};
  for (const role of ['userA', 'userB']) {
    scoped[role] = {};
    await check(`${config.roles[role].label} scoped list`, async () => {
      const response = await client.request('GET', '/api/properties?page=1&pageSize=100', { token: sessions[role].token });
      assertStatus(response, 200, 'properties');
      scoped[role].rows = responseRows(response, 'properties');
    });
    await check(`${config.roles[role].label} scoped stats`, async () => {
      const response = await client.request('GET', '/api/properties/stats', { token: sessions[role].token });
      assertStatus(response, 200, 'stats');
      scoped[role].stats = responseStats(response, 'stats');
    });
  }
  if (scoped.userA?.rows && scoped.userB?.rows) {
    let separation;
    await check('User A and user B lists are separated', async () => {
      separation = assertListSeparation(scoped.userA.rows, scoped.userB.rows);
    });
    if (separation) {
      if (config.fixture.foreignPropertyId && !separation.leftOnly.includes(config.fixture.foreignPropertyId)) {
        throw new Error('SMOKE_FOREIGN_PROPERTY_ID must be present only in user A scoped list');
      }
      const foreignId = config.fixture.foreignPropertyId || separation.leftOnly[0];
      const ownId = separation.leftOnly[0] || separation.rightOnly[0] || rowId(scoped.userA.rows[0]);
      if (ownId) {
        await check('Scoped detail is available to the matching user', async () => {
          const response = await client.request('GET', `/api/properties/${encodeURIComponent(ownId)}`, { token: sessions.userA.token });
          assertStatus(response, 200, 'own detail');
        });
      } else {
        skip('Scoped detail is available to the matching user', 'no property fixture in user A list');
      }
      if (foreignId) {
        await check('Foreign scoped detail returns 404', async () => {
          const response = await client.request('GET', `/api/properties/${encodeURIComponent(foreignId)}`, { token: sessions.userB.token });
          assertStatus(response, 404, 'foreign detail');
        });
      } else {
        skip('Foreign scoped detail returns 404', 'no user-A-only property fixture');
      }
    }
  }
  if (scoped.userA?.stats && scoped.userB?.stats) {
    await check('User A and user B stats are separated', async () => assertStatsSeparation(scoped.userA.stats, scoped.userB.stats));
  }

  await check('Ordinary user cannot read global settings', async () => assertForbidden(await client.request('GET', '/api/setting', { token: sessions.userA.token }), 'settings'));
  await check('Ordinary user cannot read global sources', async () => assertForbidden(await client.request('GET', '/api/sources', { token: sessions.userA.token }), 'sources'));
  await check('Ordinary user cannot read pipeline telemetry', async () => assertForbidden(await client.request('GET', '/api/pipeline/status', { token: sessions.userA.token }), 'pipeline'));

  await check('Admin can read user B target profile', async () => {
    const response = await client.request('GET', `/api/admin/user-profiles/${sessions.userB.userId}`, { token: sessions.admin.token });
    assertStatus(response, 200, 'admin target profile');
    const profile = responseData(response, 'admin target profile');
    if (!isRecord(profile) || profile.user_id !== sessions.userB.userId) throw new Error('admin target profile mismatch');
  });
  await check('Admin manual pipeline target contract is explicit', async () => {
    const request = buildManualPipelineRequest(sessions.userB.userId);
    if (request.body.targetUserId !== sessions.userB.userId || request.body.mode !== 'full') throw new Error('manual pipeline target contract mismatch');
  });

  if (config.fixture.photoDocumentId && config.fixture.photoFilename) {
    await check('Scoped photo is available to user A and hidden from user B', async () => {
      const path = `/api/photos/${safePathSegment(config.fixture.photoDocumentId, 'photo document')}/${safePathSegment(config.fixture.photoFilename, 'photo filename')}`;
      const [allowed, foreign] = await Promise.all([
        client.request('GET', path, { token: sessions.userA.token }),
        client.request('GET', path, { token: sessions.userB.token }),
      ]);
      assertStatus(allowed, 200, 'scoped photo');
      assertStatus(foreign, 404, 'foreign scoped photo');
    });
  } else {
    skip('Scoped photo is available to user A and hidden from user B', 'set an A-only SMOKE_PHOTO_DOCUMENT_ID and SMOKE_PHOTO_FILENAME');
  }

  if (config.allowMutations) {
    await runMutationChecks({ config, client, sessions, check });
  } else {
    skip('Status/comment isolation', 'read-only by default; opt in with SMOKE_ALLOW_MUTATIONS=1 and fixture-only confirmation');
    skip('Ordinary-user mutation denial', 'mutation probes are opt-in and use no-op payloads');
  }

  skip('Cron/digest runtime evidence', 'not emulated through unsupported public endpoints; verify exact cron fan-out manually in dev acceptance');
  skip('Manual pipeline execution', 'contract checked without starting a run; execute only as separate explicitly approved runtime evidence');
  return result;
}

async function runMutationChecks({ config, client, sessions, check }) {
  const propertyId = config.fixture.propertyId;
  const encodedPropertyId = encodeURIComponent(propertyId);

  let fixtureVisible = false;
  await check('Mutation fixture is visible to both users', async () => {
    const [a, b] = await Promise.all([
      client.request('GET', `/api/properties/${encodedPropertyId}`, { token: sessions.userA.token }),
      client.request('GET', `/api/properties/${encodedPropertyId}`, { token: sessions.userB.token }),
    ]);
    assertStatus(a, 200, 'user A fixture');
    assertStatus(b, 200, 'user B fixture');
    const dtoA = a?.data?.data;
    const dtoB = b?.data?.data;
    if (dtoA?.documentId !== propertyId || dtoB?.documentId !== propertyId
      || dtoA?.title !== config.fixture.expectedTitle || dtoB?.title !== config.fixture.expectedTitle) {
      throw new Error('mutation fixture identity/title does not match the dedicated fixture');
    }
    fixtureVisible = true;
  });
  if (!fixtureVisible) return;

  let originalStatusA = 'new';
  let originalStatusB = 'new';
  let fixtureReady = false;
  try {
    const [initialA, initialB] = await Promise.all([
      client.request('GET', `/api/me/properties/${encodedPropertyId}/status`, { token: sessions.userA.token }),
      client.request('GET', `/api/me/properties/${encodedPropertyId}/status`, { token: sessions.userB.token }),
    ]);
    assertStatus(initialA, 200, 'initial user A status');
    assertStatus(initialB, 200, 'initial user B status');
    originalStatusA = statusValue(initialA);
    originalStatusB = statusValue(initialB);
    fixtureReady = true;
  } catch {
    fixtureReady = false;
  }

  if (fixtureReady) {
    await check('Status change is isolated and restored', async () => {
      const statusPath = `/api/me/properties/${encodedPropertyId}/status`;
      const changedStatus = originalStatusA === 'in_progress' ? 'viewed' : 'in_progress';
      try {
        const changed = await client.request('PUT', statusPath, {
          token: sessions.userA.token,
          body: { data: { status: changedStatus } },
        });
        assertStatus(changed, 200, 'status update');
        const [a, b] = await Promise.all([
          client.request('GET', statusPath, { token: sessions.userA.token }),
          client.request('GET', statusPath, { token: sessions.userB.token }),
        ]);
        assertStatus(a, 200, 'user A changed status');
        assertStatus(b, 200, 'user B status');
        if (statusValue(a) !== changedStatus) throw new Error('user A status did not change');
        if (statusValue(b) !== originalStatusB) throw new Error('user B status changed with user A');
      } finally {
        let restoreError;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            const restored = originalStatusA === 'new'
              ? await client.request('DELETE', statusPath, { token: sessions.userA.token })
              : await client.request('PUT', statusPath, { token: sessions.userA.token, body: { data: { status: originalStatusA } } });
            assertStatus(restored, [200, 204], 'status restore');
            restoreError = null;
            break;
          } catch (error) {
            restoreError = error;
          }
        }
        if (restoreError) throw new Error('fixture status cleanup failed after retries; manual cleanup is required');
      }
    });
  } else {
    await check('Status change is isolated and restored', async () => {
      throw new Error('initial status was unavailable; mutation was not attempted');
    });
  }

  await check('Comment change is isolated and restored', async () => {
    const marker = `smoke-fixture-${randomUUID()}`;
    let createAccepted = false;
    let commentId = null;
    try {
      const created = await client.request('POST', `/api/me/properties/${encodedPropertyId}/comments`, {
        token: sessions.userA.token,
        body: { data: { text: marker } },
      });
      createAccepted = created.status === 201 || created.status === 200;
      if (!createAccepted) throw new Error('comment create was not accepted');
      commentId = extractCommentId(created);
      if (!commentId) {
        const lookup = await client.request('GET', `/api/me/properties/${encodedPropertyId}/comments`, { token: sessions.userA.token });
        assertStatus(lookup, 200, 'comment cleanup lookup');
        const comments = Array.isArray(lookup.data) ? lookup.data : lookup.data?.data;
        const matches = Array.isArray(comments) ? comments.filter(item => item?.text === marker) : [];
        if (matches.length === 1) commentId = extractCommentId({ data: matches[0] });
      }
      if (!commentId) throw new Error('comment id missing after marker lookup; manual cleanup is required');
      const [a, b] = await Promise.all([
        client.request('GET', `/api/me/properties/${encodedPropertyId}/comments`, { token: sessions.userA.token }),
        client.request('GET', `/api/me/properties/${encodedPropertyId}/comments`, { token: sessions.userB.token }),
      ]);
      assertStatus(a, 200, 'user A comments');
      assertStatus(b, 200, 'user B comments');
      const aComments = Array.isArray(a.data) ? a.data : a.data?.data;
      const bComments = Array.isArray(b.data) ? b.data : b.data?.data;
      if (!Array.isArray(aComments) || !aComments.some(item => String(item?.id ?? item?.documentId) === commentId)) {
        throw new Error('user A cannot read its fixture comment');
      }
      if (!Array.isArray(bComments) || bComments.some(item => String(item?.id ?? item?.documentId) === commentId)) {
        throw new Error('user B can read user A comment');
      }
    } finally {
      if (createAccepted && !commentId) throw new Error('comment was created without an id; manual cleanup is required');
      if (commentId) {
        let cleanupError;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            const response = await client.request('DELETE', `/api/me/properties/${encodedPropertyId}/comments/${encodeURIComponent(commentId)}`, { token: sessions.userA.token });
            assertStatus(response, [200, 204], 'comment restore');
            cleanupError = null;
            break;
          } catch (error) {
            cleanupError = error;
          }
        }
        if (cleanupError) throw new Error('fixture comment cleanup failed after retries; manual cleanup is required');
      }
    }
  });

  const denialProbes = [
    ['Ordinary user cannot mutate global settings', 'PUT', '/api/setting', { data: {} }],
    ['Ordinary user cannot mutate global sources', 'PUT', '/api/sources/__smoke_denied__', { data: {} }],
    ['Ordinary user cannot start a pipeline', 'POST', '/api/pipeline/start', {}],
  ];
  for (const [name, method, path, body] of denialProbes) {
    await check(name, async () => {
      const response = await client.request(method, path, { token: sessions.userA.token, body });
      assertForbidden(response, name);
    });
  }
}

function helpText() {
  return `AKLAB multi-user smoke harness\n\nUsage:\n  node scripts/smoke-test.js              # explicit dev acceptance target\n  node scripts/smoke-test.js --local      # only with explicit fixture credentials\n  node scripts/smoke-test.js --print-plan # validate env and print no-network plan\n  node scripts/smoke-test.js --help\n\nRequired environment:\n  SMOKE_API_URL, SMOKE_UI_URL\n  SMOKE_ADMIN_EMAIL, SMOKE_ADMIN_PASSWORD\n  SMOKE_USER_A_EMAIL, SMOKE_USER_A_PASSWORD\n  SMOKE_USER_B_EMAIL, SMOKE_USER_B_PASSWORD\n\nOptional fixture environment:\n  SMOKE_PHOTO_DOCUMENT_ID, SMOKE_PHOTO_FILENAME\n  SMOKE_FOREIGN_PROPERTY_ID, SMOKE_FIXTURE_PROPERTY_ID\n  SMOKE_FIXTURE_EXPECTED_TITLE (required with mutation opt-in)\n\nMutations are disabled by default. Fixture-only status/comment probes require:\n  SMOKE_ALLOW_MUTATIONS=1 SMOKE_MUTATION_CONFIRM=fixture-only\n\nProduction URLs are rejected unless SMOKE_ALLOW_PRODUCTION=1 is explicit.\nCron/queue fan-out and manual pipeline execution are separate runtime evidence.\n`;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help')) {
    process.stdout.write(helpText());
    return;
  }
  try {
    const config = createSmokeConfig(process.env, argv);
    if (argv.includes('--print-plan')) {
      process.stdout.write(`${JSON.stringify(buildSmokePlan(config), null, 2)}\n`);
      return;
    }
    const client = createHttpClient({ baseUrl: config.apiBaseUrl });
    const uiClient = createHttpClient({ baseUrl: config.uiBaseUrl });
    const result = await runSmoke({ config, client, uiClient });
    process.stdout.write(`\nSummary: passed=${result.passed.length} failed=${result.failed.length} skipped=${result.skipped.length}\n`);
    if (result.failed.length > 0) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${safeErrorMessage(error, [])}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  ADMIN_ROLE_TYPE,
  DENIAL_STATUSES,
  MUTATION_CONFIRM,
  assertDenied,
  assertForbidden,
  assertListSeparation,
  assertProfilesDistinctWithOverlap,
  assertStatsSeparation,
  buildManualPipelineRequest,
  buildSmokePlan,
  createHttpClient,
  createSmokeConfig,
  maskIdentifier,
  redactText,
  runMutationChecks,
  runSmoke,
};

if (require.main === module) {
  main().catch(() => {
    process.exitCode = 1;
  });
}
