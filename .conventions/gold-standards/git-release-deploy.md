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
- explicit confirmation/dry-run/summary;
- object-domain allowlist;
- transaction и relation discovery через SQLite PRAGMA;
- users/profiles/settings/sources защищены;
- pre/post counts и integrity check;
- запуск только после deploy нового parser contract и отдельного approval;
- затем full reparse и acceptance по каждому source.

Исторический `clear-new` нельзя возвращать в старой неатомарной форме с удалением файлов до DB commit и orphan relations.

## 7. Stop/rollback semantics

Команда пользователя «стоп» означает: не выполнять следующий side effect. Сохранить worktree/evidence, сообщить последнюю завершённую проверку и ждать решения.

При deploy failure не импровизировать broad recovery. Сначала exact state, затем документированный rollback штатного script.
