import * as path from 'path';

export interface PhotoStorageEnvironment {
  PRIVATE_PHOTO_ROOT?: string;
  PHOTOS_BASE_DIR?: string;
}

export class PhotoStorageConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PhotoStorageConfigurationError';
  }
}

export class PhotoStoragePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PhotoStoragePathError';
  }
}

function normalizedConfiguredRoot(name: 'PRIVATE_PHOTO_ROOT' | 'PHOTOS_BASE_DIR', raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const value = raw.trim();
  if (value === '' || !path.isAbsolute(value)) {
    throw new PhotoStorageConfigurationError(`${name} must be a non-empty absolute path`);
  }
  return path.normalize(path.resolve(value));
}

/**
 * Resolve the persistent private root without a release/cwd fallback.
 * PHOTOS_BASE_DIR is retained only as a temporary compatibility alias.
 */
export function resolvePhotoRoot(env: PhotoStorageEnvironment = process.env): string {
  const canonical = normalizedConfiguredRoot('PRIVATE_PHOTO_ROOT', env.PRIVATE_PHOTO_ROOT);
  const alias = normalizedConfiguredRoot('PHOTOS_BASE_DIR', env.PHOTOS_BASE_DIR);

  if (canonical && alias && canonical !== alias) {
    throw new PhotoStorageConfigurationError(
      'PRIVATE_PHOTO_ROOT and PHOTOS_BASE_DIR must resolve to the same path',
    );
  }
  if (canonical) return canonical;
  if (alias) return alias;
  throw new PhotoStorageConfigurationError(
    'PRIVATE_PHOTO_ROOT is required (PHOTOS_BASE_DIR is only a temporary alias)',
  );
}

function assertSafeSegment(value: unknown, label: string): asserts value is string {
  if (
    typeof value !== 'string'
    || value === ''
    || value !== value.trim()
    || value === '.'
    || value === '..'
    || value.includes('\0')
    || value.includes('/')
    || value.includes('\\')
    || path.isAbsolute(value)
    || path.posix.isAbsolute(value)
    || path.win32.isAbsolute(value)
    || path.basename(value) !== value
  ) {
    throw new PhotoStoragePathError(`${label} must be a single relative path segment`);
  }
}

function assertContained(root: string, candidate: string): string {
  const relative = path.relative(root, candidate);
  if (
    relative === ''
    || relative === '..'
    || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative)
  ) {
    throw new PhotoStoragePathError('Resolved photo path escapes the configured root');
  }
  return candidate;
}

export function resolvePhotoDirectory(
  documentId: string,
  env: PhotoStorageEnvironment = process.env,
): string {
  const root = resolvePhotoRoot(env);
  assertSafeSegment(documentId, 'documentId');
  return assertContained(root, path.resolve(root, documentId));
}

export function resolvePhotoPath(
  documentId: string,
  filename: string,
  env: PhotoStorageEnvironment = process.env,
): string {
  const root = resolvePhotoRoot(env);
  assertSafeSegment(documentId, 'documentId');
  assertSafeSegment(filename, 'filename');
  return assertContained(root, path.resolve(root, documentId, filename));
}
