/**
 * Pipeline controller — SSE-based run-aware orchestration.
 */

import type { StrapiInstance } from '../../../types/strapi';
import { getPipelineService } from '../../../services/pipeline';
import type { PipelineMode } from '../../../services/pipeline';
import { registerSSEClient } from '../../../services/pipeline-sse';

function getPipeline() {
  return getPipelineService(strapi as unknown as StrapiInstance);
}

const MODES: PipelineMode[] = ['full', 'parse', 'analyze', 'digest'];

export default {
  /** POST /api/pipeline/start — returns the durable run id immediately. */
  async start(ctx: any) {
    try {
      const pipeline = getPipeline();
      const body = ctx.request.body || {};
      const mode = (body.mode || 'full') as PipelineMode;
      const depth = body.depth ?? 20;
      const filters = body.filters;
      if (!MODES.includes(mode)) {
        ctx.status = 400;
        ctx.body = { ok: false, message: `Unknown pipeline mode: ${mode}` };
        return;
      }

      strapi.log.info(`[pipeline] Start requested: mode=${mode}, depth=${depth}, filters=${JSON.stringify(filters)}`);
      const runId = await pipeline.start(mode, depth, filters, 'manual');
      ctx.body = {
        ok: true,
        run_id: runId,
        runId,
        message: `Pipeline started: mode=${mode}, depth=${depth}`,
      };
    } catch (err: any) {
      ctx.body = { ok: false, message: err.message };
      ctx.status = err.message.includes('уже выполняется') || err.message.includes('отменяется') ? 409 : 500;
    }
  },

  /** POST /api/pipeline/cancel */
  async cancel(ctx: any) {
    try {
      const pipeline = getPipeline();
      await pipeline.cancel();
      const state = await pipeline.getState();
      ctx.body = { ok: true, run_id: state.run_id, state, message: 'Pipeline cancellation requested' };
    } catch (err: any) {
      ctx.body = { ok: false, message: err.message };
      ctx.status = 500;
    }
  },

  /** POST /api/pipeline/reset — refuses to reset a lifecycle with live jobs. */
  async reset(ctx: any) {
    try {
      const pipeline = getPipeline();
      await pipeline.forceReset();
      ctx.body = { ok: true, message: 'Pipeline state reset' };
    } catch (err: any) {
      ctx.body = { ok: false, message: err.message };
      ctx.status = err.message.includes('активный') ? 409 : 500;
    }
  },

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

  async stream(ctx: any) {
    const cleanup = registerSSEClient(ctx.res);
    const pingInterval = setInterval(() => {
      try {
        ctx.res.write(`:ping\n\n`);
      } catch {
        clearInterval(pingInterval);
        cleanup();
      }
    }, 30000);

    ctx.res.on('close', () => {
      clearInterval(pingInterval);
      cleanup();
    });
    ctx.respond = false;
  },
};
