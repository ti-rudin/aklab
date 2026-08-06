const BASE_URL = 'https://investmoscow.ru';

function validAbsoluteHttpUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined;

  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
      ? parsed.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

export function resolveInvestmoscowSourceUrl(tender: Record<string, unknown>): string {
  const platformLink = validAbsoluteHttpUrl(tender.platformLink);
  if (platformLink) return platformLink;

  const portalUrl = String(tender.url ?? '').trim();
  const absolutePortalUrl = validAbsoluteHttpUrl(portalUrl);
  if (absolutePortalUrl) return absolutePortalUrl;

  try {
    const resolved = new URL(portalUrl, `${BASE_URL}/`);
    if (resolved.protocol === 'https:' && resolved.hostname === 'investmoscow.ru') {
      return resolved.toString();
    }
  } catch {
    // Fall through to the safe listing page.
  }

  return `${BASE_URL}/tenders`;
}
