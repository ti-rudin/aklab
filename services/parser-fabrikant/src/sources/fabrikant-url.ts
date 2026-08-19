const DEFAULT_BASE_URL = 'https://www.fabrikant.ru';

/** Base URL for Fabrikant; override via FABRIKANT_BASE_URL. */
export function getFabrikantBaseUrl(): string {
  const fromEnv = process.env.FABRIKANT_BASE_URL?.trim();
  const base = fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_BASE_URL;
  return base.replace(/\/$/, '');
}

export function buildSearchUrl(baseUrl = getFabrikantBaseUrl()): string {
  return `${baseUrl}/procedure/search/sales`;
}

export function buildProcedureViewUrl(procedureId: string, baseUrl = getFabrikantBaseUrl()): string {
  return `${baseUrl}/v2/trades/procedure/view/${procedureId}`;
}

export function buildLotViewUrl(
  procedureId: string,
  lotId: string,
  baseUrl = getFabrikantBaseUrl(),
): string {
  return `${baseUrl}/v2/trades/procedure/lot/view/${procedureId}/${lotId}`;
}

export function isProcedureViewUrl(url: string): boolean {
  return /\/v2\/trades\/procedure\/view\/[^/?#]+/.test(url);
}

export function isLotViewUrl(url: string): boolean {
  return /\/v2\/trades\/procedure\/lot\/view\/[^/?#]+\/[^/?#]+/.test(url);
}

export function extractProcedureIdFromUrl(url: string): string | undefined {
  const lotView = url.match(/\/v2\/trades\/procedure\/lot\/view\/([^/?#]+)/);
  if (lotView?.[1]) return lotView[1];
  const procedureView = url.match(/\/v2\/trades\/procedure\/view\/([^/?#]+)/);
  return procedureView?.[1];
}

export function extractLotIdFromUrl(url: string): string | undefined {
  const lotView = url.match(/\/v2\/trades\/procedure\/lot\/view\/[^/?#]+\/([^/?#]+)/);
  if (lotView?.[1]) return lotView[1];
  const hash = url.match(/#lot-([^/?#]+)/);
  return hash?.[1];
}

/** Normalize listing URL to lot-scoped view when procedure id is known. */
export function normalizeFabrikantListingUrl(
  linkHref: string,
  lotId: string,
  baseUrl = getFabrikantBaseUrl(),
): string {
  const procedureId = extractProcedureIdFromUrl(linkHref);
  if (procedureId) {
    return buildLotViewUrl(procedureId, lotId, baseUrl);
  }
  if (linkHref.startsWith('http')) return linkHref;
  if (linkHref.startsWith('/')) return `${baseUrl}${linkHref}`;
  return `${baseUrl}/${linkHref}`;
}
