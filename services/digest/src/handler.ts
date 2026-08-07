import { PermanentError } from '@aklab/sqlite-queue';
import type { Job, WorkerContext } from '@aklab/sqlite-queue';
import nodemailer from 'nodemailer';
import { logCron } from '@aklab/service-shared';
import { config } from './config';
import { logger } from './utils/logger';

export interface DigestRequest {
  runId: string;
  userId: number;
  snapshotHash: string;
  correlationId?: string;
}

type DigestResult = { sent: boolean; count: number; reason?: string };
type DeliveryReason = 'inactive' | 'disabled' | 'missing_email';
type DeliveryState =
  | { enabled: true; email: string }
  | { enabled: false; reason: DeliveryReason };
type Property = Record<string, unknown>;

type ProjectionMeta = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  threshold: number;
  windowEndAt: string;
};

type Projection = {
  data: Property[];
  meta: ProjectionMeta;
};

const BASE = config.strapi.url;
const PAGE_SIZE = 100;
const MAX_PROPERTIES = 100_000;
const MAX_PAGES = MAX_PROPERTIES / PAGE_SIZE;
const MAX_RUN_ID_LENGTH = 128;
const MAX_CORRELATION_ID_LENGTH = 128;
const MAX_DOCUMENT_ID_LENGTH = 256;
const MAX_EMAIL_LENGTH = 320;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UTC_ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/;
const DELIVERY_REASONS = new Set<DeliveryReason>([
  'inactive',
  'disabled',
  'missing_email',
]);
const HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'x-aklab-service-token': config.strapi.apiToken,
};
const PROPERTY_KEYS = new Set([
  'documentId',
  'title',
  'source',
  'external_id',
  'url',
  'city',
  'address',
  'area_sqm',
  'price',
  'price_per_sqm',
  'property_type',
  'auction_type',
  'description',
  'is_undervalued',
  'deviation_percent',
  'focus_score',
  'status',
  'tags',
  'photo_urls',
  'photos',
  'minimum_price',
  'first_seen_at',
  'createdAt',
]);

const PROJECTION_REQUEST_ERROR = 'Digest projection request failed';
const PROJECTION_RESPONSE_ERROR = 'Digest projection response is invalid';
const DELIVERY_RESPONSE_ERROR = 'Digest delivery response is invalid';
const SEND_ERROR = 'Digest email send failed';
const WORKER_ERROR = 'Digest worker failed';

class SafeDigestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SafeDigestError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(value, key));
}

function throwIfCancellationRequested(workerContext?: WorkerContext): void {
  if (workerContext?.isCancellationRequested() || workerContext?.isLeaseValid?.() === false) {
    throw new PermanentError('Digest job cancelled or lease lost before the next side effect');
  }
}

function validBoundedText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maxLength
    && value.trim() === value
    && !CONTROL_PATTERN.test(value);
}

function validateJobData(value: unknown): DigestRequest {
  if (!isRecord(value)) throw new PermanentError('Invalid digest job data');
  const keys = Object.keys(value);
  if (
    (keys.length !== 3 && keys.length !== 4)
    || !Object.prototype.hasOwnProperty.call(value, 'runId')
    || !Object.prototype.hasOwnProperty.call(value, 'userId')
    || !Object.prototype.hasOwnProperty.call(value, 'snapshotHash')
    || keys.some(key => !['runId', 'userId', 'snapshotHash', 'correlationId'].includes(key))
  ) {
    throw new PermanentError('Invalid digest job data');
  }
  if (!validBoundedText(value.runId, MAX_RUN_ID_LENGTH)) {
    throw new PermanentError('Invalid digest job data');
  }
  if (typeof value.userId !== 'number' || !Number.isSafeInteger(value.userId) || value.userId <= 0) {
    throw new PermanentError('Invalid digest job data');
  }
  if (typeof value.snapshotHash !== 'string' || !SHA256_PATTERN.test(value.snapshotHash)) {
    throw new PermanentError('Invalid digest job data');
  }
  const correlationId = value.correlationId;
  if (Object.prototype.hasOwnProperty.call(value, 'correlationId')
    && !validBoundedText(correlationId, MAX_CORRELATION_ID_LENGTH)) {
    throw new PermanentError('Invalid digest job data');
  }
  return {
    runId: value.runId,
    userId: value.userId,
    snapshotHash: value.snapshotHash,
    ...(correlationId === undefined ? {} : { correlationId: correlationId as string }),
  };
}

function logMeta(correlationId?: string): Record<string, string> {
  return correlationId ? { correlationId } : {};
}

async function postJson(path: string, data: Record<string, unknown>, workerContext?: WorkerContext): Promise<unknown> {
  throwIfCancellationRequested(workerContext);
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ data }),
    });
  } catch {
    throw new SafeDigestError(PROJECTION_REQUEST_ERROR);
  }
  throwIfCancellationRequested(workerContext);

  if (
    !response
    || response.ok !== true
    || !Number.isInteger(response.status)
    || response.status < 200
    || response.status >= 300
    || typeof response.json !== 'function'
  ) {
    throw new SafeDigestError(PROJECTION_REQUEST_ERROR);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new SafeDigestError(PROJECTION_REQUEST_ERROR);
  }
  throwIfCancellationRequested(workerContext);
  return body;
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_EMAIL_LENGTH) return null;
  if (value.trim() !== value || CONTROL_PATTERN.test(value) || !EMAIL_PATTERN.test(value)) return null;
  return value;
}

function parseDeliveryResponse(body: unknown): DeliveryState {
  if (!isRecord(body) || !hasExactKeys(body, ['data']) || !isRecord(body.data)) {
    throw new SafeDigestError(DELIVERY_RESPONSE_ERROR);
  }
  const data = body.data;
  if (data.enabled === false) {
    if (!hasExactKeys(data, ['enabled', 'reason'])
      || typeof data.reason !== 'string'
      || !DELIVERY_REASONS.has(data.reason as DeliveryReason)) {
      throw new SafeDigestError(DELIVERY_RESPONSE_ERROR);
    }
    return { enabled: false, reason: data.reason as DeliveryReason };
  }
  if (data.enabled === true && hasExactKeys(data, ['enabled', 'email'])) {
    const email = normalizeEmail(data.email);
    if (email) return { enabled: true, email };
  }
  throw new SafeDigestError(DELIVERY_RESPONSE_ERROR);
}

async function fetchDelivery(request: DigestRequest, workerContext?: WorkerContext): Promise<DeliveryState> {
  const body = await postJson('/api/internal/digest/delivery', {
    runId: request.runId,
    userId: request.userId,
    snapshotHash: request.snapshotHash,
  }, workerContext);
  return parseDeliveryResponse(body);
}

function parseWindowEndAt(value: unknown): string {
  if (
    typeof value !== 'string'
    || !UTC_ISO_PATTERN.test(value)
    || !Number.isFinite(Date.parse(value))
    || new Date(value).toISOString() !== value
  ) {
    throw new SafeDigestError(PROJECTION_RESPONSE_ERROR);
  }
  return value;
}

function parsePropertiesResponse(body: unknown, requestedPage: number, seen: Set<string>, previous?: ProjectionMeta): Projection {
  if (!isRecord(body) || !hasExactKeys(body, ['data', 'meta']) || !Array.isArray(body.data) || !isRecord(body.meta)) {
    throw new SafeDigestError(PROJECTION_RESPONSE_ERROR);
  }
  const meta = body.meta;
  if (!hasExactKeys(meta, ['page', 'pageSize', 'total', 'totalPages', 'threshold', 'windowEndAt'])) {
    throw new SafeDigestError(PROJECTION_RESPONSE_ERROR);
  }
  if (
    typeof meta.page !== 'number'
    || !Number.isSafeInteger(meta.page)
    || meta.page !== requestedPage
    || meta.page < 1
    || meta.page > MAX_PAGES
    || meta.pageSize !== PAGE_SIZE
    || typeof meta.total !== 'number'
    || !Number.isSafeInteger(meta.total)
    || meta.total < 0
    || meta.total > MAX_PROPERTIES
    || typeof meta.totalPages !== 'number'
    || !Number.isSafeInteger(meta.totalPages)
    || meta.totalPages < 0
    || meta.totalPages > MAX_PAGES
    || meta.totalPages !== Math.ceil(meta.total / PAGE_SIZE)
    || (meta.totalPages > 0 && meta.page > meta.totalPages)
    || (meta.totalPages === 0 && meta.page !== 1)
    || typeof meta.threshold !== 'number'
    || !Number.isFinite(meta.threshold)
    || meta.threshold < 0
    || meta.threshold > 100
  ) {
    throw new SafeDigestError(PROJECTION_RESPONSE_ERROR);
  }
  const windowEndAt = parseWindowEndAt(meta.windowEndAt);
  const normalizedMeta: ProjectionMeta = {
    page: meta.page,
    pageSize: meta.pageSize,
    total: meta.total,
    totalPages: meta.totalPages,
    threshold: meta.threshold,
    windowEndAt,
  };
  if (previous && (
    previous.pageSize !== normalizedMeta.pageSize
    || previous.total !== normalizedMeta.total
    || previous.totalPages !== normalizedMeta.totalPages
    || previous.threshold !== normalizedMeta.threshold
    || previous.windowEndAt !== normalizedMeta.windowEndAt
  )) {
    throw new SafeDigestError(PROJECTION_RESPONSE_ERROR);
  }

  const expectedLength = normalizedMeta.totalPages === 0
    ? 0
    : normalizedMeta.page < normalizedMeta.totalPages
      ? PAGE_SIZE
      : normalizedMeta.total - ((normalizedMeta.totalPages - 1) * PAGE_SIZE);
  if (body.data.length !== expectedLength) throw new SafeDigestError(PROJECTION_RESPONSE_ERROR);

  const data: Property[] = [];
  for (const item of body.data) {
    if (!isRecord(item)
      || Object.keys(item).some(key => !PROPERTY_KEYS.has(key))
      || !validBoundedText(item.documentId, MAX_DOCUMENT_ID_LENGTH)) {
      throw new SafeDigestError(PROJECTION_RESPONSE_ERROR);
    }
    if (seen.has(item.documentId)) throw new SafeDigestError(PROJECTION_RESPONSE_ERROR);
    seen.add(item.documentId);
    data.push(item);
  }
  return { data, meta: normalizedMeta };
}

async function fetchProjection(request: DigestRequest, workerContext?: WorkerContext): Promise<{ properties: Property[]; meta: ProjectionMeta }> {
  const seen = new Set<string>();
  const first = parsePropertiesResponse(await postJson('/api/internal/digest/properties', {
    runId: request.runId,
    userId: request.userId,
    snapshotHash: request.snapshotHash,
    page: 1,
    pageSize: PAGE_SIZE,
  }, workerContext), 1, seen);
  const properties = [...first.data];
  for (let page = 2; page <= first.meta.totalPages; page += 1) {
    const next = parsePropertiesResponse(await postJson('/api/internal/digest/properties', {
      runId: request.runId,
      userId: request.userId,
      snapshotHash: request.snapshotHash,
      page,
      pageSize: PAGE_SIZE,
    }, workerContext), page, seen, first.meta);
    properties.push(...next.data);
  }
  if (properties.length !== first.meta.total) throw new SafeDigestError(PROJECTION_RESPONSE_ERROR);
  return { properties, meta: first.meta };
}

const cityLabel: Record<string, string> = { moscow: 'Москва', mo: 'МО', other: 'Другой' };

const tagLabel: Record<string, string> = {
  undervalued: 'Недооценён',
  has_minimum_price: 'Торги',
  new: 'Новый',
  large_area: 'Большая пл.',
  moscow_mo: 'МСК/МО',
};

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

function formatNumber(value: unknown, suffix: string): string {
  if (value === null || value === undefined || value === '') return '—';
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toLocaleString('ru-RU')}${suffix}` : '—';
}

function scoreValue(property: Property): number {
  const score = Number(property.focus_score);
  return Number.isFinite(score) ? score : 0;
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

function propertyRow(property: Property): string {
  const title = displayText(property.title);
  const href = safeHttpsUrl(property.url);
  const titleHtml = href
    ? `<a href="${escapeHtml(href)}">${escapeHtml(title)}</a>`
    : escapeHtml(title);
  const tags = labelsForTags(property.tags).map((tag) =>
    `<span style="display:inline-block;padding:1px 6px;margin:1px;border-radius:8px;font-size:11px;background:#e0e7ff;color:#3730a3">${escapeHtml(tag)}</span>`,
  ).join(' ');
  const city = cityLabel[String(property.city)] || displayText(property.city);
  const score = scoreValue(property);
  return `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #eee">${titleHtml}</td>
      <td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(city)}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${escapeHtml(formatNumber(property.area_sqm, ' м²'))}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${escapeHtml(formatNumber(property.price, ' ₽'))}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${escapeHtml(formatNumber(property.price_per_sqm, ' ₽/м²'))}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:center;font-weight:bold;color:${score >= 50 ? '#ef4444' : '#f59e0b'}">${escapeHtml(formatScore(property.focus_score))}</td>
      <td style="padding:8px;border-bottom:1px solid #eee">${tags || '—'}</td>
    </tr>
  `;
}

function propertyText(property: Property): string {
  const title = displayText(property.title);
  const city = cityLabel[String(property.city)] || displayText(property.city);
  const tags = labelsForTags(property.tags);
  const href = safeHttpsUrl(property.url);
  return [
    title,
    city,
    formatNumber(property.area_sqm, ' м²'),
    formatNumber(property.price, ' ₽'),
    formatNumber(property.price_per_sqm, ' ₽/м²'),
    `скор ${formatScore(property.focus_score)}`,
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

function buildMail(properties: Property[], windowEndAt: string): { subject: string; html: string; text: string } {
  const dateLabel = new Date(windowEndAt).toISOString().slice(0, 10);
  const hot = properties.filter(property => scoreValue(property) >= 50);
  const regular = properties.filter(property => scoreValue(property) < 50);
  const avgScore = Math.round(properties.reduce((sum, property) => sum + scoreValue(property), 0) / properties.length);

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

  const html = `
    <div style="font-family:sans-serif;max-width:900px;margin:0 auto">
      <h2 style="color:#333">AKLAB: Объекты в фокусе — ${escapeHtml(dateLabel)}</h2>
      <p style="color:#666">В фокусе: <strong>${properties.length}</strong> объектов · Средний скор: <strong>${avgScore}</strong></p>
      <p style="color:#666;font-size:13px">🔥 Горячее (скор ≥ 50): ${hot.length} · 📋 Обычное (20-49): ${regular.length}</p>
      ${sectionsHtml}
      <p style="color:#999;font-size:12px;margin-top:24px">AKLAB — мониторинг коммерческой недвижимости</p>
    </div>`;
  const text = [
    `AKLAB: Объекты в фокусе — ${dateLabel}`,
    `В фокусе: ${properties.length} объектов · Средний скор: ${avgScore}`,
    `Горячее (скор ≥ 50): ${hot.length} · Обычное (20-49): ${regular.length}`,
    hot.length > 0 ? `\nГорячее:\n${hot.map(propertyText).join('\n')}` : null,
    regular.length > 0 ? `\nОбычное:\n${regular.map(propertyText).join('\n')}` : null,
    '\nAKLAB — мониторинг коммерческой недвижимости',
  ].filter(Boolean).join('\n');

  return {
    subject: `AKLAB: ${properties.length} объектов в фокусе (скор ${avgScore}) — ${dateLabel}`,
    html,
    text,
  };
}

// workerContext is optional for direct/manual invocations.
export async function handleDigestJob(job: Job, workerContext?: WorkerContext): Promise<DigestResult> {
  const request = validateJobData(job?.data);
  const metadata = logMeta(request.correlationId);

  try {
    const initialDelivery = await fetchDelivery(request, workerContext);
    if (!initialDelivery.enabled) {
      logger.info('Digest skipped', { ...metadata, reason: initialDelivery.reason, count: 0 });
      return { sent: false, count: 0, reason: initialDelivery.reason };
    }

    const projection = await fetchProjection(request, workerContext);
    if (projection.properties.length === 0) {
      logger.info('Digest skipped', { ...metadata, reason: 'empty', count: 0 });
      return { sent: false, count: 0, reason: 'empty' };
    }

    const mail = buildMail(projection.properties, projection.meta.windowEndAt);
    const currentDelivery = await fetchDelivery(request, workerContext);
    if (!currentDelivery.enabled) {
      logger.info('Digest skipped', { ...metadata, reason: currentDelivery.reason, count: 0 });
      return { sent: false, count: 0, reason: currentDelivery.reason };
    }
    throwIfCancellationRequested(workerContext);

    let transporter: ReturnType<typeof nodemailer.createTransport>;
    try {
      transporter = nodemailer.createTransport({
        host: config.smtp.host,
        port: config.smtp.port,
        secure: true,
        auth: { user: config.smtp.user, pass: config.smtp.pass },
      });
    } catch {
      throw new SafeDigestError(SEND_ERROR);
    }

    throwIfCancellationRequested(workerContext);
    try {
      await transporter.sendMail({
        from: config.smtp.from,
        to: currentDelivery.email,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
      } as any);
    } catch {
      throw new SafeDigestError(SEND_ERROR);
    }

    try {
      logger.info('Digest sent', { ...metadata, count: projection.properties.length });
    } catch {
      // Logging must not turn an already sent email into a retryable failure.
    }
    await logCron({
      name: 'digest-send',
      started_at: projection.meta.windowEndAt,
      finished_at: projection.meta.windowEndAt,
      items_processed: projection.properties.length,
    }).catch(() => {});
    return { sent: true, count: projection.properties.length };
  } catch (error) {
    if (error instanceof PermanentError) throw error;
    try {
      logger.error('Digest worker failed', metadata);
    } catch {
      // Logging must not replace the safe worker error.
    }
    if (error instanceof SafeDigestError) throw error;
    throw new SafeDigestError(WORKER_ERROR);
  }
}
