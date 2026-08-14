import { describe, expect, it } from 'vitest';
import {
  classifyParserError,
  parserHttpError,
  ParserSourceError,
  safeParserErrorCode,
} from '../src/parser-error';

describe('parser error safety contract', () => {
  it('preserves explicit anti-bot and HTTP-block classes end to end', () => {
    expect(classifyParserError(new ParserSourceError('anti_bot'))).toBe('anti_bot');
    expect(classifyParserError(parserHttpError(403))).toBe('http_block');
    expect(classifyParserError(parserHttpError(429))).toBe('rate_limited');
  });

  it('uses stable names and numeric statuses but never parses raw message text', () => {
    expect(classifyParserError(Object.assign(new Error('secret HTTP 403 token=abc'), { status: 403 }))).toBe('http_block');
    expect(classifyParserError(new Error('anti_bot HTTP 403 secret token=abc'))).toBeUndefined();
  });

  it('returns a bounded safe code without raw error content', () => {
    const error = Object.assign(new Error('raw adapter failure contains sensitive payload marker'), {
      parser_error_class: 'schema_changed',
    });
    expect(safeParserErrorCode(error)).toBe('parser.schema_changed');
    expect(safeParserErrorCode(new Error('secret'))).toBe('parser.transient');
  });
});
