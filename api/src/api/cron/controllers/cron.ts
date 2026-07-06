/**
 * Cron controller — manual triggers for parse/analyze/digest/score.
 */

import { getQueueService } from '../../../services/queueService';
import { getPipelineService } from '../../../services/pipeline';
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
      const pipeline = getPipelineService(s);

      // Parse optional filters from request body
      const body = ctx.request?.body || {};
      const priceFrom = body.priceFrom ? Number(body.priceFrom) : null;
      const priceTo = body.priceTo ? Number(body.priceTo) : null;
      const cityFilter: string[] | null = body.city || null;
      const threshold = body.threshold ? Number(body.threshold) : null;
      const force = body.force === true;

      // Force mode: сбросить is_undervalued для пересчёта (keep inline for now)
      if (force) {
        const resetWhere: any = { status: 'new' };
        if (priceFrom !== null && !isNaN(priceFrom)) {
          resetWhere.price = { ...(resetWhere.price || {}), $gte: priceFrom };
        }
        if (priceTo !== null && !isNaN(priceTo)) {
          resetWhere.price = { ...(resetWhere.price || {}), $lte: priceTo };
        }
        if (cityFilter && Array.isArray(cityFilter) && cityFilter.length > 0) {
          resetWhere.city = { $in: cityFilter };
        }

        const toReset = await s.db.query('api::property.property').findMany({
          where: resetWhere,
          select: ['documentId'],
        });

        let resetCount = 0;
        for (const prop of toReset || []) {
          await s.db.query('api::property.property').update({
            where: { documentId: prop.documentId },
            data: { is_undervalued: null, deviation: null, price_per_sqm_ref: null },
          });
          resetCount++;
        }
        strapi.log.info(`[cron] Force reset ${resetCount} properties (is_undervalued → null)`);
      }

      // Delegate analysis to PipelineService
      const analyzeResult = await pipeline.analyze({
        city: cityFilter || undefined,
        priceFrom: priceFrom != null && !isNaN(priceFrom) ? priceFrom : undefined,
        priceTo: priceTo != null && !isNaN(priceTo) ? priceTo : undefined,
        threshold: threshold != null && !isNaN(threshold) ? threshold : undefined,
      });

      ctx.body = {
        ok: true,
        message: `Analysis complete: ${analyzeResult.undervalued} undervalued`,
        undervalued: analyzeResult.undervalued,
        errors: analyzeResult.errors,
        filters: { priceFrom, priceTo, city: cityFilter, threshold, force },
      };
    } catch (err: any) {
      strapi.log.error(`[cron] analyzeAll error: ${err.message}`);
      ctx.internalServerError(err.message);
    }
  },

  async sendDigest(ctx: any) {
    try {
      const s = strapi as unknown as StrapiInstance;
      const pipeline = getPipelineService(s);

      // Delegate digest to PipelineService (it checks digest_enabled internally)
      const digestResult = await pipeline.digest();

      ctx.body = {
        ok: digestResult.sent,
        message: digestResult.sent ? 'Digest sent' : 'Дайджест отключён в настройках',
        sent: digestResult.sent,
        errors: digestResult.errors,
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

  /**
   * GET /api/cron/analyze-progress
   * Прогресс анализа — сколько проанализировано / сколько всего.
   */
  async analyzeProgress(ctx: any) {
    try {
      const s = strapi as unknown as StrapiInstance;
      const allNew = await s.db.query('api::property.property').findMany({
        where: { status: 'new' },
        select: ['is_undervalued'],
      });
      const total = allNew.length;
      const analyzed = allNew.filter((p: any) => p.is_undervalued !== null).length;
      const undervalued = allNew.filter((p: any) => p.is_undervalued === true).length;

      ctx.body = {
        ok: true,
        total,
        analyzed,
        remaining: total - analyzed,
        undervalued,
        done: analyzed >= total,
      };
    } catch (err: any) {
      strapi.log.error(`[cron] analyzeProgress error: ${err.message}`);
      ctx.internalServerError(err.message);
    }
  },
};
