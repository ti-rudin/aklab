/**
 * Auction dates scraped from Russian marketplaces are expressed in Moscow time.
 * The parser accepts unambiguous Russian or timezone-less ISO source dates and returns UTC.
 */
const RU_AUCTION_DATE_PATTERN = /^(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}):(\d{2}))?$/;
const ISO_AUCTION_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::\d{2})?(?:\.\d+)?)?$/;

export function parseAuctionEndAt(value: string): string | undefined {
  const source = value.trim();
  const ruMatch = source.match(RU_AUCTION_DATE_PATTERN);
  const isoMatch = source.match(ISO_AUCTION_DATE_PATTERN);
  if (!ruMatch && !isoMatch) return undefined;

  const [, first, second, third, hourText, minuteText] = ruMatch || isoMatch!;
  const isIso = Boolean(isoMatch);
  const day = Number(isIso ? third : first);
  const month = Number(isIso ? second : second);
  const year = Number(isIso ? first : third);
  const hour = hourText === undefined ? 23 : Number(hourText);
  const minute = minuteText === undefined ? 59 : Number(minuteText);
  const secondValue = hourText === undefined ? 59 : 0;

  if (hour > 23 || minute > 59) return undefined;

  // Validate calendar rollovers in the source (MSK) calendar first. MSK is
  // UTC+3 and does not observe DST, so conversion is an exact subtraction.
  const local = new Date(Date.UTC(year, month - 1, day, hour, minute, secondValue));
  if (
    local.getUTCFullYear() !== year
    || local.getUTCMonth() !== month - 1
    || local.getUTCDate() !== day
    || local.getUTCHours() !== hour
    || local.getUTCMinutes() !== minute
  ) return undefined;

  return new Date(local.getTime() - 3 * 60 * 60 * 1000).toISOString();
}

/** Prefer explicit application deadlines over a generic auction-date label. */
export function extractAuctionEndAt(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const labels = [
    'Окончание приема заявок',
    'Окончание приёма заявок',
    'Дата окончания приема заявок',
    'Дата окончания приёма заявок',
    'Дата торгов',
    'Окончание',
  ];
  for (const label of labels) {
    const match = text.match(new RegExp(`${label}[^\\d]{0,80}(\\d{2}\\.\\d{2}\\.\\d{4}(?:\\s+\\d{2}:\\d{2})?)`, 'i'));
    const parsed = match ? parseAuctionEndAt(match[1]) : undefined;
    if (parsed) return parsed;
  }
  return undefined;
}

export function hasAuctionEnded(auctionEndAt: string | undefined, now = new Date()): boolean {
  if (!auctionEndAt) return false;
  const time = Date.parse(auctionEndAt);
  return Number.isFinite(time) && time < now.getTime();
}
