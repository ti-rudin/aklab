/**
 * cron-log controller
 */
import { factories } from '@strapi/strapi';

const INTERNAL_CRON_LOG_FIELDS = new Set([
  'name',
  'started_at',
  'finished_at',
  'items_processed',
  'error',
]);

function internalPayload(ctx: any): Record<string, unknown> | null {
  const data = ctx.request?.body?.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return null;
  }

  const fields = Object.keys(data);
  if (fields.length === 0 || fields.some((field) => !INTERNAL_CRON_LOG_FIELDS.has(field))) {
    return null;
  }

  return data as Record<string, unknown>;
}

export default factories.createCoreController('api::cron-log.cron-log', ({ strapi }) => ({
  /** Service-only worker endpoint with a strict field mask. */
  async internalCreate(ctx) {
    const data = internalPayload(ctx);
    if (!data) {
      ctx.status = 400;
      ctx.body = { error: 'Invalid internal cron-log payload' };
      return;
    }

    const created = await strapi.db.query('api::cron-log.cron-log').create({ data });
    ctx.status = 201;
    ctx.body = { data: created };
  },
}));
