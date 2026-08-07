# Multi-user: проверяемый dev rollout / rollback

Статус этого документа: **операционный runbook для AKLAB dev**. Он описывает
проверки и порядок действий, но не является разрешением на production. В этой
документационной волне runtime deploy, restart, migration против реальной БД,
копирование фотографий, SMTP и E2E на сервере **не выполнялись**.

Runbook опирается на план multi-user и на фактический код текущего SHA:

- migration CLI находится в `api/scripts/migrate-multiuser.js`;
- в `api/package.json` доступны `multiuser:audit` и `multiuser:migrate`;
- CLI не поднимает Strapi и требует явные абсолютные `--db` и `--backup`;
- `MULTIUSER_ENABLED` включается только raw-значением `true`; пробелы, другой
  регистр и любые иные значения означают `false`;
- persistent private photo-root описан в
  [контракте storage](photo-storage-contract.md);
- snapshot, profile scope и digest counters проверяются в
  [контракте parser telemetry](run-scoped-parser-telemetry.md).

Все значения в угловых скобках — **обязательные prerequisites целевого dev
окружения**, а не значения, которые можно угадывать или коммитить. Не записывать
в этот документ и в Git email тестовых пользователей, пароли, JWT, service
tokens, содержимое `.env`, IP-адреса, хосты или реальные filesystem paths.

## 0. Неподвижные правила

- Работать только с одним подтверждённым dev-окружением. Production — только
  отдельной командой пользователя и отдельным release checklist (см. §11).
- Применять только exact SHA, прошедший локальные проверки. `git pull` наугад,
  floating `main`, stash/reset ради продолжения и server-side commit запрещены.
- До любой миграции или изменения env получить backup и сохранить его путь,
  размер, SHA-256 и `PRAGMA integrity_check = ok` вне репозитория.
- Сначала deploy с `MULTIUSER_ENABLED=false`, затем read-only audit, затем
  migration, затем повторный idempotent audit. Не включать flag на Wave A/B.
- Не запускать локально `npm run dev`, `npm run serve`, `npm run start`,
  серверы, SSH, API probes или операции с runtime DB в рамках локальной docs
  проверки.
- Не удалять legacy `Setting`, `Property.status`, старые public photo originals,
  additive tables или backup во время rollout/rollback.
- Не считать build/health достаточным доказательством: нужны no-auth denial,
  admin, user A, user B, private media, manual single-target и cron fan-out
  evidence.

## 1. Подготовить переменные и evidence directory

Оператор целевого dev окружения сначала заполняет значения локально или на
dev-host, не помещая их в документацию:

```bash
REPO=/absolute/path/to/the/aklab-dev-checkout
DEV_DB=/absolute/path/to/the/persistent/dev/data.db
BASELINE_BACKUP=/absolute/path/to/a/private/backup/multiuser-baseline-<UTC>.db
MIGRATION_BACKUP=/absolute/path/to/a/private/backup/multiuser-before-migration-<UTC>.db
IDEMPOTENCY_BACKUP=/absolute/path/to/a/private/backup/multiuser-second-apply-<UTC>.db
EVIDENCE_DIR=/absolute/path/to/a/private/evidence/multiuser-<UTC>
EXPECTED_SHA=<exact-reviewed-dev-release-sha>
TARGET_USER_EMAIL=<configured-target-user-email>
API_BASE=<dev-api-base-url>
APP_BASE=<dev-app-base-url>
LEGACY_PHOTO_ROOT=/absolute/path/to/the/current/photo-root
PRIVATE_PHOTO_ROOT=/absolute/path/to/the/persistent/private-photo-root
```

`DEV_DB`, все три backup paths, `REPO`, оба photo roots и `EVIDENCE_DIR` должны
быть абсолютными. `DEV_DB` и backup должны быть разными файлами на том же
целевом окружении, а evidence не должен находиться в Git checkout.

```bash
set -euo pipefail
umask 077
mkdir -p "$EVIDENCE_DIR"
cd "$REPO"
test -f "$DEV_DB"
test "$DEV_DB" != "$MIGRATION_BACKUP"
test "$DEV_DB" != "$IDEMPOTENCY_BACKUP"
```

Если хотя бы один prerequisite неизвестен, rollout останавливается. Host,
SSH, PM2 names, deploy command, env storage и реальные paths берутся из
фактического dev окружения и AKLAB deploy skill (`skill_view(name='aklab')`),
а не из этого runbook.

## 2. SHA gate и предварительные проверки

### 2.1 Локальный exact-SHA gate

До передачи artifact на dev:

```bash
cd "$REPO"
test "$(git rev-parse --verify HEAD)" = "$EXPECTED_SHA"
test -z "$(git status --porcelain)"
git show --no-patch --format='%H%n%P%n%s' "$EXPECTED_SHA" \
  | tee "$EVIDENCE_DIR/sha.txt"
git diff --check
```

В evidence должны попасть branch, exact `HEAD`, parent и subject, но не env.
На dev deploy preflight должен повторно доказать: clean checkout, ожидаемый
branch, exact target SHA после fast-forward и отсутствие server-side Git
авторства. Если применяемый deploy script не принимает SHA или делает
непроверенный `git pull`, он не удовлетворяет этому gate; использовать только
штатную immutable процедуру из AKLAB deploy skill либо сначала получить
отдельно проверенный wrapper.

`scripts/deploy-dev.sh` принимает обязательный `--ref <SHA>`, требует clean
`main`, сверяет SHA с `origin/main` и применяет только fast-forward. До любых
PM2/build/DB side effects он отказывается от dirty/raced состояния; stash,
floating pull и server-side release authorship запрещены regression-тестом.
После первого failed attempt повторный запуск должен передать
`--rollback-ref <last-known-good-SHA>`; после успешного health gate script сам
атомарно сохраняет last-success SHA вне checkout. Текущий server HEAD после
неуспешной сборки/health-проверки не считается доказанным rollback target.
Dev-host использует общий PM2 daemon с другим проектом, поэтому Node-version
mismatch также fail-closed: deploy не выполняет автоматический `pm2 update`.

### 2.2 Доступные локальные проверки

Команды ниже существуют в текущих manifest'ах и не запускают dev server:

```bash
cd "$REPO"
STRAPI_API_TOKEN="${SYNTHETIC_API_TOKEN:?set a non-secret synthetic value in the local shell}" npm test
(cd api && npm test -- scripts/__tests__/migrate-multiuser.test.ts)
(cd api && npm run multiuser:audit -- --help)
(cd app && npm run type-check)
(cd app && npm run build)
git diff --check
```

Synthetic token допускается только для локального тестового процесса и не должен
попадать в вывод или commit. `npm run smoke`, Playwright и health probes — это
runtime-проверки Wave C и выполняются только в разрешённом dev окружении; не
подменять ими локальную docs-проверку.

## 3. Wave A — additive deploy, flag OFF

### A0. Quiesce и backup до mutation

1. Зафиксировать, что pipeline idle, нет активных legacy/v2 queue jobs и нет
   параллельной migration/cron работы. Не делать blind kill и не очищать логи.
2. Через принятый для dev SQLite backup механизм создать
   `$BASELINE_BACKUP` **до** deploy, который может создать таблицы при startup.
   Для WAL-БД использовать transaction-consistent backup (например,
   согласованный SQLite backup/VACUUM INTO путь), а не копию только main-файла.
3. Read-only открыть backup, проверить integrity и сохранить только metadata:
   bytes, SHA-256, integrity status. Содержимое и PII в evidence не писать.
4. Проверить, что `MULTIUSER_ENABLED` отсутствует/пуст или имеет значение,
   отличное от `true`, во всех API process env до первой перезагрузки.

Если backup не проверен или pipeline не удалось остановить штатно, Wave A не
начинать.

### A1. Immutable dev deploy с feature OFF

1. Передать в утверждённую dev deploy procedure только `$EXPECTED_SHA`.
2. Убедиться, что API, frontend и workers собираются из этого SHA, а env
   multi-user flag остаётся `false`. Workers не получают отдельный flag.
3. Выполнить production-like build/restart из фактического dev окружения:
   build artifacts, штатный process manager, `pm2 save` если это часть принятой
   dev procedure, затем health checks. Не использовать `ecosystem-local.config.js`
   и `npm run dev` как acceptance для этого rollout.
4. Сохранить без секретов: exact runtime SHA, health status API/app/workers,
   process status и отсутствие lifecycle errors.

### A2. Acceptance Wave A

- health доступен в разрешённом health-контуре;
- health и login доступны по своим контрактам; пользовательский traffic остаётся
  quiesced до Wave B, если target ещё не имеет роли `aklab_admin`;
- additive tables/relations присутствуют согласно schema contract;
- no-auth data/settings/media по-прежнему закрыты или не расширены;
- process manager после restart использует ожидаемый SHA и clean env;
- при любом расхождении flag остаётся OFF, дальнейшие waves блокируются.

Важно: feature flag не является authorization bypass. Политика `aklab-admin`
проверяет свежую роль из БД и действует также при flag OFF. Поэтому нельзя
объявлять legacy global settings/sources/pipeline доступными до назначения роли
через проверенную migration. Между A1 и B2 держать rollout в maintenance/quiesced
режиме, а не ослаблять policy статическим user ID/token или permissive fallback.

## 4. Wave B — audit, migration, idempotent re-audit

### B0. Read-only audit

Выполнить на копии/целевой dev DB после Wave A, до любого apply:

```bash
cd "$REPO"
(cd api && npm run multiuser:audit -- \
  --target-user-email="$TARGET_USER_EMAIL" \
  --db="$DEV_DB") \
  | tee "$EVIDENCE_DIR/audit-before.json"
```

Это только read-only audit. CLI обязан проверить schema, relation topology,
ровно одного target user, active/confirmed state, legacy ranges/booleans,
unknown statuses, existing profiles/role/links и orphan conditions. В отчёте
ожидаются только schema classes, counts, integrity и change-related metadata;
не сохранять email, user IDs, row payloads или raw SQL errors.

Оператор вручную сверяет и подписывает gate:

- target user найден ровно один раз и готов для migration;
- `smtp_to` — один валидный адрес либо migration остановлена для ручного решения;
- число users/properties/comments/profiles/states и legacy status counts
  записано до apply;
- `comments_without_author`, relation orphans и duplicate identity равны нулю
  либо имеют заранее утверждённое объяснение;
- relation topology полностью introspectable. `schema.ready=false` допустим до
  первого apply только когда причина исчерпывается явными `false` в четырёх
  `unique_constraints` (`role_type`, `property_document_id`, `profile_user_id`,
  `state_identity_key`): Strapi SQLite может не материализовать field-level
  `unique` как physical index. Missing table/column, ambiguous relation или
  duplicate values остаются fail-closed;
- audit не изменил ни DB, ни filesystem.

### B1. Transactional migration и backup argument

Перед apply заново подтвердить quiesce и создать отдельный backup через CLI.
Команда обязана использовать абсолютные значения обоих путей:

```bash
cd "$REPO"
(cd api && npm run multiuser:migrate -- \
  --target-user-email="$TARGET_USER_EMAIL" \
  --db="$DEV_DB" \
  --backup="$MIGRATION_BACKUP") \
  | tee "$EVIDENCE_DIR/migration-first.json"
```

Текущий CLI делает canonical validation и duplicate precheck до backup/write
transaction, проверяет backup integrity и permissions, затем внутри одной
transaction создаёт только отсутствующие named UNIQUE indexes, повторно
introspect'ит schema и выполняет idempotent apply с postconditions до commit.
Duplicate-identical FK rows, которые Strapi SQLite может вернуть через PRAGMA,
схлопываются только по полному semantic tuple; отличающаяся topology остаётся
ambiguous/fail-closed. CLI не должен запускаться с implicit DB path, relative
path, `--backup` равным `--db`, Strapi bootstrap или запущенным локальным server.

Expected result:

- основной legacy user получает профиль и `AKLAB Admin` только по exact target;
- остальные пользователи получают широкие defaults без перезаписи их профиля;
- non-`new` legacy statuses становятся sparse user states только для target;
- существующие comments получают автора только там, где он отсутствовал;
- `Setting`, `Property.status`, unrelated profiles/roles/links не очищаются;
- report содержит before/after counts, `changes`, backup bytes/hash/integrity и
  generic error codes без PII.
- `after.schema.ready=true`, а все четыре `after.schema.unique_constraints`
  равны `true`.

Любой schema/validation/postcondition failure должен дать non-zero exit и
откатить DB transaction. Если failure произошёл после создания backup, backup
сохраняется как evidence.

### B2. Idempotent re-audit и второй apply proof

Сначала повторить read-only audit и сравнить counts с migration report:

```bash
(cd api && npm run multiuser:audit -- \
  --target-user-email="$TARGET_USER_EMAIL" \
  --db="$DEV_DB") \
  | tee "$EVIDENCE_DIR/audit-after.json"
```

Затем, если нужен полный idempotency proof, повторить тот же apply с новым,
отдельным абсолютным backup path:

```bash
(cd api && npm run multiuser:migrate -- \
  --target-user-email="$TARGET_USER_EMAIL" \
  --db="$DEV_DB" \
  --backup="$IDEMPOTENCY_BACKUP") \
  | tee "$EVIDENCE_DIR/migration-second.json"
```

Для второго apply ожидается `profiles_created=0`, `states_created=0`,
`comments_authored=0`, а также нулевые role/profile/link changes. Финальный
audit должен сохранить те же counts и подтвердить отсутствие orphan/duplicate
rows; `schema.ready` и все четыре unique constraints остаются `true`. Любое
изменение, новый профиль, второй role link или изменение чужой existing profile
— rollback trigger.

## 5. Private photo-root migration

Фото — отдельный gate, не побочный эффект DB migration.

1. На фактическом dev окружении доказать, что `$PRIVATE_PHOTO_ROOT` — непустой
   абсолютный путь вне immutable release и web root, а API и photo-fetcher
   используют один normalized root.
2. Если задан deprecated `$PHOTOS_BASE_DIR`, его normalized value должна совпадать
   с `$PRIVATE_PHOTO_ROOT`; конфликт — fail closed. Не придумывать alias и не
   считать symlink заменой storage contract.
3. До копирования сохранить source count/bytes/checksum metadata. Копирование
   выполняется только из `$LEGACY_PHOTO_ROOT` в `$PRIVATE_PHOTO_ROOT`; public
   originals, legacy root и symlink не удалять.
4. Копировать regular files с сохранением относительного layout
   `<documentId>/<filename>`. При существующем destination с отличающимся
   checksum остановиться, не перезаписывать молча.
5. После копирования повторно посчитать count, bytes и aggregate SHA-256
   manifest по `(relative path, file SHA-256)`. Source и private destination
   должны совпасть; manifest и report хранить с mode 0600 вне Git.
6. Проверить private permissions, authenticated photo read для property в scope
   A/B и neutral denial для no-auth/foreign scope. Публичный static root не
   считать доказательством private media.

Фактическая процедура копирования/permissions берётся из dev storage
операций; runbook не фиксирует неизвестный host/path. Подробный resolver,
layout и rollback risk: [photo-storage-contract.md](photo-storage-contract.md).
Исходники можно удалять только отдельной cleanup wave после acceptance и
нового backup; в этом rollout/rollback они всегда сохраняются.

## 6. Wave C — dev cutover, flag ON только на dev

### C0. Включение и production-like restart

1. Убедиться, что Wave A/B и photo gate имеют подписанные evidence, а
   `$EXPECTED_SHA` всё ещё является runtime SHA.
2. Изменить `MULTIUSER_ENABLED=true` **только в API env целевого dev**. Не
   добавлять `VITE_MULTIUSER_ENABLED`; frontend получает capability через
   authenticated context. Workers включают multi-user semantics только через
   versioned queue payload, созданный API.
3. Выполнить разрешённый production-like build/restart target dev и дождаться
   health. Не делать локальный `npm run dev`, ручной SSH sequence, `pm2 flush`
   или необратимый cleanup.
4. Зафиксировать, что `/me/context` или эквивалентный authenticated capability
   response показывает `multiuserEnabled=true`, а admin role проверяется
   server-side. В public logs/hash evidence не помещать token, email или full
   snapshot.

### C1. No-auth и private media negative checks

Проверить health отдельно от data boundary: health — единственный ожидаемый
public read. Для каждого data endpoint фактический ожидаемый status должен быть
зафиксирован контрактом (обычно `401/403`, а для чужого detail/media допустим
нейтральный `404`):

```bash
curl -sS -o /dev/null -w '%{http_code}\n' "$API_BASE/_health"
curl -sS -o /dev/null -w '%{http_code}\n' "$API_BASE/api/properties"
curl -sS -o /dev/null -w '%{http_code}\n' "$API_BASE/api/setting"
curl -sS -o /dev/null -w '%{http_code}\n' "$API_BASE/api/pipeline/status"
curl -sS -o /dev/null -w '%{http_code}\n' \
  "$API_BASE/api/photos/<in-scope-document-id>/<safe-filename>"
```

Не подставлять в этот документ реальные IDs. Authenticated photo request с
`USER_A_JWT`/`USER_B_JWT` должен работать только для property в соответствующем
scope; no-auth и foreign-scope запросы не должны раскрывать наличие файла.

### C2. Admin / user A / user B smoke evidence

Использовать три заранее созданные dev fixture accounts без записи их email,
паролей и JWT в evidence:

- **Admin:** видит только разрешённые global settings/sources/pipeline controls;
  ordinary user получает `403` на global mutation и не может выбрать чужого
  target через body/query.
- **A и B:** имеют несовместимые полные профили (region + type + price/area +
  stop words), чтобы доказать OR профилей без смешивания полей.
- Catalog/dashboard/focus/stats A и B различаются; один canonical property,
  подходящий обоим, хранится и создаётся один раз.
- Status/comment A не виден и не меняется B; чужой detail ID отвечает neutral
  `404`.
- Blocked/unconfirmed user не входит в active snapshot и не получает digest;
  additive data не удаляется.
- No-auth properties/settings/events/telemetry/media закрыты; login и health
  остаются доступными по их отдельному контракту.

Текущий `npm run smoke` — dedicated multi-user harness. Он требует явные
`SMOKE_API_URL`, `SMOKE_UI_URL` и три разные пары credentials для admin/A/B,
ничего не берёт из legacy `TEST_USER_*` и не имеет production fallback.
URL принимаются только как exact trusted pair: dev-домены из этого репозитория,
production-домены с отдельным `SMOKE_ALLOW_PRODUCTION=1`, либо loopback pair с
флагом `--local`. Unknown/mixed UI/API origins отклоняются до login.
Read-only проверки запускаются по умолчанию. Status/comment и harmless denial
probes включаются только для изолированной fixture:

```bash
cd "$REPO"
SMOKE_API_URL="$API_BASE" SMOKE_UI_URL="$APP_BASE" \
SMOKE_ADMIN_EMAIL="$ADMIN_EMAIL" SMOKE_ADMIN_PASSWORD="$ADMIN_PASSWORD" \
SMOKE_USER_A_EMAIL="$USER_A_EMAIL" SMOKE_USER_A_PASSWORD="$USER_A_PASSWORD" \
SMOKE_USER_B_EMAIL="$USER_B_EMAIL" SMOKE_USER_B_PASSWORD="$USER_B_PASSWORD" \
SMOKE_FIXTURE_PROPERTY_ID="${SHARED_FIXTURE_DOCUMENT_ID:?set shared A/B fixture}" \
SMOKE_FIXTURE_EXPECTED_TITLE="${SHARED_FIXTURE_TITLE:?set exact dedicated fixture title}" \
SMOKE_PHOTO_DOCUMENT_ID="${USER_A_ONLY_PHOTO_DOCUMENT_ID:?set A-only photo fixture}" \
SMOKE_PHOTO_FILENAME="${PHOTO_FILENAME:?set safe stored filename}" \
SMOKE_ALLOW_MUTATIONS=1 SMOKE_MUTATION_CONFIRM=fixture-only \
npm run smoke
```

Все переменные задаются только в защищённом окружении оператора. Harness не
печатает email/password/JWT и обязан восстановить status/delete fixture comment
в `finally`. Cron/queue и реальный pipeline start остаются отдельным evidence.

### C3. E2E evidence

Playwright config больше не запускает Vite/dev/preview автоматически и работает
только против уже развёрнутого target. Multi-user spec без полного fixture env
помечается skipped до создания browser/page. Запускать его одним serial suite:

```bash
cd "$REPO"
SMOKE_API_URL="$API_BASE" SMOKE_UI_URL="$APP_BASE" \
SMOKE_ADMIN_EMAIL="$ADMIN_EMAIL" SMOKE_ADMIN_PASSWORD="$ADMIN_PASSWORD" \
SMOKE_USER_A_EMAIL="$USER_A_EMAIL" SMOKE_USER_A_PASSWORD="$USER_A_PASSWORD" \
SMOKE_USER_B_EMAIL="$USER_B_EMAIL" SMOKE_USER_B_PASSWORD="$USER_B_PASSWORD" \
SMOKE_FOREIGN_PROPERTY_ID="${USER_A_ONLY_DOCUMENT_ID:?set A-only property fixture}" \
SMOKE_PHOTO_DOCUMENT_ID="${USER_A_ONLY_PHOTO_DOCUMENT_ID:?set A-only photo fixture}" \
SMOKE_PHOTO_FILENAME="${PHOTO_FILENAME:?set safe stored filename}" \
SMOKE_ALLOW_MUTATIONS=1 SMOKE_MUTATION_CONFIRM=fixture-only \
E2E_MULTIUSER=1 HEADLESS=1 npm run test:e2e -- --project=chromium
```

Spec проверяет no-auth denial, A/B profile/list/stats/detail isolation, foreign
detail 404, admin gating и private media. Status/comment ownership доказывает
mutating smoke fixture. Blocked-user exclusion, real manual pipeline и cron
fan-out остаются отдельными runtime gates, а не эмулируются Playwright.

## 7. Manual single-target pipeline

Запускать только admin actor и только после C0/C1:

```bash
PIPELINE_BODY="$(node -e '
  const depth = Number(process.argv[1]);
  const targetUserId = Number(process.argv[2]);
  if (!Number.isSafeInteger(depth) || depth < 1 || depth > 1000
      || !Number.isSafeInteger(targetUserId) || targetUserId < 1) process.exit(2);
  process.stdout.write(JSON.stringify({ mode: "full", depth, targetUserId }));
' "${PIPELINE_DEPTH:?set validated depth}" "${USER_B_ID:?set target user id}")"
curl --fail-with-body -sS \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer ${ADMIN_JWT:?set in protected environment}" \
  --data "$PIPELINE_BODY" \
  "$API_BASE/api/pipeline/start" \
  | tee "$EVIDENCE_DIR/manual-b-start.json"
```

Проверки:

- server-side admin check принимает только выбранный active target;
- request не содержит произвольных legacy city/price/threshold filters;
- run получает `profile_scope=single`, target B, snapshot hash/schema version и
  fixed window до первой queue job;
- Phase 1 и Phase 2 используют один snapshot/hash, source обходится один раз,
  canonical Property не дублируется;
- после анализа создаётся ровно одна digest job для B (или `skipped` без
  SMTP side effect по текущему delivery control);
- status output отдаёт scope/hash/counters, но не full snapshot, email, token,
  username или profile IDs.

Остановить run только штатным cancel. Сохранить `run_id`, job/correlation IDs,
terminal status и counters; payload и private user data в общий evidence не
копировать.

## 8. Cron OR/fan-out acceptance

После успешного manual single-target отдельно проверить cron-equivalent в dev
fixture, не запуская два ручных full pipeline параллельно:

1. Создать/зафиксировать active snapshot для A+B: OR целых профилей, без
   объединения region одного профиля с price другого.
2. Запустить принятую в dev процедуру `pipeline:daily`/cron harness в одном
   controlled window. Если в окружении нет безопасного harness, это blocker,
   а не повод вызывать внутреннюю cron-функцию наугад.
3. Проверить один parser run и один scan каждого source, один canonical object
   при совпадении с A и B, details повторно с тем же snapshot hash.
4. Проверить digest fan-out: отдельная idempotent job на каждого eligible user,
   то есть две jobs для A+B, с counters
   `scheduled = sent + skipped + failed`; payload jobs не содержит email.
5. Перед SMTP отдельно reread blocked/digest/email controls. Blocked,
   disabled или invalid recipient дают `skipped` без side effect.
6. Повтор cron-equivalent с тем же run/idempotency contract не создаёт новых
   Property или duplicate digest jobs.

Это должно быть подтверждено telemetry/counters и sanitized queue evidence, а
не только надписью в UI. Подробные immutable snapshot/queue правила —
[run-scoped-parser-telemetry.md](run-scoped-parser-telemetry.md).

## 9. Rollback triggers

Немедленно rollback, если обнаружено хотя бы одно:

- A видит Property, status, comment, photo или telemetry B, либо наоборот;
- ordinary user читает/меняет global settings, source, pipeline или чужой
  profile/state/comment;
- no-auth получает data/media/telemetry, или media выходит через public root;
- snapshot/hash/version различаются между scan/details/analyze/digest;
- source сканируется повторно на пользователя, появляется duplicate canonical
  Property или duplicate state/digest job;
- manual target не ограничен одним user, blocked user попал в snapshot/digest;
- digest side effect направлен невалидному/неожидаемому recipient;
- migration postcondition, relation topology, backup integrity или checksum
  gate нарушен;
- runtime High/error loop, потеря данных, queue recovery uncertainty или
  production-like restart не подтверждены.

При сомнении предпочесть flag OFF и сохранение evidence, а не продолжать
acceptance.

## 10. Rollback order

1. Зафиксировать incident time, exact runtime SHA, flag value и sanitized
   status/counters. Не удалять логи и не менять DB вручную.
2. Штатно cancel новый pipeline/digest. Дождаться terminal state либо
   зафиксировать exact run/correlation/job IDs и pending/retry counts.
3. Проверить, что активных `*-v2` jobs больше нет; оставшиеся отменить только
   по exact run/correlation ownership и сохранить queue evidence.
4. Поставить `MULTIUSER_ENABLED=false` **до** отката приложения. Проверить env
   API и capability response после restart; worker не должен получить v2 job.
5. Откатить приложение на exact предыдущий SHA через approved immutable
   dev procedure и production-like restart. Не использовать floating pull,
   server commit, blind stash/reset или ручной `npm start`.
6. Проверить legacy health/auth/read path и отсутствие новых public data/media
   permissions. Legacy `Setting` и `Property.status` не удалялись и служат
   compatibility path.
7. Additive tables, profiles, states, comments, private copies и backups не
   удалять в аварийном rollback. Если каноническая SQLite data повреждена,
   остановить writers и восстановить только из проверенного
   `$MIGRATION_BACKUP`/`$BASELINE_BACKUP` штатной WAL-safe процедурой; raw main
   file copy без учёта WAL запрещена.
8. Для media сначала вернуть совместимый env/alias и старый resolver contract,
   затем старый SHA. Не удалять private root или legacy originals: physical
   migration была copy-only.
9. После стабилизации выполнить read-only forensic comparison: before/after
   counts, backup hash, relation integrity, photo count/checksum, no-auth
   responses, queue terminal state. Повторный cutover возможен только после
   новой Wave A/B/C evidence.

Rollback приложения не означает rollback физической photo migration и не
разрешает cleanup. Это две разные операции.

## 11. Production boundary — отдельная команда

Production в этом документе **не выполняется и не подразумевается**. Для него
нужен отдельный запрос пользователя и новый preflight:

- новый exact production release SHA и clean target checkout;
- отдельные production SQLite/queue/photo backups с integrity/counts/checksums;
- подтверждённый dev DoD и migration/idempotency reports;
- production-specific host, process-manager, env and deploy command из AKLAB
  deploy skill, без копирования dev values;
- controlled recipient и запрет тестовой отправки реальным пользователям без
  отдельного согласования;
- production rollback source и incident contact.

До такой команды никакие production SSH, deploy, restart, migration, media
copy, cron, API или SMTP actions не выполнять.

## 12. Evidence template и Definition of Done

Хранить один sanitized manifest вне Git:

```text
run_id / incident_id:
expected_sha / runtime_sha:
parent_sha:
flag_before / flag_after:
DB path verified absolute: yes/no
baseline backup: bytes, sha256, integrity
migration backup: bytes, sha256, integrity
pre-audit report: path + exit code
first migration report: path + exit code
post-audit report: path + exit code
second apply report: path + exit code (if run)
photo source/destination: count, bytes, aggregate manifest sha256
health: API/app/workers
no-auth: health, properties, settings, pipeline, media statuses
admin smoke: pass/fail + artifact
user A smoke: pass/fail + artifact
user B smoke: pass/fail + artifact
E2E: command, project, pass/fail, report path
manual target: scope, hash, terminal counters, digest job count
cron: profiles, source-run count, digest scheduled/sent/skipped/failed
rollback: not needed / trigger / exact previous SHA / evidence
production touched: no (required for this runbook)
```

DoD для dev cutover:

- [ ] exact SHA gate и clean target checkout доказаны;
- [ ] baseline backup сделан до additive deploy, migration backup — до apply;
- [ ] Wave A health/schema/flag OFF пройдены;
- [ ] audit → migration → idempotent re-audit дал стабильные counts и zero
      unexpected changes;
- [ ] profiles, states, author links, role и relation topology проверены;
- [ ] private photo-root скопирован copy-only, counts/checksums совпали,
      originals сохранены;
- [ ] `MULTIUSER_ENABLED=true` был только на dev;
- [ ] production-like restart и runtime SHA подтверждены;
- [ ] no-auth/private-media denial, admin, A, B и blocked-user checks пройдены;
- [ ] manual single-target доказал single scope/hash и одну digest job;
- [ ] cron доказал один source scan, complete-profile OR и digest fan-out;
- [ ] rollback trigger/order проверены на бумаге и backup restore procedure
      определена, но destructive cleanup не выполнялся;
- [ ] production не затронут без отдельной команды пользователя.

Связанные текущие документы: [compact-doc.md](compact-doc.md),
[gotchas.md](gotchas.md), [sessions.md](sessions.md).
