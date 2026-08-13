# Git, Release and Deploy

## 1. Git changes

- Работать в feature-ветке.
- Не push напрямую в `main`.
- Не переписывать shared history без явной команды.
- Stage только literal owned paths.
- Перед commit проверить cached diff, path list и secrets.

```bash
git status --short --branch
git rev-parse HEAD
git diff --check
git add -- path/a path/b
git diff --cached --name-status
git diff --cached --check
git diff --cached
```

После commit подтвердить actual SHA, parent, committed paths и remaining dirty worktree.

## 2. Commit boundaries

Один commit должен иметь один проверяемый контракт:

- shared foundation;
- pipeline integration;
- parser wave;
- API/schema wave;
- UI wave;
- docs/release.

Не смешивать production operations, generated artifacts и unrelated cleanup с feature commit.

## 3. PR и release

До PR/merge:

- relevant tests/build GREEN;
- independent review закрыт;
- docs/schema/seeder/permissions обновлены при необходимости;
- version/changelog release prep выполнен отдельно;
- exact head SHA известен.

Отсутствие CI checks не равно PASS. Если workflows отключены, manual evidence обязателен.

## 4. Production deploy

Production deploy — только по отдельной явной команде пользователя и только штатным immutable applier:

```bash
bash scripts/deploy-prod.sh --ref <exact-merged-sha>
```

Один запрос «деплой» разрешает один запуск. Повторный запуск требует новой команды.

Запрещено заменять штатный путь набором ручных `git pull/npm build/pm2 restart` команд.

Preflight:

- exact SHA merged в `origin/main`;
- production worktree clean;
- pipeline/runtime state допустим для выпуска;
- DB/queue backup и integrity checks выполняет script;
- security gate high/critical проверен;
- changelog/version присутствуют в release commit.

## 5. Acceptance

После deploy подтвердить реальными данными:

- server exact SHA и clean status;
- API/frontend domain status;
- PM2 manifest: только name/status/pid/restarts, без env;
- targeted service logs без secrets;
- affected user flow;
- schema/data/media invariant, если затронут;
- rollback state/evidence при ошибке.

`pm2 online` само по себе не доказывает функциональную готовность.

## 6. DB cleanup/reset

Очистка object catalog — отдельный destructive action.

- использовать существующий утверждённый admin maintenance contract, а не создавать второй competing reset tool;
- admin-only и fresh-role policy;
- exact confirmation, runtime preflight и count-only summary;
- server maintenance gate, enabled only after writer processes are stopped;
- owned durable lifecycle lease held through DB and post-commit media cleanup;
- object-domain allowlist;
- pipeline `idle` и очереди без `pending/active`; preflight повторяется внутри transaction до первого delete;
- transaction и child→parent relation cleanup;
- users/profiles/settings/sources/focus rules/market references защищены;
- pre/post counts и integrity check;
- object photo directories удаляются только после DB commit; отсутствующие directories не считаются удалёнными;
- запуск только после deploy нового parser contract и отдельного approval;
- затем full reparse и acceptance по каждому source.

Исторический `clear-new` нельзя возвращать в старой неатомарной форме с удалением файлов до DB commit и orphan relations.

Production cutover order:

1. остановить внешние parser/analyzer/photo writer-процессы;
2. включить `AKLAB_CATALOG_CLEANUP_MAINTENANCE_MODE=enabled` только на время cutover; без него endpoint возвращает `409`;
3. проверить durable lifecycle и queue stats;
4. вызвать admin-only action с exact confirmation;
5. сохранить audit counts и проверить protected counts;
6. выключить maintenance mode и вернуть API в обычный режим;
7. отдельно запустить полный reparse только после явного approval.

На текущем dev-like этапе без клиентского трафика API restart во время короткого cleanup исключается операционной процедурой. Аварийный restart считается принимаемым LOW risk: cleanup проверяется и при необходимости повторяется вручную; отдельный автоматический restart-recovery не требуется.

## 7. Stop/rollback semantics

Команда пользователя «стоп» означает: не выполнять следующий side effect. Сохранить worktree/evidence, сообщить последнюю завершённую проверку и ждать решения.

При deploy failure не импровизировать broad recovery. Сначала exact state, затем документированный rollback штатного script.
