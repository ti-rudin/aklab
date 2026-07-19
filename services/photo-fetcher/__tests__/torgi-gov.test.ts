import { describe, expect, it, vi } from 'vitest';
import { extractTorgiLotId, fetchTorgiPhotoUrls } from '../src/sources/torgi-gov';

describe('torgi-gov photo source', () => {
  const detailUrl = new URL('https://torgi.gov.ru/new/public/lots/lot/21000005000000031466_1');

  it('extracts the compound lot id from the current public route', () => {
    expect(extractTorgiLotId(detailUrl)).toBe('21000005000000031466_1');
  });

  it('loads lotImages from the public API and builds image-preview URLs', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      lotImages: [
        '6a479b76f4fed970e8d6ca7e',
        '6a479b7683454947540ee9b8',
        '6a479b76f4fed970e8d6ca7e',
        'invalid',
      ],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    await expect(fetchTorgiPhotoUrls(detailUrl, fetchImpl)).resolves.toEqual([
      'https://torgi.gov.ru/new/image-preview/v1/6a479b76f4fed970e8d6ca7e?disposition=inline',
      'https://torgi.gov.ru/new/image-preview/v1/6a479b7683454947540ee9b8?disposition=inline',
    ]);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://torgi.gov.ru/new/api/public/lotcards/21000005000000031466_1',
      expect.objectContaining({ headers: { Accept: 'application/json' } }),
    );
  });

  it('rejects obsolete and foreign detail routes', () => {
    expect(() => extractTorgiLotId(new URL('https://torgi.gov.ru/new/public/lots/reg/lot-card/1/1'))).toThrow('Unsupported');
    expect(() => extractTorgiLotId(new URL('https://example.com/new/public/lots/lot/1_1'))).toThrow('Unsupported');
  });
});
