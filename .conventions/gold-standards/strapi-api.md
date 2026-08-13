# Strapi API and SQLite Boundary

## 1. Strapi 5

- Использовать `strapi.db.query(uid)` для domain relations и custom persistence.
- Не добавлять deprecated `entityService` в новый код.
- Читать фактический content-type schema и routes до изменения service/controller.
- Custom route требует явной auth/policy matrix и теста.
- Browser/admin, authenticated user и service-token routes — разные trust boundaries.

## 2. Parser ingestion

Parser upsert принимает только явный `PARSER_OWNED_FIELDS` allowlist.

Hard-cutover contract:

- `property_location` обязателен;
- parser/worker не отправляет `address`, `city`, `latitude`, `longitude`;
- API отклоняет эти stale caller fields, а не молча перезаписывает;
- DB geography columns вычисляются server-side только из validated `property_location`;
- nested JSON использует exact key allowlists, неизвестные keys отклоняются до identity lookup.

Запрещено:

- передавать request `data` в ORM через безусловный spread;
- принимать workflow, focus/scoring, user state, media-local или manual fields;
- silently trim canonical identity;
- принимать неизвестные enum/JSON shapes;
- доверять client role/ownership claims.

Валидировать до первого DB lookup/write:

- required identity;
- schema enums;
- finite numbers;
- URL/string/array shape;
- nested `property_location` и `parties` invariants;
- status/data consistency (`region-only` без address, `missing` без location data);
- pair/range coordinates;
- party fields не участвуют в DB geography projection.

## 3. JSON и SQLite

`strapi.db.query().create()` не выполняет REST JSON transform. JSON attributes сериализуются на ORM boundary:

```typescript
const createData = {
  ...validatedParserData,
  tags: JSON.stringify([]),
  photo_urls: JSON.stringify(validatedParserData.photo_urls ?? []),
  property_location: JSON.stringify(validatedParserData.property_location),
  parties: JSON.stringify(validatedParserData.parties ?? []),
};
```

Сериализовать только validated values. Не double-stringify. Runtime fixture на disposable SQLite должен подтверждать реальную форму, когда меняется persistence path.

## 4. Schema и migration

Schema, runtime allowlist и canonical enums меняются одним wave и покрываются contract tests.

- Новые typed blobs — explicit JSON attributes.
- Additive schema change не доказывает физическую legacy migration автоматически.
- Перед raw SQLite mutation: `.tables`, `.schema`, `PRAGMA foreign_key_list`, `PRAGMA index_list`.
- Relation table names не угадывать по Strapi schema.
- Unique constraint подтверждать физическим индексом, не только `unique: true` в JSON.

## 5. Scoped DTO

Multi-user reads используют один canonical positive scope.

- SELECT перечисляет explicit columns.
- Mapper возвращает allowlisted DTO.
- Internal IDs, relations, ownership и global workflow не протекают.
- JSON parsed строго: malformed provenance/parties fail closed; отсутствие required `property_location` — contract violation.
- Detail вне scope возвращает indistinguishable not-found semantics.
- Party data не участвует в city/profile scope predicate.

## 6. Raw SQL

Raw SQL не получает ORM-защиту автоматически.

- Все dynamic values — bindings.
- Sort/column names — allowlist.
- Filters должны воспроизводить canonical scope.
- SQLite datetime representation проверяется фактически.
- Query errors не превращаются в пустые результаты, если это скрывает отказ boundary.

## 7. Verification

Минимум для Strapi boundary change:

1. RED focused service/repository tests.
2. GREEN focused tests.
3. Full API suite.
4. `npm run --prefix api build`.
5. Schema/allowlist consistency test.
6. `git diff --check`.
7. Runtime DB contract отдельно от mocks, если изменена реальная persistence/migration форма.
