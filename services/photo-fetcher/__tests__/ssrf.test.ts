import { describe, expect, it, vi } from 'vitest';
import {
  UnsafeUrlError,
  assertAllowedDetailUrl,
  assertPublicHttpsUrl,
  fetchPublicImage,
  readValidatedImage,
} from '../src/ssrf';

const publicLookup = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]);

function lookupWithPrivateTarget(hostname: string) {
  if (hostname === '127.0.0.1') return Promise.resolve([{ address: '127.0.0.1', family: 4 }]);
  return Promise.resolve([{ address: '93.184.216.34', family: 4 }]);
}

describe('photo fetch SSRF guard', () => {
  it('allows a parser detail URL only on the source-owned public host', async () => {
    await expect(assertAllowedDetailUrl(
      'https://www.fabrikant.ru/procedure/123',
      'fabrikant',
      publicLookup,
    )).resolves.toMatchObject({ hostname: 'www.fabrikant.ru' });
  });

  it.each([
    ['a private IPv4 address', 'https://127.0.0.1/admin', [{ address: '127.0.0.1', family: 4 }]],
    ['an IPv6 loopback address', 'https://[::1]/admin', [{ address: '::1', family: 6 }]],
  ])('rejects %s', async (_label, url, addresses) => {
    await expect(assertPublicHttpsUrl(url, { lookup: async () => addresses })).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it('rejects a detail page host outside the source allowlist before navigation', async () => {
    await expect(assertAllowedDetailUrl(
      'https://example.com/lot/123',
      'fabrikant',
      publicLookup,
    )).rejects.toThrow('not allowed for this source');
  });

  it('rejects credentialed, non-HTTPS, and custom-port URLs', async () => {
    await expect(assertPublicHttpsUrl('http://example.com', { lookup: publicLookup })).rejects.toThrow('Only HTTPS');
    await expect(assertPublicHttpsUrl('https://user:pass@example.com', { lookup: publicLookup })).rejects.toThrow('Credentialed');
    await expect(assertPublicHttpsUrl('https://example.com:8443', { lookup: publicLookup })).rejects.toThrow('Custom URL ports');
  });

  it('revalidates every image redirect before a second outbound request', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, {
      status: 302,
      headers: { location: 'https://127.0.0.1/internal.png' },
    }));

    await expect(fetchPublicImage('https://cdn.example.com/image.png', {
      fetchImpl,
      lookup: lookupWithPrivateTarget,
    })).rejects.toThrow('does not resolve only to public addresses');

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('accepts only an image whose MIME type and magic bytes agree', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await expect(readValidatedImage(new Response(png, {
      headers: { 'content-type': 'image/png', 'content-length': String(png.length) },
    }))).resolves.toEqual({ buffer: png, extension: '.png' });

    await expect(readValidatedImage(new Response(Buffer.from('not a png'), {
      headers: { 'content-type': 'image/png' },
    }))).rejects.toThrow('does not match its declared type');
  });

  it('rejects oversized image responses before buffering them', async () => {
    await expect(readValidatedImage(new Response(Buffer.from([0xff, 0xd8, 0xff]), {
      headers: { 'content-type': 'image/jpeg', 'content-length': String(8 * 1024 * 1024 + 1) },
    }))).rejects.toThrow('size limit');
  });
});
