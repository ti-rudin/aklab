import type { ExtractedPhoto } from './extractors';

const TORGI_HOST = 'torgi.gov.ru';
const LOT_ROUTE = /^\/new\/public\/lots\/lot\/(\d+_\d+)\/?$/;
const FILE_ID = /^[a-f0-9]{24}$/i;
const API_TIMEOUT_MS = 15_000;
const MAX_PHOTOS = 20;

type FetchImplementation = typeof fetch;

export function extractTorgiLotId(detailUrl: URL): string {
  const match = detailUrl.hostname.toLowerCase() === TORGI_HOST
    ? detailUrl.pathname.match(LOT_ROUTE)
    : null;
  if (!match) throw new Error(`Unsupported torgi.gov.ru detail URL: ${detailUrl.toString()}`);
  return match[1];
}

export async function fetchTorgiPhotoUrls(
  detailUrl: URL,
  fetchImpl: FetchImplementation = fetch,
): Promise<string[]> {
  const lotId = extractTorgiLotId(detailUrl);
  const apiUrl = new URL(`/new/api/public/lotcards/${lotId}`, detailUrl.origin);
  const response = await fetchImpl(apiUrl.toString(), {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Torgi lot API returned ${response.status}`);
  }
  const contentType = response.headers.get('content-type')?.toLowerCase() || '';
  if (!contentType.includes('application/json')) {
    throw new Error(`Torgi lot API returned unexpected content type: ${contentType || 'missing'}`);
  }

  const payload = await response.json() as { lotImages?: unknown };
  if (!Array.isArray(payload.lotImages)) return [];

  const fileIds = [...new Set(
    payload.lotImages.filter((value): value is string => typeof value === 'string' && FILE_ID.test(value)),
  )].slice(0, MAX_PHOTOS);

  return fileIds.map((fileId) => {
    const imageUrl = new URL(`/new/image-preview/v1/${fileId}`, detailUrl.origin);
    imageUrl.searchParams.set('disposition', 'inline');
    return imageUrl.toString();
  });
}

export async function extractTorgiPhotos(detailUrl: URL): Promise<ExtractedPhoto[]> {
  return (await fetchTorgiPhotoUrls(detailUrl)).map((url) => ({ url }));
}
