/**
 * Cron controller — ручной запуск парсинга, анализа, дайджеста.
 *
 * queueService доступен через require('../../../services/queueService').
 * Путь считается от dist/src/api/cron/controllers/ → dist/src/services/.
 */

function getQueue() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getQueueService } = require('../../../services/queueService');
  return getQueueService();
}

export default {
  async queueStats(ctx: any) {
    try {
      const qs = getQueue();
      const stats = qs.getDetailedStats();

      const sources = await (strapi as any).entityService.findMany('api::source.source', {
        filters: { is_active: true },
        fields: ['slug', 'name', 'last_parse_status', 'last_parsed_at'],
        limit: 100,
      });

      ctx.body = {
        ok: true,
        queues: stats.queues,
        total: stats.total,
        sources: (sources || []).map((s: any) => ({
          slug: s.slug,
          name: s.name,
          last_parse_status: s.last_parse_status,
          last_parsed_at: s.last_parsed_at,
        })),
      };
    } catch (err: any) {
      ctx.internalServerError(err.message);
    }
  },

  async parseSource(ctx: any) {
    const { slug } = ctx.params;

    try {
      const sources = await (strapi as any).entityService.findMany('api::source.source', {
        filters: { slug },
        limit: 1,
      });

      if (!sources?.length) {
        return ctx.notFound(`Source "${slug}" not found`);
      }

      const source = sources[0];

      if (!source.is_active) {
        return ctx.badRequest(`Source "${source.name}" is not active`);
      }

      await (strapi as any).entityService.update('api::source.source', source.id, {
        data: { last_parse_status: 'running', last_parse_error: undefined },
      });

      const qs = getQueue();
      const corrId = `manual-parse-${Date.now()}`;
      const queueName = `parse-${slug}`;
      qs.addToQueue(queueName, {
        source: slug,
        sourceId: source.id,
        documentId: source.documentId,
      }, { correlationId: corrId });

      strapi.log.info(`[cron] Manual parse triggered for ${source.name} (${corrId})`);

      ctx.body = {
        ok: true,
        message: `Parse job enqueued for "${source.name}"`,
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

      const properties = await (strapi as any).entityService.findMany('api::property.property', {
        filters: { status: 'new', is_undervalued: { $null: true } },
        limit: 100,
      });

      for (const prop of properties || []) {
        qs.addToQueue('analyze-property', { documentId: prop.documentId }, { correlationId: corrId });
      }

      ctx.body = {
        ok: true,
        message: `Enqueued ${properties?.length || 0} properties for analysis`,
        correlationId: corrId,
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

      const settings = await (strapi as any).entityService.findMany('api::setting.setting', { limit: 1 });
      const smtpTo = settings?.[0]?.smtp_to || undefined;

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
};
