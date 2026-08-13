# Shared Contracts

## 1. Один canonical contract

Общие типы и нормализация должны иметь один источник истины в shared package. Нельзя создавать локальные несовместимые копии enum, region list, property type или provenance status.

Примеры источников истины:

- regions и parse rules — `@aklab/parse-rules`;
- parser property types — `services/_shared/src/types.ts`;
- structured location helpers — `services/_shared/src/property-location.ts`.

Consumer импортирует canonical values либо реализует узкую security-validation на своей trust boundary с contract tests, доказывающими совпадение.

## 2. Property location

География имущества представляется обязательным `property_location`.
Parser/worker HTTP payload не содержит `address/city/latitude/longitude`: эти DB-колонки являются только server-derived денормализованной проекцией typed location.

Инварианты:

- `confirmed_address` требует непустой структурированный address;
- `confirmed_region_only` требует region, region_code или пару координат и не содержит address;
- `missing` не содержит location data;
- координаты передаются только парой и проходят finite/range validation;
- `source_kind` ограничен семантически структурированными источниками;
- `source_path` непустой и указывает конкретное поле/селектор;
- `derivePropertyRegion()` читает только typed location;
- денормализованный address появляется только из `confirmed_address`.
- parser output без `property_location` отклоняется до artifact, identity lookup и persistence.
- статус `legacy_unverified` отсутствует; hard cutover не поддерживает legacy payload compatibility.

## 3. Parties отдельно от имущества

`parties` хранит должника, организатора, продавца, заказчика, залогодержателя и иных участников.

- Party address никогда не становится property address.
- Party должен иметь роль, имя и provenance.
- Адреса party имеют отдельный `kind`: legal/postal/actual/unknown.
- Dedup: INN → OGRN → нормализованное имя.
- Merge объединяет роли и адреса, но не переносит их в geography.
- UI показывает property location/provenance и party addresses в разных семантических секциях; party address никогда не подписывается как адрес объекта.

## 4. Merge semantics

Scan и details объединяются целыми provenance records:

- `missing` details не ослабляет более сильное scan evidence;
- более слабый detail record не понижает scan record;
- detail record равной или большей силы заменяет scan record целиком;
- поля разных `source_path/source_kind` нельзя смешивать в одном `PropertyLocation`;
- полный адрес сильнее region-only;
- parties объединяются отдельным helper;
- после чтения scan artifact typed data заново валидируется — JSON artifact не является trusted input.

Запрещён `Object.assign(prop, details)` без фильтрации и domain-aware merge.

## 5. Boundary discipline

Каждая граница валидирует собственный input:

```text
source parser
  → ParsedProperty
  → scan artifact validation
  → details merge
  → local derived projections for filtering
  → Strapi client
  → typed-only HTTP payload
  → API parser-owned allowlist
  → server-derived DB projections
  → SQLite serialization
  → scoped DTO mapping
```

Нельзя считать TypeScript type runtime-валидацией. Нельзя молча отбрасывать typed fields на промежуточной границе.

## 6. Tests

Минимальная contract matrix:

- valid full address;
- valid region-only;
- missing;
- invalid source kind/path;
- incomplete/out-of-range coordinates;
- Tver city vs Tver oblast;
- non-property region classification;
- scan/details strength merge;
- party dedup и role merge;
- доказательство, что party address не влияет на city/address.
