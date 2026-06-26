import type { Job } from '@aklab/sqlite-queue';
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

async function fetchFocusProperties(threshold: number): Promise<any[]> {
  const url = `${BASE}/api/properties/focus?threshold=${threshold}&pageSize=100&sort=-focus_score`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) return [];
  const json: any = await res.json();
  return json.data || [];
}

function propertyRow(p: any): string {
  const tags = (p.tags || []).map((t: string) =>
    `<span style="display:inline-block;padding:1px 6px;margin:1px;border-radius:8px;font-size:11px;background:#e0e7ff;color:#3730a3">${tagLabel[t] || t}</span>`
  ).join(' ');
  return `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #eee"><a href="${p.url || '#'}">${p.title}</a></td>
      <td style="padding:8px;border-bottom:1px solid #eee">${cityLabel[p.city] || p.city}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${p.area_sqm ? p.area_sqm + ' м²' : '—'}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${p.price ? Number(p.price).toLocaleString('ru-RU') + ' ₽' : '—'}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${p.price_per_sqm ? Number(p.price_per_sqm).toLocaleString('ru-RU') + ' ₽/м²' : '—'}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:center;font-weight:bold;color:${(p.focus_score || 0) >= 50 ? '#ef4444' : '#f59e0b'}">${p.focus_score ?? '—'}</td>
      <td style="padding:8px;border-bottom:1px solid #eee">${tags || '—'}</td>
    </tr>
  `;
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

export async function handleDigestJob(job: Job): Promise<{ sent: boolean; count: number }> {
  const req = job.data as DigestRequest;
  const corrId = req.correlationId || job.correlation_id || `digest-${Date.now()}`;
  const startedAt = new Date().toISOString();

  logger.info(`Digest triggered for ${req.date}`, { correlationId: corrId });

  const setting = await fetchSetting().catch(() => null);
  const regions: string[] = setting?.monitored_regions || ['moscow', 'mo'];

  const allFocus = await fetchFocusProperties(20);
  const filtered = allFocus.filter((p: any) => regions.includes(p.city));

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
      <h2 style="color:#333">AKLAB: Объекты в фокусе — ${req.date}</h2>
      <p style="color:#666">В фокусе: <strong>${filtered.length}</strong> объектов · Средний скор: <strong>${avgScore}</strong></p>
      <p style="color:#666;font-size:13px">🔥 Горячее (скор ≥ 50): ${hot.length} · 📋 Обычное (20-49): ${regular.length}</p>
      ${sectionsHtml}
      <p style="color:#999;font-size:12px;margin-top:24px">AKLAB — мониторинг коммерческой недвижимости</p>
    </div>`;

  try {
    const transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: true,
      auth: { user: config.smtp.user, pass: config.smtp.pass },
    });
    await transporter.sendMail({
      from: config.smtp.from,
      to: smtpTo,
      subject: `AKLAB: ${filtered.length} объектов в фокусе (скор ${avgScore}) — ${req.date}`,
      html,
    });
    logger.info(`Email sent: ${hot.length} hot + ${regular.length} regular`, { correlationId: corrId });
  } catch (err: any) {
    logger.error(`Email send failed: ${err.message}`, { correlationId: corrId });
    throw err;
  }

  await logCron({ name: 'digest-send', started_at: startedAt, finished_at: new Date().toISOString(), items_processed: filtered.length }).catch(() => {});
  return { sent: true, count: filtered.length };
}
