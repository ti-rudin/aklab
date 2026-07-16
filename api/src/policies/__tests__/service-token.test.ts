import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import serviceToken from '../service-token';

const TEST_TOKEN = 'unit-test-service-token';

function makeCtx(headers: Record<string, string> = {}) {
  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
  );

  return {
    status: 200,
    body: undefined as unknown,
    get: vi.fn((name: string) => normalizedHeaders[name.toLowerCase()] ?? ''),
  };
}

async function authorize(headers: Record<string, string> = {}) {
  const ctx = makeCtx(headers);
  const allowed = await serviceToken(ctx as any);
  return { allowed, ctx };
}

describe('service-token policy', () => {
  const originalToken = process.env.STRAPI_API_TOKEN;

  beforeEach(() => {
    process.env.STRAPI_API_TOKEN = TEST_TOKEN;
  });

  afterEach(() => {
    if (originalToken === undefined) {
      delete process.env.STRAPI_API_TOKEN;
    } else {
      process.env.STRAPI_API_TOKEN = originalToken;
    }
  });

  it('allows an exact X-AKLAB-Service-Token header', async () => {
    const { allowed, ctx } = await authorize({
      'X-AKLAB-Service-Token': TEST_TOKEN,
    });

    expect(allowed).toBe(true);
    expect(ctx.status).toBe(200);
  });

  it('allows the temporary exact Authorization Bearer compatibility token', async () => {
    const { allowed, ctx } = await authorize({
      Authorization: `Bearer ${TEST_TOKEN}`,
    });

    expect(allowed).toBe(true);
    expect(ctx.status).toBe(200);
  });

  it('rejects a mismatched service-token header without returning credentials', async () => {
    const { allowed, ctx } = await authorize({
      'X-AKLAB-Service-Token': 'wrong-unit-test-token',
    });

    expect(allowed).toBe(false);
    expect(ctx.status).toBe(401);
    expect(ctx.body).toEqual({ error: 'Unauthorized' });
    expect(JSON.stringify(ctx.body)).not.toContain(TEST_TOKEN);
  });

  it('does not accept a JWT-shaped Authorization bearer value', async () => {
    const { allowed, ctx } = await authorize({
      Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.test.signature',
    });

    expect(allowed).toBe(false);
    expect(ctx.status).toBe(401);
    expect(ctx.body).toEqual({ error: 'Unauthorized' });
  });

  it('rejects requests without either service credential', async () => {
    const { allowed, ctx } = await authorize();

    expect(allowed).toBe(false);
    expect(ctx.status).toBe(401);
    expect(ctx.body).toEqual({ error: 'Unauthorized' });
  });

  it('fails closed when STRAPI_API_TOKEN is missing or malformed', async () => {
    delete process.env.STRAPI_API_TOKEN;
    const missingEnv = await authorize({ 'X-AKLAB-Service-Token': TEST_TOKEN });

    expect(missingEnv.allowed).toBe(false);
    expect(missingEnv.ctx.status).toBe(401);

    process.env.STRAPI_API_TOKEN = ` ${TEST_TOKEN} `;
    const malformedEnv = await authorize({ 'X-AKLAB-Service-Token': TEST_TOKEN });

    expect(malformedEnv.allowed).toBe(false);
    expect(malformedEnv.ctx.status).toBe(401);
  });

  it('rejects a different-length token without throwing', async () => {
    await expect(authorize({ 'X-AKLAB-Service-Token': 'short' })).resolves.toMatchObject({
      allowed: false,
      ctx: { status: 401, body: { error: 'Unauthorized' } },
    });
  });
});
