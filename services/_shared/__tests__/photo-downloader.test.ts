import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before importing the module
vi.mock('fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  access: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/logger', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

import * as fs from 'fs/promises';
import { downloadPropertyPhotos } from '../src/photo-downloader';
import { logger } from '../src/logger';

describe('downloadPropertyPhotos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset fetch mock
    vi.stubGlobal('fetch', vi.fn());
  });

  function mockFetchResponse(options: {
    ok?: boolean;
    contentType?: string;
    body?: Uint8Array;
  } = {}) {
    const { ok = true, contentType = 'image/jpeg', body = new Uint8Array([0xff, 0xd8, 0xff]) } = options;
    const arrayBuffer = body.buffer;
    return {
      ok,
      headers: {
        get: (name: string) => (name === 'content-type' ? contentType : null),
      },
      arrayBuffer: () => Promise.resolve(arrayBuffer),
    };
  }

  it('should download photos from URLs and create directory', async () => {
    const docId = 'abc123';
    const urls = ['https://example.com/photo1.jpg', 'https://example.com/photo2.jpg'];

    (fetch as any)
      .mockResolvedValueOnce(mockFetchResponse({ contentType: 'image/jpeg' }))
      .mockResolvedValueOnce(mockFetchResponse({ contentType: 'image/jpeg' }));

    const result = await downloadPropertyPhotos(docId, urls);

    expect(fs.mkdir).toHaveBeenCalledWith(
      expect.stringContaining(docId),
      { recursive: true },
    );
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledWith('https://example.com/photo1.jpg');
    expect(fetch).toHaveBeenCalledWith('https://example.com/photo2.jpg');
    expect(fs.writeFile).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(2);
    expect(result[0]).toContain(`/photos/${docId}/0.jpg`);
    expect(result[1]).toContain(`/photos/${docId}/1.jpg`);
  });

  it('should handle jpeg content type', async () => {
    (fetch as any).mockResolvedValueOnce(mockFetchResponse({ contentType: 'image/jpeg' }));

    const result = await downloadPropertyPhotos('id1', ['https://example.com/img.jpg']);

    expect(result[0]).toContain('.jpg');
  });

  it('should handle png content type', async () => {
    (fetch as any).mockResolvedValueOnce(mockFetchResponse({ contentType: 'image/png' }));

    const result = await downloadPropertyPhotos('id1', ['https://example.com/img.png']);

    expect(result[0]).toContain('.png');
  });

  it('should handle webp content type', async () => {
    (fetch as any).mockResolvedValueOnce(mockFetchResponse({ contentType: 'image/webp' }));

    const result = await downloadPropertyPhotos('id1', ['https://example.com/img.webp']);

    expect(result[0]).toContain('.webp');
  });

  it('should default to .jpg for unknown content types', async () => {
    (fetch as any).mockResolvedValueOnce(mockFetchResponse({ contentType: 'image/gif' }));

    const result = await downloadPropertyPhotos('id1', ['https://example.com/img']);

    expect(result[0]).toContain('.jpg');
  });

  it('should default to .jpg when content-type header is missing', async () => {
    (fetch as any).mockResolvedValueOnce(mockFetchResponse({ contentType: '' }));

    const result = await downloadPropertyPhotos('id1', ['https://example.com/img']);

    expect(result[0]).toContain('.jpg');
  });

  it('should skip photos that return non-ok status', async () => {
    (fetch as any)
      .mockResolvedValueOnce(mockFetchResponse({ ok: true }))
      .mockResolvedValueOnce(mockFetchResponse({ ok: false }))
      .mockResolvedValueOnce(mockFetchResponse({ ok: true }));

    const result = await downloadPropertyPhotos('id1', [
      'https://example.com/ok1.jpg',
      'https://example.com/fail.jpg',
      'https://example.com/ok2.jpg',
    ]);

    expect(result).toHaveLength(2);
    expect(result[0]).toContain('0.jpg');
    expect(result[1]).toContain('2.jpg');
    // writeFile called only for ok responses
    expect(fs.writeFile).toHaveBeenCalledTimes(2);
  });

  it('should handle fetch errors gracefully and continue with other photos', async () => {
    (fetch as any)
      .mockResolvedValueOnce(mockFetchResponse({ ok: true }))
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce(mockFetchResponse({ ok: true }));

    const result = await downloadPropertyPhotos('id1', [
      'https://example.com/ok1.jpg',
      'https://example.com/fail.jpg',
      'https://example.com/ok2.jpg',
    ]);

    // Successful downloads still return results
    expect(result).toHaveLength(2);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to download photo 1'),
    );
  });

  it('should return correct download count', async () => {
    (fetch as any)
      .mockResolvedValueOnce(mockFetchResponse({ ok: true }))
      .mockResolvedValueOnce(mockFetchResponse({ ok: false }))
      .mockRejectedValueOnce(new Error('fail'));

    const result = await downloadPropertyPhotos('id1', [
      'https://example.com/a.jpg',
      'https://example.com/b.jpg',
      'https://example.com/c.jpg',
    ]);

    // Only the first succeeded
    expect(result).toHaveLength(1);
  });

  it('should use custom basePath when provided', async () => {
    (fetch as any).mockResolvedValueOnce(mockFetchResponse());

    const customPath = '/tmp/custom-photos';
    const result = await downloadPropertyPhotos('id1', ['https://example.com/img.jpg'], customPath);

    expect(fs.mkdir).toHaveBeenCalledWith(customPath, { recursive: true });
    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining(customPath),
      expect.any(Buffer),
    );
  });

  it('should return empty array when no URLs provided', async () => {
    const result = await downloadPropertyPhotos('id1', []);

    expect(result).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
    expect(fs.mkdir).toHaveBeenCalled(); // directory still created
  });

  it('should use correct file indexing for downloaded photos', async () => {
    (fetch as any)
      .mockResolvedValueOnce(mockFetchResponse({ contentType: 'image/jpeg' }))
      .mockResolvedValueOnce(mockFetchResponse({ contentType: 'image/png' }))
      .mockResolvedValueOnce(mockFetchResponse({ contentType: 'image/webp' }));

    const result = await downloadPropertyPhotos('id1', [
      'https://example.com/a.jpg',
      'https://example.com/b.png',
      'https://example.com/c.webp',
    ]);

    expect(result[0]).toContain('/0.jpg');
    expect(result[1]).toContain('/1.png');
    expect(result[2]).toContain('/2.webp');
  });

  it('should write Buffer to file with correct path', async () => {
    const bodyBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    (fetch as any).mockResolvedValueOnce(mockFetchResponse({
      contentType: 'image/png',
      body: bodyBytes,
    }));

    await downloadPropertyPhotos('doc999', ['https://example.com/photo.png']);

    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('doc999'),
      expect.any(Buffer),
    );
  });
});
