import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@strapi/utils', () => ({
  errors: {
    UnauthorizedError: class UnauthorizedError extends Error {
      constructor(message = 'Unauthorized') {
        super(message);
        this.name = 'UnauthorizedError';
      }
    },
  },
}));

import serviceToken from '../service-token';

const TEST_TOKEN = 'unit-test-service-token';

function makeCtx(headers: Record<string, string> = {}) {
  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
  );

  return {
    status: 200,
    body: undefined as unknown,
    // Strapi wraps Koa context with Object.assign(), so policies receive
    // the request object, not Koa's prototype get() helper.
    request: { headers: normalizedHeaders },
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
    const ctx = makeCtx({ 'X-AKLAB-Service-Token': 'wrong-unit-test-token' });

    await expect(serviceToken(ctx as any)).rejects.toMatchObject({
      name: 'UnauthorizedError',
      message: 'Unauthorized',
    });
  });

  it('does not accept a JWT-shaped Authorization bearer value', async () => {
    const ctx = makeCtx({ Authorization: 'Bearer eyJhbG...ture' });

    await expect(serviceToken(ctx as any)).rejects.toMatchObject({
      name: 'UnauthorizedError',
      message: 'Unauthorized',
    });
  });

  it('rejects requests without either service credential', async () => {
    await expect(serviceToken(makeCtx() as any)).rejects.toMatchObject({
      name: 'UnauthorizedError',
      message: 'Unauthorized',
    });
  });

  it('fails closed when STRAPI_API_TOKEN is missing or malformed', async () => {
    delete process.env.STRAPI_API_TOKEN;
    await expect(serviceToken(makeCtx({ 'X-AKLAB-Service-Token': TEST_TOKEN }) as any))
      .rejects.toMatchObject({ name: 'UnauthorizedError', message: 'Unauthorized' });

    process.env.STRAPI_API_TOKEN = ` ${TEST_TOKEN} `;
    await expect(serviceToken(makeCtx({ 'X-AKLAB-Service-Token': TEST_TOKEN }) as any))
      .rejects.toMatchObject({ name: 'UnauthorizedError', message: 'Unauthorized' });
  });

  it('rejects a different-length token without throwing', async () => {
    await expect(serviceToken(makeCtx({ 'X-AKLAB-Service-Token': 'short' }) as any))
      .rejects.toMatchObject({ name: 'UnauthorizedError', message: 'Unauthorized' });
  });
});
