import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  assertListSeparation,
  buildManualPipelineRequest,
  buildSmokePlan,
  redactText,
  runMutationChecks,
} from '../smoke-test.js';

const ROOT = new URL('../../', import.meta.url);
const SCRIPT = new URL('scripts/smoke-test.js', ROOT);
const PLAYWRIGHT_SPEC = new URL('app/e2e/vue.spec.ts', ROOT);

const SAFE_ENV = {
  SMOKE_API_URL: 'https://aklab-dev.example.test',
  SMOKE_UI_URL: 'https://aklab-dev.example.test',
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
    expect(() => assertListSeparation([{ id: 1 }], [{ id: 1 }], true)).toThrow('exclusive fixture rows');
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
      config: { fixture: { propertyId: 'fixture-property' }, secrets: [] },
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
});
