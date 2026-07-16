import { timingSafeEqual } from 'node:crypto';

type PolicyContext = {
  request?: {
    headers?: Record<string, string | string[] | undefined>;
  };
  status: number;
  body: unknown;
};

function requestHeader(ctx: PolicyContext, name: string): string {
  const value = ctx.request?.headers?.[name];
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

function configuredServiceToken(): string | null {
  const token = process.env.STRAPI_API_TOKEN;

  // Empty or whitespace-padded values are configuration errors, not credentials.
  if (typeof token !== 'string' || token.length === 0 || /\s/.test(token)) {
    return null;
  }

  return token;
}

function matchesToken(candidate: unknown, expected: string): boolean {
  if (typeof candidate !== 'string') {
    return false;
  }

  const candidateBuffer = Buffer.from(candidate, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');

  // timingSafeEqual throws for differently sized buffers, so reject before it.
  if (candidateBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(candidateBuffer, expectedBuffer);
}

export default async function serviceToken(ctx: PolicyContext): Promise<boolean> {
  const expectedToken = configuredServiceToken();
  const serviceToken = requestHeader(ctx, 'x-aklab-service-token');
  const authorization = requestHeader(ctx, 'authorization');

  const validServiceHeader = expectedToken !== null && matchesToken(serviceToken, expectedToken);
  const validCompatibilityBearer = expectedToken !== null
    && authorization.startsWith('Bearer ')
    && matchesToken(authorization.slice('Bearer '.length), expectedToken);

  if (validServiceHeader || validCompatibilityBearer) {
    return true;
  }

  ctx.status = 401;
  ctx.body = { error: 'Unauthorized' };
  return false;
}
