import { createHash } from 'crypto';
import { PermanentError } from '@aklab/sqlite-queue';
import type { Job, WorkerContext } from '@aklab/sqlite-queue';
import type { ParserDetailResult, PropertyLocation, SourceParser } from './types';
import { aggregateSemanticFingerprints, isParserExtractionDiagnostics } from './parser-diagnostics';
import { classifyParserError } from './parser-error';
import { mergePropertyLocation, normalizeStructuredLocation } from './property-location';

export type ParserProbeStatus = 'healthy' | 'degraded' | 'schema_changed' | 'blocked';

export interface ParserProbeResult {
  source: string;
  checked: number;
  listing_ok: boolean;
  detail_supported: boolean;
  detail_ok: boolean;
  property_block_found: number;
  location_label_found: number;
  confirmed_address: number;
  confirmed_region_only: number;
  missing: number;
  semantic_fingerprint: string;
  status: ParserProbeStatus;
  reason?: 'no_samples' | 'detail_failed' | 'diagnostics_missing' | 'location_missing' | 'property_block_missing' | 'source_blocked';
}

interface ProbeRequest {
  operation: 'probe';
  origin: 'canary';
  runId: string;
  stage: 'probe';
  source: string;
  maxItems: number;
  timeoutMs: number;
}

type ParseHandler = (job: Job, workerContext?: WorkerContext) => Promise<any>;

function probeRequest(value: unknown, parserName: string): ProbeRequest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const req = value as Record<string, unknown>;
  const expectedKeys = ['operation', 'origin', 'runId', 'stage', 'source', 'maxItems', 'timeoutMs'];
  const actualKeys = Object.keys(req).sort();
  if (actualKeys.length !== expectedKeys.length
    || actualKeys.some((key, index) => key !== expectedKeys.slice().sort()[index])) return null;
  if (req.operation !== 'probe' || req.origin !== 'canary' || req.stage !== 'probe'
    || typeof req.runId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(req.runId)
    || req.source !== parserName || typeof req.source !== 'string'
    || !/^[a-z0-9][a-z0-9-]{0,49}$/.test(req.source)
    || !Number.isSafeInteger(req.maxItems) || (req.maxItems as number) < 1 || (req.maxItems as number) > 3
    || !Number.isSafeInteger(req.timeoutMs) || (req.timeoutMs as number) < 1_000 || (req.timeoutMs as number) > 120_000) {
    return null;
  }
  return req as unknown as ProbeRequest;
}

function throwIfCancelled(workerContext?: WorkerContext): void {
  if (workerContext?.isCancellationRequested() || workerContext?.isLeaseValid?.() === false) {
    throw new PermanentError('Parser probe cancelled or lease lost');
  }
}

async function withCooperativeDeadline<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  try {
    timer = setTimeout(() => { timedOut = true; }, timeoutMs);
    const result = await operation;
    if (timedOut) throw new PermanentError('Parser probe timeout');
    return result;
  } catch (error) {
    if (timedOut) throw new PermanentError('Parser probe timeout');
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Queue dispatcher with a side-effect-free probe branch and unchanged normal parse branch. */
export function createParserQueueHandler(parser: SourceParser, parseHandler: ParseHandler) {
  return async function handleParserQueueJob(job: Job, workerContext?: WorkerContext): Promise<any> {
    const operation = (job.data as any)?.operation;
    if (operation !== 'probe') return parseHandler(job, workerContext);

    const req = probeRequest(job.data, parser.name);
    if (!req) throw new PermanentError('Invalid parser probe request');
    throwIfCancelled(workerContext);

    return withCooperativeDeadline((async (): Promise<ParserProbeResult> => {
      const listed = await parser.parse(req.maxItems);
      throwIfCancelled(workerContext);
      const candidates = listed.slice(0, req.maxItems);
      const detailSupported = typeof parser.fetchDetails === 'function';
      const fingerprints = new Set<string>();
      let detailFailures = 0;
      let diagnosticsSeen = 0;
      let propertyBlockFound = 0;
      let locationLabelFound = 0;
      let confirmedAddress = 0;
      let confirmedRegionOnly = 0;
      let missing = 0;
      let propertyBlockMissing = false;
      let blockingFailure = false;

      for (const prop of candidates) {
        throwIfCancelled(workerContext);
        let location: PropertyLocation = normalizeStructuredLocation(prop.property_location);
        let details: ParserDetailResult = {};
        if (detailSupported) {
          try {
            details = await parser.fetchDetails!(prop.url);
          } catch (error) {
            throwIfCancelled(workerContext);
            const errorClass = classifyParserError(error);
            if (errorClass === 'anti_bot' || errorClass === 'http_block'
              || errorClass === 'rate_limited' || errorClass === 'blocked') {
              blockingFailure = true;
            }
            detailFailures++;
            continue;
          }
          throwIfCancelled(workerContext);
          if (details.property_location !== undefined) {
            location = mergePropertyLocation(location, normalizeStructuredLocation(details.property_location));
          }
          const diagnostics = details.parser_diagnostics;
          if (diagnostics !== undefined) {
            if (!isParserExtractionDiagnostics(diagnostics)) {
              detailFailures++;
              continue;
            }
            diagnosticsSeen++;
            fingerprints.add(diagnostics.semantic_fingerprint);
            if (diagnostics.property_block_found) propertyBlockFound++;
            if (diagnostics.location_label_id) locationLabelFound++;
            if (diagnostics.schema_mismatch === 'property_block_missing') propertyBlockMissing = true;
          }
        }
        if (location.status === 'confirmed_address') confirmedAddress++;
        else if (location.status === 'confirmed_region_only') confirmedRegionOnly++;
        else missing++;
      }

      const checked = candidates.length;
      const fingerprint = aggregateSemanticFingerprints(fingerprints)
        ?? createHash('sha256').update(JSON.stringify([
          detailSupported ? 'diagnostics_missing' : 'listing_only',
          req.source,
        ])).digest('hex');
      let status: ParserProbeStatus = 'healthy';
      let reason: ParserProbeResult['reason'];
      if (blockingFailure) {
        status = 'blocked'; reason = 'source_blocked';
      } else if (detailSupported && propertyBlockMissing) {
        status = 'schema_changed'; reason = 'property_block_missing';
      } else if (checked === 0) {
        status = 'degraded'; reason = 'no_samples';
      } else if (detailSupported && detailFailures > 0) {
        status = 'degraded'; reason = 'detail_failed';
      } else if (detailSupported && diagnosticsSeen !== checked) {
        status = 'degraded'; reason = 'diagnostics_missing';
      } else if (missing > 0) {
        status = 'degraded'; reason = 'location_missing';
      }

      return {
        source: req.source,
        checked,
        listing_ok: checked > 0,
        detail_supported: detailSupported,
        detail_ok: checked > 0 && (!detailSupported || detailFailures === 0),
        property_block_found: propertyBlockFound,
        location_label_found: locationLabelFound,
        confirmed_address: confirmedAddress,
        confirmed_region_only: confirmedRegionOnly,
        missing,
        semantic_fingerprint: fingerprint,
        status,
        ...(reason ? { reason } : {}),
      };
    })(), req.timeoutMs);
  };
}
