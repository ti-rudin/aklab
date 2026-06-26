/**
 * Cron controller — manual triggers for parse/analyze/digest/score.
 */

import { getQueueService } from '../../../services/queueService';
import { scoreProperty } from '../../../services/focusEngine';

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

  async queueStats(ctx: any) {
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

  /**
   * POST /api/cron/score
   * Ручной запуск scoring — оценка всех status='new' по focus rules.
   */
  async scoreProperties(ctx: any) {
    try {
      const body = ctx.request?.body || {};
      let threshold = body.threshold ? Number(body.threshold) : null;
      const cityFilter: string[] | null = body.city || null;
      const priceFrom = body.priceFrom ? Number(body.priceFrom) : null;
      const priceTo = body.priceTo ? Number(body.priceTo) : null;

      // Если порог не задан — берём из Setting
      if (threshold === null || isNaN(threshold)) {
        const setting = await (strapi as any).db.query('api::setting.setting').findOne({});
        threshold = setting?.threshold_percent || 20;
      }

      // Загружаем активные правила
      const rules = await (strapi as any).entityService.findMany('api::focus-rule.focus-rule', {
        filters: { is_active: true },
        sort: { priority: 'asc' },
        limit: 100,
      });

      if (!rules || rules.length === 0) {
        ctx.body = { ok: true, scored: 0, in_focus: 0, by_tag: {}, message: 'No active focus rules' };
        return;
      }

      // Строим фильтры для свойств
      const where: any = { status: 'new' };
      if (cityFilter && Array.isArray(cityFilter) && cityFilter.length > 0) {
        where.city = { $in: cityFilter };
      }
      if (priceFrom !== null && !isNaN(priceFrom)) {
        where.price = { ...(where.price || {}), $gte: priceFrom };
      }
      if (priceTo !== null && !isNaN(priceTo)) {
        where.price = { ...(where.price || {}), $lte: priceTo };
      }

      // Пагинация: обрабатываем батчами
      const BATCH = 200;
      let offset = 0;
      let scored = 0;
      let inFocus = 0;
      const byTag: Record<string, number> = {};

      while (true) {
        const properties = await (strapi as any).db.query('api::property.property').findMany({
          where,
          orderBy: { id: 'asc' },
          limit: BATCH,
          offset,
        });

        if (!properties || properties.length === 0) break;

        for (const prop of properties) {
          const result = scoreProperty(prop, rules);

          // Обновляем объект
          await (strapi as any).db.query('api::property.property').update({
            where: { id: prop.id },
            data: {
              focus_score: result.score,
              tags: result.tags,
            },
          });

          // Записываем события
          for (const evt of result.events) {
            await (strapi as any).entityService.create('api::property-event.property-event', {
              data: {
                event_type: evt.event_type,
                old_value: evt.old_value || null,
                new_value: evt.new_value || null,
                property: prop.id,
              },
            });
          }

          scored++;
          if (result.score >= (threshold as number)) {
            inFocus++;
          }
          for (const tag of result.tags) {
            byTag[tag] = (byTag[tag] || 0) + 1;
          }
        }

        if (properties.length < BATCH) break;
        offset += BATCH;
      }

      ctx.body = {
        ok: true,
        scored,
        in_focus: inFocus,
        by_tag: byTag,
        threshold,
        filters: { city: cityFilter, priceFrom, priceTo },
      };
    } catch (err: any) {
      strapi.log.error(`[cron] scoreProperties error: ${err.message}`);
      ctx.internalServerError(err.message);
    }
  },
};
