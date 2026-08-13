# Workflow and Ownership

## 1. Discovery до правок

До изменения кода:

- прочитать `docs/compact-doc.md` и релевантные gotchas;
- найти реальный entry point, caller, persistence boundary и существующие тесты;
- проверить package scripts и workspace boundaries;
- проверить `git status`, `HEAD` и недавнюю историю;
- для Strapi прочитать schema, route, controller/service и policy;
- для парсера прочитать scan, details, shared pipeline и extraction tests.

Не делать вывод «метода нет» только по одному поисковому запросу. Проверять Git history, project docs и operational scripts.

## 2. Scope

Перед работой сформулировать:

- разрешённые файлы;
- явный out-of-scope;
- критерии готовности;
- команды targeted verification;
- side effects и точку rollback.

Не расширять scope «заодно». Если зависимый дефект вне scope блокирует работу — зафиксировать его отдельно.

## 3. Dirty и concurrent worktree

AKLAB может изменяться несколькими исполнителями одновременно.

Обязательные правила:

- не использовать `git reset`, `git clean`, `git stash`, checkout чужих файлов или массовую перезапись;
- не использовать `git add .` и `git add -A` в shared worktree;
- перед каждой новой правкой перечитывать owned files;
- перед commit повторять `git status`, `git rev-parse HEAD`, `git diff --name-status`, `git diff --check`;
- stage только literal owned paths;
- self-report субагента не считать evidence: перечитать diff и самостоятельно запустить проверки;
- при сдвиге `HEAD` не amend/reset историю; пересчитать фактического parent и staged scope.

## 4. TDD и debugging

Новое поведение и bug fix начинаются с минимального теста.

1. RED: тест падает по ожидаемой бизнес-причине.
2. GREEN: минимальная реализация.
3. REFACTOR: только после GREEN.
4. Targeted suite.
5. Package suite/build.
6. Расширенный repository gate по риску.

Ошибка runner/setup не является RED. Сначала сделать тест исполняемым.

При инциденте сначала установить root cause и data path, затем писать regression. Не исправлять симптом fallback-эвристикой.

## 5. Side effects

Без отдельной явной команды пользователя запрещены:

- production deploy;
- очистка/reset БД;
- pipeline reset/reparse;
- PM2 restart/reload;
- изменение `.env`, proxy, tunnel, CORS или infrastructure;
- destructive Git operations.

Локально разрешены code edits, tests, typecheck/lint и production build. Локальные dev/start/serve процессы не запускать.

## 6. Документация

Обновлять docs вместе с изменением, если меняется:

- публичный/internal API contract;
- schema или migration requirement;
- parser source semantics/provenance;
- operational workflow;
- повторяемый gotcha.

Не писать в docs секреты, prod dumps, временные SHA/PR как вечный контракт или неподтверждённые runtime claims.
