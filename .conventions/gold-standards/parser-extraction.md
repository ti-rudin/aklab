# Parser Extraction

## 1. Source-faithful extraction

Парсер извлекает данные только из поля, семантически относящегося к текущему лоту/имуществу.

Допустимые источники property location:

- отдельное DOM-поле адреса/региона имущества;
- именованное API field текущего lot/property;
- XML field текущего lot/property;
- SSR payload field текущего объекта.

Недопустимые источники geography:

- `document.body.innerText`;
- title, description, excerpt или произвольный full text;
- «первый похожий адрес»;
- адрес организатора, должника, продавца, заказчика, банка или залогодержателя;
- hardcoded city без source contract, явно доказывающего фиксированный регион.

Если подтверждённого поля нет: `missing`. Если есть только регион: `confirmed_region_only` с пустым legacy address.

## 2. Provenance

Каждый typed location содержит:

- точный `source_kind`;
- стабильный `source_path`, например `lot.address`, `GeoDataAddress`, `.property-address`;
- status, соответствующий фактической полноте данных.

Не указывать provenance шире реального источника: `document.body` и `description regex` не являются structured field.

## 3. Parties

Party-данные извлекаются только из ограниченного party block/field.

- роль назначается только при явном label/context;
- legal/postal/actual адрес сохраняется внутри party;
- контакты не участвуют в property geography;
- bounded text допустим только для явно ограниченного party block, не для всей страницы.

## 4. Scan и details

- Listing location может быть `missing`, если detail page содержит точное поле.
- Details не имеет права возвращать legacy address без typed `property_location`.
- Исчезнувший selector — schema/degraded signal, не повод сканировать всю страницу.
- Каждый Playwright page закрывается в `finally`; shared context создаётся pipeline и не закрывается parser-методом.
- Никаких неограниченных retry; delays/backoff задаются с первого релиза parser integration.

## 5. Другие поля

- Price units нормализуются явно; не угадывать масштаб.
- `minimum_price` не означает обычную стартовую цену и заполняется только из подтверждённого бизнес-поля.
- Auction deadline не подменяется датой начала.
- URL проверяется как конкретная рабочая public detail/source ссылка, а не только HTTP 200 SPA shell.
- Classification может читать title/description, но geography — нет.

## 6. TDD fixture matrix

Для каждого parser source нужны fixtures/tests:

1. подтверждённый address/region field;
2. поле отсутствует → `missing`;
3. party address существует, property address отсутствует → geography не меняется;
4. title/description содержат другой город → geography не меняется;
5. координаты валидны/невалидны;
6. точный `source_path/source_kind`;
7. scan/details merge;
8. regression конкретного production incident, если он был.

Тест должен вызывать реальный extraction helper/parser path, а не повторять regex внутри теста.

## 7. Integration checklist

После parser-focused GREEN:

- parser package build;
- shared pipeline tests;
- parser payload проходит Strapi API allowlist/schema;
- runtime проверка выполняется только на разрешённом сервере после push/pull;
- найдено/записано/прошло фильтры/исключено показывается по каждому source, а не одним общим итогом.
