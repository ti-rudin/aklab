import { describe, expect, it } from 'vitest';
import { isNormalParserSourceAllowed } from '../parser-source-quarantine';

describe('normal parser source quarantine predicate', () => {
  it.each(['healthy', 'degraded'])('allows an active source with supported status %s', (status) => {
    expect(isNormalParserSourceAllowed({ is_active: true, parser_health_status: status })).toBe(true);
  });

  it.each([null, undefined, 'schema_changed', 'blocked', 'corrupt_legacy_value', '', 7])('fails closed for hard, missing, or unknown status %s', (status) => {
    expect(isNormalParserSourceAllowed({ is_active: true, parser_health_status: status })).toBe(false);
  });

  it('rejects inactive or malformed source snapshots', () => {
    expect(isNormalParserSourceAllowed({ is_active: false, parser_health_status: 'healthy' })).toBe(false);
    expect(isNormalParserSourceAllowed(null)).toBe(false);
  });
});
