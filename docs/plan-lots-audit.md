# План аудита многолотовости парсеров

Дата: 2026-08-19. База: `main`, репозиторий `v1.1.96`.
Триггер: инцидент Fabrikant (процедура с 3 лотами смешана в один
Property). Фикс Фабриканта — отдельный документ
[planlot.md](planlot.md). Этот файл — проверка остальных источников
и доработка, если они тоже сливают лоты.

Правила: каждая группа парсеров — отдельная feature-ветка → PR в `main`.
Сначала Fabrikant ([planlot.md](planlot.md)), затем ETPRF, затем
остальные по приоритету ниже. Git/deploy только по команде пользователя.
Live URL площадок в новый код не хардкодить — env / seeder `Source.url`.

---

## Инвариант

**1 лот = 1 Property.**

- `external_id` и `url` идентифицируют лот, не извещение/процедуру/торги.
- Title, price, area, description, `property_location` берутся из
  одного scoped-блока этого лота.
- Если detail-страница содержит N блоков имущества с разными
  регионом/ценой/кадастром, а текущий лот не выделен — fail-closed
  (`missing` / skip / `schema_mismatch`), не `querySelector` first/last
  по всему документу.
- Title не является географией. Конфликт «в title один субъект РФ, в
  typed address другой» — сигнал смешивания: skip, не угадывание city.

Контракт `fetchDetails(url) → ParserDetailResult` сейчас 1:1
([`services/_shared/src/types.ts`](../services/_shared/src/types.ts)).
Разбиение N лотов делать в `parse()` (как в плане Фабриканта), пока
не доказано, что 1→N нужен в shared handler. Если после аудита
три и более адаптера не могут эмитить лоты на scan — тогда отдельный
PR: `fetchDetails` возвращает массив, parse-handler создаёт N Property.
Не начинать этот PR «на всякий случай».

---

## Метод проверки (для каждого источника)

Повторять одинаково, чтобы не гадать по аналогии (ошибка с ETPRF
в разборе инцидента).

1. **Код:** listing identity (`external_id`, `href`), `fetchDetails`
   селекторы (`querySelector` vs scoped container), first/last Map.
2. **Live (readonly):** найти на площадке процедуру/извещение с ≥2
   лотами в разных регионах. Зафиксировать DOM: сколько property-блоков,
   есть ли lot-id в URL, совпадает ли first-match с «нашим» лотом.
3. **Решение:** `ok` / `fix-scope` / `fix-split` / `out-of-scope`.
4. **Фикстура:** sanitized HTML/JSON с двумя лотами (регион A и B).
   Positive: два Property или skip. Negative: запрещён mixed row.
5. Не продвигать title/body/organizer в `property_location`.

Доказательство «ok» без live-страницы с 2 лотами — только для
JSON/XML API, где каждый item уже lot-card (`torgi-gov`, listing
`sberbank-ast` XML row). Для Playwright-HTML live обязателен.

---

## Сводка по источникам (код, до live)

Приоритет = риск смешать поля + активен ли воркер.

### P0 — подтверждённый баг, чинится в planlot.md

**fabrikant** — procedure/view + first `.lot_delivery_place`.
Не дублировать работы здесь.

### P1 — тот же класс бага в коде, нужен live

**etprf** ([`services/parser-etprf/src/sources/etprf.ts`](../services/parser-etprf/src/sources/etprf.ts))

- Listing: строка `table.reporttable`, URL `/Notification/id/{id}`
  (извещение, не лот). `external_id = etprf-{lot_id}` из первой колонки.
- Details: все `.details-table tr`. `Map.set` — последний лейбл
  побеждает; `getFieldValue` — первый. Gotcha #70 как раз про «искать
  во всех таблицах».
- Фикстуры — один property-block.
- Работа: live извещение с ≥2 лотами в разных регионах. Если listing
  уже даёт N строк с одним notification URL — details должен выбирать
  секцию лота по `lot_id`, не first/last. Если listing — одна строка
  на извещение — expand в `parse()` по образцу Фабриканта
  (`etprf-{notificationId}-{lotNumber}`).
- Fail-closed, пока нет lot-scope: >1 «Регион местонахождения
  имущества» с разными значениями → skip.

**m-ets** ([`services/parser-m-ets/src/sources/m-ets.ts`](../services/parser-m-ets/src/sources/m-ets.ts))

- Listing per `lot_id`, URL `/lot/{id}` — формально уже сплит.
- Details: `querySelector('.lot-info-block.info-type_1')` — первый
  блок. Цену уже чинили (gotcha #74: `meta[itemprop=price]`).
- Работа: live multi-lot trade, открыть URL конкретного лота. Если
  DOM всё ещё содержит блоки соседей — scope к текущему лоту
  (itemprop/canonical lot id). Если URL один на торги — expand как
  Fabrikant.
- Не считать «уже исправлено», пока live не подтвердит, что
  info-type_1 на lot-URL один.

### P2 — проверить live, код не доказывает ok

**alfalot** — listing `.lot-card` с `/ {lotId}` в href. Details:
первый `.location-block > p.address` и первый
`.tab-content[data-page="lot-info"]`. Если деталь лота не содержит
соседей — `ok`. Если SPA торгов рендерит несколько lot-info —
`fix-scope`.

**aggregator-bankrot** — listing `article.card` + `lot_id`. Details:
`#info` current lot. Live: страница лота vs страница торгов с
несколькими лотами. Если `#info` один на лот-URL — `ok`. Если
агрегатор открывает торги целиком — `fix-scope` / `fix-split`.

**roseltorg** — listing строки таблицы, details geography сейчас
fail-closed `missing`. Многолотовость не чинить, пока нет
source-faithful location field и фикстуры
(`docs/parser-source-contracts.md`). Сначала контракт адреса, потом
lot-scope. Не угадывать селекторы «чтобы завести сплит».

**sberbank-ast** — listing XML `_source` / `PurchaseId`. Проверить
live, бывает ли одно `PurchaseView` с несколькими лотами в XML.
Если один `_source` = один лот — `ok`. Если detail XML содержит
массив лотов, а парсер берёт первый GeoDataAddress — `fix-split`.

### P3 — API per-item, код выглядит ok, короткая верификация

**torgi-gov** — search/detail JSON `lotcards/{notice}_{lot}`. Identity
уже lot-scoped. Проверка: один notice с несколькими `lotNumber`
даёт несколько Property с разными `external_id`. Если да — `ok` без
кода. Если scan схлопывает notice — `fix-split` (маловероятно по коду).

**investmoscow** — SSR тендер, нет `fetchDetails`. Один тендер = один
объект в payload. Live: бывает ли тендер с несколькими площадками/
адресами в одном `startPrice`. Если да — решение продукта (сплит
или skip). Не парсить адрес из title.

**invest-mosreg** — JSON map `uid`/`id` per place. Скорее `ok`.
Проверка: один place ≠ пачка участков в одном объекте.

### Out of scope

**fedresurs** — воркера нет в `services.json`, runtime выключен.
Не включать ради многолотовости. Если когда-нибудь вернут — лоты
уже ходят массивом `/biddings/{guid}/lots`; тогда 1 bidding ≠ 1
Property с первого шага.

---

## Этап A — Общий чеклист и диагностика

- [ ] A.1 Добавить в gotchas правило: multi-lot страница без scoped
      identity = fail-closed или N объектов, никогда merge first/last.
      Ссылка на инцидент Fabrikant и этот документ.
- [ ] A.2 Хелпер для тестов (опционально, не обязательный shared runtime):
      фикстура «два лота, два региона» + assert, что не существует
      Property с title региона A и address региона B.
- [ ] A.3 Не менять snapshot city-фильтр: `other` на scan по-прежнему
      не география из title. Сплит чинит данные, фильтр остаётся
      typed `property_location`.

Приёмка: правило записано; новый код парсеров без 2-lot fixture в PR
не принимается, если details читает глобальный `querySelector` property-блока.

---

## Этап B — ETPRF (после Fabrikant)

- [ ] B.1 Live: 2+ лота на `/Notification/id/…`, разные регионы.
      Зафиксировать, listing — N строк или одна.
- [ ] B.2 Fail-closed на конфликт лейбла «Регион местонахождения
      имущества».
- [ ] B.3 Lot-scope: секция лота по номеру/`lot_id`; URL и
      `external_id` уникальны на лот.
- [ ] B.4 Если listing одно извещение — expand в `parse()` по образцу
      [planlot.md](planlot.md) этап 2.
- [ ] B.5 Fixture `etprf/multi-lot-notification.html` (санитизированная).
      Запрет: first `getFieldValue` + last `Map.set`.

Приёмка: 2 лота → 2 Property или skip всех; mixed row невозможен.

---

## Этап C — М-ЕТС

- [ ] C.1 Live lot-URL на multi-lot trade: сколько `.lot-info-block.info-type_1`.
- [ ] C.2 Если >1 — scope к текущему `lot_id` (URL/itemprop). Не
      полагаться только на meta price.
- [ ] C.3 Fixture `m-ets/multi-lot-trade.html`. Цена, регион, описание
      одного лота.

Приёмка: соседний лот другого региона не протекает в details.

---

## Этап D — Alfalot, агрегатор, Сбер-АСТ

- [ ] D.1 По одному live примеру multi-lot (или запись «на площадке
      деталь всегда 1 лот» с URL-доказательством).
- [ ] D.2 Только при доказанном смешении — lot-scope / expand.
      Не рефакторить «профилактически».
- [ ] D.3 Fixture только если селектор меняется.

Приёмка: для каждого slug в contracts обновлён
`last live verification` и вердикт `ok | fix-*`.

---

## Этап E — Torgi / Invest Moscow / Invest МО / Росэлторг

- [ ] E.1 torgi-gov: тест или live, что notice с лотами 1 и 2 даёт
      два `external_id` (`…_1`, `…_2`).
- [ ] E.2 investmoscow / invest-mosreg: просмотр payload на пачку
      адресов. Если один тендер — один объект, документировать как
      ограничение источника, не баг.
- [ ] E.3 roseltorg: не делать multi-lot до location-контракта.

Приёмка: таблица внизу заполнена; для `ok` есть evidence (тест или
зафиксированный live URL в session notes, не в коде).

---

## Этап F — Shared 1→N (только если понадобится)

Критерий входа: ≥3 активных адаптера не могут эмитить лоты в `parse()`
(нет lot-id в listing, expand слишком дорогой).

- [ ] F.1 `fetchDetails` → `ParserDetailResult | ParserDetailResult[]`
      (или явный `fetchLots`).
- [ ] F.2 parse-handler: цикл createProperty по каждому результату,
      свой `external_id`, свой snapshot filter.
- [ ] F.3 Тесты handler: 1 URL, 2 detail results, 2 persist / 1 filter.
- [ ] F.4 Не включать F в PR Фабриканта.

---

## Порядок и зависимости

```
planlot.md (Fabrikant)  →  этап B ETPRF  →  этап C m-ets
        →  этап D по факту live  →  этап E короткая проверка
        →  этап F только по критерию входа
```

Этап A можно параллельно с Fabrikant.

Не деплоить «все парсеры сразу». Каждый источник — свой PR, свой
rollback.

---

## Таблица вердиктов (заполнять по мере аудита)

- fabrikant — `fix-split` — план: [planlot.md](planlot.md)
- etprf — `fix-split` (код) — live: TODO
- m-ets — `fix-scope?` — live: TODO
- alfalot — TODO
- aggregator-bankrot — TODO
- sberbank-ast — TODO
- torgi-gov — вероятно `ok` — verify: TODO
- investmoscow — вероятно `ok` / ограничение тендера — TODO
- invest-mosreg — вероятно `ok` — TODO
- roseltorg — blocked на location-контракт
- fedresurs — out of scope

---

## Что не делать

- Не чинить город-фильтр «по словам в title».
- Не копировать селекторы Фабриканта на другие площадки.
- Не объявлять парсер исправленным без 2-lot fixture или live
  доказательства «деталь = один лот».
- Не включать Fedresurs.
- Не хардкодить URL извещений/процедур в адаптерах.
