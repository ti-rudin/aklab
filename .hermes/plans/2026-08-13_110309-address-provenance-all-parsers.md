# Семантические адреса имущества и участники торгов — Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task. Production deploy is forbidden until explicit user command; production deployment must use `scripts/deploy-prod.sh --ref <SHA>`.

**Goal:** Исключить подмену адреса имущества адресом залогодержателя, организатора, должника или площадки во всех 10 активных парсерах; хранить происхождение адреса и участников раздельно; использовать только подтверждённую географию имущества для региона, фильтров и UI.

**Architecture:** Каждый парсер возвращает типизированный `property_location` и массив `parties`. Канонический `address` становится совместимой проекцией только из структурированного `property_location.address`; `city` вычисляется только из `property_location.region/region_code/address`. Свободное описание никогда не создаёт канонический адрес имущества. Оно может использоваться только внутри строго ограниченного блока для извлечения явно названного залогодержателя с отдельной ролью и provenance.

**Tech Stack:** TypeScript, Playwright/DOM, JSON API/XML/Nuxt SSR, shared parser package, Strapi 5 + SQLite, Vue 3/Vitest.

---

## 1. Обязательные инварианты

1. **Адрес имущества — только структурированный источник:**
   - HTML: отдельный DOM-элемент/строка, привязанный к блоку имущества или текущего лота;
   - API/XML/SSR: семантически именованное поле текущего объекта (`estateAddress`, `GeoDataAddress`, `address` и т. п.);
   - глобальный `document.body.innerText`, произвольный excerpt, title и полное описание не являются источником канонического адреса.
2. **Fail closed:** если отдельного поля полного адреса нет, сохраняются подтверждённые `region`, `region_code` и координаты, но `property_location.address` остаётся пустым со статусом `confirmed_region_only` или `missing`.
3. **География только имущества:** `city`, геокодинг, пользовательский scope и региональные фильтры получают только `property_location`. `parties[*].addresses` не могут влиять на географию объекта.
4. **Роли разделены:** залогодержатель/обеспеченный кредитор, должник, организатор, продавец и заказчик — самостоятельные роли. Банк не считается залогодержателем только потому, что это банк или организатор.
5. **Противоречия не скрываются:** если отдельное поле говорит «Конкурсный кредитор: Нет», а описание говорит «предмет залога в пользу ПАО…», сохраняется explicit provenance второго утверждения; первое не перезаписывается и не превращается в географию.
6. **Legacy `address`:** временно сохраняется для совместимости, но после перехода заполняется только как `property_location.address ?? null`. Обратное преобразование legacy `address → property_location` запрещено без повторной проверки источника.
7. **Никаких silent fallbacks:** селектор исчез или семантическое поле стало пустым — parser telemetry/лог отмечает `location_status=missing|schema_changed`; парсер не подставляет первое упоминание Москвы.

---

## 2. Предлагаемый общий контракт

### `services/_shared/src/types.ts`

```ts
export type PropertyLocationStatus =
  | 'confirmed_address'
  | 'confirmed_region_only'
  | 'missing'
  | 'legacy_unverified';

export type StructuredSourceKind =
  | 'dom_field'
  | 'api_field'
  | 'xml_field'
  | 'ssr_field';

export interface PropertyLocation {
  address?: string;
  region?: string;
  region_code?: string;
  latitude?: number;
  longitude?: number;
  status: PropertyLocationStatus;
  source_kind: StructuredSourceKind;
  /** CSS selector, API path, XML tag or SSR property path. */
  source_path: string;
}

export type PropertyPartyRole =
  | 'pledgee'
  | 'secured_creditor'
  | 'debtor'
  | 'organizer'
  | 'seller'
  | 'customer';

export interface PartyAddress {
  kind: 'legal' | 'postal' | 'actual' | 'unknown';
  value: string;
}

export interface PropertyParty {
  roles: PropertyPartyRole[];
  name: string;
  inn?: string;
  ogrn?: string;
  kpp?: string;
  addresses?: PartyAddress[];
  phone?: string;
  email?: string;
  /** DOM/API/XML field or bounded property-description block. */
  source_path: string;
  source_kind: StructuredSourceKind | 'bounded_text';
  confidence: 'structured' | 'explicit_text';
}
```

Изменение `ParsedProperty`:

```ts
property_location: PropertyLocation;
parties?: PropertyParty[];
/** Compatibility projection; never a source of truth. */
address: string;
```

### Shared helpers

Создать `services/_shared/src/property-location.ts`:

- `normalizeStructuredLocation(input): PropertyLocation` — trim/empty/coordinate validation без попыток искать адрес в тексте;
- `projectLegacyAddress(location): string`;
- `derivePropertyRegion(location): 'moscow' | 'mo' | 'tver' | 'tver_oblast' | 'other'`;
- `mergePropertyLocation(scan, details)` — Phase 2 заменяет Phase 1 только если новая структура не `missing`; сведения сторон не принимаются аргументом;
- `dedupeParties(parties)` — внутри одного объекта по `INN`, затем `OGRN`, затем нормализованному имени; объединяет роли и не смешивает типы адресов.

Запретить API вида `detectCity(text: string)` в parser pipeline. Для переходного периода переименовать текущий текстовый helper или закрыть его за adapter, но `parse-handler` должен принимать только `PropertyLocation`.

---

## 3. Результаты read-only аудита 10 активных парсеров

| Источник | Текущая логика | Live-структура | Риск | План |
|---|---|---|---|---|
| **fabrikant** | Phase 1 regex по title; detail regex по текстовому property section | Подтверждён отдельный DOM-контейнер `.panel-group-element-lot_delivery_place`; адрес в `.form-group-element-lot_delivery_place-address`, рядом отдельные ОКАТО/регион | **Высокий**: правильный DOM существует, но не используется | Извлекать address/region/OKATO только из `lot_delivery_place`; отдельно читать seller/organizer blocks; удалить title/text fallback |
| **torgi-gov** | Detail `estateAddress || lotAddress`; city по `subjectRFCode` | Live API двух лотов вернул `subjectRFCode=77` и корректный `estateAddress`; один свежий production row хранил вместо адреса «Офис, типовой ремонт…» | **Средний**: контракт хороший, production требует re-fetch/backfill и runtime regression | Использовать exact API paths; валидировать, что address пришёл из allowlist поля; fixture на оба лота; исследовать и повторно классифицировать stale row |
| **aggregator-bankrot** | Regex по excerpt/`#info`/description; fallback «Москва» из всего body | Live page имеет отдельный `Регион` и отдельный `#trade-organizer`, но полного структурированного адреса может не быть; местоположение часто внутри общего описания | **Критический** | Сохранять только структурированный region; full address = missing; удалить body/description fallback; organizer — отдельная party |
| **alfalot** | `.address`, затем regex из description | Подтверждены `.location-block .address`, `lot-info`, `debtor-info`, `organizer-info`; `.address` бывает пустым либо только регионом | **Высокий** | `.location-block .address` — единственный адресный DOM source; empty не дополнять из description; debtor/organizer — parties; отдельного pledgee не придумывать |
| **etprf** | Адрес regex только из property-description row; organizer postal address уже исключён | Подтверждены отдельные строки `Регион местонахождения имущества`, `Краткие сведения об имуществе`, organizer и `Почтовый адрес` | **Высокий**: organizer разделён, но full address всё ещё получается из свободного описания | Канонически хранить structured region; full address = missing, пока нет отдельного поля; organizer postal address — party; regex из имущества не использовать как canonical address |
| **sberbank-ast** | Listing `GeoDataAddress`; detail `textAddress || OrganizatorInfo_OrgAddressJur`; затем Moscow fallback по всему body | XML/DOM содержит `GeoDataAddress/textAddress`, отдельные `OrganizatorInfo_OrgAddressJur/Fact`, `CustomerInfo_*` | **Критический**: код прямо может записать юридический адрес организатора как имущество | Только `GeoDataAddress/textAddress`; удалить `OrgAddressJur` и body fallback; organizer/customer отдельно в parties; не трактовать `BidPledge` как залогодержателя без подтверждения семантики |
| **invest-mosreg** | API `fields` с поиском имени, fallback municipality; city hardcoded `mo` | Live API: отдельные поля `Адрес`/`Адресс`, объектные coordinates; participant fields в выборке не найдены | **Низкий/средний** | Exact normalized field-name allowlist (`адрес`, документированная опечатка `адресс`); municipality = region-only, не full address; provenance API path |
| **investmoscow** | Nuxt SSR tender `address/shortAddress/objectAddress`; city hardcoded Москва | Tender entity определяется наличием `startPrice/objectArea/address`, адрес находится внутри той же SSR entity | **Низкий** | Зафиксировать SSR provenance и fixture; city получать из structured region/address/catalog scope, а не произвольного hardcode без provenance; parties не создавать при отсутствии данных |
| **roseltorg** | Regex по excerpt и всему `document.body.innerText`, затем Moscow fallback | Production объектов нет; источник Qrator-блокирован, реальные detail selectors в этой сессии не подтверждены | **Критический/заблокирован** | Немедленно убрать body/excerpt → canonical address. До live DOM-аудита возвращать region из подтверждённого listing filter/structured row либо `missing`; полноценный adapter не принимать без fixture с доступного окружения |
| **m-ets** | Regex из общего description; city по title+seller region+description | Для `226787-1`: отдельный DOM `Регион местонахождения имущества=Республика Башкортостан`, coords и `data-region`; полного отдельного address field нет. Description смешивает адрес имущества и ПАО Сбербанк. `Конкурсный кредитор…=Нет` противоречит описанию залога | **Критический, подтверждённый инцидент** | Канонически region/coordinates only, address missing. ПАО Сбербанк извлекать только как party `pledgee` из bounded `Сведения об имуществе` с `explicit_text`; никогда не передавать его адреса в geography |

### Общий вывод по залогодержателям

Ни один текущий parser contract не умеет хранить залогодержателей отдельно. Наличие organizer/contact text не является заменой. На первой волне `pledgee/secured_creditor` создаются **только при явном обозначении роли источником**. Если источник публикует только должника/организатора, сохраняются только эти роли.

---

## 4. Порядок реализации (TDD)

### Task 1: Зафиксировать shared contract и compile-time boundary

**Files:**
- Modify: `services/_shared/src/types.ts`
- Create: `services/_shared/src/property-location.ts`
- Create: `services/_shared/src/__tests__/property-location.test.ts`
- Modify: `services/_shared/src/index.ts`

**RED tests:**

1. `derivePropertyRegion()` игнорирует party legal address `Москва`, если property region — `Республика Башкортостан`.
2. `mergePropertyLocation()` не заменяет confirmed region/address значением `missing`.
3. `projectLegacyAddress()` возвращает только `property_location.address`, не title/description.
4. `dedupeParties()` объединяет две записи ПАО Сбербанк по INN, сохраняя legal/postal addresses как разные kinds.
5. Tver cases: `г. Тверь` → `tver`; другая locality Тверской области → `tver_oblast`.

**Run:**
```bash
npx vitest run services/_shared/src/__tests__/property-location.test.ts
```

**Expected RED:** missing module/types; после минимальной реализации — PASS.

### Task 2: Закрыть географический pipeline типизированным объектом

**Files:**
- Modify: `services/_shared/src/parse-handler.ts`
- Modify: `services/_shared/src/strapi-client.ts`
- Modify: `services/_shared/__tests__/parse-handler.test.ts`
- Modify: `services/_shared/__tests__/strapi-client.test.ts`

**Tests:**

- detail возвращает party с московским legal address и property region Башкортостан → `city` остаётся `other`;
- M-ETS-like fixture без structured full address не получает address из description;
- Phase 2 structured address корректно заменяет `confirmed_region_only`;
- payload в Strapi содержит `property_location`, `parties`, а legacy `address` равен только confirmed full address;
- отсутствие property location не маскируется `title` fallback.

### Task 3: Расширить Strapi schema и service ingestion allowlist

**Files:**
- Modify: `api/src/api/property/content-types/property/schema.json`
- Modify: `api/src/api/property/controllers/property.ts`
- Modify: `api/src/api/property/services/property.ts`
- Modify: тесты internal/service upsert рядом с соответствующими controller/service tests
- Add a manual migration/backfill script under `scripts/` only after schema tests

**Schema fields:**

```json
"property_location": { "type": "json" },
"parties": { "type": "json", "default": [] }
```

`city` enum:

```json
["moscow", "mo", "tver", "tver_oblast", "other"]
```

**Boundary validation:**

- reject unknown `property_location.source_kind/status`;
- reject parties without non-empty `name`, role or provenance;
- trim identifiers, but do not silently reinterpret party address as property address;
- normalize JSON at Strapi ORM boundary according to existing SQLite JSON rules;
- keep parser-owned allowlist strict.

### Task 4: Wave A — источники с подтверждёнными structured full addresses

#### 4.1 Fabrikant

**Files:**
- Modify: `services/parser-fabrikant/src/sources/fabrikant.ts`
- Replace/extend: `services/parser-fabrikant/src/__tests__/extraction.test.ts`
- Add HTML fixture: `services/parser-fabrikant/src/__tests__/fixtures/property-location.html`

**Selector contract:**

```css
.panel-group-element-lot_delivery_place
.form-group-element-lot_delivery_place-address
.form-group-element-lot_delivery_place-region
.form-group-element-lot_delivery_place-okato
```

Fixture must include a seller/organizer legal address in Moscow and property address in another region; expected city follows property.

#### 4.2 Torgi Gov

**Files:**
- Modify: `services/parser-torgi-gov/src/sources/torgi-gov.ts`
- Modify: `services/parser-torgi-gov/src/__tests__/extraction.test.ts`
- Add JSON fixtures for compound IDs `..._4` and `..._6` with secrets absent

**API contract:** `estateAddress`, fallback `lotAddress` only if verified as address field, `subjectRFCode`, `point`. Add a shape guard so descriptive fields cannot be accepted through accidental key reuse.

#### 4.3 Sberbank-AST

**Files:**
- Modify: `services/parser-sberbank-ast/src/sources/sberbank-ast.ts`
- Modify: `services/parser-sberbank-ast/src/__tests__/extraction.test.ts`
- Add XML fixture with property outside Moscow and organizer/customer in Moscow

**Allowed property fields:** `GeoDataAddress`, `textAddress`, associated `Latitude/Longitude`.

**Forbidden fallbacks:** `OrganizatorInfo_OrgAddressJur`, `OrgAddressFact`, `CustomerInfo_*`, global Moscow regex.

**Parties:** map `OrganizatorInfo_* → organizer`, `CustomerInfo_* → customer`; do not infer pledgee.

#### 4.4 Invest Moscow / Invest Mosreg

**Files:**
- Modify parser files and existing extraction tests.

For Mosreg use normalized exact field-name allowlist including observed `Адресс`; `municipality` creates `confirmed_region_only`. For Invest Moscow capture `tender.address` provenance in the same resolved tender entity.

### Task 5: Wave B — region-only and role-separated sources

#### 5.1 M-ETS

**Files:**
- Modify: `services/parser-m-ets/src/sources/m-ets.ts`
- Rewrite address section in: `services/parser-m-ets/src/__tests__/extraction.test.ts`
- Add sanitized fixture: `services/parser-m-ets/src/__tests__/fixtures/226787-1.html`

**Structured geography:**

- `.generalview-container[data-region][data-regionid]`;
- `.lot-info-block.info-type_1 .lot-info-item` with exact label `Регион местонахождения имущества`;
- map coordinates only inside current `.generalview-container`.

**Canonical address:** missing for this fixture. Delete regex extraction from `[itemprop=description]`.

**Pledgee parser:** scope only to the exact `Сведения об имуществе...` value. Parse only an explicit phrase equivalent to `является предметом залога в пользу <entity>` and the immediately nested legal/postal/INN/OGRN data. Emit `source_kind='bounded_text'`, `confidence='explicit_text'`, `source_path` naming the exact lot-info row. Add negative test: organizer/footer/platform address must not become pledgee.

#### 5.2 ETPRF

Use exact labeled DOM row `Регион местонахождения имущества` for geography. Preserve `Почтовый адрес` only under organizer party. Do not turn addresses embedded in `Сведения об имуществе` into canonical full address in this wave.

#### 5.3 Aggregator Bankrot

Use exact `#info` labeled `Регион` row. Remove description/body Moscow fallbacks. Parse `#trade-organizer` to organizer party. Full address remains missing unless a later live fixture proves an independent object-address field.

#### 5.4 Alfalot

Use `.location-block .address` only when non-empty and tied to current lot. Empty element means no full address; `card.region` or a dedicated location text can be region-only. Parse `debtor-info` and `organizer-info` independently. Never infer pledgee from bank-like names.

### Task 6: Roseltorg fail-closed adapter

**Files:**
- Modify: `services/parser-roseltorg/src/sources/roseltorg.ts`
- Replace unsafe tests in: `services/parser-roseltorg/src/__tests__/extraction.test.ts`
- Add fixture only after successful live source access from an approved environment

Before a verified fixture exists:

- delete full-body/excerpt canonical address extraction and global Moscow fallback;
- retain only a structured listing scope if independently proven (e.g. source query OKATO as region provenance), otherwise location `missing`;
- mark parser run/source degraded or log selector contract missing, not success-with-guessed-address.

Do not introduce proxy/tunnel infrastructure without separate user approval.

### Task 7: Add Tver/Tver Oblast end-to-end

Recommended distinct values:

- `tver` — locality is the city of Tver;
- `tver_oblast` — Tver Oblast outside the city or region-only without proof of locality Tver.

**Files likely to change:**

- `services/_shared/src/property-location.ts`
- `services/_shared/src/__tests__/property-location.test.ts`
- `api/src/api/property/content-types/property/schema.json`
- `api/src/services/user-property-scope.ts`
- user-profile schema/service and tests
- `lib/parse-rules/src/index.ts` and tests
- `app/src/utils/formatters.ts`
- `app/src/components/settings/user-profile-form.ts`
- `app/src/components/settings/ParsingRulesPanel.vue`
- `app/src/components/properties/ParseLaunchPanel.vue`
- related Vue/Vitest tests

Update every hardcoded `moscow/mo/other` list found by repository search. Do not use party text to distinguish Tver city/oblast.

### Task 8: UI — transparent source and parties

**Files:**
- Modify: `app/src/views/PropertyDetailView.vue`
- Modify local `Property` interface currently declared in `PropertyDetailView.vue`
- Modify dashboard/list types where address is rendered
- Add/update tests in `app/src/views/__tests__/` and component test paths

**Detail card:**

1. Block **«Местонахождение имущества»**:
   - confirmed address;
   - region;
   - badge `Подтверждено полем источника` / `Подтверждён только регион` / `Адрес не подтверждён`;
   - source path shown in a collapsible technical line, not as raw HTML.
2. Block **«Участники и обременение»**:
   - entity name and roles;
   - INN/OGRN/KPP;
   - legal/postal/actual addresses with explicit labels;
   - never label a party address as object address.
3. Legacy row with `legacy_unverified` must show warning and must not be used as primary location.
4. Both themes/mobile/ARIA: semantic headings, definition lists, no horizontal overflow.

### Task 9: Clean object reset and full reparse

Historical address backfill is intentionally removed from scope. The project has no client traffic yet, and the production object catalog may be cleared during an explicitly approved cutover.

Create a narrow, explicit reset command with `audit` and `apply` modes. It must operate only on the disposable object domain and its derived records; it must not delete users, profiles, settings, sources, parser configuration, or other editorial/configuration data.

**Audit output before reset:**

- row counts for properties and every dependent/derived table selected for cleanup;
- counts of user-property states, comments, events, digest projections, queue jobs and media references affected by the reset;
- exact table allowlist and foreign-key order;
- database integrity result and backup path/checksum for apply mode;
- no row payloads, PII, tokens or secrets.

**Apply rules:**

1. Default to audit-only; `apply` requires an explicit absolute database path and confirmation flag.
2. Create and verify a fresh SQLite backup before writes.
3. Stop writers for the short maintenance window and drain/cancel parser/analyzer jobs for the old catalog.
4. Delete only the reviewed object-domain allowlist in a transaction and in foreign-key-safe order; rollback on any error.
5. Preserve users, user profiles, settings, sources and parser configuration.
6. Remove or quarantine orphaned object media only after the database transaction succeeds and the manifest is written.
7. Verify SQLite integrity, zero expected object-domain rows, and unchanged protected-table counts.
8. Deploy the exact accepted SHA, then run all active parsers from clean state and rebuild derived analysis/digest projections.
9. Emit a source-by-source acceptance report: found, created, confirmed address, region-only, missing, filtered, parties by role and schema-change failures.
10. Run first on dev; production reset/cutover remains a separately approved command.

### Task 10: Cross-parser contract suite

Create `services/_shared/__tests__/parser-location-contract.test.ts` or source-specific fixture tests with a common assertion helper.

Required adversarial fixtures:

1. Property in Bashkortostan + pledgee legal/postal address Moscow.
2. Property outside Moscow + organizer Moscow.
3. Empty `.address` + description containing Moscow.
4. Region-only property with no full address.
5. Multiple pledgees with distinct address kinds.
6. Footer/platform `itemprop=address` unrelated to lot.
7. Conflicting structured region and party address.
8. Tver city vs Tver Oblast.
9. Selector removed/schema changed → missing/degraded, not guessed value.
10. Multi-lot page — selector must remain scoped to current lot container.

---

## 5. Verification sequence

Local code verification only; do not run local dev servers.

```bash
# Narrow RED/GREEN runs per task
npx vitest run services/_shared/src/__tests__/property-location.test.ts
npx vitest run services/_shared/__tests__/parse-handler.test.ts
npx vitest run services/parser-m-ets/src/__tests__/extraction.test.ts
npx vitest run services/parser-sberbank-ast/src/__tests__/extraction.test.ts
# ...each parser-specific extraction test

# Full backend/parser suite
npx vitest run

# Builds
npm run build
npm run --prefix api build
npm run --prefix app build

# Frontend tests
npm run --prefix app test -- --run

git diff --check
```

After commit/push and explicit permission, verify on dev server using real pages/API:

- exact parser build SHA;
- one controlled sample per active source;
- persisted `property_location`, `parties`, legacy address projection and city;
- regression object `m-ets-268573190` classified by Bashkortostan property geography, not Sberbank Moscow address;
- no new parser uses `document.body.innerText` or free description for canonical address;
- UI clearly separates property location and party addresses.

Production deploy remains a later explicit command and must use immutable `scripts/deploy-prod.sh --ref <SHA>`.

---

## 6. Acceptance criteria

- [ ] All 10 active parsers return `property_location` with provenance/status.
- [ ] No canonical address extraction uses global body, title, excerpt or unrestricted description.
- [ ] All known organizer/customer/debtor fields map to parties, not property geography.
- [ ] Pledgee/secured creditor exists only when source explicitly states that role.
- [ ] `parse-handler` cannot call geography detection with arbitrary text.
- [ ] Sberbank organizer/customer Moscow addresses cannot overwrite property address.
- [ ] M-ETS `226787-1` does not become Moscow; PАО Сбербанк appears separately as pledgee with legal/postal details and explicit-text provenance.
- [ ] Empty/absent DOM address yields region-only/missing, never guessed address.
- [ ] Tver city and Tver Oblast work end-to-end in parser, DB, API scope, settings, labels and tests.
- [ ] Clean reset command audits and removes only the approved object-domain rows; protected configuration/user counts remain unchanged.
- [ ] Full clean reparse rebuilds the catalog exclusively with the new semantic location contract.
- [ ] Production remains unchanged until separately approved reset/cutover and deploy.

---

## 7. Risks and trade-offs

1. **Recall temporarily decreases:** fail-closed behavior will classify some national-source rows as `other` or region-only. This is preferable to false Moscow/МО inclusion.
2. **Some sources do not publish a separate full address:** M-ETS/ETPRF/Aggregator samples prove that «отдельный DOM address» is not universal. The system must represent honest absence instead of fabricating certainty.
3. **Roseltorg remains blocked by Qrator:** selector contract cannot be accepted from guesses; infrastructure changes require separate approval.
4. **Clean cutover compatibility:** add schema/API/UI support before reset; old object rows are disposable and will not be migrated field-by-field.
5. **Party role ambiguity:** organizer/customer/bank names do not prove pledgee status. Explicit role text is mandatory.
6. **Contradictory source fields:** retain provenance and do not silently choose a participant field for geography.

## 8. Decisions embedded in this plan

- JSON fields `property_location` and `parties` are preferred over immediate Strapi components: they match parser payloads, support multiple parties, and minimize schema breadth; API ingress validation remains mandatory.
- `tver` and `tver_oblast` are separate values to avoid treating the whole oblast as the city.
- Parsing bounded text is permitted for an explicitly named **party role**, not for canonical property location.
- Coordinates and structured region may be retained when full address is absent.
