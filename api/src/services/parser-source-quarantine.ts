const NORMAL_WORK_STATUSES = new Set(['healthy', 'degraded']);

/** Normal parser work is fail-closed; read-only canaries intentionally bypass this gate. */
export function isNormalParserSourceAllowed(source: unknown): boolean {
  if (!source || typeof source !== 'object') return false;
  const value = source as { is_active?: unknown; parser_health_status?: unknown };
  if (value.is_active !== true) return false;
  return typeof value.parser_health_status === 'string'
    && NORMAL_WORK_STATUSES.has(value.parser_health_status);
}