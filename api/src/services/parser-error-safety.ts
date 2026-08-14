export type ApiParserErrorClass =
  | 'transient'
  | 'rate_limited'
  | 'blocked'
  | 'anti_bot'
  | 'http_block'
  | 'schema_changed'
  | 'permanent'
  | 'cancelled';

const SAFE_CODE = /^parser\.(?:transient|rate_limited|blocked|anti_bot|http_block|schema_changed|permanent|cancelled)$/;

/** Defense-in-depth: telemetry never persists caller-provided raw error text. */
export function safeParserTelemetryError(
  value: unknown,
  errorClass?: ApiParserErrorClass,
): string {
  if (typeof value === 'string' && SAFE_CODE.test(value)) return value;
  return `parser.${errorClass ?? 'transient'}`;
}

export function isSafeParserTelemetryError(value: unknown): value is string {
  return typeof value === 'string' && SAFE_CODE.test(value);
}
