# Implementation Plan: AKLAB Multi-user — персональные фильтры, состояния и дайджесты

**Статус:** согласованная спецификация для реализации; код в рамках составления плана не меняется.

## 1. Цель и критерии готовности

Реализовать multi-user режим без дублирования канонических объектов и без повторного обхода одного источника для каждого пользователя:

- `Property` остаётся одной общей канонической записью.
- У каждого пользователя есть собственный профиль фильтров и email-дайджеста.
- Cron pipeline один раз сканирует каждый источник и сохраняет объект, если он подходит хотя бы одному активному пользовательскому профилю.
- Ручной полный pipeline AKLAB Admin запускает только для выбранного пользователя.
- Каталог, dashboard, focus, статусы и комментарии изолированы по текущему JWT-пользователю.
- Персональная видимость `Property` вычисляется динамически; отдельные связи «объект назначен пользователю» не сохраняются.
- Персональные рабочие состояния сохраняются только при взаимодействии пользователя.
- После общего cron run создаётся отдельная digest-job для каждого пользователя с включённым дайджестом.
- Публичным остаётся только health-контур; пользовательские данные, события, настройки, pipeline telemetry и фотографии требуют авторизации.
- Заблокированный пользователь не входит в snapshot, не получает дайджест и не может войти; его данные сохраняются. Hard delete пользователя запрещён до отдельной управляемой процедуры.

## 2. Зафиксированные продуктовые решения

### 2.1 Общие и персональные данные

**Общие:**

- `Property` и результаты анализа: `focus_score`, `is_undervalued`, `deviation_percent`, теги, эталоны, фото и source metadata.
- Источники и их включённость.
- `parse_depth`, общий график pipeline/digest, глобальный порог анализа, retention.
- Технические hard filters: валидность, dedup, source safety, отсечение заведомо неподдерживаемых объектов.

**Персональные:**

- регионы;
- типы недвижимости;
- цена от/до;
- площадь от/до;
- стоп-слова;
- `digest_email`;
- `digest_enabled`;
- статус объекта: `new`, `in_progress`, `viewed`, `rejected`;
- комментарии.

Выбор источников и минимальный `focus_score` не входят в персональный профиль v1. Порог focus остаётся общим, но пользовательские экранные фильтры могут дополнительно сужать выдачу.

### 2.2 Defaults нового пользователя

- все поддерживаемые регионы;
- все поддерживаемые типы;
- цена и площадь без ограничений;
- пустой список персональных стоп-слов;
- `digest_enabled=false`, пока не задан валидный `digest_email`;
- как минимум один регион и один тип обязательны при сохранении профиля;
- новый пользователь сразу видит всю сохранённую историю в пределах общего retention, подходящую текущему профилю;
- в письмо попадают только подходящие объекты за последние 24 часа.

### 2.3 Роли

- Создание аккаунтов остаётся в Strapi Admin Panel; публичной регистрации нет.
- Добавляется Users & Permissions role `AKLAB Admin`.
- Обычный пользователь редактирует только свой профиль.
- AKLAB Admin может просматривать и редактировать любой профиль, управлять глобальными правилами, источниками, эталонами и pipeline.
- Текущий основной пользователь назначается `AKLAB Admin` миграцией через обязательный параметр `--target-user-email`.

## 3. Целевая модель данных

### 3.1 `user-profile`

Создать `api/src/api/user-profile/content-types/user-profile/schema.json`:

- `user`: one-to-one → `plugin::users-permissions.user`, required;
- `user_id`: integer required/unique — scalar ownership key для DB-level uniqueness и fail-closed запросов;
- `regions`: JSON string array;
- `property_types`: JSON string array;
- `price_from`, `price_to`: decimal nullable;
- `area_from`, `area_to`: decimal nullable;
- `stop_words`: JSON string array;
- `digest_email`: email nullable;
- `digest_enabled`: boolean default false;
- `profile_version`: integer default 1.

Не полагаться только на JSON/schema validation Strapi. Все записи проводить через один профильный сервис с Zod-валидацией:

- enum для регионов и типов;
- непустые и дедуплицированные массивы;
- `from <= to`;
- неотрицательные диапазоны;
- trim/lowercase/dedup стоп-слов, затем не более 128 canonical unique значений и не более 256 символов в каждом значении; ровно 128/256 допустимо, 129/257 отклоняется;
- `digest_enabled=true` допустим только с валидным `digest_email`;
- `profile_version` увеличивается при каждом содержательном изменении;
- update выполняется optimistic DB predicate по scalar `id + profile_version`; pre-read comparison без version в `where` недостаточен, а zero-row update возвращает typed conflict и не считается успехом.

### 3.2 `user-property-state`

Создать `api/src/api/user-property-state/content-types/user-property-state/schema.json`:

- `user`: many-to-one → `plugin::users-permissions.user`, required;
- `property`: many-to-one → `api::property.property`, required;
- `user_id`: integer required — scalar ownership key;
- `property_document_id`: string required — стабильный scalar identity объекта;
- `identity_key`: string required/unique, канонический `${userId}:${propertyDocumentId}`;
- `status`: enum `in_progress | viewed | rejected`, required;
- индексы `(user_id, status)` и `property_document_id`.

В текущем Strapi 5 relation-поля физически хранятся в `*_lnk` таблицах, поэтому content-type `indexes` не может честно обеспечить составную уникальность двух relations. DB-инвариант `user + property` обеспечивает unique `identity_key`; scalar keys и relation links создаются/обновляются только одной приватной service-функцией в одной транзакции. Core CRUD для профилей/states не публикуется. Migration и tests обязаны проверять отсутствие расхождений scalar keys ↔ relation links.

Сделать таблицу разреженной:

- отсутствие строки означает `status=new`;
- установка `new` удаляет существующую строку;
- остальные статусы записываются атомарным upsert;
- никаких глобальных изменений `Property.status` из пользовательского API.

Физическое поле `Property.status` в первой версии не удалять: сохранить для rollback и миграционной проверки, но после cutover не использовать в пользовательских read/write-контрактах.

### 3.3 Комментарии и события

Обновить `api/src/api/user-comment/content-types/user-comment/schema.json` двухфазно:

- в additive schema добавить nullable relation `author` → `plugin::users-permissions.user`;
- закрыть generic comment writes, выполнить transactional backfill и проверить `comments_without_author=0`;
- только после backfill gate включить application-level required invariant в ownership-safe controller; не делать relation schema-required до совместимой миграции существующих rows;
- оставить relation на `Property`;
- чтение/создание/изменение/удаление разрешать только автору;
- AKLAB Admin не получает неявный доступ к чужим комментариям через обычный пользовательский endpoint.

`PropertyEvent` оставить общим для событий канонического объекта и анализа. `status_changed` больше не создавать как глобальное событие. Историю пользовательских статусов в v1 отдельно не вести: достаточны `createdAt/updatedAt` состояния.

### 3.4 Pipeline telemetry

Расширить `api/src/api/parser-run/content-types/parser-run/schema.json` и `api/src/services/pipeline/state.ts`:

- `profile_scope`: `all | single | none`;
- `target_user_id`: nullable;
- `filter_snapshot`: JSON;
- `filter_snapshot_hash`: string;
- `filter_snapshot_schema_version`: integer;
- digest counters: `scheduled`, `sent`, `skipped`, `failed`.

Snapshot должен сохраняться полностью, а не только hash, чтобы run был воспроизводим и аудируем.

### 3.5 Текущий `Setting`

Оставить singleType как глобальную конфигурацию:

- продолжить использовать `parse_depth`, `threshold_percent`, `digest_time` и технические параметры;
- перестать читать из него `smtp_to`, `digest_enabled`, `monitored_regions`, `price_from/to`, `area_from/to`, `stop_words` после cutover;
- legacy-поля в этой волне не удалять: мигрировать их основному пользователю и оставить для rollback;
- пометить legacy-поля в коде и документации как deprecated.

## 4. Единый контракт фильтров и snapshot

Расширить `lib/parse-rules/src/index.ts` вместо создания второй расходящейся библиотеки.

Добавить контракты:

```ts
interface UserParseProfile {
  userId: number
  profileId: number
  version: number
  regions: Region[]
  propertyTypes: PropertyType[]
  priceFrom: number | null
  priceTo: number | null
  areaFrom: number | null
  areaTo: number | null
  stopWords: string[]
}

interface UserFilterSnapshot {
  schemaVersion: 1
  scope: 'all' | 'single'
  createdAt: string
  windowEndAt: string
  profiles: UserParseProfile[]
  hash: string
}
```

Правило объединения — дизъюнкция целых профилей, а не объединение отдельных полей:

```text
profileMatches = region AND propertyType AND price AND area AND stopWords
matchesSnapshot = profileA OR profileB OR ...
```

Обязательные тесты:

- профиль «Москва до 20 млн» плюс «МО от 50 млн» не даёт ложных пересечений;
- объект, подходящий двум профилям, обрабатывается один раз;
- персональные стоп-слова одного пользователя не отсекают объект для другого;
- отсутствующие на Phase 1 поля не дают false negative; после details выполняется повторная проверка;
- empty snapshot завершает parse stage без запуска источников и без ошибки;
- канонизация JSON стабильна, hash детерминирован и не зависит от порядка ключей;
- snapshot не содержит email, username и другие лишние персональные данные.

## 5. Последовательность реализации

### Task 1. Добавить RED-тесты контракта профилей

**Файлы:**

- `lib/parse-rules/src/index.ts`;
- новый `lib/parse-rules/src/index.test.ts` или подключённый Vitest test target;
- `lib/parse-rules/package.json` — добавить реальный `test` script, если выбран Vitest.

Сначала зафиксировать в тестах OR-семантику, границы диапазонов, enums, stop words, unknown fields и hash. Затем реализовать минимальные pure-функции и собрать library. Legacy permissive contract для property data сохраняется: если `city/property_type/price/area/text` реально отсутствует (`undefined` или `null` в parser/Strapi payload), само отсутствие не отсекает объект ни на scan, ни на details; если поле присутствует и non-null, тип/значение валидно и должно соответствовать профилю. Fail-closed относится к пустому/невалидному профилю, ID/version/range, scope/cardinality, duplicate profile identity, snapshot hash/version и повреждённому payload, а не к отсутствующим данным самого объявления.

### Task 2. Добавить additive schemas и индексы

**Файлы:**

- новые `api/src/api/user-profile/**`;
- новые `api/src/api/user-property-state/**`;
- `api/src/api/user-comment/content-types/user-comment/schema.json`;
- `api/src/api/parser-run/content-types/parser-run/schema.json`;
- `api/src/api/property/content-types/property/schema.json` — только обратные relations/индексы, без удаления legacy status.

Требования:

- все изменения схемы additive;
- уникальность `user + property` проверяется БД через канонический unique `identity_key`, поскольку relations хранятся в link tables;
- schema tests и migration verification проверяют scalar keys, relation links и отсутствие drift;
- не создавать профиль или state через публичные core CRUD routes.

### Task 3. Создать actor, role и policy слой

**Файлы:**

- `api/src/policies/authenticated-user.ts`;
- новый `api/src/policies/aklab-admin.ts`;
- при необходимости новый `api/src/services/request-actor.ts`;
- `api/src/seeders/permissions.ts`;
- `api/src/index.ts`.

Реализовать два явных actor type:

- пользователь с JWT и Users & Permissions role;
- внутренний service actor с существующим `STRAPI_API_TOKEN`, проверяемым текущей `global::service-token` policy; второе имя секрета не вводить.

AKLAB Admin policy должна проверять фактическую роль из БД, а не доверять role из request body/localStorage. Маршруты должны различать user JWT и service actor; обычный пользователь не может выдать себя за другого через `userId` в query/body.

Idempotent seeder создаёт роль `AKLAB Admin`, но не назначает её произвольному пользователю. Назначение выполняет миграционная команда по email.

### Task 4. Создать единый профильный сервис

**Новые файлы:**

- `api/src/services/user-profile.ts`;
- `api/src/services/user-filter-snapshot.ts`;
- unit tests рядом с сервисами.

Операции:

- `ensureProfile(userId)` с согласованными широкими defaults;
- `getMyProfile(actor)`;
- `updateMyProfile(actor, input)`;
- admin list/get/update профилей;
- `buildAllActiveSnapshot()` только по exact active users (`blocked=false`, `confirmed=true`) независимо от `digest_enabled`; missing/null/string active flags fail-closed;
- `buildSingleUserSnapshot(targetUserId)` только для exact active пользователя (`blocked=false`, `confirmed=true`);
- канонизация и SHA-256 snapshot;
- текущий профиль меняется сразу для UI, но активный pipeline продолжает использовать сохранённый snapshot.

Добавить lifecycle subscription на `plugin::users-permissions.user`:

- `afterCreate`: idempotent `ensureProfile`;
- `beforeDelete/beforeDeleteMany`: блокировать hard delete и объяснять, что аккаунт нужно блокировать;
- bypass/operational override для hard delete не добавлять: rollback не удаляет additive данные и выполняется откатом exact SHA.

### Task 5. Добавить безопасную миграционную команду

**Новые файлы:**

- `api/scripts/migrate-multiuser.js` либо существующий принятый в проекте scripts pattern;
- тест/fixture для dry-run и повторного запуска;
- npm scripts `multiuser:audit` и `multiuser:migrate`.

CLI contract:

```bash
npm run multiuser:audit -- --target-user-email=<email>
npm run multiuser:migrate -- --target-user-email=<email> --backup=<path>
```

Поведение:

1. Проверить наличие ровно одного target user.
2. Проверить schema/version и отсутствие дубликата role/profile.
3. Показать без секретов: количество users, properties по legacy status, comments без author, states/profiles до миграции.
4. Создать профиль основного пользователя из legacy `Setting`:
   - regions, ranges и stop words;
   - все типы недвижимости;
   - `smtp_to` → `digest_email` только если это один валидный адрес; неоднозначный список требует ручного решения;
   - `digest_enabled` переносится только при валидном email.
5. Создать широкие defaults для остальных существующих пользователей.
6. Создать `UserPropertyState` только для legacy `status != new` основного пользователя.
7. Привязать существующие комментарии к основному пользователю.
8. Назначить основному пользователю `AKLAB Admin`.
9. Выполнить всё транзакционно и idempotent; повторный запуск не дублирует данные.
10. Сверить before/after counts и записать machine-readable отчёт без PII/секретов.

Не очищать legacy `Setting`, `Property.status` и старые relations в этой волне.

### Task 6. Реализовать централизованный user property scope

**Новый файл:** `api/src/services/user-property-scope.ts`.

Все пользовательские выборки должны использовать один scope builder:

- профиль: regions, types, price, area, stop words;
- запрос пользователя может только сузить профильный scope, но не расширить его;
- отсутствующая цена/площадь сохраняет текущую permissive-семантику parser rules;
- stop words проверяются по нормализованным title + description параметризованным SQL/Query Builder без интерполяции;
- личный статус вычисляется как `COALESCE(user_property_state.status, 'new')`;
- detail по `documentId`, не подходящий профилю, возвращает 404, а не 403, чтобы не подтверждать существование объекта;
- service actor получает отдельный явно unscoped path, не пользовательский scope.

Scope repository должен fail closed и иметь один SQL/DTO contract для list/count/detail/focus/stats/digest:

- параметризованный SQLite/Query Builder без string interpolation и без fallback на unscoped query;
- scalar profile predicates и join `user_property_states.user_id + property_document_id` применяются до pagination;
- stop words используют `LOWER(COALESCE(title,''))`/`description`, экранируют `%`, `_` и escape-char;
- list и count выполняют один и тот же predicate; application-side post-filter после pagination запрещён;
- user DTO строится allowlist-ом и не включает inverse states, profile IDs, authors или чужие relations;
- произвольный `populate` от user JWT запрещён.

Добавить индексы для profile predicates и state join; измерить query plan на production-like SQLite fixture. Не дублировать правила между list/focus/stats/digest.

### Task 7. Перевести Property API на персональный контракт

**Файлы:**

- `api/src/api/property/controllers/property.ts`;
- `api/src/api/property/services/property.ts`;
- `api/src/api/property/routes/property.ts`;
- `api/src/services/buildPropertyWhere.ts` и тесты;
- `api/src/api/property-event/controllers/property-event.ts` и routes.

Изменения:

- `find`, `findOne`, `focus`, `stats` и CSV data всегда scoped по JWT-профилю;
- `status` в response — виртуальный персональный status;
- user JWT не может изменять канонические поля `Property`;
- canonical create/update/delete доступны только service actor или отдельному AKLAB Admin operational endpoint;
- `clear-new` удалить из пользовательского контракта: физически удалять общие объекты по личному статусу нельзя;
- глобальную retention cleanup сделать отдельной admin/cron операцией, если она нужна;
- `PropertyEvent` отдавать только после проверки доступности связанного объекта текущему пользователю;
- photo/geocode/fetch endpoints также проверяют scope объекта.

При `MULTIUSER_ENABLED=true` legacy generic Property/PropertyEvent routes не должны оставаться параллельным обходом:

- user-facing list/detail/focus/stats работают только через custom scoped controllers и allowlist DTO;
- core update/delete/create, generic populate, `clear-new` и unscoped event reads для обычного JWT отключены;
- internal service routes имеют отдельный `/internal/*` path и только `global::service-token` policy;
- ownership/scope predicate входит в DB query до чтения/изменения; post-filter уже загруженной чужой записи запрещён.

### Task 8. Реализовать персональные статусы и комментарии

**Файлы:**

- custom controllers/routes для `user-property-state`;
- custom controllers/routes для `user-comment`;
- tests на ownership и cross-user denial.

Контракты:

- `PUT /api/me/properties/:documentId/status` → upsert/delete sparse state;
- batch endpoint для bulk status вместо N параллельных PUT;
- `GET/POST/PUT/DELETE /api/me/properties/:documentId/comments...` только для автора и только если property входит в текущий profile scope;
- relation `author` всегда берётся из `ctx.state.user`, никогда из body;
- required `author` schema не деплоится без backward-compatible create controller: даже при `MULTIUSER_ENABLED=false` legacy create получает author из проверенного JWT, поскольку старый frontend его не отправляет;
- существующие comments без author до migration не выдаются новым scoped read path; cutover запрещён до полного backfill и orphan=0;
- пользователь A не видит и не меняет status/comment пользователя B;
- блокировка пользователя сохраняет rows, но исключает доступ.

### Task 9. Снять immutable snapshot при старте pipeline

**Файлы:**

- `api/src/services/pipeline/index.ts`;
- `api/src/services/pipeline/state.ts`;
- `api/src/services/pipeline/stages.ts`;
- `api/src/api/pipeline/controllers/pipeline.ts`;
- `api/src/cron/index.ts`.

Режимы:

- cron: `buildAllActiveSnapshot()`; `scope='all'` может содержать пустой `profiles`, что означает no-op;
- manual admin: обязательный `targetUserId`, `buildSingleUserSnapshot()`; если целевой профиль не ready/пустой, builder возвращает `null`, parser run получает `profile_scope='none'` и terminal `done`, а не невалидный пустой `scope='single'` snapshot;
- произвольные `filters` из request body удалить;
- `depth` брать из глобального Setting либо валидированного admin input;
- snapshot записать в parser run и pipeline state до постановки первой job;
- queue jobs получают snapshot/hash как immutable input;
- профиль, изменённый во время run, применяется только со следующего pipeline;
- если snapshot пуст, terminal state должен быть успешным `done` с объяснением, без обхода источников.

Pipeline control/telemetry contract:

- `start/cancel/reset/status` доступны только AKLAB Admin; обычный JWT не видит pipeline telemetry и `filter_snapshot`;
- `targetUserId` принимается только после server-side admin check и повторной проверки target `blocked=false`;
- service actor использует отдельные internal endpoints, а не OR-auth на пользовательском route;
- `filter_snapshot` хранится для server-side audit, но user/admin response по умолчанию отдаёт только hash/scope/counters без полного profile payload.

### Task 10. Перевести Phase 1/Phase 2 на OR профилей

**Файлы:**

- `services/_shared/src/parse-handler.ts`;
- `services/_shared/src/strapi-client.ts`;
- `api/src/services/pipeline/stages.ts`;
- `services/_shared/src/scan-artifact.ts` и schema/tests;
- адаптеры только там, где они формируют несовместимые candidate поля.

Phase 1:

- технический global hard filter;
- `profiles.some(profileMatchesCandidate)`;
- существующий global dedup остаётся до создания canonical `Property`;
- один объект не добавляется в artifact повторно, даже если совпал с несколькими профилями.

Phase 2:

- загрузить детали один раз;
- повторить `profiles.some(profileMatchesDetails)`;
- создать одну canonical `Property` только при совпадении хотя бы с одним snapshot profile.

Artifact contract:

- bump schema version;
- добавить `filterSnapshotHash` и scope metadata без email/username;
- details stage отклоняет artifact/job при несовпадении hash/version;
- checksum и атомарная запись остаются обязательными;
- details retry повторно читает тот же validated artifact: удалять artifact сразу после чтения запрещено;
- artifact удаляется только после успешного terminal completion details stage либо отдельной verified cleanup-процедурой после исчерпания retry; ошибка после чтения не должна уничтожать handoff.

Проверить все service-token вызовы после закрытия публичных routes. Внутренние parser/analyzer/photo-worker операции не должны случайно попасть под персональный JWT scope.

### Task 11. Сделать digest fan-out

**Файлы:**

- `services/digest/src/handler.ts`;
- `services/digest/__tests__/handler.test.ts`;
- `api/src/services/pipeline/stages.ts`;
- queue job types/shared validation.

После анализа:

1. Взять `userId` из immutable run filter snapshot; email и delivery flags в snapshot и scan-artifact не сохранять.
2. Для каждого `userId` непосредственно перед постановкой/выполнением отправки загрузить текущие `blocked`, `digest_enabled` и `digest_email`. Если пользователь заблокирован, выключил дайджест или не имеет валидного email — зафиксировать `skipped` и не выполнять side effect.
3. Для отбора объектов использовать именно фильтры пользователя из сохранённого run snapshot, поэтому изменение регионов/типов/ranges/stop words во время pipeline применяется только со следующего run. Изменение `digest_enabled` или email действует сразу как delivery safety control.
4. Создать отдельную job с idempotency key `${runId}:digest:${userId}`.
5. Digest query выполняется через internal API/service actor с `X-AKLAB-Service-Token` (и только документированным compatibility bearer при необходимости), получает и валидирует filter profile из run snapshot; используется тот же property scope, фиксированное окно `windowEndAt - 24h <= first_seen_at < windowEndAt` и фактический глобальный `Setting.threshold_percent`, а не hardcoded `0` или текущее время worker-а.
6. Job не логирует email полностью; использовать masked recipient.
7. Результаты агрегируются в `scheduled/sent/skipped/failed`; ошибка одного получателя не отменяет письма остальным, но приводит к `done_with_errors`.
8. Cron обрабатывает всех пользователей из `all` snapshot.
9. Manual single-user run рассматривает только выбранного пользователя.

Не читать `Setting.smtp_to` и `Setting.digest_enabled` после cutover.

`first_seen_at` в v1 означает глобальную новизну canonical Property. Если новый/изменённый профиль впервые начинает видеть старый объект вне зафиксированного 24-часового окна, такой объект доступен в UI как персонально необработанный, но не попадает в digest задним числом. Per-user `first_visible_at`/cursor отложен и не должен возникнуть неявно.

### Task 12. Закрыть API и медиа

**Файлы:** все custom routes/policies, `api/src/seeders/permissions.ts`, media controller/storage service.

Политика:

- публичные: `/_health` и явно утверждённые worker health endpoints;
- login остаётся штатным Strapi endpoint;
- properties, settings, profiles, comments, events, stats, sources, rules, market references, parser runs, pipeline status/cancel/reset/stream требуют JWT или явного service actor;
- глобальные mutations и telemetry — только AKLAB Admin;
- убрать public read permission на `Setting`, `Property`, `PropertyEvent` и другие data endpoints;
- CORS не считать механизмом авторизации.

Закрытие выполняется атомарно с включением flag: новые scoped routes не считаются готовыми, пока legacy generic routes дают тот же data surface. `Property.user_states`, `UserComment.author`, parser snapshot и иные ownership/telemetry relations никогда не сериализуются через generic populate; user DTO — только allowlist.

Фотографии:

- прекратить отдавать property photos из публичного static root;
- использовать persistent private root через env, вне immutable release и web root;
- отдавать файл через `GET /api/properties/:documentId/photos/:photoId` после JWT + property scope check;
- защита от path traversal, allowlist MIME, private cache headers;
- фронтенд загружает blob через Axios с Bearer JWT и освобождает ObjectURL;
- существующие фото копировать/переносить отдельной проверяемой migration step с counts/checksums; исходники не удалять до acceptance.

Pipeline SSE:

- нативный `EventSource` не передаёт Authorization header;
- в v1 закрыть `/pipeline/stream` и использовать авторизованный polling `/pipeline/status` только в admin UI;
- не передавать JWT в query string;
- fetch-stream можно вынести в будущую оптимизацию.

### Task 13. Обновить frontend auth и role gating

**Файлы:**

- `app/src/stores/auth.ts` и tests;
- `app/src/router/index.ts`;
- `app/src/api/strapi.ts`;
- `app/src/App.vue`;
- `app/src/components/Footer.vue`.

Изменения:

- `/users/me?populate=role` или отдельный безопасный `/me/context` возвращает роль и профиль readiness;
- computed `isAklabAdmin`;
- router meta `requiresAdmin` и guard для admin views;
- 403 не разлогинивает пользователя; 401 очищает сессию;
- menu/footer не показывают admin links обычному пользователю;
- role hiding — только UX, серверные policy остаются источником истины.

### Task 14. Разделить «Мои настройки» и «Системные настройки»

**Файлы:**

- переработать `app/src/views/SettingsView.vue`;
- переработать `app/src/components/settings/ParsingRulesPanel.vue`;
- новые `UserProfileForm.vue`, `AdminUserProfilesPanel.vue`, при необходимости `SystemSettingsPanel.vue`;
- component/unit tests.

Обычный пользователь видит:

- регионы, типы, price/area ranges, stop words;
- digest email и digest enabled;
- logout.

AKLAB Admin дополнительно видит:

- список профилей и редактирование выбранного профиля;
- глобальные parse depth/digest time/threshold;
- источники, общие rules и market references;
- pipeline controls.

Форма валидирует те же ограничения, но API повторно валидирует всё. Текущие смешанные поля `Setting` не должны случайно перезаписывать персональный профиль.

### Task 15. Персонализировать dashboard, списки и detail

**Файлы:**

- `app/src/views/DashboardView.vue`;
- `app/src/views/PropertyListView.vue`;
- `app/src/views/PropertyDetailView.vue`;
- `app/src/components/properties/PropertyAllTab.vue`;
- `app/src/components/properties/PropertyFocusTab.vue`;
- `app/src/composables/usePropertyData.ts`;
- связанные tests.

Изменения:

- dashboard stats/hot/new/type breakdown приходят только из scoped API;
- UI-фильтры дополнительно сужают профиль, не заменяют его;
- вкладки «Все», «В работе», «В фокусе» используют виртуальный личный status;
- `clear-new` и физическое удаление общих объектов убрать из обычного UI;
- status change и bulk status вызывают новые персональные endpoints;
- comments загружаются отдельным ownership-safe endpoint, не через произвольный `populate=comments`;
- global property events отображаются только после scoped detail access;
- «Пересчитать» и другие глобальные analyzer actions показывать только AKLAB Admin;
- фотографии получать авторизованными blob-запросами.

### Task 16. Переделать admin manual pipeline UI

**Файлы:**

- `app/src/components/properties/ParseLaunchPanel.vue`;
- `app/src/composables/usePipeline.ts`;
- admin часть `SettingsView.vue`/новая `PipelineAdminPanel.vue`;
- tests.

Контракт:

- обязательный selector пользователя;
- убрать произвольные city/price/threshold launch filters;
- POST `/pipeline/start` передаёт `targetUserId` и валидированный depth;
- обычному пользователю компонент и route недоступны;
- progress показывает scope/target и персональные digest counters без email;
- заменить SSE на authenticated polling с cleanup interval при unmount/terminal state.

### Task 17. Обновить smoke/E2E и документацию

**Файлы:**

- `scripts/smoke-test.js`;
- Playwright specs в `app/e2e/`;
- `docs/compact-doc.md`;
- `docs/gotchas.md`;
- `docs/sessions.md` или отдельный `docs/multiuser.md`;
- deploy/checklist docs.

Smoke должен работать минимум с двумя test users и одним admin:

- no-auth: health доступен, data/settings/media заблокированы;
- user A и B с разными несовместимыми профилями видят разные списки и stats;
- изменение статуса/comment A не меняет B;
- прямой detail ID чужого profile scope даёт 404;
- обычный user получает 403 на global settings/pipeline/source mutations;
- admin может изменить профиль B и запустить manual run для B;
- cron test fixture создаёт две digest jobs, manual B — одну;
- blocked user исключён из snapshot и digest;
- duplicate Property не создаётся при совпадении двух профилей;
- photos недоступны без JWT и доступны подходящему пользователю.

## 6. TDD и проверочные команды

Работать по RED → GREEN → REFACTOR для каждого слоя. Локально не запускать `dev`, `serve` или `start`; разрешены только тесты, typecheck, lint и build.

Минимальный локальный acceptance:

```bash
cd /Users/aleksandrrudin/github.nosync/aklab
STRAPI_API_TOKEN=synthetic-test-token npm test
npm run build --workspaces --if-present
cd api && npm run test && npm run build
cd ../app && npm run test:unit -- --run && npm run type-check && npm run build
cd .. && npm audit --audit-level=high
cd api && npm audit --audit-level=high
cd ../app && npm audit --audit-level=high
```

Дополнительно точечно:

```bash
cd /Users/aleksandrrudin/github.nosync/aklab/lib/parse-rules && npm test && npm run build
cd /Users/aleksandrrudin/github.nosync/aklab/services/_shared && npm test && npm run build
cd /Users/aleksandrrudin/github.nosync/aklab/services/digest && npm test && npm run build
cd /Users/aleksandrrudin/github.nosync/aklab/app && npm run type-check
```

Не использовать несуществующие root aliases `build:libs`, `test:services`, `build:services`, `test:api`, `test:app`, `build:api` или `build:app`: фактический root manifest их не объявляет.

Перед коммитом проверить `git diff --check`, отсутствие секретов и отсутствие непредусмотренных lockfile churn. При изменении file/workspace-зависимостей следовать repository gotchas и пересобирать `lib` до services.

## 7. Безопасный rollout

Выпуск сделать через additive feature flag `MULTIUSER_ENABLED`, по умолчанию `false` для первого старта новой схемы.

Контракт flag:

- единственный source of truth — env API-процесса `MULTIUSER_ENABLED`; отсутствующее/пустое/невалидное значение означает `false`;
- API и cron читают одну типизированную helper-функцию, а не разбирают env независимо;
- workers не получают второй env flag: новая семантика включается только versioned queue payload, поставленным API;
- multi-user jobs используют отдельные request types `parse-source-v2`, `analyze-property-v2`, `digest-send-v2` и обязательный `payloadSchemaVersion`; старые consumers не регистрируют эти types, а новые fail closed на неподдерживаемой версии;
- frontend не имеет отдельного `VITE_MULTIUSER_ENABLED`: он получает `multiuserEnabled` и role capabilities из authenticated `/me/context`;
- при `false` новые tables/services могут существовать, но новый пользовательский/cron contract не активен; при частичной конфигурации система остаётся на legacy path fail-closed.

### Wave A — local/dev foundation, feature off

1. Создать и проверить backup SQLite и property photo storage только целевого dev-окружения.
2. Выполнить dev deploy exact SHA с новыми additive schemas, services, tests и feature flag off.
3. Перезапуск создаёт новые таблицы/relations, но старый пользовательский контракт продолжает работать.
4. Проверить health, PM2 без env/secrets, schema presence и отсутствие ошибок lifecycle.

### Wave B — audit и migration

1. Выполнить `multiuser:audit` с target user email.
2. Проверить counts и неоднозначный `smtp_to`.
3. Выполнить транзакционную migration с отдельным backup path.
4. Повторить dry-run: ожидается ноль изменений.
5. Проверить роль основного пользователя, profiles, state counts, comment authors и отсутствие orphan rows.
6. Скопировать property photos в private root, сверить counts/checksums; публичные исходники пока оставить.

### Wave C — dev cutover

1. Включить `MULTIUSER_ENABLED=true` только на AKLAB dev.
2. Перезапустить штатным production-like способом, не `npm run dev`.
3. Прогнать smoke + E2E с admin/user A/user B.
4. Запустить manual pipeline для выбранного test user; проверить snapshot hash, один обход, один digest job и отсутствие duplicate Property.
5. Запустить cron-equivalent для двух профилей; проверить OR-контракт и fan-out.
6. Проверить desktop/mobile и крупный font scale для новых форм/admin tables.

### Wave D — production cutover только по отдельной команде пользователя

1. После отдельной команды создать и проверить production backups, затем подтвердить exact SHA, migration report и dev acceptance.
2. Включить feature flag и выполнить immutable manual deploy по AKLAB skill.
3. Проверить health, authenticated smoke, no-auth denial, private media, profile target counts, digest telemetry и PM2 statuses.
4. Не отправлять тестовые письма реальным пользователям без явного согласования; использовать test recipient/controlled manual run.
5. Наблюдать первый реальный cron: snapshot profile count, source jobs, details, analyze и digest counters без логирования email.

## 8. Rollback

Rollback trigger:

- cross-user data leak;
- user может изменить чужой status/comment/profile;
- public data/media endpoint;
- snapshot mismatch между phases;
- duplicate Property или повторный source scan на пользователя;
- digest отправлен не тому получателю;
- Runtime High или потеря данных миграции.

Порядок:

1. Остановить новый запуск pipeline/digest штатной cancel-процедурой.
2. Проверить по queue/run telemetry, что нет active `*-v2` jobs; pending/retry v2 jobs отменить по exact run/correlation ID и сохранить counts как evidence.
3. Поставить `MULTIUSER_ENABLED=false` и только затем откатить приложение на предыдущий exact SHA; legacy worker не должен получить v2 job.
4. Legacy `Setting` и `Property.status` сохранены, поэтому старый read path доступен.
5. Новые additive tables не удалять во время аварийного rollback.
6. При повреждении канонических данных восстановить SQLite из pre-migration backup.
7. Private photo migration выполняется копированием; public originals удалять только отдельной cleanup-волной после стабильного production acceptance.
8. После стабилизации провести read-only forensic comparison и только затем повторять cutover.

## 9. Definition of Done

- [ ] Два пользователя с разными профилями получают разные scoped catalog/dashboard/focus.
- [ ] Один канонический объект может динамически отображаться обоим без duplicate row.
- [ ] Phase 1 сканирует источник один раз и использует OR целых immutable profiles.
- [ ] Phase 2 повторно применяет тот же snapshot hash.
- [ ] Статусы и комментарии полностью изолированы.
- [ ] Admin role проверяется сервером; обычный user не управляет глобальным контуром.
- [ ] Cron создаёт персональный digest fan-out; manual run — job только target user.
- [ ] Новый пользователь видит подходящую историю, но digest содержит только 24 часа.
- [ ] Заблокированный user исключён из snapshot/send, данные сохранены; hard delete заблокирован.
- [ ] Публичным остался только health/login; data, telemetry и property photos закрыты.
- [ ] Migration dry-run/idempotency/backup/rollback реально проверены.
- [ ] Unit/integration/frontend/smoke/E2E проходят; API/app/services собираются.
- [ ] `npm audit --audit-level=high` не содержит блокирующих high/critical.
- [ ] Dev acceptance завершён; production не затронут без отдельной команды.

## 10. Явно вне scope v1

- публичная регистрация и приглашения;
- персональное время дайджеста;
- персональный выбор источников;
- персональный порог focus score;
- materialized relation «все подходящие Property пользователя»;
- отдельный полный pipeline на каждого пользователя;
- история изменений персонального статуса;
- физическое удаление пользователей и GDPR-like purge;
- удаление legacy полей/tables и public photo originals до отдельной cleanup-волны;
- возврат streaming progress поверх авторизованного fetch-SSE.
