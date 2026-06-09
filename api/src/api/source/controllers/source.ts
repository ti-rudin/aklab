/**
 * source controller — расширенный: core CRUD + healthCheck action.
 */
import { factories } from '@strapi/strapi';

export default factories.createCoreController('api::source.source', ({ strapi }) => ({
  async healthCheck(ctx) {
    const { id } = ctx.params;

    try {
      const source = await strapi.entityService.findOne('api::source.source', id);
      if (!source) return ctx.notFound('Source not found');
      if (!(source as any).health_port) {
        return ctx.badRequest('No health_port configured');
      }

      const port = (source as any).health_port;
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
