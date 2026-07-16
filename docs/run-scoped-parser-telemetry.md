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
6. После `waitForJobs()` pipeline сверяет terminal SQLite Queue. Если queue зафиксировала failure/cancellation после worker callback, очередь является источником истины и telemetry приводится к `failed`/`cancelled`.
7. После завершения pipeline `parser-run` получает `succeeded`, `degraded`, `failed` или `cancelled`.

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
    counters: {
      listed: number; eligible: number; existing: number; pre_filtered: number;
      details_attempted: number; details_ok: number; created: number;
      skipped: number; failed: number;
    };
    error_class?: 'transient' | 'rate_limited' | 'blocked' |
      'schema_changed' | 'permanent' | 'cancelled';
    error_message?: string;
  }
}
```

Контроллер проверяет ownership по сохранённому `job_id`, отвергает неизвестные поля и отрицательные counters. Повтор идентичного terminal snapshot идемпотентен; конфликтующий terminal snapshot отклоняется.

## Invariants

- `run_id` и `identity_key` не изменяются;
- retry/restart не создаёт дубль: unique-constraint race повторно читает строку-победитель;
- `job_id` всегда реальный identifier SQLite Queue, не synthetic string;
- counters — полный exact snapshot, не инкрементальный patch;
- normal terminal строка не может быть перезаписана другим terminal payload;
- исключение — reconciliation с terminal состоянием SQLite Queue при cancellation race.

## Основные файлы

- `api/src/services/parser-run-telemetry.ts`
- `api/src/services/pipeline/index.ts`
- `api/src/services/pipeline/stages.ts`
- `api/src/api/parser-run-source/controllers/parser-run-source.ts`
- `services/_shared/src/parse-handler.ts`
- `services/_shared/src/strapi-client.ts`
