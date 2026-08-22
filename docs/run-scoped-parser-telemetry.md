# Run-scoped parser telemetry

## Назначение

`Source` хранит только агрегированное состояние здоровья источника. Координация конкретного запуска и каждой его очередной задачи хранится отдельно:

- `parser-run` — один запуск pipeline, уникальный по immutable `run_id`;
- `parser-run-source` — один этап `scan` или `details` конкретного источника, уникальный по `identity_key`:
  
  ```text
  {runId}:{sourceSlug}:{stage}
  ```

Пример: `run-1:fabrikant:scan`.

## Lifecycle

1. Pipeline получает lifecycle lock и создаёт/переиспользует `parser-run`.
2. До enqueue pipeline создаёт `parser-run-source` в состоянии `queued`, без `job_id`.
3. Сразу после `addToQueue` pipeline сохраняет **точный numeric** `job_id`.
4. Worker, после claim задачи, переводит только принадлежащую ей строку в `running`.
5. Worker отправляет один полный terminal snapshot counters.
6. После `waitForJobs()` pipeline сверяет terminal SQLite Queue. Если queue зафиксировала failure/cancellation после worker callback, очередь является источником истины и telemetry приводится к `failed`/`cancelled`; reconciliation сохраняет точный allowlisted `parser.<class>` из queue, а не подменяет любой failure классом `permanent`. Queue cancellation всегда нормализуется как `parser.cancelled`, даже если stale worker error содержал другой allowlisted class.
7. После завершения pipeline `parser-run` получает `succeeded`, `degraded`, `failed` или `cancelled`.

## Queue provenance envelopes

Новые queue jobs несут явный origin без отдельной generic telemetry table:

- analyzer pipeline: `{ documentId, origin: 'pipeline', runId, stage: 'analyze' }`;
- read-only canary probe: `{ operation: 'probe', origin: 'canary', runId, stage: 'probe', source, maxItems, timeoutMs }`;
- user lazy photo fetch: `{ documentId, url, source, origin: 'user', stage: 'photo_fetch' }`.

Analyzer и photo worker сохраняют совместимость с legacy payload, где отсутствуют все provenance-поля. Если любое provenance-поле присутствует, соответствующий полный envelope обязателен; partial/malformed payload отклоняется до внешнего fetch или другого side effect. Lazy photo jobs намеренно не получают `runId`: это пользовательское действие, а не parser-run stage.

## Protected worker aliases

Оба endpoint доступны только внутренним сервисам через `global::service-token`:

```text
PUT /api/internal/parser-run-sources/:identityKey/running
PUT /api/internal/parser-run-sources/:identityKey/terminal
```

`running` принимает ровно `{ data: { job_id } }`.

`terminal` принимает только:

```ts
{
  data: {
    job_id: number;
    status: 'success' | 'success_empty' | 'degraded' | 'blocked' |
      'schema_changed' | 'failed' | 'cancelled';
    detail_supported: boolean;
    counters: {
      listed: number; eligible: number; existing: number; pre_filtered: number;
      details_attempted: number; details_ok: number; created: number;
      skipped: number; failed: number;
      property_block_found: number; location_label_found: number;
      location_confirmed_address: number; location_confirmed_region_only: number;
      location_missing: number; location_unresolved: number;
      schema_mismatch: number;
    };
    diagnostics_schema_version?: 1;
    semantic_fingerprint?: string; // SHA-256 of bounded semantic IDs only
    error_class?: 'transient' | 'rate_limited' | 'blocked' | 'anti_bot' |
      'http_block' | 'schema_changed' | 'permanent' | 'cancelled';
    error_message?: `parser.${string}`; // controlled allowlisted code only; never raw exception text
  }
}
```

Контроллер проверяет ownership по сохранённому `job_id`, отвергает неизвестные поля и отрицательные counters. Повтор идентичного terminal snapshot идемпотентен; конфликтующий terminal snapshot отклоняется.

После deterministic health classification API записывает в ту же строку только operational annotation `health_status` (`healthy`, `degraded`, `schema_changed` или `blocked`) и только если соответствующий source-health CAS был выигран. Annotation получает effective persisted source status, поэтому stale normal/canary writer не может отметить строку healthy при текущем hard quarantine. Эта annotation не меняет terminal payload или counters. Исторический detail baseline строится только из строк `status=success AND health_status=healthy AND detail_supported=true`; listing-only, legacy/null, degraded и schema-changed строки в baseline не входят.

`detail_supported=false` — явный listing-only contract. Такая успешная details-строка может иметь `details_attempted=0` без detail fingerprint и классифицироваться как `healthy`; capability не выводится из counters. Для `detail_supported=true` сохраняются строгие detail counter/fingerprint drift checks. Enum `error_class` одинаков в worker client, controller, API service type и schema.

Canary probe results carry exact safe-integer `details_attempted`, `details_ok` и `details_failed` counters with `details_ok + details_failed = details_attempted`; detail-capable probes use `details_attempted=checked`, while listing-only probes use `0/0/0`. The legacy `detail_ok` flag, when present, is derived from `details_failed === 0`.

If the bounded cancellation-ack window expires while owned jobs remain active, canary returns `{ run_id, skipped: true, reason: 'terminal_ack_pending', pending_job_ids, results: [] }`, keeps lifecycle state `cancelling`, writes no health, and does not release the owner. Pending IDs are safe numeric IDs in ascending order.

When a healthy canary is held against persisted degraded or hard health, the Source update may refresh the check timestamp but omits incoming `last_schema_fingerprint` and `last_health_reason`; persisted status and degraded streak remain authoritative.

## Item-level detail failures

- Обычное исключение непосредственно из `parser.fetchDetails()` ограничивается одной карточкой: увеличивается только `failed`; `skipped` зарезервирован для успешно оценённых, но не сохранённых кандидатов (unresolved location, snapshot/create filter). Обработка immutable artifact продолжается, terminal source status становится `degraded` с `parser.transient`.
- `ParserSourceError`, cancellation/lease loss, invalid typed location, diagnostics/merge/progress/persistence errors после возврата `fetchDetails()` остаются source-level fail-closed failures.
- Если все выполненные detail requests источника завершились ошибкой (`details_ok=0`), stage не может стать `degraded`: он завершается `failed`, остаётся retryable, а scan artifact сохраняется.
- Terminal `completed` и `failed` details rows проходят source-health classification/alert path после queue reconciliation; cancellation row намеренно исключается.
- Partial degraded success очищает artifact только после terminal telemetry и source stats; failed stage artifact не удаляет.

## Invariants

- `run_id` и `identity_key` не изменяются;
- retry/restart не создаёт дубль: unique-constraint race повторно читает строку-победитель;
- `job_id` всегда реальный identifier SQLite Queue, не synthetic string;
- counters — полный exact snapshot, не инкрементальный patch;
- для detail-capable terminal snapshot категории взаимоисключающие: `details_ok + failed = details_attempted`, а `created + skipped + failed = details_attempted`; historical rows до этого контракта могут содержать legacy overlap и не переписываются;
- completed details-stage с effective health `degraded`, `schema_changed` или `blocked` передаёт bounded `parser.<class>` в parent aggregation: `parser_run.status=degraded`, pipeline terminal stage=`done_with_errors`; это не queue failure и не запускает retry;
- для `detail_supported=true`: `location_unresolved <= location_missing`, а сумма location statuses не превышает `details_ok`; для listing-only detail extraction counters нулевые, но `location_unresolved` может фиксировать fail-closed persistence skip;
- fingerprint не содержит raw HTML, CSS classes, адреса или party data;
- `error_message` проходит strict controller allowlist и хранит только controlled `parser.<class>` code; worker rethrows a fresh typed safe error, pipeline state never copies raw `job.error`, and queue cancellation is derived from `cancellation_requested_at` rather than message text;
- queue-terminal reconciliation выводит `error_class` только из уже allowlisted `parser.<class>`; неизвестный/raw текст безопасно нормализуется в `parser.transient`;
- normal terminal строка не может быть перезаписана другим terminal payload; post-terminal annotation `health_status` допускается только для source-health CAS winner и вычисляется из уже сохранённого exact snapshot;
- исключение — reconciliation с terminal состоянием SQLite Queue при cancellation race.

## Основные файлы

- `api/src/services/parser-run-telemetry.ts`
- `api/src/services/pipeline/index.ts`
- `api/src/services/pipeline/stages.ts`
- `api/src/api/parser-run-source/controllers/parser-run-source.ts`
- `services/_shared/src/parse-handler.ts`
- `services/_shared/src/strapi-client.ts`
- `services/_shared/src/parser-diagnostics.ts`
- `services/_shared/src/parser-probe.ts`
- `api/src/services/parser-source-health.ts`
- `api/src/services/parser-canary.ts`
- `api/src/services/parser-health-alerts.ts`
