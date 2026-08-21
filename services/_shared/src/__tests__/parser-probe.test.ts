import { describe, expect, it, vi } from 'vitest';
import { createParserQueueHandler } from '../parser-probe';
import { createParserExtractionDiagnostics } from '../parser-diagnostics';
import { ParserSourceError } from '../parser-error';
import type { SourceParser } from '../types';

function job(data: Record<string, unknown>, withProvenance = true) {
  return {
    id: 9,
    data: withProvenance
      ? { operation: 'probe', origin: 'canary', runId: 'run-1', stage: 'probe', ...data }
      : data,
    correlation_id: 'probe-run',
  } as any;
}

function property(id: string) {
  return {
    external_id: id,
    url: `https://example.test/${id}`,
    title: 'Склад',
    address: '',
    city: 'other',
    property_location: {
      status: 'missing' as const,
      source_kind: 'dom_field' as const,
      source_path: 'listing.property_location',
    },
    property_type: 'warehouse',
    auction_type: 'bankruptcy',
  };
}

describe('parser probe handler', () => {
  it('runs 1-3 read-only samples and aggregates bounded diagnostics', async () => {
    const parser: SourceParser = {
      name: 'probe-source',
      parse: vi.fn().mockResolvedValue([property('1'), property('2'), property('3')]),
      fetchDetails: vi.fn().mockResolvedValue({
        property_location: {
          region: 'Ярославская область',
          status: 'confirmed_region_only',
          source_kind: 'dom_field',
          source_path: 'details.field.region',
        },
        parser_diagnostics: createParserExtractionDiagnostics({
          adapterVersion: 'probe-source.v1',
          propertyBlockFound: true,
          locationLabelId: 'property.location.region',
          semanticSignals: ['property.block', 'property.location.region'],
        }),
      }),
    };
    const parseHandler = vi.fn();
    const handler = createParserQueueHandler(parser, parseHandler);

    const result = await handler(job({ operation: 'probe', source: 'probe-source', maxItems: 2, timeoutMs: 5_000 }));

    expect(parser.parse).toHaveBeenCalledWith(2);
    expect(parser.fetchDetails).toHaveBeenCalledTimes(2);
    expect(parseHandler).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      source: 'probe-source', checked: 2, listing_ok: true, detail_ok: true,
      detail_supported: true, details_attempted: 2, details_ok: 2, details_failed: 0,
      property_block_found: 2, location_label_found: 2,
      confirmed_address: 0, confirmed_region_only: 2, missing: 0,
      status: 'healthy',
    });
    expect(result.semantic_fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it('treats a healthy listing-only parser as supported instead of a detail failure', async () => {
    const listingProperty = {
      ...property('listing-only'),
      property_location: {
        address: 'г. Москва, ул. Тестовая, д. 1',
        status: 'confirmed_address' as const,
        source_kind: 'api_field' as const,
        source_path: 'listing.address',
      },
    };
    const parser: SourceParser = {
      name: 'listing-only',
      parse: vi.fn().mockResolvedValue([listingProperty]),
    };

    const result = await createParserQueueHandler(parser, vi.fn())(
      job({ operation: 'probe', source: 'listing-only', maxItems: 1, timeoutMs: 5_000 }),
    );

    expect(result).toMatchObject({
      source: 'listing-only',
      checked: 1,
      listing_ok: true,
      detail_supported: false,
      detail_ok: true, details_attempted: 0, details_ok: 0, details_failed: 0,
      confirmed_address: 1,
      status: 'healthy',
    });
  });

  it('classifies typed missing with a hydrated property block as location_missing, not schema_changed', async () => {
    const parser: SourceParser = {
      name: 'typed-missing',
      parse: vi.fn().mockResolvedValue([property('typed-missing')]),
      fetchDetails: vi.fn().mockResolvedValue({
        property_location: property('typed-missing').property_location,
        parser_diagnostics: createParserExtractionDiagnostics({
          adapterVersion: 'typed-missing.v1',
          propertyBlockFound: true,
          semanticSignals: ['property.block'],
        }),
      }),
    };

    const result = await createParserQueueHandler(parser, vi.fn())(
      job({ operation: 'probe', source: 'typed-missing', maxItems: 1, timeoutMs: 5_000 }),
    );

    expect(result).toMatchObject({
      source: 'typed-missing',
      checked: 1,
      details_attempted: 1,
      details_ok: 1,
      details_failed: 0,
      property_block_found: 1,
      missing: 1,
      status: 'degraded',
      reason: 'location_missing',
    });
    expect(result.status).not.toBe('schema_changed');
  });

  it('preserves exact partial detail counters for one successful and one failed candidate', async () => {
    const parser: SourceParser = {
      name: 'partial-details',
      parse: vi.fn().mockResolvedValue([property('success'), property('failure')]),
      fetchDetails: vi.fn()
        .mockResolvedValueOnce({
          property_location: {
            address: 'г. Москва, ул. Тестовая, д. 1',
            status: 'confirmed_address',
            source_kind: 'dom_field',
            source_path: 'details.property.address',
          },
          parser_diagnostics: createParserExtractionDiagnostics({
            adapterVersion: 'partial-details.v1',
            propertyBlockFound: true,
            locationLabelId: 'property.location.address',
            semanticSignals: ['property.block', 'property.location.address'],
          }),
        })
        .mockRejectedValueOnce(new Error('detail request failed')),
    };

    const result = await createParserQueueHandler(parser, vi.fn())(
      job({ operation: 'probe', source: 'partial-details', maxItems: 2, timeoutMs: 5_000 }),
    );

    expect(result).toMatchObject({
      source: 'partial-details',
      checked: 2,
      details_attempted: 2,
      details_ok: 1,
      details_failed: 1,
      detail_ok: false,
      status: 'degraded',
      reason: 'detail_failed',
    });
  });

  it('does not settle the queue job before a timed-out operation has cleaned up', async () => {
    vi.useFakeTimers();
    try {
      let operationSettled = false;
      const parser: SourceParser = {
        name: 'slow-source',
        parse: vi.fn().mockImplementation(() => new Promise(resolve => {
          setTimeout(() => {
            operationSettled = true;
            resolve([property('slow')]);
          }, 1_100);
        })),
      };
      const pending = createParserQueueHandler(parser, vi.fn())(
        job({ operation: 'probe', source: 'slow-source', maxItems: 1, timeoutMs: 1_000 }),
      );
      const assertion = expect(pending).rejects.toThrow(/timeout/i);

      await vi.advanceTimersByTimeAsync(1_000);
      expect(operationSettled).toBe(false);
      await vi.advanceTimersByTimeAsync(100);
      await assertion;
      expect(operationSettled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('routes normal queue jobs to the existing parse handler unchanged', async () => {
    const parser = { name: 'source', parse: vi.fn() } as any;
    const parseHandler = vi.fn().mockResolvedValue({ created: 1 });
    const handler = createParserQueueHandler(parser, parseHandler);
    const normalJob = job({ source: 'source', phase: 'scan' }, false);

    await expect(handler(normalJob)).resolves.toEqual({ created: 1 });
    expect(parseHandler).toHaveBeenCalledWith(normalJob, undefined);
    expect(parser.parse).not.toHaveBeenCalled();
  });

  it('reports explicit property-block loss as schema_changed without raw reason text', async () => {
    const parser: SourceParser = {
      name: 'changed-source',
      parse: vi.fn().mockResolvedValue([property('1')]),
      fetchDetails: vi.fn().mockResolvedValue({
        property_location: property('1').property_location,
        parser_diagnostics: createParserExtractionDiagnostics({
          adapterVersion: 'changed-source.v1',
          propertyBlockFound: false,
          semanticSignals: [],
        }),
      }),
    };
    const result = await createParserQueueHandler(parser, vi.fn())(
      job({ operation: 'probe', source: 'changed-source', maxItems: 1, timeoutMs: 5_000 }),
    );

    expect(result).toMatchObject({ status: 'schema_changed', reason: 'property_block_missing' });
    expect(JSON.stringify(result)).not.toContain('https://example.test');
  });

  it('maps an explicit anti-bot detail failure to blocked without raw error text', async () => {
    const parser: SourceParser = {
      name: 'blocked-source',
      parse: vi.fn().mockResolvedValue([property('1')]),
      fetchDetails: vi.fn().mockRejectedValue(new ParserSourceError('anti_bot')),
    };
    const result = await createParserQueueHandler(parser, vi.fn())(
      job({ operation: 'probe', source: 'blocked-source', maxItems: 1, timeoutMs: 5_000 }),
    );

    expect(result).toMatchObject({ status: 'blocked', reason: 'source_blocked', detail_ok: false });
    expect(JSON.stringify(result)).not.toContain('anti_bot');
  });

  it('fails closed on invalid bounds before parser or parse-handler calls', async () => {
    const parser = { name: 'source', parse: vi.fn() } as any;
    const parseHandler = vi.fn();
    const handler = createParserQueueHandler(parser, parseHandler);

    await expect(handler(job({ operation: 'probe', source: 'source', maxItems: 4, timeoutMs: 5_000 })))
      .rejects.toThrow(/probe request/i);
    expect(parser.parse).not.toHaveBeenCalled();
    expect(parseHandler).not.toHaveBeenCalled();
  });

  it.each([
    { operation: 'probe', source: 'source', maxItems: 1, timeoutMs: 5_000 },
    { operation: 'probe', origin: 'canary', runId: 'run-1', source: 'source', maxItems: 1, timeoutMs: 5_000 },
    { operation: 'probe', origin: 'pipeline', runId: 'run-1', stage: 'probe', source: 'source', maxItems: 1, timeoutMs: 5_000 },
    { operation: 'probe', origin: 'canary', runId: 'bad run', stage: 'probe', source: 'source', maxItems: 1, timeoutMs: 5_000 },
    { operation: 'probe', origin: 'canary', runId: 'run-1', stage: 'probe', source: 'source', maxItems: 1, timeoutMs: 5_000, extra: true },
  ])('requires the exact canary provenance envelope: %o', async (data) => {
    const parser = { name: 'source', parse: vi.fn().mockResolvedValue([]) } as any;
    const parseHandler = vi.fn();
    const handler = createParserQueueHandler(parser, parseHandler);

    await expect(handler(job(data, false))).rejects.toThrow(/probe request/i);
    expect(parser.parse).not.toHaveBeenCalled();
    expect(parseHandler).not.toHaveBeenCalled();
  });

  it('checks cooperative cancellation before network work', async () => {
    const parser = { name: 'source', parse: vi.fn() } as any;
    const handler = createParserQueueHandler(parser, vi.fn());
    const workerContext = { isCancellationRequested: () => true, isLeaseValid: () => true } as any;

    await expect(handler(job({ operation: 'probe', source: 'source', maxItems: 1, timeoutMs: 5_000 }), workerContext))
      .rejects.toThrow(/cancel/i);
    expect(parser.parse).not.toHaveBeenCalled();
  });
});
