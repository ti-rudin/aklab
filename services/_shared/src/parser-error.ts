export type ParserErrorClass =
  | 'transient'
  | 'rate_limited'
  | 'blocked'
  | 'anti_bot'
  | 'http_block'
  | 'schema_changed'
  | 'permanent'
  | 'cancelled';

const ERROR_CLASSES = new Set<ParserErrorClass>([
  'transient',
  'rate_limited',
  'blocked',
  'anti_bot',
  'http_block',
  'schema_changed',
  'permanent',
  'cancelled',
]);

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

/** Classify only explicit typed fields, numeric HTTP status, or stable error names. */
export function classifyParserError(error: unknown): ParserErrorClass | undefined {
  const value = record(error);
  const explicit = value?.parser_error_class;
  if (typeof explicit === 'string' && ERROR_CLASSES.has(explicit as ParserErrorClass)) {
    return explicit as ParserErrorClass;
  }

  const response = record(value?.response);
  const statusValue = value?.statusCode ?? value?.status ?? response?.status;
  const status = typeof statusValue === 'number' ? statusValue : Number.NaN;
  if (status === 429) return 'rate_limited';
  if (status === 401 || status === 403 || status === 451) return 'http_block';
  if (status >= 500 && status <= 599) return 'transient';
  if (status >= 400 && status <= 499) return 'permanent';

  const name = typeof value?.name === 'string' ? value.name : undefined;
  if (name === 'AntiBotError') return 'anti_bot';
  if (name === 'HttpBlockError') return 'http_block';
  if (name === 'RateLimitError') return 'rate_limited';
  if (name === 'SchemaChangedError') return 'schema_changed';
  if (name === 'TimeoutError' || name === 'AbortError') return 'transient';
  if (name === 'PermanentError') return 'permanent';
  return undefined;
}

/** Persistable/loggable bounded code. Raw Error.message is deliberately ignored. */
export function safeParserErrorCode(error: unknown): string {
  return `parser.${classifyParserError(error) ?? 'transient'}`;
}

export class ParserSourceError extends Error {
  readonly parser_error_class: ParserErrorClass;
  readonly statusCode?: number;
  readonly permanent: boolean;

  constructor(errorClass: ParserErrorClass, statusCode?: number) {
    super(`parser.${errorClass}`);
    this.name = errorClass === 'anti_bot'
      ? 'AntiBotError'
      : errorClass === 'http_block'
        ? 'HttpBlockError'
        : 'ParserSourceError';
    this.parser_error_class = errorClass;
    this.statusCode = statusCode;
    this.permanent = errorClass === 'blocked'
      || errorClass === 'anti_bot'
      || errorClass === 'http_block'
      || errorClass === 'schema_changed'
      || errorClass === 'permanent'
      || errorClass === 'cancelled';
  }
}

export function parserHttpError(status: number): ParserSourceError {
  if (status === 429) return new ParserSourceError('rate_limited', status);
  if (status === 401 || status === 403 || status === 451) {
    return new ParserSourceError('http_block', status);
  }
  if (status >= 500 && status <= 599) return new ParserSourceError('transient', status);
  return new ParserSourceError('permanent', status);
}
