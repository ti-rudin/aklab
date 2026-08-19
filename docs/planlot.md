# План: многолотовость parser-fabrikant

Дата: 2026-08-19. База: `main`, репозиторий `v1.1.96`.
Инцидент: карточка `rj1dq0t2kn7grd3qdq68k4ky` в утреннем дайджесте.
Источник: процедура Фабриканта (аукцион №5566409), три лота на одной странице.

Правила выполнения: отдельная feature-ветка → PR в `main`.
Никаких git-операций и деплоя без отдельной команды пользователя.
Базовый URL площадки не хардкодить в новом коде — только env
(`FABRIKANT_BASE_URL` / существующая переменная источника).

Смежный документ: [plan-lots-audit.md](plan-lots-audit.md) — остальные парсеры.

---

## Инцидент (зафиксировано live DOM)

Страница процедуры содержит три независимых блока
`.panel-group-element-lot_delivery_place`:

- Лот 1 (`#lot-wX7x_Z_et7Pf_x73_wtspw`): ООО «ФИТСТАЛЬ»; Москва,
  Рязанский пр-кт, 24 к.2; 10 000 RUB
- Лот 2 (`#lot-lPiWChHcm7mVl0romGnZfA`): ООО «КОРС»; Москва,
  Ленинградский пр-кт, 80 к.66; 10 000 RUB
- Лот 3 (`#lot-fam6zd_D8QPKhagZdm_rUQ`): здание 3002,7 кв.м,
  «Бранская область», Клинцы, ул. Горького 31А; 70 136 153,26 RUB

На сайте уже есть lot-scoped маршрут:
`/v2/trades/procedure/lot/view/{procedureId}/{lotId}`.
В AKLAB попала ссылка на procedure-level
`/v2/trades/procedure/view/{procedureId}`.

Что сделал парсер ([`services/parser-fabrikant/src/sources/fabrikant.ts`](../services/parser-fabrikant/src/sources/fabrikant.ts)):

1. Scan берёт `[data-slot="card"][data-id]`. Keyword-фильтр
   (`PROPERTY_KEYWORDS`: «нежилое», «здание», …) отсекает лоты 1–2
   (предмет = название ООО). Проходит только лот 3.
2. `url` берётся из `anchor.href` — страница всей процедуры.
3. `fetchDetails` делает `document.querySelector('.panel-group-element-lot_delivery_place')`
   и Cheerio `.first()` — адрес **лота 1 (Москва)**.
4. Title details не возвращает → в карточке остаётся брянский title лота 3.
5. Description — regex `Лот №` по `document.body.innerText` (снова первый лот).
   Цена details не возвращает → остаётся цена карточки лота 3 (~70 млн).

Фильтр Москва/МО смотрит только typed `property_location`, не title.
Поэтому объект законно попал в дайджест. Analyzer посчитал отклонение
по Москве для площади/цены брянского здания.

Инвариант, который должен держать фикс:

**1 лот = 1 Property.** Title, price, area, description и
`property_location` из одного scoped-блока. Смешивать поля соседних
лотов запрещено.

---

## Архитектурное решение

Контракт `fetchDetails(url) → один ParserDetailResult` не менять в этом
плане (это общее изменение для всех парсеров, см. audit-док).
Разбиение лотов — в `parse()`:

- карточка поиска с href на `procedure/view` **не** становится одним
  Property;
- парсер один раз открывает страницу процедуры, читает все лоты
  (`#lot-{id}`, `.lot_head_*`, свой `lot_delivery_place` / `lot_price`);
- эмитит N кандидатов с `external_id = fabrikant-{lotId}` и URL
  lot-view;
- `fetchDetails` открывает lot-view (или procedure/view + якорь
  `#lot-{id}`) и извлекает **только** этот лот.

Если lot-view всё равно рисует соседние лоты — извлекать из контейнера
`#lot-{lotId}`, не из первого `querySelector` по документу.

Уникальность в БД уже есть: `(source, external_id)`.
Новый лот = новый `external_id`, не апсерт в карточку соседа.

---

## Этап 0 — Предохранитель (делать первым)

- [ ] 0.1 В `fetchDetails` / `extractPropertyLocationFromHtml`: если
      `querySelectorAll('.panel-group-element-lot_delivery_place').length > 1`
      и текущий `lotId` из URL/якоря не выделен — не возвращать
      first-match адрес. Fail-closed: `property_location.status = missing`
      + `schema_mismatch` (или throw, чтобы parse-handler skip).
      Смешанную карточку персистить нельзя даже до полного сплита.
- [ ] 0.2 Убрать `document.body.innerText` как источник description.
      Описание только из bounded поля текущего лота (предмет договора /
      заголовок `.lot_head_*`).
- [ ] 0.3 Тест: HTML с двумя `lot_delivery_place` (Москва + Брянск) без
      lot-scope → location `missing`, в payload нет московского адреса
      при брянском title.

Приёмка: на фикстуре инцидента без lot-scope объект не создаётся
(skip), а не попадает в каталог с чужим городом.

---

## Этап 1 — Identity и URL лота

- [ ] 1.1 Вынести базу площадки в env (`FABRIKANT_BASE_URL`), добавить в
      `.env.template` и `scripts/check-env.js`. Listing/search и lot-view
      собирать только из этой базы + path. Не копировать URL инцидента
      в код.
- [ ] 1.2 На scan сохранять `lotId` из `data-id`. Если `anchor.href`
      указывает на `procedure/view/{procedureId}` — строить
      `{FABRIKANT_BASE_URL}/v2/trades/procedure/lot/view/{procedureId}/{lotId}`.
      Procedure id брать из href карточки, не хардкодить.
- [ ] 1.3 `external_id` оставить `fabrikant-{lotId}` (уже так). Не
      использовать procedureId как identity.

Приёмка: у кандидата scan `url` содержит `/procedure/lot/view/` и
тот же `lotId`, что `external_id`.

---

## Этап 2 — Разбиение процедуры на N объектов

- [ ] 2.1 После сбора карточек поиска: сгруппировать unique
      `procedureId`. Для каждой процедуры, у которой карточка вела на
      procedure/view **или** на странице процедуры больше одного
      `#lot-*`, открыть процедуру один раз и извлечь все лоты.
- [ ] 2.2 На каждый лот эмитить отдельный `ParsedProperty`:
      title = заголовок лота («Лот №N. …»),
      price = `.panel-group-element-lot_price` этого лота,
      area = из title/предмета этого лота,
      listing location = `missing` (география только из delivery_place
      на details),
      url = lot-view,
      external_id = `fabrikant-{lotId}`.
- [ ] 2.3 Keyword-фильтр (`PROPERTY_KEYWORDS` / `EXCLUDE_KEYWORDS`)
      применять **к тексту лота**, не к названию процедуры. Лоты 1–2
      инцидента (предмет = ООО, но есть `lot_delivery_place` и
      классификатор «здания») **не отбрасывать** только из-за отсутствия
      слова «нежилое» в title. Правило: если у лота есть bounded
      delivery_place — это кандидат; EXCLUDE (жильё, авто, оборудование)
      по-прежнему режет. Коммерческий тип дальше решает
      `classifyPropertyType` + `isCommercialProperty`.
- [ ] 2.4 Дедуп по `lotId` внутри run: карточка поиска + expand
      процедуры не должны дать два кандидата одного лота.
- [ ] 2.5 Depth: N лотов с одной процедуры считаются N кандидатами
      (лимит `depth` как сейчас). Не раздувать без лимита.

Приёмка на фикстуре инцидента (санитизированные адреса):

- scan/expand даёт **3** кандидата с разными `external_id`;
- лот 3: брянский title, брянский delivery_place, цена ~70 млн;
- лоты 1–2: свои московские адреса и цены 10 000;
- ни у одного нет чужого региона/цены.

После snapshot-фильтра Москва/МО: лоты 1–2 проходят, лот 3 отсекается.
В дайджест брянское здание не попадает.

---

## Этап 3 — fetchDetails lot-scoped

- [ ] 3.1 `fetchDetails` принимает lot-view URL. Достаёт `lotId` из
      path. Ждёт `#lot-{lotId}` или соответствующий `.lot_head_*`.
- [ ] 3.2 Адрес/регион/ОКАТО — только
      `.panel-group-element-lot_delivery_place` **внутри контейнера
      этого лота**, не первый по документу.
- [ ] 3.3 Цена — `.panel-group-element-lot_price` этого лота (сейчас
      details цену не возвращает; вернуть, чтобы не оставлять цену
      соседнего лота с scan, если expand и details расходятся).
- [ ] 3.4 Contacts организатора можно брать из процедурной шапки
      (общие для лотов). Не брать адрес организатора как
      `property_location` (уже запрещено контрактом).
- [ ] 3.5 Если lotId в URL нет и на странице >1 delivery_place —
      fail-closed (этап 0), не first-match.

Приёмка: unit-тест на HTML трёх лотов + `fetchDetails` с lotId лота 3
возвращает только Клинцы, не Рязанский пр-кт.

---

## Этап 4 — Фикстуры и регрессия

- [ ] 4.1 Sanitized fixture `fabrikant/multi-lot-procedure.html` по
      форме аукциона 5566409: три `#lot-*`, три delivery_place, три
      цены. Без реальных ИНН/ФИО/телефонов — синтетика.
- [ ] 4.2 Кейсы:
      - expand → 3 ParsedProperty;
      - fetchDetails(lot3) → Брянск;
      - fetchDetails без lotId на той же HTML → missing / throw;
      - organizer postal (Татарстан) не становится адресом объекта.
- [ ] 4.3 Не использовать `body.innerText` в тестах как positive path
      для географии.

Приёмка: `npm --prefix services/parser-fabrikant test` (или vitest
extraction) зелёный; `npm run test:parser-contracts` не падает.

---

## Этап 5 — Данные инцидента

- [ ] 5.1 После мержа фикса: карточку `rj1dq0t2kn7grd3qdq68k4ky`
      отклонить или удалить. Не оставлять mixed row в фокусе/дайджесте.
- [ ] 5.2 Если в БД есть другие `fabrikant-*` с одним и тем же
      procedure URL и разными title/address — выборка и такая же
      зачистка. Только после команды пользователя и backup.

Пересчёт analyze/digest без чистой записи бессмысленен.

---

## Что не входит в этот план

- Изменение `SourceParser.fetchDetails` на массив результатов —
  только если audit остальных парсеров покажет, что 1→N нужен в
  shared handler. Тогда отдельный PR, не этот.
- Ослабление фильтра регионов через title («в названии Брянск»).
  Title по-прежнему не география.
- parser-etprf / m-ets — [plan-lots-audit.md](plan-lots-audit.md).
- Деплой на прод.

---

## Порядок работ

0 → 1 → 2 → 3 можно частично параллелить 1 с 0, но **не** включать
expand (этап 2) без предохранителя (этап 0): иначе снова смешаем
поля, только на большем числе карточек.
4 вместе с 2–3. 5 — после выкладки на dev/prod по команде.
