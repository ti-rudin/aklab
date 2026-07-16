import { timingSafeEqual } from 'node:crypto';

type PolicyContext = {
  get(name: string): string;
  status: number;
  body: unknown;
};

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
  const serviceToken = ctx.get('x-aklab-service-token');
  const authorization = ctx.get('authorization');

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
