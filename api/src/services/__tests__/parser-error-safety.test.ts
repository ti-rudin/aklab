import { describe, expect, it } from 'vitest';
import { isSafeParserTelemetryError, safeParserTelemetryError } from '../parser-error-safety';

describe('parser telemetry error safety', () => {
  it('passes only bounded parser error codes', () => {
    expect(isSafeParserTelemetryError('parser.anti_bot')).toBe(true);
    expect(isSafeParserTelemetryError('parser.http_block')).toBe(true);
    expect(isSafeParserTelemetryError('parser.failure')).toBe(false);
    expect(isSafeParserTelemetryError('parser.queue_failure')).toBe(false);
    expect(isSafeParserTelemetryError('raw adapter failure contains sensitive payload marker')).toBe(false);
  });

  it('maps raw and legacy pseudo-codes to the canonical transient fallback', () => {
    expect(safeParserTelemetryError('raw adapter failure contains sensitive payload marker')).toBe('parser.transient');
    expect(safeParserTelemetryError('parser.failure')).toBe('parser.transient');
    expect(safeParserTelemetryError('parser.queue_failure')).toBe('parser.transient');
  });

  it('replaces raw queue text without retaining its content', () => {
    const safe = safeParserTelemetryError('raw adapter failure contains sensitive payload marker', 'permanent');
    expect(safe).toBe('parser.permanent');
    expect(safe).not.toContain('secret');
  });
});
