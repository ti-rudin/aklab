/** Pipeline controller — run-aware orchestration with status polling. */

import type { StrapiInstance } from '../../../types/strapi';
import { getPipelineService } from '../../../services/pipeline';
import type { PipelineMode } from '../../../services/pipeline';
import { sanitizePipelineState, validateDepth } from '../../../services/pipeline/state';

function getPipeline() {
  return getPipelineService(strapi as unknown as StrapiInstance);
}

const MODES: PipelineMode[] = ['full', 'parse', 'analyze', 'digest'];
const START_KEYS = new Set(['mode', 'depth', 'targetUserId']);

class PipelineRequestError extends Error {
  readonly code = 'PIPELINE_INPUT_INVALID';

  constructor(message = 'Invalid pipeline start request.') {
    super(message);
    this.name = 'PipelineRequestError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseStartBody(input: unknown): { mode: PipelineMode; depth?: number; targetUserId: number } {
  if (!isRecord(input)) throw new PipelineRequestError();
  for (const key of Object.keys(input)) {
    if (!START_KEYS.has(key)) throw new PipelineRequestError();
  }
  if (typeof input.targetUserId !== 'number' || !Number.isSafeInteger(input.targetUserId) || input.targetUserId <= 0) {
    throw new PipelineRequestError();
  }
  const mode = input.mode === undefined ? 'full' : input.mode;
  if (typeof mode !== 'string' || !MODES.includes(mode as PipelineMode)) throw new PipelineRequestError();
  if (input.depth !== undefined) validateDepth(input.depth);
  return {
    mode: mode as PipelineMode,
    ...(input.depth === undefined ? {} : { depth: input.depth as number }),
    targetUserId: input.targetUserId,
  };
}

function safeError(err: unknown): { status: number; code: string; message: string } {
  const rawCode = typeof (err as any)?.code === 'string' ? (err as any).code : '';
  const knownCodes = new Set([
    'PIPELINE_INPUT_INVALID', 'USER_PROFILE_VALIDATION_ERROR', 'USER_PROFILE_NOT_FOUND',
    'USER_PROFILE_UNAVAILABLE', 'USER_PROFILE_MALFORMED', 'USER_PROFILE_SNAPSHOT_ERROR',
    'PIPELINE_BUSY', 'PIPELINE_TARGET_NOT_FOUND',
    'PARSER_RUN_SNAPSHOT_CONFLICT', 'PIPELINE_CONFIGURATION_INVALID',
  ]);
  const code = knownCodes.has(rawCode) ? rawCode : 'PIPELINE_ERROR';
  if (code === 'PIPELINE_INPUT_INVALID') return { status: 400, code, message: 'Некорректные параметры запуска pipeline.' };
  if (code === 'USER_PROFILE_VALIDATION_ERROR') return { status: 400, code, message: 'Некорректный целевой пользователь.' };
  if (code === 'USER_PROFILE_NOT_FOUND') return { status: 404, code, message: 'Целевой пользователь не найден.' };
  if (code === 'USER_PROFILE_UNAVAILABLE') return { status: 409, code, message: 'Профиль пользователя недоступен для запуска.' };
  if (code === 'USER_PROFILE_MALFORMED') return { status: 409, code, message: 'Сохранённый профиль пользователя некорректен.' };
  if (code === 'USER_PROFILE_SNAPSHOT_ERROR') return { status: 500, code, message: 'Не удалось построить профильный snapshot.' };
  if (code === 'PARSER_RUN_SNAPSHOT_CONFLICT') return { status: 409, code, message: 'Конфликт immutable snapshot запуска.' };
  if (code === 'PIPELINE_BUSY') return { status: 409, code, message: 'Pipeline уже выполняется или отменяется.' };
  if (code === 'PIPELINE_TARGET_NOT_FOUND') return { status: 404, code, message: 'Целевой пользователь не найден.' };
  return { status: 500, code, message: 'Не удалось запустить pipeline.' };
}

export default {
  /** POST /api/pipeline/start — returns the durable run id after snapshot preflight. */
  async start(ctx: any) {
    try {
      const { mode, depth, targetUserId } = parseStartBody(ctx.request?.body);
      const pipeline = getPipeline();
      strapi.log.info(`[pipeline] Start requested: mode=${mode}, depth=${depth ?? 'setting'}, target=provided`);
      const runId = await pipeline.start(mode, depth, targetUserId, 'manual');
      ctx.body = {
        ok: true,
        run_id: runId,
        runId,
        message: `Pipeline started: mode=${mode}, depth=${depth ?? 'setting'}`,
      };
    } catch (err: any) {
      const failure = safeError(err);
      ctx.body = { ok: false, code: failure.code, message: failure.message };
      ctx.status = failure.status;
    }
  },

  /** POST /api/pipeline/cancel */
  async cancel(ctx: any) {
    try {
      const pipeline = getPipeline();
      await pipeline.cancel();
      const state = await pipeline.getState();
      ctx.body = { ok: true, run_id: state.run_id, state: sanitizePipelineState(state), message: 'Pipeline cancellation requested' };
    } catch (err: any) {
      ctx.body = { ok: false, code: 'PIPELINE_ERROR', message: 'Не удалось отменить pipeline.' };
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
      ctx.body = { ok: false, code: 'PIPELINE_ERROR', message: 'Не удалось сбросить состояние pipeline.' };
      ctx.status = 500;
    }
  },

  async status(ctx: any) {
    try {
      const pipeline = getPipeline();
      const state = await pipeline.getState();
      ctx.body = { ok: true, state: sanitizePipelineState(state) };
    } catch (err: any) {
      ctx.body = { ok: false, code: 'PIPELINE_ERROR', message: 'Не удалось получить состояние pipeline.' };
      ctx.status = 500;
    }
  },
};
