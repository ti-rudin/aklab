/**
 * Cron controller — manual triggers for parse/analyze/digest/score.
 */

import { getQueueService } from '../../../services/queueService';
import { scorePropertiesBatch } from '../../../services/focusEngine';
import type { StrapiInstance } from '../../../types/strapi';

function getQueue() {
  return getQueueService();
}

export default {
  async parseSource(ctx: any) {
    try {
      const s = strapi as unknown as StrapiInstance;
      const { slug } = ctx.params;
      const depth = ctx.request.body?.depth ?? 20;
      const qs = getQueue();
      const corrId = `manual-parse-${Date.now()}`;

      // Find source by slug
      const sources = await s.entityService.findMany('api::source.source', {
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
        depth,
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
      const s = strapi as unknown as StrapiInstance;
      const qs = getQueue();
      const corrId = `manual-analyze-${Date.now()}`;

      // Parse optional filters from request body
      const body = ctx.request?.body || {};
      const priceFrom = body.priceFrom ? Number(body.priceFrom) : null;
      const priceTo = body.priceTo ? Number(body.priceTo) : null;
      const cityFilter = body.city || null; // array of city codes
      const threshold = body.threshold ? Number(body.threshold) : null;
      const force = body.force === true; // ручной пересчёт — сбросить и пересчитать

      // Build Strapi filters
      const filters: any = { status: 'new', is_undervalued: { $null: true } };

      // Force mode: сбросить is_undervalued для пересчёта
      if (force) {
        const resetFilters: any = { status: 'new' };
        if (priceFrom !== null && !isNaN(priceFrom)) {
          resetFilters.price = { ...(resetFilters.price || {}), $gte: priceFrom };
        }
        if (priceTo !== null && !isNaN(priceTo)) {
          resetFilters.price = { ...(resetFilters.price || {}), $lte: priceTo };
        }
        if (cityFilter && Array.isArray(cityFilter) && cityFilter.length > 0) {
          resetFilters.city = { $in: cityFilter };
        }

        const toReset = await s.entityService.findMany('api::property.property', {
          filters: resetFilters,
          limit: 500,
          fields: ['documentId'],
        });

        let resetCount = 0;
        for (const prop of toReset || []) {
          await s.entityService.update('api::property.property', prop.documentId, {
            data: { is_undervalued: null, deviation: null, price_per_sqm_ref: null },
          });
          resetCount++;
        }
        strapi.log.info(`[cron] Force reset ${resetCount} properties (is_undervalued → null)`);
      }

      if (priceFrom !== null && !isNaN(priceFrom)) {
        filters.price = { ...(filters.price || {}), $gte: priceFrom };
      }
      if (priceTo !== null && !isNaN(priceTo)) {
        filters.price = { ...(filters.price || {}), $lte: priceTo };
      }
      if (cityFilter && Array.isArray(cityFilter) && cityFilter.length > 0) {
        filters.city = { $in: cityFilter };
      }

      const properties = await s.entityService.findMany('api::property.property', {
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
      const s = strapi as unknown as StrapiInstance;
      const qs = getQueue();
      const corrId = `manual-digest-${Date.now()}`;

      const setting = await s.db.query('api::setting.setting').findOne({});
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

  async queueStats(ctx: any) {
    try {
      const s = strapi as unknown as StrapiInstance;
      const qs = getQueue();
      const detailedStats = qs.getDetailedStats();

      // Also get source stats
      const sources = await s.entityService.findMany('api::source.source', {
        limit: 50,
      });

      ctx.body = {
        ok: true,
        queues: detailedStats.queues || detailedStats,
        sources: (sources || []).map((src: any) => ({
          slug: src.slug,
          is_active: src.is_active,
          last_parse_status: src.last_parse_status,
          last_parsed_at: src.last_parsed_at,
          total_created: src.total_created,
          total_details_fetched: src.total_details_fetched || 0,
          total_details_needed: src.total_details_needed || 0,
          parse_count: src.parse_count,
        })),
      };
    } catch (err: any) {
      strapi.log.error(`[cron] getQueueStats error: ${err.message}`);
      ctx.internalServerError(err.message);
    }
  },

  /**
   * POST /api/cron/score
   * Ручной запуск scoring — оценка всех status='new' по focus rules.
   * Делегирует scoring logic в scorePropertiesBatch (focusEngine).
   */
  async scoreProperties(ctx: any) {
    try {
      const s = strapi as unknown as StrapiInstance;
      const body = ctx.request?.body || {};
      let threshold = body.threshold ? Number(body.threshold) : null;
      const cityFilter: string[] | null = body.city || null;
      const priceFrom = body.priceFrom ? Number(body.priceFrom) : null;
      const priceTo = body.priceTo ? Number(body.priceTo) : null;

      // Если порог не задан — берём из Setting
      if (threshold === null || isNaN(threshold)) {
        const setting = await s.db.query('api::setting.setting').findOne({});
        threshold = setting?.threshold_percent || 20;
      }

      const result = await scorePropertiesBatch({
        city: cityFilter || undefined,
        priceFrom: priceFrom != null && !isNaN(priceFrom) ? priceFrom : undefined,
        priceTo: priceTo != null && !isNaN(priceTo) ? priceTo : undefined,
        threshold: threshold ?? undefined,
      });

      ctx.body = {
        ok: true,
        ...result,
        threshold: threshold ?? undefined,
        filters: { city: cityFilter, priceFrom, priceTo },
      };
    } catch (err: any) {
      strapi.log.error(`[cron] scoreProperties error: ${err.message}`);
      ctx.internalServerError(err.message);
    }
  },
};
