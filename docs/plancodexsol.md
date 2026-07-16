# AKLAB — полный технический аудит и план работ

> **Дата аудита:** 15.07.2026  
> **Локальная база аудита:** `main` @ `fc9aea4` (`v1.1.63`)  
> **Production на момент проверки:** `main` @ `716ca53` (`v1.1.64`)  
> **Области:** парсеры и shared parsing layer, очередь, pipeline, Strapi backend, focus/analyzer, digest/photo-fetcher, Vue frontend, тесты, зависимости, runtime и эксплуатация.  
> **Важно:** аудит выполнялся read-only. Новый production pipeline не запускался и деплой не выполнялся. Для runtime-проверки использованы фактическая БД, PM2, queue.db и логи последнего production-прогона.

---

## 1. Резюме

AKLAB уже не является прототипом: в проекте есть изолированные source-сервисы, двухфазный pipeline, общий слой парсинга, тесты, health checks, правила фильтрации, focus engine и полноценный Vue-интерфейс. Главная проблема сейчас не в отсутствии архитектуры, а в нескольких нарушенных инвариантах внутри неё.

### Главный вывод

**Текущий pipeline нельзя считать строго детерминированным и идемпотентным.** При последнем production-прогоне 5-минутный механизм stale recovery повторно поставил долгие parser jobs в очередь, пока исходные процессы ещё работали. В результате одни и те же источники выполнялись параллельно, счётчики перезаписывались, pipeline объявлял завершение раньше поздних side effects, а содержимое Properties продолжало меняться после статуса `done`.

Это подтверждено одновременно кодом, очередью и логами:

- `QUEUE_STALE_TIMEOUT_MIN` по умолчанию равен 5 минутам (`lib/sqlite-queue/index.ts:56-58`);
- stale recovery переводит любую `active` job старше порога обратно в `pending` без heartbeat/lease (`lib/sqlite-queue/index.ts:80-90, 273-295`);
- parser jobs реально работают десятки минут;
- в production `queue.db` зафиксированы повторные попытки parser jobs (`attempts=2`): `fabrikant`, `aggregator-bankrot`, `etprf`, `m-ets`;
- в логах `fabrikant` второй scan стартовал в 18:07, пока первый scan продолжал идти и дошёл до 1000 карточек в 18:09;
- после статуса pipeline `done` состав таблицы Properties изменился: появились поздние результаты `torgi-gov` и `aggregator-bankrot`, а source counters не соответствуют фактическим строкам БД.

### Приоритеты

| Приоритет | Направление | Почему |
|---|---|---|
| **P0** | Исправить lease/stale recovery очереди и отменить параллельные дубли parser jobs | Сейчас нарушается корректность всего pipeline |
| **P0** | Закрыть публичные mutating/admin endpoints и разделить user/service auth | Внешний клиент может запускать pipeline, парсеры, анализ, digest и photo fetch |
| **P0** | Довести идемпотентность до уровня БД и очереди | Текущая проверка `exists → insert` не атомарна; unique index фактически не `UNIQUE` |
| **P0/P1** | Обновить Strapi и уязвимые production dependencies | `npm audit` для API: 52 уязвимости, из них 24 high |
| **P1** | Перестроить run/progress model: per-run/per-stage jobs вместо общих Source counters | Сейчас метрики теряются и не привязаны к конкретному прогону |
| **P1** | Ввести единый контракт source adapters и live/fixture contract tests | Тесты не ловят реальный DOM drift (`roseltorg=0`, Sber pagination не работает) |
| **P1** | Исправить analyzer/focus/digest correctness | Force-анализ, cache, threshold semantics и digest completion имеют ошибки |
| **P1** | Исправить frontend orchestration и error states | UI может запустить scoring до завершения analysis и скрывает часть ошибок |

### Оценка текущего состояния

| Область | Оценка | Комментарий |
|---|---:|---|
| Общая архитектура | 7/10 | Правильное разделение компонентов, но нарушена модель владения состоянием |
| Парсеры | 6/10 | Много реальных адаптеров и общий handler, но слабый контракт, N+1 и DOM drift |
| Очередь/pipeline | 3/10 | Критический stale-recovery race и некоррелированный progress |
| Backend | 6/10 | Хорошая структура Strapi, но публичные write endpoints и несколько correctness bugs |
| Frontend | 7/10 | Хороший UI-kit/composables, но orchestration и error handling требуют доработки |
| Тестирование | 7/10 | 583 backend/shared теста проходят, но production-инварианты очереди и pipeline не покрыты |
| Безопасность | 4/10 | Секреты не обнаружены, но API perimeter фактически открыт |
| Наблюдаемость | 5/10 | Логи и health есть, но нет run-level telemetry и алертинга по деградации данных |
| Документация | 7/10 | Богатая история, но актуальная версия и часть утверждений расходятся с runtime |

---

## 2. Что проверено

### 2.1 Исходники

- `services/_shared`: parse handler, Strapi client, anti-ban, queue worker, types;
- 11 source adapters: 10 активных + `fedresurs`;
- `lib/sqlite-queue`;
- `api/src/services/pipeline/*`, `queueService`, `focusEngine`, `buildPropertyWhere`;
- Strapi controllers/routes/services/content-types, cron, seeders, configs;
- analyzer, digest, photo-fetcher;
- Vue views, components, composables, stores, router, API client и тесты;
- deploy/health manifests и существующие планы/документация.

### 2.2 Реальный production runtime

- public frontend: HTTP 200;
- API health: HTTP 204;
- `/api/setting`: HTTP 200;
- health script: 15/15 заявленных сервисов healthy;
- PM2: фактически 16 процессов online, включая orphan `aklab-parser-fedresurs`;
- RAM: около 2.3 GiB из 7.8 GiB, swap не используется;
- `chrome-headless-shell`: 0 процессов между прогонами;
- `data.db`: около 1.8 MiB;
- queue.db, Source counters, Pipeline state и последние parser logs;
- unauthenticated GET к `/api/pipeline/status`, `/api/cron/queue-stats`, `/api/properties/stats`, `/api/properties/focus`, `/api/sources` возвращает 200.

### 2.3 Проверки качества

- root tests: **27 suites, 583 tests — PASS**;
- frontend production build: **PASS**;
- frontend unit tests: **17 suites, 117 pass, 1 fail**;
  - stale test `useFocusTab.test.ts`: тест ожидает threshold 50, mock Setting возвращает 20;
- API build локально не выполнен: в `api/node_modules` отсутствует Strapi binary (`strapi: command not found`), это ограничение локальной среды, а не доказательство ошибки исходников;
- npm audit:
  - root production deps: 3 vulnerabilities (2 high, 1 low);
  - app production deps: 1 high;
  - API production deps: 52 (24 high, 22 moderate, 6 low), в основном Strapi/transitive chain;
- app build warning: основной JS chunk около 779 KiB в несжатом виде, выше Vite threshold.

---

## 3. Критические находки

## P0-1. Stale recovery повторно запускает живые parser jobs

### Код

`lib/sqlite-queue/index.ts`:

- default stale timeout — 5 минут (`:56-58`);
- каждые 60 секунд Strapi вызывает recovery (`:105-108`);
- любая `active` job старше порога возвращается в `pending` (`:80-90, 273-295`);
- heartbeat, lease renewal, owner PID/worker ID и stage-aware timeout отсутствуют.

### Production-доказательство

В `queue.db` четыре parser jobs имеют `attempts=2`. Лог `fabrikant` показывает два пересекающихся исполнения одного run/correlation ID. Source counters в этот момент сбрасывались повторно, поэтому один worker видел `needed=17`, а другой менял те же поля.

### Последствия

- параллельная нагрузка на внешние сайты и риск ban/HTTP 451;
- двойные browser sessions и расход RAM;
- гонки `reset counters → update counters`;
- поздние INSERT после завершения pipeline/digest;
- невозможность доверять `objects_created`, `details_fetched`, `parse_count`;
- `clearQueue`/timeout могут пометить job failed, но handler продолжит side effects;
- digest не включает объекты, пришедшие после ложного завершения.

### Решение

1. Немедленно отключить time-based requeue для parser jobs либо поднять порог выше максимального runtime как временный hotfix.
2. Реализовать lease:
   - `locked_by`, `lease_expires_at`, `heartbeat_at`;
   - worker обновляет heartbeat каждые 15–30 секунд;
   - requeue только если lease истёк и worker не продлевал его;
   - timeout задаётся per queue/stage (`scan`, `details`, analyzer, digest), а не глобально.
3. При timeout/cancel handler должен получать cooperative cancellation signal и прекращать side effects.
4. Completion update должен быть условным: только владелец текущего lease может завершить job.
5. Добавить integration test: handler работает > stale threshold, но выполняется ровно один раз.

**Критерий готовности:** один correlation/stage/source создаёт ровно одну физическую попытку; pipeline `done` означает отсутствие выполняющихся handlers и неизменность БД после завершения.

---

## P0-2. Mutating/admin API доступен без аутентификации

В custom routes массово используется `auth: false`, включая:

- `POST /pipeline/start`, `/pipeline/cancel`, `/pipeline/reset`;
- `/cron/parse/:slug`, `/cron/analyze`, `/cron/digest`, `/cron/score`;
- Sources CRUD/health;
- Setting update;
- Properties write/bulk/clear;
- photo fetch/geocode;
- market references и focus rules.

Single-tenant архитектура не означает, что backend можно оставлять публичным. Frontend уже получает JWT и способен отправлять его; parser/worker services имеют отдельный API token.

### Риски

- внешний запуск depth=5000 и DoS сервера/источников;
- сброс/удаление данных;
- произвольный запуск email digest;
- запуск photo-fetcher по URL из БД;
- чтение коммерчески значимой подборки;
- в комбинации с публичным созданием Property — SSRF через photo worker.

### Решение без слепого «закрыть всё JWT»

1. Разделить endpoint classes:
   - **UI user**: JWT + role/policy;
   - **service-to-service**: Strapi API token или отдельный HMAC/service policy;
   - **public**: только health без данных и, при необходимости, login.
2. Убрать `auth:false` с mutating endpoints.
3. Для cron/pipeline установить policy `isAuthenticated + isOperator`.
4. Для internal parser property exists/create/update оставить service token; не открывать эти endpoints браузеру.
5. На Traefik добавить rate limits для auth, pipeline и expensive routes.
6. Добавить security tests: unauthenticated write = 401/403; service token не может менять Settings/Users; user JWT не может обращаться к internal ingestion endpoint.

---

## P0-3. Идемпотентность не гарантируется БД и очередью

### Properties

- `propertyExists()` + `POST /properties` — классический check-then-insert race (`strapi-client.ts:238-248`);
- индекс `idx_properties_source_external_id_unique` в production schema создан как обычный `CREATE INDEX`, а не `CREATE UNIQUE INDEX`;
- два параллельных workers могут пройти обе проверки.

### Queue

- idempotency включается только если caller передал `idempotent: true` (`lib/sqlite-queue/index.ts:124-130`);
- pipeline передаёт correlation ID, но не `idempotent: true`;
- `addAndWait` также добавляет job без idempotent (`:150-152`);
- даже idempotent check — `SELECT → INSERT`, без unique partial index/transaction;
- scan и details используют одинаковый correlation ID в одной queue, без stage в ключе.

### Решение

1. Создать реальный `UNIQUE(source, external_id)` после dedup migration.
2. На conflict выполнять `DO NOTHING`/upsert, а не надеяться на предварительный GET.
3. Добавить queue key: `(queue, correlation_id, stage, logical_key)` либо единый `idempotency_key` с UNIQUE constraint.
4. Сформировать ключи:
   - `runId:source:scan`;
   - `runId:source:details`;
   - `runId:property:analyze`;
   - `runId:digest`.
5. Проверку существования делать bulk-запросом, но считать её оптимизацией, не гарантией целостности.

---

## P0/P1-4. SSRF и неограниченная загрузка файлов в photo-fetcher

`photo-fetcher` делает server-side requests по `property.url` и найденным image URLs. Сейчас отсутствуют полноценные:

- allowlist доменов по source;
- запрет private/link-local/loopback IP после DNS resolution и redirect;
- ограничение размера response;
- строгая проверка MIME + magic bytes;
- лимит итогового места/файлов на Property;
- quarantine/cleanup для частично загруженных файлов.

Дополнительно `photos_downloaded=true` ставится даже при нуле извлечённых/успешно загруженных изображений, поэтому временный сбой становится постоянным ложным успехом.

### Решение

- source → allowed hosts mapping;
- DNS/IP SSRF guard на каждом redirect;
- timeout, max redirects, max bytes, content-type и image decode verification;
- состояния `pending/success/empty/retryable_error/permanent_error`, `attempts`, `last_error`;
- `photos_downloaded=true` только при успехе либо подтверждённом `empty`;
- отдельный retry/backoff и disk quota.

---

## 4. Аудит shared parsing architecture

## 4.1 Что сделано хорошо

- общий `createParseHandler` уменьшает копипасту;
- двухфазная схема scan/details позволяет видеть общий объём detail work;
- strict city/price/area/stop-word rules применяются повторно перед INSERT;
- browser/context/page закрываются через `finally`; production подтвердил 0 zombie Chrome после прогона;
- есть fail-closed поведение при недоступном API, защищающее от массовых дублей;
- источник изолирован отдельным PM2 process.

## 4.2 Проблемы shared handler/client

### P1. Source counters одновременно используются как UI telemetry и coordination state

Все workers пишут в одну запись Source через read-modify-write. Это не run-scoped и не stage-scoped. При retry/parallel execution значения сбрасываются и перетираются.

**Решение:** создать `parser_runs` и `parser_run_sources`:

- `run_id`, `source`, `stage`, `job_id`, `status`;
- counters `listed`, `eligible`, `existing`, `pre_filtered`, `details_attempted`, `details_ok`, `created`, `skipped`, `failed`;
- started/heartbeat/finished timestamps;
- error classification;
- Source хранит только агрегат `last_successful_run` и health summary.

### P1. `total_found` удваивается

В scan handler статистика обновляется сначала на `:133-138`, затем повторно на `:145-151`. `updateSourceStats` интерпретирует `total_found` как increment, поэтому runtime значения ровно удваиваются: 1000 → 2000, 1647 → 3294, 288 → 576.

**Решение:** отдельные методы `setRunCounters` и `incrementRunCounter`; запретить неявную семантику «некоторые поля set, некоторые increment».

### P1. Phase 2 теряет Phase 1 totals

При `phase='details'` локальные `total` и `preFiltered` остаются 0, поэтому финальный лог всегда вида `FINAL: total=0 ... preFiltered=0`. Метрики неполны и вводят в заблуждение.

**Решение:** сохранять вместе с items manifest `{runId, source, counters, checksum, schemaVersion}` и читать его в Phase 2.

### P1. `/tmp` JSON — ненадёжная граница между фазами

`parse-handler.ts:40-45, 123-131, 169-180`:

- sync FS в async worker;
- write error логируется, но scan всё равно объявляется success;
- при restart/container migration файл теряется;
- details при отсутствии файла тихо обрабатывает 0 items и возвращает success;
- нет checksum/schema version/TTL cleanup;
- один host является скрытым обязательным условием.

**Решение:** хранить scan items в queue/run DB или отдельной staging table; минимум — atomic temp write + rename, checksum, manifest и hard failure при отсутствии expected artifact.

### P1. N+1 existence checks

Каждый item делает отдельный HTTP GET в Strapi, затем `createProperty` делает проверку повторно. При depth=1000 это тысячи запросов.

**Решение:** bulk endpoint `POST /internal/properties/existing-keys` или staging/upsert; получить Set existing IDs одним/несколькими chunked запросами. DB UNIQUE остаётся последней гарантией.

### P1. Нет timeout/retry policy у native fetch

Strapi client и часть JSON parsers используют `fetch()` без AbortSignal. Один зависший socket может остановить worker; stale recovery затем создаёт дубль.

**Решение:** общий `fetchWithPolicy`:

- connect/headers/body timeout;
- retry только idempotent GET на network/429/5xx;
- `Retry-After`, jitter и per-source budgets;
- response size limit;
- typed errors (`Transient`, `RateLimited`, `Blocked`, `SchemaChanged`, `Permanent`).

### P1. Ошибки слишком часто превращаются в «успешный пустой результат»

Примеры:

- Fedresurs catch возвращает `[]` (`fedresurs.ts:79-85`);
- некоторые category/page catches продолжают run;
- scan artifact write error не фейлит stage;
- missing scan file = success/0;
- `fetchDetails` часто возвращает `{}` после DOM/network error.

**Решение:** run outcome должен быть `success`, `success_empty`, `degraded`, `blocked`, `schema_changed`, `failed`. Пустой результат не считается success без источникового empty-proof.

### P1. Smart stop семантически слаб

10 последовательных существующих объектов могут встретиться перед новым объектом, особенно при нескольких сортировках/категориях. Stop основан на порядке выдачи, который не формализован.

**Решение:** smart stop включать только для источников с доказанным newest-first order и `published_at/external monotonic key`; иначе сканировать заданную глубину.

### P1. `minimum_price` используется неверно

По предметной модели `minimum_price` — нижняя цена публичного предложения и должна заполняться только там, где источник действительно даёт это поле. В проекте договорённость: **minimum_price — задача m-ets**.

Сейчас начальная цена ошибочно записывается как minimum в:

- `aggregator-bankrot.ts:262-271, 301-311`;
- `alfalot.ts:226-239, 264-275`;
- `etprf.ts:237-245, 277-284`;
- `fabrikant.ts:256-274`.

Production подтверждает ложные значения: minimum_price присутствует у aggregator-bankrot, alfalot и etprf.

**Решение:** удалить эти mappings, сделать поля `start_price`, `current_price`, `minimum_public_offer_price` явными; `minimum_price` маппить только из подтверждённого source field.

### P2. Нечёткая доменная классификация

`isCommercialProperty` доверяет типам `apartment` и `land` как коммерческим (`strapi-client.ts:52-55`), а часть source parsers включает жилые/земельные категории. Это может быть намеренным расширением продукта, но сейчас название, правила и UI не формализуют его.

**Решение:** зафиксировать product taxonomy: какие property types допустимы, какие комбинации (здание+земля) сохраняются, как обрабатываются доли и жильё. Покрыть decision table тестами.

---

## 5. Аудит каждого parser adapter

Низкая конверсия национальной площадки при строгом фильтре `Москва + цена + площадь` сама по себе **не является багом**. Ниже отделены ожидаемые фильтры от реальных технических проблем.

| Источник | Последний runtime | Состояние | Основные выводы и действия |
|---|---|---|---|
| **aggregator-bankrot** | scan 503, details 208; поздние side effects после `done` | Работает, затронут duplicate execution | Удалить ложный `minimum_price`; `pageNewCount` не используется; depth не обрезается строго; добавить DOM contract fixture и run-scoped counters |
| **alfalot** | scan 1647, details 254; часть объектов создана | Работает | `MAX_AGE_HOURS` объявлен, но не используется; depth считается страницами и может дать >depth; начальная цена ошибочно идёт в minimum; fixture должен покрывать SPA hydration и пустую карточку |
| **etprf** | scan 1000, details 651, created мало из-за strict filter | Работает, очень дорогой Phase 2 | Нет `seenIds`; после click нет ожидания смены page fingerprint; 651 последовательный detail fetch занимает десятки минут; начальная цена ошибочно идёт в minimum; сначала фильтровать город/тип по listing/API, где возможно |
| **fabrikant** | scan 1000; strict prefilter оставил 17; created 0 | Работает, но duplicate job доказан | Исправить queue lease; selector `Показать ещё` проверять live-contract тестом; убрать ложный minimum; в логах stop-word `аренд` срабатывает на нерелевантные строки — вести reason metrics, а не считать это parser error |
| **torgi-gov** | scan 288, details 11, поздно созданы 11 | Работает, но finish semantics сломана queue race | `depth` применяется к каждому из 5 search queries, а не ко всему source; includes region 50, хотя run filter Москва; ранний stop считает «нет региональных matches», а не старые даты; добавить fetch timeout/schema validation и общий global limit |
| **sberbank-ast** | только 20 listing rows; log: `No next page button` | **Pagination всё ещё не работает в production** | Исправление scrollIntoView не решило selector; перейти с клика по символу `›` на наблюдение network/AJAX или API/page function; ждать изменения XML checksum; live test минимум 2 страницы |
| **roseltorg** | 0 карточек | **Вероятный DOM drift/blocked response** | Fallback selectors слишком широкие (`table`, `[class*=lot]`) и при этом runtime 0; сохранять sanitized HTML/screenshot при zero anomaly; проверить status/challenge/redirect; не считать 0 success без empty-proof |
| **m-ets** | scan 1000, details 408, часть создана | Основной источник minimum_price; затронут duplicate execution | Сохранить minimum только здесь; добавить `seenIds`; page error сейчас просто пропускает страницу; validate API response; timeout для browser-context fetch; configurable per-source pacing |
| **investmoscow** | scan 24; объекты создаются без detail phase | Работает | Сканируются аренда и акции/доли, которые затем отсекаются общими правилами; убрать нерелевантные categories на входе; Nuxt resolver depth=10 и эвристический поиск объектов нуждаются в payload fixture/schema anomaly alert |
| **invest-mosreg** | scan 6, 0 при фильтре Москва | Ожидаемо при city=moscow | Menu 287 = аренда; кадастровая стоимость не равна цене продажи и не должна участвовать как auction price без отдельной семантики; поле area «<100 = гектары» слишком эвристично — использовать unit metadata |
| **fedresurs** | Source inactive, но PM2 process online; не входит в health manifest | Конфигурационный drift | Остановить orphan process либо официально вернуть в manifest; Python failure не должен возвращать success-empty; `московск` ошибочно смешивает Москву и МО; EXCLUDE land отбрасывает building+land packages; сохранить disabled до proxy/IP strategy |

### Source-specific acceptance contract

Каждый adapter должен иметь одинаковый контракт:

1. `list()` возвращает нормализованные summaries и diagnostics;
2. `details()` возвращает typed partial, не `{}` без reason;
3. `validate()` проверяет обязательные поля и domain invariants;
4. `sourceHealth()` различает reachable/blocked/schema_changed/empty;
5. fixture tests для Phase 1 и Phase 2;
6. live canary на 1–2 страницы без записи в БД;
7. alarm, если baseline `listed > 0` внезапно стал 0 или key field completeness резко упала.

---

## 6. Очередь и pipeline

## 6.1 Дополнительные ошибки

### P1. `waitForQueues` ждёт глобальную пустоту queue, а не jobs текущего run

`pipeline/stages.ts:37-74` смотрит на общие pending/active counts queue и общие Source statuses. Чужой manual run может задержать pipeline или, наоборот, старый Source status завершит новый run.

**Решение:** ждать конкретные job IDs/idempotency keys текущего run, проверять их results/errors.

### P1. Нет deadline у wait loops

`waitForQueues`, analyze wait и digest wait могут работать бесконечно. Cancellation in-memory и не останавливает активный handler.

**Решение:** stage deadlines + persisted cancellation + heartbeat + explicit timeout outcome.

### P1. Phase 2 пропускается для adapters без fetchDetails

Если все активные adapters возвращают `detailsNeeded=0`, pipeline делает early return (`stages.ts:213-220`) и не даёт handler создать summaries. В смешанном run это маскируется тем, что другие sources имеют details.

**Решение:** разделить `items_to_persist` и `details_to_fetch`; Phase 2/persist должен выполняться даже при нуле detail requests.

### P1. Force analysis в pipeline работает неправильно

- базовый `where` сразу содержит `is_undervalued: null` (`stages.ts:307-308`);
- force reset выбирает только уже-null строки, а не проанализированные (`:319-331`);
- сбрасываются несуществующие/устаревшие поля `deviation`, `price_per_sqm_ref` вместо `deviation_percent`, `manual_price_per_sqm`.

В cron controller основной `is_undervalued` сбрасывается шире, но там остаются те же неверные имена полей (`cron.ts:70-96`). Два пути расходятся.

**Решение:** единый `AnalysisService.recalculate(filters)`; один корректный field map; удалить duplicate force-reset из controller.

### P1. Analyze progress не соответствует фильтру/run

Pipeline считает analyzed по **всем** `status=new` (`stages.ts:381-390`), а total относится только к выбранному filter subset. `/cron/analyze-progress` также глобален. UI может увидеть `done=true` до завершения jobs текущего пересчёта.

**Решение:** progress по job IDs/run ID; не вычислять его через глобальное состояние Properties.

### P1. Digest объявляется отправленным без проверки результата job

`stages.ts:443-462` ждёт только исчезновения pending/active и всегда возвращает `sent:true`; failed job также означает empty queue.

**Решение:** сохранить job ID, дождаться именно `completed`, проверить typed result `{sent, recipients, regularCount, hotCount}`; failed → pipeline `done_with_errors`.

### P1. `acquireLock` — read-then-write race

Два concurrent start могут оба увидеть idle. Manual `pipeline.analyze()`/`digest()` вообще могут обновлять общий pipeline state вне full-run lock.

**Решение:** атомарный DB compare-and-set либо отдельная run table с unique partial index для `status=running`.

### P2. Pipeline errors swallowed at top level

`run()` пишет state error, но не rethrow. Controller, запустивший async run, не получает завершение; это допустимо для background job, но нужен run resource и отдельный status/result endpoint.

---

## 7. Analyzer, focus engine и data model

### P1. MarketReference cache никогда не очищается в production

`analyzer/src/handler.ts` заявляет «очищается в начале batch», но `clearMrCache()` вызывается только тестами. Обновление эталона не применяется до рестарта analyzer.

**Решение:** cache TTL/version; invalidate при изменении MarketReference; очищать в начале run.

### P1. `no MarketReference` становится терминальным analyzed=false outcome

При отсутствии эталона объект получает `is_undervalued=false`, `deviation=0`. После добавления эталона обычный analyze его не возьмёт.

**Решение:** `analysis_status = pending|ok|no_reference|invalid_data|error`, `reference_id/version`; requeue `no_reference` при появлении/изменении эталона.

### P1. Транзакции фактически не используются

`focusEngine.ts:406-431` открывает `s.db.transaction(async ({}) => ...)`, но внутри вызывает глобальные `s.db.query`/`entityService`, не transaction-bound `trx`. Это не гарантирует одну транзакцию.

**Решение:** использовать transaction handle во всех queries; добавить rollback integration test.

### P1. Priority semantics противоречива

Код сначала документирует `1 = highest priority` (`:193-194`), затем для deviation выбирает **max priority number** (`:269-274`). Сейчас rules 1/2/3 случайно дают ожидаемое увеличение score вместе с threshold, но contract неверен и легко сломается.

**Решение:** определить одно правило: либо lower number wins, либо выбирать максимальный threshold/score независимо от priority. Покрыть overlapping thresholds тестом.

### P1. Threshold concepts смешаны

`threshold_percent` — порог рыночного отклонения, а frontend использует его как default `focus_score` threshold. Это разные единицы.

**Решение:** отдельные настройки:

- `undervaluation_threshold_percent`;
- `focus_score_threshold`;
- labels и API types, запрещающие подмену.

### P1. Rule ranges не покрывают порог 20–29%

Runtime rules начинаются с deviation 30, хотя setting threshold = 20 и label первого правила говорит о диапазоне 20–30. Объект может считаться undervalued при 20%, но не получить deviation score/tag.

**Решение:** хранить explicit `min/max` ranges либо вычислять score tier из threshold table; валидировать отсутствие gap/overlap.

### P1. Property events разрастаются orphan rows

Production: `property_events` = 14 957, relation rows к текущим properties = 87. После удаления Property relation очищается, но event rows остаются. `clearNew` не удаляет events.

**Решение:** cascade/delete events при property cleanup или хранить immutable event с explicit orphan retention policy; миграция удаляет orphan records.

### P2. Clear operation неатомарна и неверно считает photosDeleted

Фото удаляются до DB delete; ошибка БД оставит потерянные files. `fs.rm(..., force:true)` считается удалением даже если папки не было.

**Решение:** staged cleanup/job, transaction intent, real existence count, cleanup report.

---

## 8. Digest и notifications

### P1. Digest ограничен первыми 100 focus objects

`fetchFocus()` запрашивает `pageSize=100`, пагинации нет. При росте базы часть объектов не попадёт в digest.

**Решение:** server-side digest query по first_seen_at/run_id или полная pagination; дедуп по `last_digest_run_id`.

### P1. HTML строится из scraped strings без escaping

Title/tags/url попадают в HTML email. Даже если письмо отправляется одному пользователю, source content не является доверенным.

**Решение:** `escapeHtml` для текста, URL protocol/host validation, plain-text alternative.

### P1. Pipeline digest не подтверждает SMTP result

Исправляется вместе с job-result ожиданием.

### P2. Focus labels и thresholds расходятся

Regular section подписан как score 20–49, но query threshold 0 может включить score 0–19. Сделать категории в одном shared helper и тестировать границы 0/19/20/49/50.

---

## 9. Backend/API

### Сильные стороны

- контроллер Property уже тоньше, SQL focus вынесен в service;
- sort field whitelist и query placeholders защищают focus query от прямой SQL injection;
- parsing rules переиспользуются через shared package;
- content types и modules разделены достаточно понятно;
- CORS allowlist и basic rate-limit middleware присутствуют.

### Проблемы

1. **P0 auth perimeter** — см. раздел 3.
2. **P1 input validation** — custom controllers вручную делают `Number()/parseInt`, но нет единого Zod/schema validation; нужны limits для depth, pageSize, arrays, strings.
3. **P1 error disclosure** — часть controllers возвращает `err.message` клиенту; internal/network details не должны уходить наружу.
4. **P1 Nominatim** — нет timeout/cache для not-found; указан несуществующий contact email. Использовать корректный public contact `tirobots@yandex.ru`, cache success+negative result и policy-compliant rate limit.
5. **P1 photo serving path validation** — проверять `documentId`, `basename`, resolved path prefix и allowed extensions, не полагаться только на router params.
6. **P1 public queue stats** — раскрывает operational details и source status; закрыть operator role.
7. **P1 stats scalability** — часть агрегатов считает массивы в JS; перевести на SQL COUNT/GROUP BY.
8. **P2 raw row mapping** в focus service нужно закрепить contract tests; malformed tags JSON не должен ронять весь response.
9. **P2 orphan fedresurs process** — manifest/PM2/health должны иметь единый source of truth.
10. **P2 production git tree dirty** — на сервере untracked `api/package-lock.json`, `scripts/count-lines.sh`, `scripts/setup-systemd.sh`, `scripts/setup-vps.sh`. Deploy должен либо генерировать их вне repo, либо проверять clean tree.

---

## 10. Frontend

### Что хорошо

- Vue 3 Composition API, Pinia, composables и UI components;
- server-side focus search уже реализован;
- toast используется в большинстве важных действий;
- app production build проходит;
- adaptive layout, dark mode, skip link и базовые aria attributes;
- страницы/панели лучше декомпозированы, чем в ранних аудитах.

### P1. Recalculate может запустить scoring до завершения analysis

`PropertyFocusTab.vue:306-335`:

- POST `/cron/analyze` сам ждёт `pipeline.analyze`, поэтому дополнительный polling выглядит избыточным;
- polling ограничен 120 секундами;
- после таймаута код без проверки `done` запускает `/cron/score`;
- progress endpoint глобальный и может преждевременно показать done.

**Решение:** один backend run endpoint возвращает `runId`; frontend подписывается на run status и запускает следующий stage только по backend orchestration. Не оркестрировать analysis→score из браузера.

### P1. SSE fallback ненадёжен

`usePipeline` включает polling только если `EventSource.readyState === CLOSED`; на обычных errors EventSource часто остаётся CONNECTING. UI может остаться со stale state.

**Решение:** heartbeat timeout; reconnect counter/backoff; после N секунд без events включать polling независимо от readyState; один composable instance per screen.

### P1. Start/cancel/reset optimistic state и ошибки

- start не блокирует повторный click до ответа;
- cancel/reset местами обновляют локальное состояние даже при ошибке;
- Settings pipeline start всё ещё использует `alert()` (`SettingsView.vue:447-449`).

**Решение:** explicit command states `idle/submitting/accepted/failed`; toast; повторное получение authoritative status после каждой команды.

### P1. Request races в list/focus data

Rapid filters/search могут завершиться не по порядку; старый response перезапишет новый. Error не всегда очищается перед retry.

**Решение:** AbortController/request sequence token; `loading/error/empty/stale` state machine.

### P1. Dashboard threshold inconsistency

KPI «горячие» использует score ≥50, а top list запрашивается с threshold 20 и подписан как горячий. Либо threshold 50, либо название «В фокусе».

### P1. Deviation color semantics

`deviation > 0` означает дешевле рынка, но formatter/style ориентирован на отрицательные границы. В UI недооценённый объект может не получать правильную зелёную индикацию.

**Решение:** shared domain formatter с тестами на -20/0/+20/+50.

### P1. Empty city selection имеет неочевидную семантику

Frontend не отправляет `cities`, если ничего не выбрано; backend подставляет global settings. Пользователь ожидает либо validation error, либо «все города», но не скрытый fallback.

### P2. CSV экспорт ограничен 1000 records

Нужен server export job или pagination всех страниц; показывать реальное количество экспортированных строк.

### P2. Bulk update через `Promise.all`

При частичном failure UI не показывает, какие records обновились. Нужен backend bulk endpoint с per-item result/transaction policy.

### P2. Silent catches

- geocode и events в PropertyDetail;
- changelog fallback;
- некоторые polling retries.

Non-critical ошибки можно не показывать toast каждый раз, но UI должен иметь retry/stale indicator и telemetry.

### P2. Bundle size

Icon component динамически импортирует весь namespace `lucide-vue-next`, что мешает tree shaking и, вероятно, формирует chunk ~779 KiB.

**Решение:** явный icon registry/imports, route-level lazy loading и bundle analyzer. Цель — main chunk <500 KiB без ущерба UX.

### P2. Accessibility

Проверить focus trap/restore для lightbox и dialogs, keyboard navigation, aria-live для progress/bulk result; добавить automated axe smoke tests.

---

## 11. Тестирование и quality gates

### Текущие пробелы

1. Нет integration test на long-running queue job + stale recovery.
2. Нет test на cancel/timeout, который гарантирует отсутствие поздних side effects.
3. Нет pipeline tests, проверяющих run correlation, exact counters и digest ordering.
4. Нет полноценного fedresurs test.
5. Нет photo-fetcher SSRF/size/MIME tests.
6. Нет parser live canary suite; fixtures не обнаруживают текущие `roseltorg=0` и Sber page-2 failure.
7. Нет API auth matrix tests для custom routes.
8. App test suite сейчас red на одном stale assertion.
9. API build не является частью воспроизводимого root workspace workflow.
10. Dependency audit не проходит.

### Обязательный CI pipeline

1. secret scan;
2. install с lockfile (`npm ci`) для root/api/app;
3. typecheck;
4. root unit tests;
5. app unit tests;
6. API + app + all service builds;
7. queue/pipeline integration tests с temporary SQLite;
8. API auth/security tests;
9. parser fixture contract tests;
10. npm audit policy: fail на new high/critical, allowlist только с owner+expiry;
11. optional scheduled live parser canary без записи в production DB;
12. artifact/version consistency check.

---

## 12. Целевая архитектура

Не требуется немедленно переписывать AKLAB на Kafka/Redis/Postgres. Текущую схему можно стабилизировать на SQLite, если формализовать run model.

### 12.1 Parser adapter layers

```text
SourceAdapter
├── list(request, transport) -> ListingBatch + diagnostics
├── details(summary, transport) -> DetailsResult
├── normalize(raw) -> CandidateProperty
├── validate(candidate) -> ValidationResult
└── health() -> SourceHealth

Transport
├── HttpTransport (timeouts, retry, size limit, schema validation)
└── BrowserTransport (one context, page lifecycle, challenge detection)

Ingestion
├── bulk existing keys
├── DB unique upsert
├── run counters
└── rejection reasons
```

### 12.2 Run data model

```text
pipeline_runs
  id, trigger, mode, filters, status, started_at, finished_at, error_summary

pipeline_stage_runs
  run_id, stage, status, expected_jobs, completed_jobs, deadline_at

parser_run_sources
  run_id, source, scan_job_id, details_job_id,
  listed, eligible, existing, rejected, detail_ok, created, failed,
  status, heartbeat_at, diagnostics
```

Source перестаёт быть coordination bus. UI и SSE читают immutable/current run snapshot.

### 12.3 Queue lease model

```text
pending -> active(lease owner + expires)
active --heartbeat--> active
active --completed by owner--> completed
active --lease expired--> pending/failed
cancel_requested --worker acknowledges--> cancelled
```

---

## 13. План реализации

## Фаза 0 — заморозка инвариантов и regression tests

**Цель:** сначала воспроизвести критические ошибки тестами.

- [ ] Тест long parser job > stale threshold: handler вызывается один раз.
- [ ] Тест timeout/cancel: после terminal state новые rows не появляются.
- [ ] Тест DB unique `(source, external_id)`.
- [ ] Тест run-specific wait: чужая job не влияет на completion.
- [ ] Тест scan/details idempotency keys.
- [ ] Сохранить sanitized runtime fixtures для Sber, Roseltorg и ещё минимум одного Playwright source.

**DoD:** тесты падают на текущем коде и документируют observed production failure.

## Фаза 1 — P0 queue/pipeline correctness

- [ ] Временный hotfix stale timeout для parser queues.
- [ ] Lease + heartbeat + owner-aware completion.
- [ ] Per-queue/stage deadlines.
- [ ] Cooperative cancellation.
- [ ] Unique idempotency key в jobs.
- [ ] Pipeline ждёт конкретные job IDs/results.
- [ ] `done` только когда нет активных handlers текущего run.
- [ ] Digest получает только frozen run dataset либо запускается после confirmed completion.

**DoD:** повторный depth=1000 run не имеет attempts>1 без реального worker crash; DB остаётся неизменной после `done`.

## Фаза 2 — P0 security perimeter

- [ ] Route inventory с классами public/user/service/operator.
- [ ] Удалить `auth:false` с write/admin routes.
- [ ] JWT/role policy для UI.
- [ ] Service-token policy для ingestion/workers.
- [ ] Rate limit expensive endpoints.
- [ ] SSRF hardening photo-fetcher.
- [ ] Path validation photo serving.
- [ ] Security integration tests.

**DoD:** внешний unauthenticated client не может читать business data и запускать side effects; internal workers продолжают работать по service credentials.

## Фаза 3 — DB integrity и run telemetry

- [ ] Dedup migration и настоящий UNIQUE constraint.
- [ ] `pipeline_runs/stage_runs/parser_run_sources`.
- [ ] Убрать Source counters из coordination logic.
- [ ] Исправить double `total_found`.
- [ ] Разделить set/increment semantics.
- [ ] Очистить orphan property_events и добавить retention/cascade policy.
- [ ] Убрать `/tmp` artifact либо сделать durable staging.

**DoD:** counters сходятся с SQL facts; любой показатель можно объяснить через run ID.

## Фаза 4 — parser platform refactor

- [ ] Общий `fetchWithPolicy` и BrowserTransport.
- [ ] Typed source error/status taxonomy.
- [ ] Bulk existing keys/upsert.
- [ ] Строгий global depth contract.
- [ ] `minimum_price` только из подтверждённого поля m-ets.
- [ ] Source adapter contract + diagnostics.
- [ ] Per-source delay/concurrency configuration.
- [ ] Zero-result anomaly detection и evidence capture.

**DoD:** каждый parser выдаёт одинаковый diagnostic report; empty/degraded/failed различаются.

## Фаза 5 — точечный ремонт sources

Порядок:

1. [ ] Sberbank-AST pagination на 2+ реальных страницах.
2. [ ] Roseltorg zero-result root cause и новые selectors/API.
3. [ ] Etprf page fingerprint + dedup + ранний prefilter.
4. [ ] Fabrikant после queue fix, подтвердить один scan.
5. [ ] Alfalot/Aggregator/ETPRF/Fabrikant: убрать ложный minimum_price.
6. [ ] Torgi: global depth и source-region optimisation.
7. [ ] Investmoscow/Mosreg: убрать rent/equity категории и разделить cadastral/auction prices.
8. [ ] Fedresurs: остановить orphan process; возвращать только после proxy/IP plan.

**DoD каждого source:** Phase 1 и Phase 2 проверены на реальном DOM/API, fixture обновлена, counters и data completeness записаны.

## Фаза 6 — analyzer/focus/digest correctness

- [ ] Единый force recalculate service и правильные field names.
- [ ] Run-specific analyze progress.
- [ ] MarketReference cache TTL/invalidation.
- [ ] `analysis_status` и reference version.
- [ ] Исправить transaction-bound updates.
- [ ] Устранить priority ambiguity и rule range gap 20–29.
- [ ] Разделить undervaluation threshold и focus score threshold.
- [ ] Digest pagination/run dataset/result verification/HTML escaping.

**DoD:** изменение MarketReference воспроизводимо пересчитывает нужные records; digest count равен SQL count frozen run.

## Фаза 7 — frontend reliability

- [ ] Убрать browser orchestration analyze→score; использовать run API.
- [ ] SSE heartbeat/fallback polling.
- [ ] Command state machine и toast вместо alert.
- [ ] Abort stale list/filter requests.
- [ ] Исправить deviation colors и Dashboard threshold.
- [ ] Явная семантика пустого city filter.
- [ ] Server-side full CSV export и bulk endpoint.
- [ ] Bundle split/icon registry.
- [ ] Axe/keyboard tests.
- [ ] Исправить stale unit test; suite должна быть green.

## Фаза 8 — dependencies, CI и observability

- [ ] Обновить Strapi до patched 5.x с migration rehearsal.
- [ ] Устранить/allowlist npm audit findings с expiry.
- [ ] Воспроизводимый root command для install/build/test всех workspaces.
- [ ] Runtime alerts: source zero anomaly, blocked/rate-limit, run timeout, lease recovery, digest fail.
- [ ] Dashboard run history и rejection reasons.
- [ ] Health manifest = PM2 manifest = Source registry; убрать orphan process.
- [ ] Production clean-tree check.
- [ ] Обновить `compact-doc.md` с v1.1.64+ и актуальными инвариантами.

---

## 14. Quick wins

Эти задачи небольшие, но **не заменяют Фазы 1–2**:

- [ ] убрать второе increment-обновление `total_found`;
- [ ] убрать minimum_price из alfalot/aggregator/etprf/fabrikant;
- [ ] увеличить/отключить stale recovery для parser queues как временный guard;
- [ ] остановить orphan fedresurs PM2 process;
- [ ] исправить `alert()` в Settings на toast;
- [ ] исправить Dashboard top threshold/label;
- [ ] исправить deviation color sign;
- [ ] проверять digest job result;
- [ ] очистить stale app unit test;
- [ ] обновить contact email Nominatim;
- [ ] документировать, что production tree содержит untracked files, затем убрать drift отдельной операцией.

---

## 15. Что не стоит делать сейчас

1. **Не мигрировать сразу на Redis/BullMQ только ради исправления stale bug.** Сначала восстановить корректный lease/run contract и покрыть его тестами. Иначе race просто переедет в другую очередь.
2. **Не распараллеливать detail fetch до исправления idempotency и per-source rate limits.** Это усилит bans и гонки.
3. **Не доверять Source counters как источнику истины.** До run model сверять фактические Properties/jobs/logs.
4. **Не считать HTTP 200/PM2 online доказательством работоспособности parser.** Нужны source contract metrics и реальные Phase 1/2 samples.
5. **Не закрывать worker endpoints обычным user JWT.** Нужны разные trust domains: user и service.
6. **Не удалять strict Moscow/price filters ради увеличения количества объектов.** Высокий drop rate национальных площадок ожидаем; исправлять нужно correctness и observability.

---

## 16. Итоговый Definition of Done

Проект можно считать стабилизированным, когда одновременно выполняются условия:

- один logical job выполняется максимум одним worker в конкретный момент;
- retry происходит только после подтверждённой потери lease;
- `pipeline done` означает отсутствие поздних side effects;
- `(source, external_id)` уникален на уровне БД;
- UI, service и public routes имеют разные политики доступа;
- каждый source различает success-empty, degraded и failed;
- Sber проходит минимум 2 страницы, Roseltorg возвращает объяснимый результат;
- `minimum_price` не равен обычной начальной цене;
- Source/run counters сходятся с DB facts;
- force analysis реально пересчитывает уже analyzed records;
- MarketReference update не требует рестарта analyzer;
- digest подтверждает SMTP result и включает полный frozen dataset;
- root/app/API builds и обе unit suites green;
- high/critical dependency findings устранены либо имеют ограниченный allowlist с датой истечения;
- scheduled runtime monitoring сообщает о zero-result anomaly, block/rate-limit, run timeout и digest failure.

---

## 17. Рекомендуемый фактический порядок ближайших работ

1. Queue lease/stale hotfix + regression test.
2. DB UNIQUE + queue idempotency key.
3. Run-specific completion/progress.
4. Auth perimeter + SSRF protection.
5. Sber/Roseltorg live fixes.
6. `minimum_price` cleanup и data migration.
7. Analyzer/focus/digest correctness.
8. Frontend run orchestration.
9. Strapi dependency upgrade.
10. Observability и документация.

Именно такой порядок минимизирует повторную работу: сначала восстанавливается надёжный execution substrate, затем исправляются adapters и бизнес-логика поверх него.
