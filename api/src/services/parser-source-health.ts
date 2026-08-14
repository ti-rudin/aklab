import { createHash } from 'node:crypto';
import type { StrapiInstance } from '../types/strapi';
import { recordParserSourceHealth } from './parser-health-alerts';

export type ParserSourceHealthStatus = 'healthy' | 'degraded' | 'schema_changed' | 'blocked';

export type ParserSourceHealthErrorClass =
  | 'transient'
  | 'rate_limited'
  | 'blocked'
  | 'anti_bot'
  | 'http_block'
  | 'schema_changed'
  | 'permanent'
  | 'cancelled';

export type ParserSourceHealthCounters = {
  details_attempted: number;
  details_ok: number;
  property_block_found: number;
  location_label_found: number;
  location_confirmed_address: number;
  location_confirmed_region_only: number;
  location_missing: number;
  location_unresolved: number;
  schema_mismatch: number;
};

export type ParserSourceHealthBaselineSample = {
  counters: ParserSourceHealthCounters;
  schema_fingerprint?: string;
};

export type ParserSourceHealthCanary = {
  checked: number;
  property_block_found: number;
  expected_property_block?: boolean;
};

export type ParserSourceHealthInput = {
  counters: ParserSourceHealthCounters;
  detail_supported: boolean;
  schema_fingerprint: string;
  healthy_baseline?: readonly ParserSourceHealthBaselineSample[];
  canary?: ParserSourceHealthCanary;
  error_class?: ParserSourceHealthErrorClass | null;
};

export type ParserSourceHealthReasonCode =
  | 'healthy.within_baseline'
  | 'healthy.listing_only'
  | 'schema_changed.canary_property_block_missing'
  | 'schema_changed.schema_mismatch_majority'
  | 'schema_changed.property_block_missing'
  | 'schema_changed.location_label_missing'
  | 'schema_changed.typed_error'
  | 'blocked.typed_error'
  | 'degraded.zero_detail_success'
  | 'degraded.diagnostics_missing'
  | 'degraded.canary_location_missing'
  | 'degraded.confirmed_count_zero'
  | 'degraded.details_ok_ratio_drop'
  | 'degraded.location_failure_ratio_growth';

export type ParserSourceHealthClassification = {
  status: ParserSourceHealthStatus;
  reason_code: ParserSourceHealthReasonCode;
  schema_fingerprint: string;
};

const COUNTER_FIELDS: readonly (keyof ParserSourceHealthCounters)[] = [
  'details_attempted',
  'details_ok',
  'property_block_found',
  'location_label_found',
  'location_confirmed_address',
  'location_confirmed_region_only',
  'location_missing',
  'location_unresolved',
  'schema_mismatch',
];

const ERROR_CLASSES = new Set<ParserSourceHealthErrorClass>([
  'transient',
  'rate_limited',
  'blocked',
  'anti_bot',
  'http_block',
  'schema_changed',
  'permanent',
  'cancelled',
]);

const BLOCKING_ERROR_CLASSES = new Set<ParserSourceHealthErrorClass>([
  'rate_limited',
  'blocked',
  'anti_bot',
  'http_block',
]);

const MIN_RATIO_SAMPLE = 20;
const RATIO_DELTA = 0.2;

function assertSafeText(value: unknown, field: string): asserts value is string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.trim() !== value
    || /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new TypeError(`Invalid ${field}.`);
  }
}

function assertCounter(value: unknown, field: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`Invalid ${field}.`);
  }
}

function assertFingerprint(value: unknown, field: string): asserts value is string {
  assertSafeText(value, field);
  if (!/^[a-f0-9]{64}$/.test(value)) throw new TypeError(`Invalid ${field}.`);
}

function assertCounters(counters: ParserSourceHealthCounters, field = 'counters', detailSupported = true): void {
  if (!counters || typeof counters !== 'object') throw new TypeError(`Invalid ${field}.`);

  for (const name of COUNTER_FIELDS) assertCounter(counters[name], `${field}.${name}`);

  if (!detailSupported) {
    const detailOnly = [
      counters.details_attempted,
      counters.details_ok,
      counters.property_block_found,
      counters.location_label_found,
      counters.location_confirmed_address,
      counters.location_confirmed_region_only,
      counters.location_missing,
      counters.schema_mismatch,
    ];
    if (detailOnly.some(value => value !== 0)) throw new TypeError(`Invalid ${field}.`);
    return;
  }

  if (counters.details_ok > counters.details_attempted) {
    throw new TypeError(`Invalid ${field}.`);
  }

  const boundedByDetails = [
    counters.property_block_found,
    counters.location_label_found,
    counters.schema_mismatch,
  ];
  if (boundedByDetails.some(value => value > counters.details_ok)) {
    throw new TypeError(`Invalid ${field}.`);
  }

  const classifiedLocations = counters.location_confirmed_address
    + counters.location_confirmed_region_only
    + counters.location_missing;
  if (
    !Number.isSafeInteger(classifiedLocations)
    || classifiedLocations > counters.details_ok
    || counters.location_unresolved > counters.location_missing
  ) {
    throw new TypeError(`Invalid ${field}.`);
  }
}

function assertCanary(canary: ParserSourceHealthCanary | undefined): void {
  if (canary == null) return;
  if (!canary || typeof canary !== 'object') {
    throw new TypeError('Invalid canary.');
  }
  if (
    canary.expected_property_block !== undefined
    && typeof canary.expected_property_block !== 'boolean'
  ) {
    throw new TypeError('Invalid canary.');
  }
  assertCounter(canary.checked, 'canary.checked');
  assertCounter(canary.property_block_found, 'canary.property_block_found');
  if (canary.property_block_found > canary.checked) throw new TypeError('Invalid canary.');
}

function validateInput(input: ParserSourceHealthInput): void {
  if (!input || typeof input !== 'object') throw new TypeError('Invalid source health input.');
  if (typeof input.detail_supported !== 'boolean') throw new TypeError('Invalid detail_supported.');
  assertCounters(input.counters, 'counters', input.detail_supported);
  assertFingerprint(input.schema_fingerprint, 'schema_fingerprint');
  assertCanary(input.canary);

  if (input.error_class != null && !ERROR_CLASSES.has(input.error_class)) {
    throw new TypeError('Invalid error_class.');
  }

  if (input.healthy_baseline !== undefined) {
    if (!Array.isArray(input.healthy_baseline) || input.healthy_baseline.length > 5) {
      throw new TypeError('Invalid healthy_baseline.');
    }
    for (const [index, sample] of input.healthy_baseline.entries()) {
      if (!sample || typeof sample !== 'object') throw new TypeError(`Invalid healthy_baseline[${index}].`);
      assertCounters(sample.counters, `healthy_baseline[${index}].counters`);
      if (sample.schema_fingerprint !== undefined) {
        assertFingerprint(sample.schema_fingerprint, `healthy_baseline[${index}].schema_fingerprint`);
      }
    }
  }
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? (ordered[middle - 1] + ordered[middle]) / 2
    : ordered[middle];
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function ratioDrop(current: number, baseline: number): boolean {
  return baseline - current >= RATIO_DELTA;
}

function ratioGrowth(current: number, baseline: number): boolean {
  return current - baseline >= RATIO_DELTA;
}

/**
 * Pure, deterministic source-health policy. It only classifies the supplied
 * snapshot; persistence, alerts, IO and pipeline orchestration stay outside.
 */
export function classifyParserSourceHealth(
  input: ParserSourceHealthInput,
): ParserSourceHealthClassification {
  validateInput(input);

  const { counters, canary, error_class: errorClass } = input;
  const result = (
    status: ParserSourceHealthStatus,
    reason_code: ParserSourceHealthReasonCode,
  ): ParserSourceHealthClassification => ({
    status,
    reason_code,
    schema_fingerprint: input.schema_fingerprint,
  });

  if (errorClass != null && BLOCKING_ERROR_CLASSES.has(errorClass)) {
    return result('blocked', 'blocked.typed_error');
  }

  if (errorClass === 'schema_changed') {
    return result('schema_changed', 'schema_changed.typed_error');
  }

  if (!input.detail_supported) {
    return result('healthy', 'healthy.listing_only');
  }

  if (
    canary != null
    && (canary.expected_property_block ?? true)
    && canary.checked > 0
    && canary.property_block_found === 0
  ) {
    return result('schema_changed', 'schema_changed.canary_property_block_missing');
  }

  if (
    counters.details_ok > 0
    && counters.schema_mismatch > counters.details_ok / 2
  ) {
    return result('schema_changed', 'schema_changed.schema_mismatch_majority');
  }

  if (counters.details_ok > 0 && counters.property_block_found === 0) {
    return result('schema_changed', 'schema_changed.property_block_missing');
  }

  if (counters.details_ok > 0 && counters.location_label_found === 0) {
    return result('schema_changed', 'schema_changed.location_label_missing');
  }

  if (counters.details_attempted > 0 && counters.details_ok === 0) {
    return result('degraded', 'degraded.zero_detail_success');
  }

  const healthyBaseline = input.healthy_baseline ?? [];
  const confirmedCount = counters.location_confirmed_address + counters.location_confirmed_region_only;
  const historicalConfirmed = healthyBaseline.some(sample => (
    sample.counters.location_confirmed_address + sample.counters.location_confirmed_region_only > 0
  ));

  if (confirmedCount === 0 && historicalConfirmed) {
    return result('degraded', 'degraded.confirmed_count_zero');
  }

  if (counters.details_attempted >= MIN_RATIO_SAMPLE && healthyBaseline.length > 0) {
    const detailSuccessBaseline = median(healthyBaseline.map(sample => (
      ratio(sample.counters.details_ok, sample.counters.details_attempted)
    )));
    const detailSuccess = ratio(counters.details_ok, counters.details_attempted);
    if (ratioDrop(detailSuccess, detailSuccessBaseline)) {
      return result('degraded', 'degraded.details_ok_ratio_drop');
    }

    const locationFailureBaseline = median(healthyBaseline.map(sample => (
      ratio(
        sample.counters.location_missing,
        sample.counters.details_attempted,
      )
    )));
    const locationFailure = ratio(
      counters.location_missing,
      counters.details_attempted,
    );
    if (ratioGrowth(locationFailure, locationFailureBaseline)) {
      return result('degraded', 'degraded.location_failure_ratio_growth');
    }
  }

  return result('healthy', 'healthy.within_baseline');
}

function countersFromRow(row: any): ParserSourceHealthCounters {
  return {
    details_attempted: Number(row?.details_attempted) || 0,
    details_ok: Number(row?.details_ok) || 0,
    property_block_found: Number(row?.property_block_found) || 0,
    location_label_found: Number(row?.location_label_found) || 0,
    location_confirmed_address: Number(row?.location_confirmed_address) || 0,
    location_confirmed_region_only: Number(row?.location_confirmed_region_only) || 0,
    location_missing: Number(row?.location_missing) || 0,
    location_unresolved: Number(row?.location_unresolved) || 0,
    schema_mismatch: Number(row?.schema_mismatch) || 0,
  };
}

/** Classify one immutable current-run details row and persist only Source summary/alerts. */
export async function recordParserRunSourceHealth(strapi: StrapiInstance, input: {
  runId: string;
  source: any;
}): Promise<ParserSourceHealthClassification> {
  const identityKey = `${input.runId}:${input.source.slug}:details`;
  const query = strapi.db.query('api::parser-run-source.parser-run-source');
  const current = await query.findOne({ where: { identity_key: identityKey } });
  if (!current) throw new Error('Current parser source telemetry is missing.');
  const counters = countersFromRow(current);
  const fingerprint = typeof current.semantic_fingerprint === 'string' && /^[a-f0-9]{64}$/.test(current.semantic_fingerprint)
    ? current.semantic_fingerprint
    : createHash('sha256').update(JSON.stringify(['diagnostics_missing', input.source.slug])).digest('hex');
  const detailSupported = current.detail_supported === true;
  const baselineRows = detailSupported ? await query.findMany({
    where: {
      source_slug: input.source.slug,
      stage: 'details',
      status: 'success',
      health_status: 'healthy',
      detail_supported: true,
      identity_key: { $ne: identityKey },
    },
    orderBy: { finished_at: 'desc' },
    limit: 5,
  }) : [];
  const healthy_baseline = (baselineRows ?? []).map((row: any) => ({
    counters: countersFromRow(row),
    ...(typeof row.semantic_fingerprint === 'string' && /^[a-f0-9]{64}$/.test(row.semantic_fingerprint)
      ? { schema_fingerprint: row.semantic_fingerprint }
      : {}),
  }));
  const classification: ParserSourceHealthClassification = !detailSupported
    ? classifyParserSourceHealth({
        counters,
        detail_supported: false,
        schema_fingerprint: fingerprint,
        error_class: current.error_class ?? null,
      })
    : current.semantic_fingerprint
    ? classifyParserSourceHealth({
        counters,
        detail_supported: true,
        schema_fingerprint: fingerprint,
        healthy_baseline,
        error_class: current.error_class ?? null,
      })
    : {
        status: 'degraded',
        reason_code: 'degraded.diagnostics_missing',
        schema_fingerprint: fingerprint,
      };
  const healthWrite = await recordParserSourceHealth(strapi, {
    source: input.source,
    classification,
    runId: input.runId,
    stage: 'details',
    counters,
  });
  if (healthWrite.applied && healthWrite.persistedStatus) {
    await query.update({
      where: { identity_key: identityKey, health_status: { $null: true } },
      data: { health_status: healthWrite.persistedStatus },
    });
  }
  return classification;
}
