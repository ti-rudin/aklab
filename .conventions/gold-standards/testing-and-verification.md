# Testing and Verification

## 1. Evidence ladder

Проверки выполняются от узких к широким:

1. exact regression test;
2. affected file/package suite;
3. affected package build/typecheck;
4. dependent package tests/build;
5. root suite;
6. production build;
7. runtime smoke на разрешённом environment.

Не запускать широкий suite вместо focused RED/GREEN: широкий шум не доказывает конкретный контракт.

## 2. RED

Корректный RED:

- test runner стартовал;
- тест упал по ожидаемой бизнес-причине;
- соседние существующие tests не сломаны test setup;
- failure исчезнет только после требуемого поведения.

Не являются RED:

- missing dependency/env;
- syntax/transform error в тесте;
- неверный path/config;
- падение unrelated baseline.

## 3. GREEN

После минимальной реализации:

- повторить exact test;
- запустить весь affected test file/package;
- проверить warnings/unhandled rejections;
- затем build/typecheck.

После corrective patch старый GREEN устаревает — повторить relevant gate.

Vitest/Jest include patterns должны охватывать все canonical test directories. Существование test-файла не является evidence, пока package script фактически не собрал и не выполнил его; сверять final file/test counts.

## 4. AKLAB команды

```bash
# Root backend/shared/parser tests
npx vitest run

# Один test file
npx vitest run path/to/test.ts --reporter=verbose

# Shared package
npm run --prefix services/_shared test
npm run --prefix services/_shared build

# API
npm run --prefix api test
npm run --prefix api build

# Frontend отдельно
npm run --prefix app test
npm run --prefix app build

# Formatting integrity
git diff --check
```

Если тест требует переменную, использовать только synthetic test-only value и не выводить реальные credentials.

## 5. Parser verification

Parser unit fixture не заменяет source/runtime acceptance.

После code gate отдельно проверить:

- реальный semantic field на source;
- selector/API/XML path;
- отсутствие party/full-text leakage;
- payload до и после shared pipeline;
- persistence и filter counters;
- bounded rate-limit behavior.

Live parser/server checks не выполнять локальным dev server и не запускать на production без соответствующей команды/этапа rollout.

## 6. Review

Security/auth/deploy/persistence/parser-geography изменения требуют независимого read-only review exact SHA/diff.

Review finding принимается только с:

- severity;
- file:line;
- нарушенным invariant;
- воспроизводимым сценарием;
- corrective test.

Self-report о review PASS перепроверяется lead на фактическом commit range.

## 7. Отчёт

В итоговом evidence указывать:

- точные команды;
- exit code/result и количество tests;
- build status;
- exact SHA/dirty state;
- intentionally unrun gates;
- blocker с полным классом причины: code, environment, network, permissions или external source.

Не писать «всё проверено», если runtime/server/deploy gate не выполнялся.
