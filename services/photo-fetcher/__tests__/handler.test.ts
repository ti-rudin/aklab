import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFetchProperty = vi.hoisted(() => vi.fn());
const mockUpdateProperty = vi.hoisted(() => vi.fn());
const mockLogCron = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockFetchPhotoWithRetry = vi.hoisted(() => vi.fn());
const mockExtractTorgiPhotos = vi.hoisted(() => vi.fn());
const mockAssertAllowedDetailUrl = vi.hoisted(() => vi.fn().mockResolvedValue(new URL('https://torgi.gov.ru/lot')));
const mockFetchPublicImage = vi.hoisted(() => vi.fn());
const mockReadValidatedImage = vi.hoisted(() => vi.fn());
const mockMkdir = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockWriteFile = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockRm = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('@aklab/service-shared', () => ({
  fetchProperty: mockFetchProperty,
  updateProperty: mockUpdateProperty,
  logCron: mockLogCron,
}));
vi.mock('../src/config', () => ({
  config: {
    logging: { level: 'silent' },
    photoStorage: { root: '/tmp/aklab-worker-photo-root' },
  },
}));
vi.mock('fs/promises', () => ({
  mkdir: mockMkdir,
  writeFile: mockWriteFile,
  rm: mockRm,
}));
vi.mock('../src/photo-download', () => ({ fetchPhotoWithRetry: mockFetchPhotoWithRetry }));
vi.mock('../src/sources/torgi-gov', () => ({ extractTorgiPhotos: mockExtractTorgiPhotos }));
vi.mock('../src/sources/extractors', () => ({ getExtractor: vi.fn() }));
vi.mock('../src/ssrf', () => ({
  assertAllowedDetailUrl: mockAssertAllowedDetailUrl,
  fetchPublicImage: mockFetchPublicImage,
  installDetailNavigationGuard: vi.fn(),
  readValidatedImage: mockReadValidatedImage,
}));

import { handlePhotoFetchJob } from '../src/handler';

const root = '/tmp/aklab-worker-photo-root';

describe('photo-fetcher handler storage contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLogCron.mockResolvedValue(undefined);
    mockFetchProperty.mockResolvedValue({ documentId: 'doc-1', photos_downloaded: false });
    mockExtractTorgiPhotos.mockResolvedValue([{ url: 'https://torgi.gov.ru/photo.jpg' }]);
    mockFetchPhotoWithRetry.mockResolvedValue(new Response('image', { status: 200 }));
    mockReadValidatedImage.mockResolvedValue({ buffer: Buffer.from('image'), extension: '.jpg' });
  });

  it('writes beneath the configured root and keeps the database URL contract', async () => {
    const result = await handlePhotoFetchJob({
      data: { documentId: 'doc-1', url: 'https://torgi.gov.ru/lot', source: 'torgi-gov' },
      correlation_id: 'corr-1',
    } as any);

    expect(result).toEqual({ fetched: true, count: 1 });
    expect(mockMkdir).toHaveBeenCalledWith(`${root}/doc-1`, { recursive: true });
    expect(mockWriteFile).toHaveBeenCalledWith(`${root}/doc-1/0.jpg`, Buffer.from('image'));
    expect(mockUpdateProperty).toHaveBeenCalledWith('doc-1', {
      photos: ['/photos/doc-1/0.jpg'],
      photos_downloaded: true,
    });
    expect(JSON.stringify(mockUpdateProperty.mock.calls)).not.toContain(root);
  });

  it('does not use process.cwd or a release-relative fallback for storage', async () => {
    await handlePhotoFetchJob({
      data: { documentId: 'doc-1', url: 'https://torgi.gov.ru/lot', source: 'torgi-gov' },
    } as any);

    expect(mockMkdir.mock.calls[0][0]).toBe(`${root}/doc-1`);
    expect(mockWriteFile.mock.calls[0][0]).toBe(`${root}/doc-1/0.jpg`);
  });
});
