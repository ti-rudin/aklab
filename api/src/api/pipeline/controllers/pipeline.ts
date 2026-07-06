/**
 * Pipeline controller — SSE-based pipeline orchestration.
 */

import type { StrapiInstance } from '../../../types/strapi';
import { getPipelineService } from '../../../services/pipeline';
import { registerSSEClient } from '../../../services/pipeline-sse';

function getPipeline() {
  return getPipelineService(strapi as unknown as StrapiInstance);
}

export default {
  /**
   * POST /api/pipeline/start
   * Body: { mode: "full"|"parse"|"analyze"|"digest", depth?, filters? }
   */
  async start(ctx: any) {
    try {
      const pipeline = getPipeline();
      const body = ctx.request.body || {};
      const mode = body.mode || 'full';
      const depth = body.depth ?? 20;
      const filters = body.filters;

      strapi.log.info(`[pipeline] Start requested: mode=${mode}, depth=${depth}`);

      // Fire and forget — pipeline runs in background
      const run = async () => {
        try {
          if (mode === 'full') {
            await pipeline.run(depth, filters, 'manual');
          } else if (mode === 'parse') {
            await pipeline.updateState({ status: 'running', stage: 'parsing_scan', trigger: 'manual' });
            await pipeline.parseAll(depth);
            await pipeline.updateState({ status: 'idle', stage: 'done' });
          } else if (mode === 'analyze') {
            await pipeline.updateState({ status: 'running', stage: 'analyzing', trigger: 'manual' });
            await pipeline.analyze(filters);
            await pipeline.updateState({ status: 'idle', stage: 'done' });
          } else if (mode === 'digest') {
            await pipeline.updateState({ status: 'running', stage: 'digesting', trigger: 'manual' });
            await pipeline.digest();
            await pipeline.updateState({ status: 'idle', stage: 'done' });
          }
          strapi.log.info(`[pipeline] Completed: mode=${mode}`);
        } catch (err: any) {
          strapi.log.error(`[pipeline] Error in mode=${mode}: ${err.message}`);
          await pipeline.updateState({
            status: 'idle',
            stage: 'error',
            errors: [err.message],
          }, `Ошибка: ${err.message}`);
        }
      };

      // Don't await — run in background
      run().catch(() => {});

      ctx.body = {
        ok: true,
        message: `Pipeline started: mode=${mode}, depth=${depth}`,
      };
    } catch (err: any) {
      ctx.body = { ok: false, message: err.message };
      ctx.status = err.message.includes('уже выполняется') ? 409 : 500;
    }
  },

  /**
   * POST /api/pipeline/cancel
   */
  async cancel(ctx: any) {
    try {
      const pipeline = getPipeline();
      await pipeline.cancel();
      ctx.body = { ok: true, message: 'Pipeline cancel requested' };
    } catch (err: any) {
      ctx.body = { ok: false, message: err.message };
      ctx.status = 500;
    }
  },

  /**
   * POST /api/pipeline/reset
   * Hard reset for stuck pipeline states.
   */
  async reset(ctx: any) {
    try {
      const pipeline = getPipeline();
      await pipeline.forceReset();
      ctx.body = { ok: true, message: 'Pipeline state reset' };
    } catch (err: any) {
      ctx.body = { ok: false, message: err.message };
      ctx.status = 500;
    }
  },

  /**
   * GET /api/pipeline/status
   * Returns current pipeline state (for reconnect/page load).
   */
  async status(ctx: any) {
    try {
      const pipeline = getPipeline();
      const state = await pipeline.getState();
      ctx.body = { ok: true, state };
    } catch (err: any) {
      ctx.body = { ok: false, message: err.message };
      ctx.status = 500;
    }
  },

  /**
   * GET /api/pipeline/stream
   * SSE endpoint — stays open, pushes progress events.
   */
  async stream(ctx: any) {
    const cleanup = registerSSEClient(ctx.res);

    // Keep connection alive with periodic pings
    const pingInterval = setInterval(() => {
      try {
        ctx.res.write(`:ping\n\n`);
      } catch {
        clearInterval(pingInterval);
        cleanup();
      }
    }, 30000);

    // Clean up on client disconnect
    ctx.res.on('close', () => {
      clearInterval(pingInterval);
      cleanup();
    });

    // Don't let Koa close the response
    ctx.respond = false;
  },
};
