const DEFAULT_BASE_URL = 'https://sale.etprf.ru';

export function getEtprfBaseUrl(): string {
  const fromEnv = process.env.ETPRF_BASE_URL?.trim();
  const base = fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_BASE_URL;
  return base.replace(/\/$/, '');
}

export function buildEtprfSearchUrl(baseUrl = getEtprfBaseUrl()): string {
  return `${baseUrl}/Notification`;
}

export function buildEtprfNotificationUrl(notificationId: string, baseUrl = getEtprfBaseUrl()): string {
  return `${baseUrl}/Notification/id/${notificationId}`;
}

export function normalizeEtprfDetailUrl(linkHref: string, baseUrl = getEtprfBaseUrl()): string {
  if (linkHref.startsWith('http')) return linkHref;
  if (linkHref.startsWith('/')) return `${baseUrl}${linkHref}`;
  return `${baseUrl}/${linkHref}`;
}
