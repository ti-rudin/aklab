/**
 * Cron controller — manual triggers for parse/analyze/digest.
 */

import { getQueueService } from '../../../services/queueService';

function getQueue() {
  return getQueueService();
}

export default {
  async parseSource(ctx: any) {
    try {
      const { slug } = ctx.params;
      const qs = getQueue();
      const corrId = `manual-parse-${Date.now()}`;

      // Find source by slug
      const sources = await (strapi as any).entityService.findMany('api::source.source', {
        filters: { slug },
        limit: 1,
      });
      const source = sources?.[0];
      if (!source) {
        ctx.notFound(`Source ${slug} not found`);
        return;
      }

      if (!source.is_active) {
        ctx.badRequest(`Source ${slug} is not active`);
        return;
      }

      qs.addToQueue(`parse-${slug}`, {
        source: slug,
        sourceId: source.id,
        documentId: source.documentId,
      }, { correlationId: corrId });

      ctx.body = {
        ok: true,
        message: `Parse job enqueued for ${slug}`,
        correlationId: corrId,
      };
    } catch (err: any) {
      strapi.log.error(`[cron] parseSource error: ${err.message}`);
      ctx.internalServerError(err.message);
    }
  },

  async analyzeAll(ctx: any) {
    try {
      const qs = getQueue();
      const corrId = `manual-analyze-${Date.now()}`;

      // Parse optional filters from request body
      const body = ctx.request?.body || {};
      const priceFrom = body.priceFrom ? Number(body.priceFrom) : null;
      const priceTo = body.priceTo ? Number(body.priceTo) : null;
      const cityFilter = body.city || null; // array of city codes
      const threshold = body.threshold ? Number(body.threshold) : null;

      // Build Strapi filters
      const filters: any = { status: 'new', is_undervalued: { $null: true } };

      if (priceFrom !== null && !isNaN(priceFrom)) {
        filters.price = { ...(filters.price || {}), $gte: priceFrom };
      }
      if (priceTo !== null && !isNaN(priceTo)) {
        filters.price = { ...(filters.price || {}), $lte: priceTo };
      }
      if (cityFilter && Array.isArray(cityFilter) && cityFilter.length > 0) {
        filters.city = { $in: cityFilter };
      }

      const properties = await (strapi as any).entityService.findMany('api::property.property', {
        filters,
        limit: 500,
      });

      for (const prop of properties || []) {
        qs.addToQueue('analyze-property', {
          documentId: prop.documentId,
          ...(threshold !== null && !isNaN(threshold) ? { threshold } : {}),
        }, { correlationId: corrId });
      }

      ctx.body = {
        ok: true,
        message: `Enqueued ${properties?.length || 0} properties for analysis`,
        correlationId: corrId,
        filters: { priceFrom, priceTo, city: cityFilter, threshold },
      };
    } catch (err: any) {
      strapi.log.error(`[cron] analyzeAll error: ${err.message}`);
      ctx.internalServerError(err.message);
    }
  },

  async sendDigest(ctx: any) {
    try {
      const qs = getQueue();
      const corrId = `manual-digest-${Date.now()}`;

      const setting = await (strapi as any).db.query('api::setting.setting').findOne({});
      const smtpTo = setting?.smtp_to || undefined;

      qs.addToQueue('digest-send', {
        date: new Date().toISOString().slice(0, 10),
        smtpTo,
      }, { correlationId: corrId });

      ctx.body = {
        ok: true,
        message: 'Digest job enqueued',
        correlationId: corrId,
      };
    } catch (err: any) {
      strapi.log.error(`[cron] sendDigest error: ${err.message}`);
      ctx.internalServerError(err.message);
    }
  },

  async getQueueStats(ctx: any) {
    try {
      const qs = getQueue();
      const queues = qs.getDetailedStats();

      // Also get source stats
      const sources = await (strapi as any).entityService.findMany('api::source.source', {
        limit: 50,
      });

      ctx.body = {
        ok: true,
        queues,
        sources: (sources || []).map((s: any) => ({
          slug: s.slug,
          is_active: s.is_active,
          last_parse_status: s.last_parse_status,
          last_parsed_at: s.last_parsed_at,
          total_created: s.total_created,
          parse_count: s.parse_count,
        })),
      };
    } catch (err: any) {
      strapi.log.error(`[cron] getQueueStats error: ${err.message}`);
      ctx.internalServerError(err.message);
    }
  },
};
