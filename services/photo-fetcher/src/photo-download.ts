const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 1_000;

type FetchPhoto = (url: string) => Promise<Response>;
type Sleep = (ms: number) => Promise<void>;

const sleepDefault: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isTransientStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export async function fetchPhotoWithRetry(
  url: string,
  fetchImpl: FetchPhoto,
  sleep: Sleep = sleepDefault,
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetchImpl(url);
      if (!isTransientStatus(response.status) || attempt === MAX_ATTEMPTS) return response;
      await response.body?.cancel().catch(() => {});
    } catch (error) {
      lastError = error;
      if (attempt === MAX_ATTEMPTS) throw error;
    }

    await sleep(RETRY_BASE_DELAY_MS * attempt);
  }

  throw lastError instanceof Error ? lastError : new Error('Photo download failed');
}
