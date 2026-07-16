/**
 * source controller — расширенный: core CRUD + healthCheck action.
 */
import { factories } from '@strapi/strapi';

const INTERNAL_SOURCE_STATS_FIELDS = new Set([
  'last_parse_status',
  'last_parse_error',
  'last_parsed_at',
  'total_found',
  'total_created',
  'total_details_fetched',
  'total_details_needed',
  'parse_count',
]);

function internalPayload(ctx: any): Record<string, unknown> | null {
  const data = ctx.request?.body?.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return null;
  }

  const fields = Object.keys(data);
  if (fields.length === 0 || fields.some((field) => !INTERNAL_SOURCE_STATS_FIELDS.has(field))) {
    return null;
  }

  return data as Record<string, unknown>;
}

// Health checks are intentionally limited to the parser ports from
// services/services.json (plus the currently disabled fedresurs worker). A
// mutable Source record must not turn this loopback proxy into a local port
// scanner.
const HEALTH_PORT_BY_PARSER: Record<string, number> = {
  fabrikant: 1345,
  'torgi-gov': 1346,
  'aggregator-bankrot': 1348,
  alfalot: 1349,
  etprf: 1350,
  'sberbank-ast': 1351,
  'invest-mosreg': 1352,
  investmoscow: 1353,
  roseltorg: 1354,
  'm-ets': 1355,
  fedresurs: 1357,
};

export default factories.createCoreController('api::source.source', ({ strapi }) => ({
  /** Service-only parser statistics update with a strict field mask. */
  async internalUpdateStats(ctx) {
    const data = internalPayload(ctx);
    if (!data) {
      ctx.status = 400;
      ctx.body = { error: 'Invalid internal source stats payload' };
      return;
    }

    const updated = await strapi.db.query('api::source.source').update({
      where: { documentId: ctx.params.id },
      data,
    });
    if (!updated) {
      ctx.status = 404;
      ctx.body = { error: 'Source not found' };
      return;
    }

    ctx.body = { data: updated };
  },

  async healthCheck(ctx) {
    const { id } = ctx.params;

    try {
      const source = await strapi.db.query('api::source.source').findOne({ where: { documentId: id } });
      if (!source) return ctx.notFound('Source not found');
      if (!(source as any).health_port) {
        return ctx.badRequest('No health_port configured');
      }

      const port = (source as any).health_port;
      const parser = (source as any).parser;
      if (HEALTH_PORT_BY_PARSER[parser] !== port) {
        return ctx.badRequest('Unexpected health_port configured for source parser');
      }
      try {
        const res = await fetch(`http://127.0.0.1:${port}/health`, {
          signal: AbortSignal.timeout(3000),
        });
        const data = await res.json();
        ctx.body = { data };
      } catch (fetchErr: any) {
        ctx.body = { data: { status: 'offline', error: fetchErr.message } };
      }
    } catch (err: any) {
      ctx.internalServerError(err.message);
    }
  },
}));
