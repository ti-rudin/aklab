import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  assertListSeparation,
  assertProfilesDistinctWithOverlap,
  buildManualPipelineRequest,
  buildSmokePlan,
  createSmokeConfig,
  redactText,
  runMutationChecks,
} from '../smoke-test.js';

const ROOT = new URL('../../', import.meta.url);
const SCRIPT = new URL('scripts/smoke-test.js', ROOT);
const PLAYWRIGHT_SPEC = new URL('app/e2e/vue.spec.ts', ROOT);

const SAFE_ENV = {
  SMOKE_API_URL: 'https://api-aklab-dev.tirobots.ru',
  SMOKE_UI_URL: 'https://aklab-dev.tirobots.ru',
  SMOKE_ADMIN_EMAIL: 'admin@example.test',
  SMOKE_ADMIN_PASSWORD: 'admin-secret',
  SMOKE_USER_A_EMAIL: 'user-a@example.test',
  SMOKE_USER_A_PASSWORD: 'user-a-secret',
  SMOKE_USER_B_EMAIL: 'user-b@example.test',
  SMOKE_USER_B_PASSWORD: 'user-b-secret',
};

function runSmokeCli(...args: string[]) {
  return spawnSync(process.execPath, [SCRIPT.pathname, ...args], {
    cwd: ROOT.pathname,
    encoding: 'utf8',
    env: { ...process.env, ...SAFE_ENV },
  });
}

describe('multiuser smoke CLI contract', () => {
  it('provides a network-free help command', () => {
    const result = runSmokeCli('--help');

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('SMOKE_ADMIN_EMAIL');
    expect(result.stdout).toContain('SMOKE_USER_A_EMAIL');
    expect(result.stdout).toContain('SMOKE_USER_B_EMAIL');
    expect(result.stdout).not.toContain('admin-secret');
  });

  it('prints a redacted read-only plan without making requests', () => {
    const result = runSmokeCli('--print-plan');

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('read-only');
    expect(result.stdout).toContain('/api/me/context');
    expect(result.stdout).toContain('/api/properties/stats');
    expect(result.stdout).toContain('/api/photos/');
    expect(result.stdout).not.toContain('admin@example.test');
    expect(result.stdout).not.toContain('admin-secret');
    expect(result.stdout).not.toContain('user-a@example.test');
    expect(result.stdout).not.toContain('user-b@example.test');
  });

  it('requires explicit environment and never falls back to production credentials', () => {
    const result = spawnSync(process.execPath, [SCRIPT.pathname, '--print-plan'], {
      cwd: ROOT.pathname,
      encoding: 'utf8',
      env: {
        ...process.env,
        SMOKE_API_URL: '',
        SMOKE_UI_URL: '',
        SMOKE_ADMIN_EMAIL: '',
        SMOKE_ADMIN_PASSWORD: '',
        SMOKE_USER_A_EMAIL: '',
        SMOKE_USER_A_PASSWORD: '',
        SMOKE_USER_B_EMAIL: '',
        SMOKE_USER_B_PASSWORD: '',
      },
    });

    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).toContain('SMOKE_API_URL');
    expect(result.stdout + result.stderr).not.toContain('aklab.tirobots.ru');
    expect(result.stdout + result.stderr).not.toContain('TEST_USER_');
  });
});

describe('multiuser smoke source boundary', () => {
  it('does not retain the legacy single-user endpoint or global user assumptions', () => {
    const source = readFileSync(SCRIPT, 'utf8');

    expect(source).not.toContain('/users/me');
    expect(source).not.toContain('TEST_USER_EMAIL');
    expect(source).not.toContain('TEST_USER_PASSWORD');
    expect(source).toContain('/api/me/context');
    expect(source).toContain('SMOKE_ALLOW_MUTATIONS');
    expect(source).toContain('SMOKE_MUTATION_CONFIRM');
    expect(source).toContain('/api/properties?page=1&pageSize=100');
    expect(source).not.toContain('pagination%5BpageSize%5D');
    expect(source).not.toContain("{ mode: 'full', targetUserId: sessions.userB.userId }");
    expect(source).not.toContain('row.document_id');
  });

  it('gates the Playwright acceptance spec on explicit multiuser test env', () => {
    const source = readFileSync(PLAYWRIGHT_SPEC, 'utf8');

    expect(source).toContain('test.skip');
    expect(source).toContain('SMOKE_ADMIN_EMAIL');
    expect(source).toContain('SMOKE_USER_A_EMAIL');
    expect(source).toContain('SMOKE_USER_B_EMAIL');
    expect(source).not.toContain('TEST_USER_EMAIL');
    expect(source).not.toContain('TEST_USER_PASSWORD');
    expect(source).toContain('E2E_ALLOW_PRODUCTION');
  });
});

describe('multiuser smoke helpers', () => {
  it('keeps secrets out of diagnostic text and makes the manual target explicit', () => {
    expect(redactText('email=admin@example.test jwt=eyJheader.eyJpayload.eyJsignature', ['admin@example.test'])).toBe(
      'email=[REDACTED_EMAIL] jwt=[REDACTED_JWT]',
    );
    expect(buildManualPipelineRequest(17)).toEqual({
      method: 'POST',
      path: '/api/pipeline/start',
      body: { mode: 'full', targetUserId: 17 },
    });
    expect(buildSmokePlan({}).noAuth.some((entry: { path: string }) => entry.path === '/api/photos/<documentId>/<filename>')).toBe(true);
    expect(() => assertListSeparation([{ documentId: 'shared' }], [{ documentId: 'shared' }])).toThrow('exclusive fixture rows');
    expect(() => assertListSeparation([], [])).toThrow('empty user list');
  });

  it('requires distinct profiles with a controlled shared candidate scope', () => {
    const left = {
      regions: ['moscow', 'other'],
      property_types: ['free_purpose'],
      price_from: 100,
      price_to: 1000,
      area_from: null,
      area_to: null,
      stop_words: ['left-only'],
    };
    const right = {
      regions: ['other'],
      property_types: ['free_purpose', 'office'],
      price_from: 500,
      price_to: 2000,
      area_from: null,
      area_to: null,
      stop_words: ['right-only'],
    };

    expect(assertProfilesDistinctWithOverlap(left, right)).toBe(true);
    expect(assertProfilesDistinctWithOverlap(left, {
      ...right,
      stop_words: [
        ...Array.from({ length: 129 }, () => 'duplicate'),
        ...Array.from({ length: 127 }, (_, index) => `word-${index}`),
      ],
    })).toBe(true);
    expect(() => assertProfilesDistinctWithOverlap(left, {
      ...right,
      stop_words: Array.from({ length: 129 }, (_, index) => `unique-${index}`),
    })).toThrow('profile response is malformed');
    expect(() => assertProfilesDistinctWithOverlap(left, { ...left })).toThrow('profiles are identical');
    expect(() => assertProfilesDistinctWithOverlap(left, {
      ...left,
      regions: [' OTHER ', 'MOSCOW', 'moscow'],
      property_types: [' FREE_PURPOSE ', 'free_purpose'],
      price_from: '100',
      price_to: '1000',
      stop_words: [' LEFT-ONLY ', 'left-only'],
    })).toThrow('profiles are identical');
    expect(() => assertProfilesDistinctWithOverlap(left, { ...right, regions: ['mo'] })).toThrow('shared candidate scope');
    expect(() => assertProfilesDistinctWithOverlap(left, { ...right, property_types: ['office'] })).toThrow('shared candidate scope');
    expect(() => assertProfilesDistinctWithOverlap(left, { ...right, price_from: 2001, price_to: 3000 })).toThrow('shared candidate scope');

    for (const malformed of [
      { ...right, price_from: '' },
      { ...right, price_from: true },
      { ...right, price_from: -1 },
      { ...right, price_from: '01' },
      { ...right, price_from: '1e3' },
      { ...right, price_from: Number.NaN },
      { ...right, price_from: Number.POSITIVE_INFINITY },
      { ...right, regions: [42] },
      { ...right, regions: [' '] },
      { ...right, regions: ['unknown-region'] },
      { ...right, property_types: ['unknown-type'] },
      { ...right, stop_words: [false] },
    ]) {
      expect(() => assertProfilesDistinctWithOverlap(left, malformed)).toThrow('profile response is malformed');
    }
  });

  it('rejects insecure remote URLs, embedded credentials and base paths', () => {
    expect(() => createSmokeConfig({ ...SAFE_ENV, SMOKE_API_URL: 'http://dev.example.test' }, [])).toThrow('HTTPS');
    expect(() => createSmokeConfig({ ...SAFE_ENV, SMOKE_API_URL: 'https://name:secret@dev.example.test' }, [])).toThrow('credentials');
    expect(() => createSmokeConfig({ ...SAFE_ENV, SMOKE_API_URL: 'https://dev.example.test/api' }, [])).toThrow('origin URL');
  });

  it('rejects unknown and mixed target pairs', () => {
    expect(() => createSmokeConfig({ ...SAFE_ENV, SMOKE_UI_URL: 'https://unknown.example.test' }, [])).toThrow('trusted target pair');
    expect(() => createSmokeConfig({ ...SAFE_ENV, SMOKE_API_URL: 'https://api-aklab.tirobots.ru' }, [])).toThrow();
  });

  it('requires an exact dedicated fixture title for mutation opt-in', () => {
    expect(() => createSmokeConfig({
      ...SAFE_ENV,
      SMOKE_ALLOW_MUTATIONS: '1',
      SMOKE_MUTATION_CONFIRM: 'fixture-only',
      SMOKE_FIXTURE_PROPERTY_ID: 'fixture-property',
    }, [])).toThrow('SMOKE_FIXTURE_EXPECTED_TITLE');
  });

  it('does not write a mutation when the shared fixture is not visible to both users', async () => {
    const calls: Array<{ method: string; path: string }> = [];
    const client = {
      async request(method: string, path: string, options?: { token?: string }) {
        calls.push({ method, path });
        if (path.includes('/api/properties/fixture-property')) {
          return { status: options?.token === 'b-token' ? 404 : 200, data: { data: {} } };
        }
        if (path.includes('/status')) return { status: 200, data: { data: { status: 'new' } } };
        return { status: 403, data: {} };
      },
    };
    const checks: string[] = [];
    const check = async (name: string, fn: () => Promise<void>) => {
      try {
        await fn();
      } catch {
        checks.push(name);
      }
    };

    await runMutationChecks({
      config: { fixture: { propertyId: 'fixture-property', expectedTitle: 'Dedicated fixture' }, secrets: [] },
      client,
      sessions: {
        userA: { token: 'a-token', userId: 1 },
        userB: { token: 'b-token', userId: 2 },
      },
      check,
    });

    expect(checks).toContain('Mutation fixture is visible to both users');
    expect(calls.some(call => call.method === 'PUT' && call.path.includes('/status'))).toBe(false);
  });

  it('compares user B with its own initial status and restores user A', async () => {
    let statusA = 'viewed';
    const statusB = 'rejected';
    const statusWrites: string[] = [];
    let commentMarker = '';
    let cleanupAttempts = 0;
    const client = {
      async request(method: string, path: string, options?: { token?: string; body?: any }) {
        if (path === '/api/properties/fixture-property') return { status: 200, data: { data: { documentId: 'fixture-property', title: 'Dedicated fixture' } } };
        if (path.endsWith('/status') && method === 'GET') {
          return { status: 200, data: { data: { status: options?.token === 'a-token' ? statusA : statusB } } };
        }
        if (path.endsWith('/status') && method === 'PUT') {
          statusA = options?.body?.data?.status;
          statusWrites.push(statusA);
          return { status: 200, data: { data: { status: statusA } } };
        }
        if (path.endsWith('/comments') && method === 'POST') {
          commentMarker = options?.body?.data?.text;
          return { status: 201, data: { data: {} } };
        }
        if (path.endsWith('/comments') && method === 'GET') {
          return { status: 200, data: { data: options?.token === 'a-token' ? [{ id: 91, text: commentMarker }] : [] } };
        }
        if (path.endsWith('/comments/91') && method === 'DELETE') {
          cleanupAttempts += 1;
          return { status: cleanupAttempts < 3 ? 503 : 204, data: null };
        }
        return { status: 403, data: null };
      },
    };
    const check = async (_name: string, fn: () => Promise<void>) => fn();

    await runMutationChecks({
      config: { fixture: { propertyId: 'fixture-property', expectedTitle: 'Dedicated fixture' }, secrets: [] },
      client,
      sessions: {
        userA: { token: 'a-token', userId: 1 },
        userB: { token: 'b-token', userId: 2 },
      },
      check,
    });

    expect(statusWrites).toEqual(['in_progress', 'viewed']);
    expect(statusA).toBe('viewed');
    expect(cleanupAttempts).toBe(3);
  });
});
