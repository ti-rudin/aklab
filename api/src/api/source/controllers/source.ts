/**
 * source controller — расширенный: core CRUD + healthCheck action.
 */
import { factories } from '@strapi/strapi';

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
