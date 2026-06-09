import type { Job } from '@aklab/sqlite-queue';
import nodemailer from 'nodemailer';
import { fetchUndervaluedProperties, logCron } from '@aklab/service-shared';
import { config } from './config';
import { logger } from './utils/logger';

export interface DigestRequest {
  date: string;
  smtpTo: string | null;
  correlationId?: string;
}

const cityLabel: Record<string, string> = { moscow: 'Москва', mo: 'МО', other: 'Другой' };
const typeLabel: Record<string, string> = {
  office: 'Офис', warehouse: 'Склад', retail: 'Торговля',
  production: 'Производство', free_purpose: 'Св. назн.', other: 'Другое',
};

export async function handleDigestJob(job: Job): Promise<{ sent: boolean; count: number }> {
  const req = job.data as DigestRequest;
  const corrId = req.correlationId || job.correlation_id || `digest-${Date.now()}`;
  const startedAt = new Date().toISOString();

  logger.info(`Digest triggered for ${req.date}`, { correlationId: corrId });

  const properties = await fetchUndervaluedProperties();
  if (properties.length === 0) {
    logger.info('No undervalued properties — skipping email', { correlationId: corrId });
    return { sent: false, count: 0 };
  }

  const smtpTo = req.smtpTo || config.smtp.user;
  if (!smtpTo) {
    logger.warn('No smtpTo address — skipping email', { correlationId: corrId });
    return { sent: false, count: properties.length };
  }

  // Формируем HTML
  const rows = properties.map((p: any) => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #eee"><a href="${p.url || '#'}">${p.title}</a></td>
      <td style="padding:8px;border-bottom:1px solid #eee">${p.address || '—'}</td>
      <td style="padding:8px;border-bottom:1px solid #eee">${cityLabel[p.city] || p.city}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${p.area_sqm ? p.area_sqm + ' м²' : '—'}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${p.price ? Number(p.price).toLocaleString('ru-RU') + ' ₽' : '—'}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${p.price_per_sqm ? Number(p.price_per_sqm).toLocaleString('ru-RU') + ' ₽/м²' : '—'}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:center;color:#f59e0b;font-weight:bold">${p.deviation_percent}%</td>
    </tr>
  `).join('');

  const html = `
    <div style="font-family:sans-serif;max-width:900px;margin:0 auto">
      <h2 style="color:#333">AKLAB: Недооценённые объекты за ${req.date}</h2>
      <p style="color:#666">Найдено <strong>${properties.length}</strong> объектов с ценой ниже эталона.</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <thead>
          <tr style="background:#f5f5f5">
            <th style="padding:8px;text-align:left">Название</th>
            <th style="padding:8px;text-align:left">Адрес</th>
            <th style="padding:8px;text-align:left">Город</th>
            <th style="padding:8px;text-align:right">Площадь</th>
            <th style="padding:8px;text-align:right">Цена</th>
            <th style="padding:8px;text-align:right">₽/м²</th>
            <th style="padding:8px;text-align:center">Отклонение</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="color:#999;font-size:12px;margin-top:24px">AKLAB — мониторинг коммерческой недвижимости</p>
    </div>
  `;

  // Отправляем через nodemailer
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
      subject: `AKLAB: ${properties.length} недооценённых объектов — ${req.date}`,
      html,
    });

    logger.info(`Email sent to ${smtpTo} with ${properties.length} properties`, { correlationId: corrId });
  } catch (err: any) {
    logger.error(`Email send failed: ${err.message}`, { correlationId: corrId });
    throw err;
  }

  await logCron({
    name: 'digest-send',
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    items_processed: properties.length,
  }).catch(() => {});

  return { sent: true, count: properties.length };
}
