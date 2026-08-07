import { describe, expect, it } from 'vitest';
import {
  PhotoStorageConfigurationError,
  PhotoStoragePathError,
  resolvePhotoDirectory,
  resolvePhotoPath,
  resolvePhotoRoot,
} from '../src/photo-storage';

const root = '/tmp/aklab-private-photos';

describe('photo-fetcher private photo storage contract', () => {
  it('uses PRIVATE_PHOTO_ROOT as the canonical configured root', () => {
    expect(resolvePhotoRoot({ PRIVATE_PHOTO_ROOT: root })).toBe(root);
  });

  it('allows PHOTOS_BASE_DIR only as an absolute transitional alias', () => {
    expect(resolvePhotoRoot({ PHOTOS_BASE_DIR: root })).toBe(root);
  });

  it('fails closed on a canonical/alias conflict or missing root', () => {
    expect(() => resolvePhotoRoot({ PRIVATE_PHOTO_ROOT: root, PHOTOS_BASE_DIR: '/tmp/other' }))
      .toThrow(PhotoStorageConfigurationError);
    expect(() => resolvePhotoRoot({})).toThrow(PhotoStorageConfigurationError);
  });

  it('fails closed on relative or empty configured roots', () => {
    expect(() => resolvePhotoRoot({ PRIVATE_PHOTO_ROOT: 'api/data/photos' }))
      .toThrow(PhotoStorageConfigurationError);
    expect(() => resolvePhotoRoot({ PRIVATE_PHOTO_ROOT: '' }))
      .toThrow(PhotoStorageConfigurationError);
    expect(() => resolvePhotoRoot({ PHOTOS_BASE_DIR: '' }))
      .toThrow(PhotoStorageConfigurationError);
  });

  it('resolves directory and file paths beneath the same root', () => {
    expect(resolvePhotoDirectory('doc-1', { PRIVATE_PHOTO_ROOT: root })).toBe(`${root}/doc-1`);
    expect(resolvePhotoPath('doc-1', '0.jpeg', { PRIVATE_PHOTO_ROOT: root }))
      .toBe(`${root}/doc-1/0.jpeg`);
  });

  it.each([
    ['../escape', '0.jpg'],
    ['doc-1', '../escape.jpg'],
    ['/absolute', '0.jpg'],
    ['doc-1', '/absolute.jpg'],
    ['doc\\escape', '0.jpg'],
    ['doc-1', '0\\escape.jpg'],
  ])('rejects unsafe path segments: %s / %s', (documentId, filename) => {
    expect(() => resolvePhotoPath(documentId, filename, { PRIVATE_PHOTO_ROOT: root }))
      .toThrow(PhotoStoragePathError);
  });
});
