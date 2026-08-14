import { createHash } from 'node:crypto';
import type { StrapiInstance } from '../types/strapi';
import type {
  ParserSourceHealthClassification,
  ParserSourceHealthCounters,
} from './parser-source-health';

interface RecordHealthInput {
  source: any;
  classification: ParserSourceHealthClassification;
  runId: string;
  stage: 'scan' | 'details' | 'canary';
  counters: ParserSourceHealthCounters;
  now?: Date;
}

type AlertOutcome = 'sent' | 'suppressed' | 'not_due' | 'not_configured' | 'send_failed';

function safeRunId(value: string): string {
  return typeof value === 'string' && /^[a-zA-Z0-9._:-]{1,128}$/.test(value) ? value : 'redacted-run';
}

function cooldownHours(): number {
  const parsed = Number(process.env.PARSER_ALERT_COOLDOWN_HOURS ?? 24);
  return Number.isFinite(parsed) && parsed >= 1 && parsed <= 168 ? parsed : 24;
}

function alertKey(sourceSlug: string, event: string, fingerprint: string, reason: string): string {
  return createHash('sha256').update(JSON.stringify([sourceSlug, event, fingerprint, reason])).digest('hex');
}

function safeCounters(counters: ParserSourceHealthCounters) {
  return {
    details_attempted: counters.details_attempted,
    details_ok: counters.details_ok,
    property_block_found: counters.property_block_found,
    location_label_found: counters.location_label_found,
    location_confirmed_address: counters.location_confirmed_address,
    location_confirmed_region_only: counters.location_confirmed_region_only,
    location_missing: counters.location_missing,
    location_unresolved: counters.location_unresolved,
    schema_mismatch: counters.schema_mismatch,
  };
}

/** Persist current source health and emit a deduplicated operational email when due. */
export async function recordParserSourceHealth(
  strapi: StrapiInstance,
  input: RecordHealthInput,
): Promise<{ alert: AlertOutcome; event?: string; applied: boolean; persistedStatus?: ParserSourceHealthClassification['status'] }> {
  const { classification, counters } = input;
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const query = strapi.db.query('api::source.source') as any;
  const freshSource = await query.findOne({
    where: { id: input.source.id },
    select: [
      'id', 'slug', 'parser_health_status', 'parser_health_degraded_streak',
      'last_health_alert_at', 'last_health_alert_key',
    ],
  });
  if (!freshSource) return { alert: 'not_due', applied: false };

  const source = { ...input.source, ...freshSource };
  const rawPreviousStatus = freshSource.parser_health_status;
  const previousStatus: ParserSourceHealthClassification['status'] = rawPreviousStatus === 'healthy'
    || rawPreviousStatus === 'degraded'
    || rawPreviousStatus === 'schema_changed'
    || rawPreviousStatus === 'blocked'
    ? rawPreviousStatus
    : 'blocked';
  const previousHardQuarantine = previousStatus === 'schema_changed' || previousStatus === 'blocked';
  const currentHardQuarantine = classification.status === 'schema_changed' || classification.status === 'blocked';
  const holdHardQuarantine = previousHardQuarantine && !currentHardQuarantine;
  const persistedStatus = holdHardQuarantine ? previousStatus : classification.status;
  const previousStreak = Number.isSafeInteger(source.parser_health_degraded_streak)
    ? Math.max(0, source.parser_health_degraded_streak)
    : 0;
  const degradedStreak = classification.status === 'degraded' ? previousStreak + 1 : 0;
  const hard = classification.status === 'schema_changed'
    || classification.status === 'blocked'
    || classification.reason_code === 'degraded.zero_detail_success';
  const recovery = classification.status === 'healthy'
    && previousStatus !== 'healthy'
    && !holdHardQuarantine
    && Boolean(source.last_health_alert_at);
  const due = hard || recovery || (classification.status === 'degraded' && degradedStreak >= 2);
  const event = recovery ? 'recovered' : classification.status;
  const key = alertKey(source.slug, event, classification.schema_fingerprint, classification.reason_code);
  const lastAlertEpoch = source.last_health_alert_at ? Date.parse(source.last_health_alert_at) : Number.NaN;
  const unchangedWithinCooldown = source.last_health_alert_key === key
    && Number.isFinite(lastAlertEpoch)
    && now.getTime() - lastAlertEpoch < cooldownHours() * 60 * 60 * 1_000;

  const sourceUpdate: Record<string, unknown> = {
    parser_health_status: persistedStatus,
    last_health_checked_at: nowIso,
    last_schema_fingerprint: classification.schema_fingerprint,
    last_health_reason: classification.reason_code,
    parser_health_degraded_streak: degradedStreak,
  };
  const expectedStatus = rawPreviousStatus === null || rawPreviousStatus === undefined
    ? { $null: true }
    : rawPreviousStatus;
  const claimed = await query.update({
    where: { id: source.id, parser_health_status: expectedStatus },
    data: sourceUpdate,
  });
  if (!claimed) return { alert: 'not_due', applied: false };

  let alert: AlertOutcome = 'not_due';
  const alertUpdate: Record<string, unknown> = {};
  if (due && unchangedWithinCooldown) {
    alert = 'suppressed';
  } else if (due) {
    const recipient = process.env.PARSER_ALERT_EMAIL;
    if (!recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
      alert = 'not_configured';
      strapi.log.warn('[parser-health] Operational alert recipient is not configured');
    } else {
      const body = [
        `source=${source.slug}`,
        `event=${event}`,
        `run_id=${safeRunId(input.runId)}`,
        `stage=${input.stage}`,
        `status=${classification.status}`,
        `reason=${classification.reason_code}`,
        `fingerprint=${classification.schema_fingerprint}`,
        `counters=${JSON.stringify(safeCounters(counters))}`,
      ].join('\n');
      try {
        await (strapi as any).plugin('email').service('email').send({
          to: recipient,
          subject: `[AKLAB parser] ${source.slug}: ${event}`,
          text: body,
        });
        alert = 'sent';
        alertUpdate.last_health_alert_at = nowIso;
        alertUpdate.last_health_alert_key = key;
        if (recovery) alertUpdate.last_health_recovered_at = nowIso;
      } catch {
        alert = 'send_failed';
        strapi.log.error('[parser-health] Operational alert delivery failed');
      }
    }
  }

  if (Object.keys(alertUpdate).length > 0) {
    await query.update({
      where: {
        id: source.id,
        parser_health_status: persistedStatus,
        last_health_checked_at: nowIso,
      },
      data: alertUpdate,
    });
  }
  return { alert, ...(due ? { event } : {}), applied: true, persistedStatus };
}
