# AKLAB Gold Standards

Этот каталог — нормативная точка входа для изменений AKLAB. `docs/editrule.md` намеренно не используется: правила разработки и эталонные паттерны живут здесь.

## Как пользоваться

Перед изменением кода:

1. Прочитать `docs/compact-doc.md` и релевантный раздел `docs/gotchas.md`.
2. Прочитать этот `README.md` и тематический стандарт ниже.
3. Проверить фактический код, schema, routes и тесты на текущем `HEAD`.
4. Зафиксировать `git status --short --branch` и отделить чужой WIP от своего scope.
5. Для нового поведения выполнить RED → GREEN → REFACTOR.

## Стандарты

- [`workflow-and-ownership.md`](workflow-and-ownership.md) — discovery, scope, concurrent worktree, side effects.
- [`shared-contracts.md`](shared-contracts.md) — canonical types, normalization, merge и legacy projection.
- [`parser-extraction.md`](parser-extraction.md) — source-faithful extraction, property location и parties.
- [`strapi-api.md`](strapi-api.md) — Strapi 5, Query Engine, allowlists, JSON/SQLite и scoped DTO.
- [`testing-and-verification.md`](testing-and-verification.md) — TDD и доказательный verification ladder.
- [`git-release-deploy.md`](git-release-deploy.md) — staging, commits, PR, immutable production deploy.

## Приоритет источников

При противоречии использовать следующий порядок:

1. Явная текущая команда пользователя и ограничения текущей задачи.
2. Проверяемый security/data-integrity invariant.
3. Фактический schema/API/runtime contract на текущем `HEAD` и его тесты.
4. Этот каталог.
5. `docs/compact-doc.md`, тематические документы и `docs/gotchas.md`.
6. Исторические plans/sessions и старые комментарии.

Историческое описание не является доказательством текущего поведения. Проверять код и тесты напрямую.

## Эталонные файлы проекта

- Shared property contract: `services/_shared/src/property-location.ts` и его focused tests.
- Pipeline boundary: `services/_shared/src/parse-handler.ts`, `services/_shared/src/strapi-client.ts`.
- Canonical region contract: `lib/parse-rules/src/index.ts`.
- Strapi schema/API boundary: `api/src/api/property/content-types/property/schema.json`, `api/src/api/property/services/property.ts`.
- Scoped multi-user projection: `api/src/services/user-property-scope.ts`.
- Service manifest: `services/services.json`.
- Production applier: `scripts/deploy-prod.sh`.

Эталонный файл — образец архитектурной формы, но не разрешение копировать его дефекты. Перед переиспользованием нужен focused test и review.
