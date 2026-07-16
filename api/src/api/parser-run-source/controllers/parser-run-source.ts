import { factories } from '@strapi/strapi';

const UID = 'api::parser-run-source.parser-run-source';
const TERMINAL_STATUSES = new Set([
  'success', 'success_empty', 'degraded', 'blocked', 'schema_changed', 'failed', 'cancelled',
]);
const ERROR_CLASSES = new Set(['transient', 'rate_limited', 'blocked', 'schema_changed', 'permanent', 'cancelled']);
const COUNTER_KEYS = [
  'listed', 'eligible', 'existing', 'pre_filtered', 'details_attempted',
  'details_ok', 'created', 'skipped', 'failed',
] as const;

function isCounterSnapshot(value: unknown): value is Record<typeof COUNTER_KEYS[number], number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const counters = value as Record<string, unknown>;
  const keys = Object.keys(counters);
  return keys.length === COUNTER_KEYS.length
    && keys.every(key => COUNTER_KEYS.includes(key as typeof COUNTER_KEYS[number]))
    && COUNTER_KEYS.every(key => Number.isSafeInteger(counters[key]) && (counters[key] as number) >= 0);
}

function terminalPayload(ctx: any): {
  jobId: number;
  status: string;
  counters: Record<typeof COUNTER_KEYS[number], number>;
  errorClass?: string;
  errorMessage?: string;
} | null {
  const data = ctx.request?.body?.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const fields = Object.keys(data);
  const allowed = new Set(['job_id', 'status', 'counters', 'error_class', 'error_message']);
  if (!fields.length || fields.some(field => !allowed.has(field))) return null;
  if (!Number.isSafeInteger(data.job_id) || data.job_id <= 0 || !TERMINAL_STATUSES.has(data.status) || !isCounterSnapshot(data.counters)) return null;
  if (data.error_class != null && (!ERROR_CLASSES.has(data.error_class) || typeof data.error_class !== 'string')) return null;
  if (data.error_message != null && (typeof data.error_message !== 'string' || data.error_message.length > 1_000)) return null;
  return {
    jobId: data.job_id,
    status: data.status,
    counters: data.counters,
    ...(data.error_class ? { errorClass: data.error_class } : {}),
    ...(data.error_message ? { errorMessage: data.error_message } : {}),
  };
}

function sameTerminalSnapshot(existing: any, payload: NonNullable<ReturnType<typeof terminalPayload>>): boolean {
  return existing.status === payload.status
    && COUNTER_KEYS.every(key => existing[key] === payload.counters[key])
    && (existing.error_class ?? undefined) === payload.errorClass
    && (existing.error_message ?? undefined) === payload.errorMessage;
}

export default factories.createCoreController(UID as any, ({ strapi }) => ({
  /** Worker-only queued → running transition, bound to the queue job already persisted by pipeline. */
  async markRunningInternal(ctx) {
    const data = ctx.request?.body?.data;
    const jobId = data?.job_id;
    if (!data || typeof data !== 'object' || Array.isArray(data) || !Number.isSafeInteger(jobId) || jobId <= 0 || Object.keys(data).some(key => key !== 'job_id')) {
      ctx.status = 400;
      ctx.body = { error: 'Invalid parser-run-source running payload' };
      return;
    }
    const existing = await strapi.db.query(UID).findOne({ where: { identity_key: ctx.params.identityKey } });
    if (!existing) {
      ctx.status = 404;
      ctx.body = { error: 'Parser run source not found' };
      return;
    }
    if (existing.job_id !== jobId) {
      ctx.status = 409;
      ctx.body = { error: 'Queue job does not own parser run source' };
      return;
    }
    if (TERMINAL_STATUSES.has(existing.status) || existing.status === 'running') {
      ctx.body = { data: existing, meta: { idempotent: true } };
      return;
    }
    const updated = await strapi.db.query(UID).update({
      where: { id: existing.id },
      data: { status: 'running', started_at: new Date().toISOString() },
    });
    ctx.body = { data: updated };
  },

  /** Worker-only terminal state transition, bound to the immutable identity path. */
  async finishInternal(ctx) {
    const payload = terminalPayload(ctx);
    if (!payload) {
      ctx.status = 400;
      ctx.body = { error: 'Invalid parser-run-source terminal payload' };
      return;
    }

    const existing = await strapi.db.query(UID).findOne({ where: { identity_key: ctx.params.identityKey } });
    if (!existing) {
      ctx.status = 404;
      ctx.body = { error: 'Parser run source not found' };
      return;
    }
    if (existing.job_id !== payload.jobId) {
      ctx.status = 409;
      ctx.body = { error: 'Queue job does not own parser run source' };
      return;
    }
    if (TERMINAL_STATUSES.has(existing.status)) {
      if (sameTerminalSnapshot(existing, payload)) {
        ctx.body = { data: existing, meta: { idempotent: true } };
        return;
      }
      ctx.status = 409;
      ctx.body = { error: 'Parser run source is already terminal' };
      return;
    }

    const updated = await strapi.db.query(UID).update({
      where: { id: existing.id },
      data: {
        status: payload.status,
        ...payload.counters,
        finished_at: new Date().toISOString(),
        ...(payload.errorClass ? { error_class: payload.errorClass } : {}),
        ...(payload.errorMessage ? { error_message: payload.errorMessage } : {}),
      },
    });
    ctx.body = { data: updated };
  },
}));
