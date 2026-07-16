import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const REQUEST_TIMEOUT_MS = 10_000;

/** Hosts that may serve a property detail page for each parser-owned source. */
const DETAIL_HOSTS: Record<string, readonly string[]> = {
  'aggregator-bankrot': ['xn----etbpba5admdlad.xn--p1ai'],
  alfalot: ['ecosystem.alfalot.ru'],
  etprf: ['sale.etprf.ru'],
  fabrikant: ['fabrikant.ru'],
  fedresurs: ['fedresurs.ru', 'bankrot.fedresurs.ru'],
  'invest-mosreg': ['invest.mosreg.ru'],
  investmoscow: ['investmoscow.ru'],
  'm-ets': ['m-ets.ru'],
  roseltorg: ['roseltorg.ru'],
  'sberbank-ast': ['utp.sberbank-ast.ru'],
  'torgi-gov': ['torgi.gov.ru'],
};

type LookupResult = { address: string; family: number };
type Lookup = (hostname: string) => Promise<LookupResult[]>;
type FetchImplementation = typeof fetch;

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeUrlError';
  }
}

async function lookupAll(hostname: string): Promise<LookupResult[]> {
  return dnsLookup(hostname, { all: true, verbatim: true });
}

function isPublicIpv4(address: string): boolean {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return false;
  }

  const [a, b] = octets;
  return !(
    a === 0
    || a === 10
    || a === 127
    || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && (b === 0 || b === 168))
    || (a === 198 && (b === 18 || b === 19 || b === 51))
    || (a === 203 && b === 0)
  );
}

function isPublicIp(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPublicIpv4(address);
  if (family !== 6) return false;

  const normalized = address.toLowerCase().split('%', 1)[0];
  // ::/96 (IPv4-compatible) and ::ffff:0:0/96 (IPv4-mapped) can encode
  // loopback/private IPv4 in hexadecimal form (for example ::ffff:7f00:1).
  // There is no need for a public photo host to use either transition range.
  if (normalized.startsWith('::')) return false;

  return !(
    normalized === '::'
    || normalized === '::1'
    || normalized.startsWith('fc')
    || normalized.startsWith('fd')
    || normalized.startsWith('fe8')
    || normalized.startsWith('fe9')
    || normalized.startsWith('fea')
    || normalized.startsWith('feb')
    || normalized.startsWith('2001:db8:')
  );
}

function hostMatches(hostname: string, allowedHost: string): boolean {
  const host = hostname.toLowerCase();
  const allowed = allowedHost.toLowerCase();
  return host === allowed || host.endsWith(`.${allowed}`);
}

/**
 * Validate a URL immediately before an outbound request. DNS is intentionally
 * resolved on every call so a redirect cannot bypass the public-address check.
 */
export async function assertPublicHttpsUrl(
  value: string,
  options: { allowedHosts?: readonly string[]; lookup?: Lookup } = {},
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new UnsafeUrlError('URL is invalid');
  }

  if (url.protocol !== 'https:') throw new UnsafeUrlError('Only HTTPS URLs are allowed');
  if (url.username || url.password) throw new UnsafeUrlError('Credentialed URLs are not allowed');
  if (url.port) throw new UnsafeUrlError('Custom URL ports are not allowed');
  if (!url.hostname) throw new UnsafeUrlError('URL hostname is required');

  if (options.allowedHosts && !options.allowedHosts.some((host) => hostMatches(url.hostname, host))) {
    throw new UnsafeUrlError(`Host ${url.hostname} is not allowed for this source`);
  }

  let addresses: LookupResult[];
  try {
    addresses = await (options.lookup || lookupAll)(url.hostname);
  } catch {
    throw new UnsafeUrlError(`Cannot resolve URL host ${url.hostname}`);
  }

  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicIp(address))) {
    throw new UnsafeUrlError(`URL host ${url.hostname} does not resolve only to public addresses`);
  }

  return url;
}

export async function assertAllowedDetailUrl(value: string, source: string, lookup?: Lookup): Promise<URL> {
  const allowedHosts = DETAIL_HOSTS[source];
  if (!allowedHosts) throw new UnsafeUrlError(`Source ${source} has no detail-page egress policy`);
  return assertPublicHttpsUrl(value, { allowedHosts, lookup });
}

/**
 * Re-check every browser request before it leaves Chromium. Main-frame
 * navigation is constrained to the parser's detail hosts; subresources may use
 * public CDNs but must still resolve only to public HTTPS addresses. Redirects
 * produce new requests and are therefore validated again.
 */
export async function installDetailNavigationGuard(page: any, source: string): Promise<void> {
  await page.route('**/*', async (route: any) => {
    const request = route.request();
    try {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
        await assertAllowedDetailUrl(request.url(), source);
      } else {
        await assertPublicHttpsUrl(request.url());
      }
      await route.continue();
    } catch {
      await route.abort('blockedbyclient');
    }
  });
}

/**
 * Fetch an image with redirect:"manual" and validate every destination before
 * following it. This is separate from the browser guard because image URLs are
 * discovered from untrusted page DOM and may legitimately use CDN hosts.
 */
export async function fetchPublicImage(
  value: string,
  options: { fetchImpl?: FetchImplementation; lookup?: Lookup; maxRedirects?: number } = {},
): Promise<Response> {
  const fetchImpl = options.fetchImpl || fetch;
  const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS;
  let current = value;

  for (let redirects = 0; redirects <= maxRedirects; redirects++) {
    const safeUrl = await assertPublicHttpsUrl(current, { lookup: options.lookup });
    const response = await fetchImpl(safeUrl, {
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      // Only request types that readValidatedImage can verify byte-for-byte.
      headers: { Accept: 'image/jpeg,image/png,image/gif,image/webp,*/*;q=0.1' },
    });

    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get('location');
    if (!location) throw new UnsafeUrlError('Redirect response has no Location header');
    if (redirects === maxRedirects) throw new UnsafeUrlError('Too many image redirects');
    current = new URL(location, safeUrl).toString();
  }

  throw new UnsafeUrlError('Too many image redirects');
}

const IMAGE_TYPES: Record<string, { extension: string; matches: (data: Buffer) => boolean }> = {
  'image/jpeg': {
    extension: '.jpg',
    matches: (data) => data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff,
  },
  'image/png': {
    extension: '.png',
    matches: (data) => data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  'image/gif': {
    extension: '.gif',
    matches: (data) => data.length >= 6 && (data.subarray(0, 6).toString('ascii') === 'GIF87a' || data.subarray(0, 6).toString('ascii') === 'GIF89a'),
  },
  'image/webp': {
    extension: '.webp',
    matches: (data) => data.length >= 12 && data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP',
  },
};

export async function readValidatedImage(response: Response, maxBytes = MAX_IMAGE_BYTES): Promise<{ buffer: Buffer; extension: string }> {
  const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() || '';
  const imageType = IMAGE_TYPES[contentType];
  if (!imageType) throw new UnsafeUrlError(`Unsupported image content type: ${contentType || 'missing'}`);

  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new UnsafeUrlError('Image exceeds the download size limit');
  }

  const reader = response.body?.getReader();
  if (!reader) throw new UnsafeUrlError('Image response has no body');

  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new UnsafeUrlError('Image exceeds the download size limit');
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }

  const buffer = Buffer.concat(chunks, total);
  if (!imageType.matches(buffer)) throw new UnsafeUrlError('Image content does not match its declared type');
  return { buffer, extension: imageType.extension };
}
