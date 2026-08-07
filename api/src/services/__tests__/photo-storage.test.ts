import { describe, expect, it } from 'vitest';
import {
  PhotoStorageConfigurationError,
  PhotoStoragePathError,
  resolvePhotoDirectory,
  resolvePhotoPath,
  resolvePhotoRoot,
} from '../photo-storage';

const canonicalRoot = '/tmp/aklab-private-photos';

describe('API private photo storage contract', () => {
  it('uses the canonical absolute root', () => {
    expect(resolvePhotoRoot({ PRIVATE_PHOTO_ROOT: canonicalRoot })).toBe(canonicalRoot);
  });

  it('accepts the deprecated alias only during the transition', () => {
    expect(resolvePhotoRoot({ PHOTOS_BASE_DIR: canonicalRoot })).toBe(canonicalRoot);
  });

  it('accepts equivalent normalized values when both variables are set', () => {
    expect(resolvePhotoRoot({
      PRIVATE_PHOTO_ROOT: `${canonicalRoot}/child/..`,
      PHOTOS_BASE_DIR: canonicalRoot,
    })).toBe(canonicalRoot);
  });

  it('fails closed when both configured values differ', () => {
    expect(() => resolvePhotoRoot({
      PRIVATE_PHOTO_ROOT: canonicalRoot,
      PHOTOS_BASE_DIR: '/tmp/another-photo-root',
    })).toThrow(PhotoStorageConfigurationError);
  });

  it('fails closed when no root is configured instead of using process.cwd', () => {
    expect(() => resolvePhotoRoot({})).toThrow(PhotoStorageConfigurationError);
  });

  it('rejects relative or empty roots, including the deprecated alias', () => {
    expect(() => resolvePhotoRoot({ PRIVATE_PHOTO_ROOT: 'data/photos' })).toThrow(PhotoStorageConfigurationError);
    expect(() => resolvePhotoRoot({ PRIVATE_PHOTO_ROOT: '' })).toThrow(PhotoStorageConfigurationError);
    expect(() => resolvePhotoRoot({ PHOTOS_BASE_DIR: 'data/photos' })).toThrow(PhotoStorageConfigurationError);
    expect(() => resolvePhotoRoot({ PHOTOS_BASE_DIR: '' })).toThrow(PhotoStorageConfigurationError);
  });

  it('uses the same root/document/filename layout for directory and file paths', () => {
    expect(resolvePhotoDirectory('doc-123', { PRIVATE_PHOTO_ROOT: canonicalRoot }))
      .toBe(`${canonicalRoot}/doc-123`);
    expect(resolvePhotoPath('doc-123', '0.jpg', { PRIVATE_PHOTO_ROOT: canonicalRoot }))
      .toBe(`${canonicalRoot}/doc-123/0.jpg`);
  });

  it.each([
    ['document traversal', '../secret', '0.jpg'],
    ['filename traversal', 'doc-123', '../secret.jpg'],
    ['document absolute separator', '/etc', '0.jpg'],
    ['filename absolute separator', 'doc-123', '/etc/passwd'],
    ['document windows separator', 'doc\\secret', '0.jpg'],
    ['filename windows separator', 'doc-123', '0\\secret.jpg'],
  ])('rejects %s before producing a path', (_label, documentId, filename) => {
    expect(() => resolvePhotoPath(documentId, filename, { PRIVATE_PHOTO_ROOT: canonicalRoot }))
      .toThrow(PhotoStoragePathError);
  });

  it('confirms lexical containment under the configured root', () => {
    expect(resolvePhotoPath('doc-123', 'photo.webp', {
      PRIVATE_PHOTO_ROOT: `${canonicalRoot}/nested/..`,
    })).toBe(`${canonicalRoot}/doc-123/photo.webp`);
  });
});
