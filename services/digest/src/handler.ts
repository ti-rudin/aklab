import { PermanentError } from '@aklab/sqlite-queue';
import type { Job, WorkerContext } from '@aklab/sqlite-queue';
import nodemailer from 'nodemailer';
import { fetchSetting, logCron } from '@aklab/service-shared';
import { config } from './config';
import { logger } from './utils/logger';

export interface DigestRequest {
  date: string;
  smtpTo: string | null;
  correlationId?: string;
}

const BASE = config.strapi.url;
const HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  ...(config.strapi.apiToken ? { Authorization: `Bearer ${config.strapi.apiToken}` } : {}),
};

const cityLabel: Record<string, string> = { moscow: 'Москва', mo: 'МО', other: 'Другой' };

const tagLabel: Record<string, string> = {
  undervalued: 'Недооценён',
  has_minimum_price: 'Торги',
  new: 'Новый',
  large_area: 'Большая пл.',
  moscow_mo: 'МСК/МО',
};

function throwIfCancellationRequested(workerContext?: WorkerContext): void {
  if (workerContext?.isCancellationRequested() || workerContext?.isLeaseValid?.() === false) {
    throw new PermanentError('Digest job cancelled or lease lost before the next side effect');
  }
}

async function fetchFocusProperties(workerContext?: WorkerContext): Promise<any[]> {
  // threshold=0 — все объекты в фокусе (score > 0)
  const pageSize = 100;
  const properties: any[] = [];
  let page = 1;
  let hasNextPage = true;

  while (hasNextPage) {
    const url = `${BASE}/api/properties/focus?threshold=0&pageSize=${pageSize}&page=${page}&sort=-focus_score`;
    throwIfCancellationRequested(workerContext);
    const res = await fetch(url, { headers: HEADERS });
    throwIfCancellationRequested(workerContext);
    if (!res.ok) {
      throw new Error(`Focus properties request failed with HTTP ${res.status}`);
    }
    throwIfCancellationRequested(workerContext);
    const json: any = await res.json();
    throwIfCancellationRequested(workerContext);

    if (!Array.isArray(json?.data)) {
      throw new Error('Focus properties response contained no data array');
    }

    properties.push(...json.data);
    const totalPages = Number(json?.meta?.totalPages);
    hasNextPage = Number.isInteger(totalPages)
      ? page < totalPages
      : json.data.length === pageSize;
    page += 1;
  }

  return properties;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return char;
    }
  });
}

function displayText(value: unknown, fallback = '—'): string {
  return value === null || value === undefined || value === '' ? fallback : String(value);
}

function parseStoredIsoTimestamp(value: unknown): number | null {
  // `getFocusQuery()` reads SQLite datetime values through a raw query, which
  // exposes them as epoch milliseconds rather than the REST ISO representation.
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 && Number.isFinite(new Date(value).getTime())
      ? value
      : null;
  }
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value ? timestamp : null;
}

function formatNumber(value: unknown, suffix: string): string {
  if (value === null || value === undefined || value === '') return '—';
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toLocaleString('ru-RU')}${suffix}` : '—';
}

function formatScore(value: unknown): string {
  const score = Number(value);
  return Number.isFinite(score) ? String(score) : '—';
}

function safeHttpsUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function labelsForTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  return tags.map((tag) => tagLabel[String(tag)] || String(tag));
}

function propertyRow(p: any): string {
  const title = displayText(p.title);
  const href = safeHttpsUrl(p.url);
  const titleHtml = href
    ? `<a href="${escapeHtml(href)}">${escapeHtml(title)}</a>`
    : escapeHtml(title);
  const tags = labelsForTags(p.tags).map((tag) =>
    `<span style="display:inline-block;padding:1px 6px;margin:1px;border-radius:8px;font-size:11px;background:#e0e7ff;color:#3730a3">${escapeHtml(tag)}</span>`
  ).join(' ');
  const city = cityLabel[String(p.city)] || displayText(p.city);
  const score = Number(p.focus_score);
  return `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #eee">${titleHtml}</td>
      <td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(city)}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${escapeHtml(formatNumber(p.area_sqm, ' м²'))}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${escapeHtml(formatNumber(p.price, ' ₽'))}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${escapeHtml(formatNumber(p.price_per_sqm, ' ₽/м²'))}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:center;font-weight:bold;color:${Number.isFinite(score) && score >= 50 ? '#ef4444' : '#f59e0b'}">${escapeHtml(formatScore(p.focus_score))}</td>
      <td style="padding:8px;border-bottom:1px solid #eee">${tags || '—'}</td>
    </tr>
  `;
}

function propertyText(p: any): string {
  const title = displayText(p.title);
  const city = cityLabel[String(p.city)] || displayText(p.city);
  const tags = labelsForTags(p.tags);
  const href = safeHttpsUrl(p.url);
  return [
    title,
    city,
    formatNumber(p.area_sqm, ' м²'),
    formatNumber(p.price, ' ₽'),
    formatNumber(p.price_per_sqm, ' ₽/м²'),
    `скор ${formatScore(p.focus_score)}`,
    tags.length > 0 ? `теги: ${tags.join(', ')}` : null,
    href,
  ].filter(Boolean).join(' | ');
}

function tableHeader(): string {
  return `<thead><tr style="background:#f5f5f5">
    <th style="padding:8px;text-align:left">Название</th>
    <th style="padding:8px;text-align:left">Город</th>
    <th style="padding:8px;text-align:right">Площадь</th>
    <th style="padding:8px;text-align:right">Цена</th>
    <th style="padding:8px;text-align:right">₽/м²</th>
    <th style="padding:8px;text-align:center">Скор</th>
    <th style="padding:8px;text-align:left">Теги</th>
  </tr></thead>`;
}

// workerContext is optional for direct/manual legacy invocations.
export async function handleDigestJob(job: Job, workerContext?: WorkerContext): Promise<{ sent: boolean; count: number }> {
  const req = job.data as DigestRequest;
  const corrId = req.correlationId || job.correlation_id || `digest-${Date.now()}`;
  const startedAt = new Date().toISOString();

  logger.info(`Digest triggered for ${req.date}`, { correlationId: corrId });

  throwIfCancellationRequested(workerContext);
  const setting = await fetchSetting().catch(() => null);
  throwIfCancellationRequested(workerContext);
  const regions: string[] = setting?.monitored_regions || ['moscow', 'mo'];
  const priceFrom = setting?.price_from;
  const priceTo = setting?.price_to;

  // Проверяем включён ли дайджест
  if (setting?.digest_enabled === false) {
    logger.info('Digest disabled in settings, skipping', { correlationId: corrId });
    return { sent: false, count: 0 };
  }

  throwIfCancellationRequested(workerContext);
  const allFocus = await fetchFocusProperties(workerContext);
  throwIfCancellationRequested(workerContext);
  const now = Date.now();
  const h24 = 24 * 60 * 60 * 1000;
  const filtered = allFocus.filter((p: any) => {
    // Свежесть: только валидные ISO timestamps за последние 24 часа.
    const seenAt = parseStoredIsoTimestamp(p.first_seen_at);
    if (seenAt === null || seenAt > now || now - seenAt > h24) return false;
    // Регион
    if (!regions.includes(p.city)) return false;
    // Цена
    if (priceFrom != null && p.price != null && p.price < Number(priceFrom)) return false;
    if (priceTo != null && p.price != null && p.price > Number(priceTo)) return false;
    return true;
  });

  if (filtered.length === 0) {
    logger.info('No focus properties — skipping email', { correlationId: corrId });
    return { sent: false, count: 0 };
  }

  const hot = filtered.filter((p: any) => (p.focus_score || 0) >= 50);
  const regular = filtered.filter((p: any) => (p.focus_score || 0) < 50);

  const smtpTo = req.smtpTo || config.smtp.user;
  if (!smtpTo) {
    logger.warn('No smtpTo address — skipping email', { correlationId: corrId });
    return { sent: false, count: filtered.length };
  }

  let sectionsHtml = '';
  if (hot.length > 0) {
    sectionsHtml += `
      <h3 style="color:#ef4444;margin-top:24px">🔥 Горячее (${hot.length})</h3>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        ${tableHeader()}
        <tbody>${hot.map(propertyRow).join('')}</tbody>
      </table>`;
  }
  if (regular.length > 0) {
    sectionsHtml += `
      <h3 style="color:#f59e0b;margin-top:24px">📋 Обычное (${regular.length})</h3>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        ${tableHeader()}
        <tbody>${regular.map(propertyRow).join('')}</tbody>
      </table>`;
  }

  const avgScore = Math.round(filtered.reduce((s: number, p: any) => s + (p.focus_score || 0), 0) / filtered.length);

  const html = `
    <div style="font-family:sans-serif;max-width:900px;margin:0 auto">
      <h2 style="color:#333">AKLAB: Объекты в фокусе — ${escapeHtml(req.date)}</h2>
      <p style="color:#666">В фокусе: <strong>${filtered.length}</strong> объектов · Средний скор: <strong>${avgScore}</strong></p>
      <p style="color:#666;font-size:13px">🔥 Горячее (скор ≥ 50): ${hot.length} · 📋 Обычное (20-49): ${regular.length}</p>
      ${sectionsHtml}
      <p style="color:#999;font-size:12px;margin-top:24px">AKLAB — мониторинг коммерческой недвижимости</p>
    </div>`;
  const text = [
    `AKLAB: Объекты в фокусе — ${displayText(req.date)}`,
    `В фокусе: ${filtered.length} объектов · Средний скор: ${avgScore}`,
    `Горячее (скор ≥ 50): ${hot.length} · Обычное (20-49): ${regular.length}`,
    hot.length > 0 ? `\nГорячее:\n${hot.map(propertyText).join('\n')}` : null,
    regular.length > 0 ? `\nОбычное:\n${regular.map(propertyText).join('\n')}` : null,
    '\nAKLAB — мониторинг коммерческой недвижимости',
  ].filter(Boolean).join('\n');

  try {
    const transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: true,
      auth: { user: config.smtp.user, pass: config.smtp.pass },
    });
    throwIfCancellationRequested(workerContext);
    await transporter.sendMail({
      from: config.smtp.from,
      to: smtpTo,
      subject: `AKLAB: ${filtered.length} объектов в фокусе (скор ${avgScore}) — ${req.date}`,
      text,
      html,
    } as any);
    throwIfCancellationRequested(workerContext);
    logger.info(`Email sent: ${hot.length} hot + ${regular.length} regular`, { correlationId: corrId });
  } catch (err: any) {
    logger.error(`Email send failed: ${err.message}`, { correlationId: corrId });
    throw err;
  }

  throwIfCancellationRequested(workerContext);
  await logCron({ name: 'digest-send', started_at: startedAt, finished_at: new Date().toISOString(), items_processed: filtered.length }).catch(() => {});
  throwIfCancellationRequested(workerContext);
  return { sent: true, count: filtered.length };
}
