/**
 * Cron controller — manual triggers for parse/analyze/digest/score.
 */

import { getQueueService } from '../../../services/queueService';
import { getPipelineService } from '../../../services/pipeline';
import { scorePropertiesBatch } from '../../../services/focusEngine';
import type { StrapiInstance } from '../../../types/strapi';
import { randomUUID } from 'node:crypto';

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

      // A legacy single-source parse is not a pipeline subrun. It must not start
      // while the persisted pipeline lifecycle owns parsing/analyze/digest work.
      const pipeline = getPipelineService(s);
      const pipelineState = await pipeline.getState();
      if (pipelineState?.status !== 'idle') {
        ctx.status = 409;
        ctx.body = {
          ok: false,
          message: 'Нельзя запустить парсинг источника: pipeline уже выполняется или отменяется',
        };
        return;
      }

      // Without `phase`, the legacy parse handler performs scan and details in one
      // job. Keep this key stable so concurrent manual requests reuse that live job.
      const phase = 'full';
      const corrId = `manual-parse-${Date.now()}-${randomUUID()}`;
      const job = qs.addToQueue(`parse-${slug}`, {
        source: slug,
        sourceId: source.id,
        documentId: source.documentId,
        depth,
      }, {
        correlationId: corrId,
        idempotencyKey: `manual:${slug}:${phase}`,
      });
      const reused = Boolean(job.correlation_id && job.correlation_id !== corrId);

      ctx.body = {
        ok: true,
        message: `Parse job enqueued for ${slug}`,
        correlationId: corrId,
        job_id: job.id,
        jobId: job.id,
        reused,
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

      const filters = {
        city: cityFilter || undefined,
        priceFrom: priceFrom != null && !isNaN(priceFrom) ? priceFrom : undefined,
        priceTo: priceTo != null && !isNaN(priceTo) ? priceTo : undefined,
        threshold: threshold != null && !isNaN(threshold) ? threshold : undefined,
        force,
      };
      const depth = 20;
      const runId = await pipeline.start('analyze', depth, filters, 'manual');

      ctx.body = {
        ok: true,
        run_id: runId,
        runId,
        message: `Pipeline started: mode=analyze, depth=${depth}`,
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

      const depth = 20;
      const runId = await pipeline.start('digest', depth, undefined, 'manual');

      ctx.body = {
        ok: true,
        run_id: runId,
        runId,
        message: `Pipeline started: mode=digest, depth=${depth}`,
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
      const pipeline = getPipelineService(s);
      const pipelineState = await pipeline.getState();
      if (pipelineState?.status !== 'idle') {
        ctx.status = 409;
        ctx.body = { ok: false, message: 'Нельзя пересчитать score: pipeline уже выполняется или отменяется' };
        return;
      }
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
