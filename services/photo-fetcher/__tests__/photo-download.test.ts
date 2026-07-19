import { describe, expect, it, vi } from 'vitest';
import { fetchPhotoWithRetry } from '../src/photo-download';

describe('photo download retry', () => {
  it('retries transient 503 responses and returns the successful response', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockResolvedValueOnce(new Response('image', { status: 200, headers: { 'content-type': 'image/jpeg' } }));
    const sleep = vi.fn().mockResolvedValue(undefined);

    const response = await fetchPhotoWithRetry('https://torgi.gov.ru/photo.jpg', fetchImpl, sleep);

    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('does not retry permanent 404 responses', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
    const sleep = vi.fn().mockResolvedValue(undefined);

    const response = await fetchPhotoWithRetry('https://example.com/missing.jpg', fetchImpl, sleep);

    expect(response.status).toBe(404);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});
