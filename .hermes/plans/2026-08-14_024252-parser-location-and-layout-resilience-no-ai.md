# Устойчивые парсеры и устранение `property_location=missing` — Implementation Plan

> **For Hermes:** Реализовывать план по волнам с TDD и независимой проверкой. AI/LLM-компоненты исключены из scope. Не запускать локальные dev-серверы. Не выполнять push, PR, deploy, очистку каталога или production reparse без отдельной явной команды Александра.

**Goal:** Устранить сохраняемые `property_location=missing` для успешно загруженной недвижимости, безопасно извлекать адрес/регион только из полей текущего имущества и сделать изменения верстки источников обнаруживаемыми до загрязнения или незаметного обеднения каталога.

**Architecture:** Source adapter сначала отделяет bounded property domain от organizer/debtor/pledgee domains, затем общий детерминированный resolver извлекает явно размеченный адрес и нормализует регион. Run-scoped telemetry получает метрики качества извлечения и semantic layout fingerprint; live canary probes проверяют ограниченный набор карточек без записи Property. При schema drift источник fail-closed получает `schema_changed`/`degraded`, алерт дедуплицируется, а автоматический fallback к `body.innerText`, title, excerpt или party address запрещён.

**Tech Stack:** TypeScript, Playwright, Vitest, Strapi 5, SQLite Queue, существующие `parser-run`/`parser-run-source`, GitHub Actions, Strapi email provider. Без AI.

---

## 1. Scope и исходное состояние

### Входит в работу

1. Завершение текущего исправления `property_location=missing` для:
   - M-ETS;
   - Aggregator Bankrot;
   - ETPRF;
   - Alfalot.
2. Исправление подтверждённого ETPRF browser-context сбоя: imported `parsePrice()` не должен выполняться внутри `page.evaluate()`.
3. Реальные очищенные fixtures и adversarial contract tests.
4. Пер-source observability:
   - listing/detail success;
   - наличие bounded property block;
   - наличие location labels;
   - `confirmed_address` / `confirmed_region_only` / `missing`;
   - schema fingerprint / schema mismatch.
5. Live canary probes без создания/обновления Property.
6. Threshold-based health classification, алерты, recovery event и runbook.
7. Controlled recovery/reparse только как отдельно одобряемая операция.

### Не входит

- AI/LLM extraction, AI browser agents, vector search или prompt pipeline;
- эвристика по `document.body.innerText`, title, excerpt или первому похожему адресу;
- автоматическое переписывание или деплой parser code;
- historical backfill: каталог disposable, после релиза используется targeted/full reparse;
- автоматический production deploy;
- прокси/туннели или иные инфраструктурные изменения;
- `npm audit --force`, Strapi downgrade/major upgrade или unrelated dependency wave.

### Текущее локальное состояние, которое необходимо сохранить

Ветка: `fix/property-location-missing`.

Незакоммиченный WIP уже затрагивает 11 файлов:

- `services/_shared/src/property-location.ts`;
- `services/_shared/src/index.ts`;
- `services/_shared/src/__tests__/property-location.test.ts`;
- source/test пары M-ETS, Aggregator Bankrot, ETPRF и Alfalot.

Подтвержденная промежуточная проверка:

```text
shared + 4 parser package builds: PASS
focused Vitest: 5 files, 135 tests passed
```

Эти изменения нельзя reset/stash/переписывать широким patch. Сначала перечитать diff и продолжать поверх него.

---

## 2. Обязательные инварианты

1. `property_location` извлекается только из API/SSR/XML/DOM-поля текущего имущества либо из уже отделенного bounded property-description field.
2. Bounded text extractor принимает не страницу и не смешанный блок, а только значение конкретного property field.
3. Party domains (`organizer`, `debtor`, `pledgee`, `secured_creditor`, `seller`, `customer`) не участвуют в property geography.
4. `address` и `city` — только legacy projections validated `property_location`.
5. `confirmed_address` сильнее `confirmed_region_only`, а `missing` не перезаписывает более сильный scan result.
6. После успешного detail fetch недвижимость с итоговым `missing` не записывается как обычная Property: она считается `location_unresolved`, попадает в telemetry/skipped counter и остается доступной для диагностического reparse, но не загрязняет пользовательский каталог.
7. `confirmed_region_only` разрешен как безопасный промежуточный результат, если источник явно связал регион с текущим имуществом.
8. Изменение selector/label не включает широкий fallback. Оно порождает `schema_changed` или `degraded` с bounded diagnostics.
9. Telemetry не содержит HTML, персональные адреса, credentials или полный текст карточки. Сохраняются только счетчики, allowlisted label IDs и hash fingerprint.
10. Canary не пишет Property, не очищает каталог и не запускает analytics/digest.

---

## 3. Целевой поток

```text
listing/API
  ↓
source adapter
  ├─ property domain
  └─ party domains (отдельно)
  ↓
bounded deterministic extractor
  ↓
PropertyLocation validator
  ├─ confirmed_address
  ├─ confirmed_region_only
  └─ missing/location_unresolved
  ↓
run-scoped extraction telemetry + semantic fingerprint
  ↓
policy
  ├─ healthy → persist
  ├─ unresolved single item → skip + diagnose
  └─ systemic drift → schema_changed/degraded + alert
```

Live canary использует тот же source adapter/extractor, но останавливается до persistence.

---

# Wave 1 — Завершить текущий location correctness fix

## Task 1: Зафиксировать WIP и превратить live evidence в fixtures

**Objective:** Не зависеть от исчезающих карточек и inline строк; сохранить минимальные source-faithful примеры без party contamination.

**Files:**

- Create: `services/parser-m-ets/src/__tests__/fixtures/property-location.html`
- Create: `services/parser-m-ets/src/__tests__/fixtures/pledgee-address-adversarial.html`
- Create: `services/parser-aggregator-bankrot/src/__tests__/fixtures/property-location.html`
- Create: `services/parser-aggregator-bankrot/src/__tests__/fixtures/region-only.html`
- Create: `services/parser-etprf/src/__tests__/fixtures/property-location.html`
- Create: `services/parser-etprf/src/__tests__/fixtures/organizer-postal-address.html`
- Create: `services/parser-alfalot/src/__tests__/fixtures/property-location.html`
- Create: `services/parser-alfalot/src/__tests__/fixtures/organizer-address-adversarial.html`
- Modify: соответствующие `src/__tests__/extraction.test.ts`

**Steps:**

1. Снять `git diff --name-only` и убедиться, что нет чужого WIP вне 11 перечисленных файлов.
2. В fixtures оставить только DOM-структуру и labels, необходимые extractor'у.
3. Заменить реальные ФИО, телефоны, email, ИНН и не относящиеся к тесту party details.
4. Сохранить адрес имущества и конфликтующий party address только там, где они необходимы для adversarial assertion.
5. Перевести новые inline RED cases на чтение fixtures через `readFileSync(new URL(..., import.meta.url))`.
6. Проверить, что fixtures не содержат token/cookie/session/API key.

**Acceptance:** Каждый источник имеет positive и negative fixture; тесты не требуют live network.

## Task 2: Завершить shared bounded address extractor

**Objective:** Поддержать реальные формы русскоязычных property labels без расширения trust boundary.

**Files:**

- Modify: `services/_shared/src/property-location.ts`
- Modify: `services/_shared/src/__tests__/property-location.test.ts`
- Modify: `services/_shared/src/index.ts`

**Required positive forms:**

- `Адрес: ...`;
- `Адрес (местоположение): ...`;
- `Адрес местоположения объекта: ...`;
- `Место нахождения: ...`;
- `расположен/расположенный по адресу: ...`;
- `Почтовый адрес ориентира: ...`.

**Required termination fields:**

- кадастровый номер;
- площадь;
- категория/назначение/вид использования;
- ограничения/обременения;
- начальная цена/задаток;
- следующий явный label.

**Negative tests:**

- `Почтовый адрес` организатора;
- адрес должника;
- адрес залогодержателя;
- arbitrary unlabelled geography;
- полный `body.innerText`/mixed container;
- email/URL вместо адреса.

**Implementation rule:** Не добавлять source-specific selectors в shared helper. Shared отвечает только за bounded text grammar и validation.

**Run:**

```bash
npx vitest run services/_shared/src/__tests__/property-location.test.ts
```

**Expected:** PASS; negative party cases остаются `undefined`.

## Task 3: Завершить M-ETS mapping

**Objective:** Извлекать адрес из `.lot-info-block.info-type_1` и explicit property region, не читая contact/pledgee blocks.

**Files:**

- Modify: `services/parser-m-ets/src/sources/m-ets.ts`
- Modify: `services/parser-m-ets/src/__tests__/extraction.test.ts`

**Contract:**

- property description: `[itemprop="description"]` только внутри `.lot-info-block.info-type_1`;
- region: label `Регион местонахождения имущества` в том же property block;
- contacts/parties: отдельные blocks, никогда не входящие в location input;
- full address → `confirmed_address`;
- explicit region без full address → `confirmed_region_only`;
- оба отсутствуют → `missing` и diagnostic, без title/body fallback.

**Tests:**

- property Волгоград + pledgee Москва → Волгоград;
- property без адреса + explicit region → region-only;
- только pledgee address → missing;
- listing `missing` не перезаписывает stronger detail location.

## Task 4: Завершить Aggregator Bankrot mapping

**Objective:** Использовать exact labelled rows из `#info`, а не mixed panel text.

**Files:**

- Modify: `services/parser-aggregator-bankrot/src/sources/aggregator-bankrot.ts`
- Modify: `services/parser-aggregator-bankrot/src/__tests__/extraction.test.ts`

**Allowlisted rows:**

- `Адрес местонахождения`;
- `Регион`;
- `Общая информация` как bounded property field, из которого helper принимает только explicit address label.

**Tests:**

- dedicated address имеет приоритет;
- address внутри `Общая информация` извлекается;
- explicit `Регион` дает region-only;
- `Организатор` с московским адресом игнорируется;
- неизвестный label не считается location.

## Task 5: Завершить ETPRF mapping и browser-context fix

**Objective:** Вернуть полноценную detail extraction и исключить `ReferenceError: service_shared_1 is not defined`.

**Files:**

- Modify: `services/parser-etprf/src/sources/etprf.ts`
- Modify: `services/parser-etprf/src/__tests__/extraction.test.ts`

**Implementation:**

1. `page.evaluate()` возвращает только raw strings/numbers из DOM.
2. `parsePrice()` вызывается после `page.evaluate()`, в Node context.
3. Property description берется из `Сведения об имуществе` / `Краткие сведения об имуществе`.
4. Region берется из `Регион местонахождения имущества`.
5. `Почтовый адрес` организатора остается party/contact field.

**Tests:**

- imported helper никогда не вызывается внутри evaluate callback;
- property description Ярославская область + organizer postal Казань → Ярославская область;
- explicit region fallback;
- missing при отсутствии обоих property fields;
- price parsing продолжает работать после переноса в Node context.

## Task 6: Завершить Alfalot mapping

**Objective:** Использовать hydrated `.location-block > p.address`, затем bounded `Описание`, не organizer tab.

**Files:**

- Modify: `services/parser-alfalot/src/sources/alfalot.ts`
- Modify: `services/parser-alfalot/src/__tests__/extraction.test.ts`

**Order:**

1. hydrated detail address;
2. explicit address label внутри bounded lot description;
3. card region as region-only;
4. missing.

**Tests:**

- detail address priority;
- explicit address в `Описание`;
- card region-only;
- organizer address ignored;
- hydration timeout не приводит к body fallback.

## Task 7: Запретить persistence итогового real-estate `missing`

**Objective:** `missing` может существовать между scan/details и в diagnostics, но не становится обычной пользовательской Property после успешной detail phase.

**Files:**

- Modify: `services/_shared/src/parse-handler.ts`
- Modify: `services/_shared/__tests__/parse-handler.test.ts`
- Modify: `services/_shared/src/types.ts`
- Modify: `services/_shared/src/strapi-client.ts` only if a new exact skip reason must cross the existing boundary

**Behavior:**

- после merge detail+scan повторно canonicalize location;
- если недвижимость и status остается `missing`, не вызывать `createProperty()`;
- увеличить explicit `location_unresolved`/`skipped` counter;
- записать bounded error reason с `source`, `external_id`, `source_path`, но без raw description/party address;
- network/detail failure остается failure, а не подменяется `location_unresolved`.

**RED tests:**

1. Real estate + details success + missing → no persistence, one unresolved skip.
2. `confirmed_region_only` → persistence разрешена.
3. `confirmed_address` → persistence разрешена.
4. Party address не превращает missing в confirmed.
5. Detail request failed → item failure, не unresolved.

---

# Wave 2 — Сделать layout drift измеримым

## Task 8: Добавить extraction quality counters в существующую run-scoped telemetry

**Objective:** Расширить текущий authoritative `parser-run-source`, не создавать параллельную систему counters.

**Files:**

- Modify: `services/_shared/src/types.ts`
- Modify: `services/_shared/src/parse-handler.ts`
- Modify: `services/_shared/src/strapi-client.ts`
- Modify: `services/_shared/__tests__/parse-handler.test.ts`
- Modify: `services/_shared/__tests__/strapi-client.test.ts`
- Modify: `api/src/services/parser-run-telemetry.ts`
- Modify: `api/src/services/__tests__/parser-run-telemetry.test.ts`
- Modify: `api/src/api/parser-run-source/content-types/parser-run-source/schema.json`
- Modify: `api/src/api/parser-run-source/controllers/parser-run-source.ts`
- Modify: `api/src/api/parser-run-source/controllers/__tests__/parser-run-source.test.ts`
- Modify: `docs/run-scoped-parser-telemetry.md`

**New exact counters:**

```ts
property_block_found: number;
location_label_found: number;
location_confirmed_address: number;
location_confirmed_region_only: number;
location_missing: number;
location_unresolved: number;
schema_mismatch: number;
```

**Validation:** Все counters — non-negative safe integers; terminal snapshot сохраняется целиком и идемпотентно, как существующие counters.

**Invariant:** `location_confirmed_address + location_confirmed_region_only + location_missing` не может превышать число обработанных candidates соответствующей stage.

## Task 9: Ввести bounded adapter diagnostics и semantic fingerprint

**Objective:** Отличать отсутствие данных в конкретном лоте от изменения структуры источника.

**Files:**

- Create: `services/_shared/src/parser-diagnostics.ts`
- Create: `services/_shared/src/__tests__/parser-diagnostics.test.ts`
- Modify: `services/_shared/src/types.ts`
- Modify: `services/_shared/src/index.ts`
- Modify: source adapters всех активных parsers поэтапно, начиная с четырех исправляемых.

**Proposed contract:**

```ts
interface ParserExtractionDiagnostics {
  schema_version: 1;
  property_block_found: boolean;
  location_label_id?: string; // allowlisted semantic ID, не raw text
  schema_mismatch?: 'property_block_missing' | 'location_label_missing' | 'detail_payload_changed';
  semantic_fingerprint: string; // SHA-256 canonical allowlisted shape
}
```

**Fingerprint input:** Только нормализованный список известных block/label IDs и parser adapter version. Никогда не hash всего HTML как единственный signal и не сохранять raw HTML в telemetry.

**Tests:**

- cosmetic class/order changes при сохраненной семантике не меняют semantic fingerprint;
- исчезновение property block меняет fingerprint и ставит mismatch;
- party labels не входят в property fingerprint;
- fingerprint deterministic между процессами.

## Task 10: Классифицировать source health по текущему run и baseline

**Objective:** Не объявлять source healthy только потому, что PM2/HTTP `/health` отвечает.

**Files:**

- Create: `api/src/services/parser-source-health.ts`
- Create: `api/src/services/__tests__/parser-source-health.test.ts`
- Modify: `api/src/services/pipeline/index.ts`
- Modify: `api/src/api/source/content-types/source/schema.json`

**Source summary fields:**

```text
parser_health_status: healthy | degraded | schema_changed | blocked
last_health_checked_at
last_schema_fingerprint
last_health_reason
last_health_alert_at
last_health_recovered_at
```

**Initial policy:**

- immediate `schema_changed`:
  - canary expected property block отсутствует;
  - `schema_mismatch > 0` на majority detail samples;
  - details candidates есть, но critical property field исчез для всех.
- `degraded`:
  - `details_ok/details_attempted` упал минимум на 20 percentage points против median последних 5 healthy runs при sample `>=20`;
  - location missing/unresolved rate вырос минимум на 20 percentage points при sample `>=20`;
  - confirmed count стал 0 при ненулевом historical baseline.
- `blocked`: anti-bot/rate-limit/HTTP block подтвержден typed error class.
- `healthy`: hard checks пройдены и quality ratios остаются в baseline envelope.

**Anti-noise:** Малые samples не сравнивать процентами; использовать minimum sample и absolute failure rules.

---

# Wave 3 — Fixtures, CI и live canary

## Task 11: Ввести parser contract matrix для всех активных источников

**Objective:** Каждый parser документирует trusted property fields и forbidden party fields.

**Files:**

- Create: `docs/parser-source-contracts.md`
- Modify/Create fixtures и extraction tests в `services/parser-*/src/__tests__/` для всех активных parsers.

**Matrix columns:**

- listing contract;
- detail contract;
- trusted property address field;
- trusted property region field;
- party domains;
- hydration/wait condition;
- expected location statuses;
- known anti-bot/TLS condition;
- canary fixture IDs;
- last live verification date.

**Per-source minimum fixture set:**

1. `confirmed_address`;
2. `confirmed_region_only` if supported;
3. party-address adversarial;
4. missing/schema-changed shape;
5. multi-object/multi-lot where applicable.

## Task 12: Добавить fixture contracts в CI

**Objective:** PR не может изменить parser contract без выполнения focused tests.

**Files:**

- Modify: `.github/workflows/ci.yml`
- Modify: root `package.json`

**Scripts:**

```json
{
  "test:parser-contracts": "STRAPI_API_TOKEN=test-token NODE_ENV=test vitest run services/_shared/src/__tests__/property-location.test.ts services/parser-*/src/__tests__/extraction.test.ts"
}
```

**CI order:**

1. `npm ci`;
2. build shared;
3. parser contract tests;
4. full root Vitest;
5. API build;
6. frontend build.

**Acceptance:** Fixture test failure blocks PR; GitHub-hosted CI не делает SSH/live probes.

## Task 13: Реализовать live canary protocol без persistence

**Objective:** Проверять реальный DOM/API на доступном server environment до/между полными parse runs.

**Files:**

- Modify: `services/_shared/src/types.ts` — optional `probe()` contract.
- Create: `services/_shared/src/parser-probe.ts`
- Create: `services/_shared/src/__tests__/parser-probe.test.ts`
- Modify: parser handlers/queue dispatch для operation `probe`.
- Modify: `api/src/services/pipeline/stages.ts` or create `api/src/services/parser-canary.ts` — enqueue exact source-scoped probe jobs.
- Create tests рядом с измененными pipeline/queue components.

**Probe result:**

```ts
{
  source: string;
  checked: number;
  listing_ok: boolean;
  detail_ok: boolean;
  property_block_found: number;
  location_label_found: number;
  confirmed_address: number;
  confirmed_region_only: number;
  missing: number;
  semantic_fingerprint: string;
  status: 'healthy' | 'degraded' | 'schema_changed' | 'blocked';
  reason?: string;
}
```

**Rules:**

- 1–3 bounded public cards/API items per source;
- no `propertyExists`, `createProperty`, analytics or digest;
- same delays/CA/anti-bot constraints as production adapter;
- exact timeout and cancellation;
- raw payload/HTML only in temporary diagnostic artifact with restrictive permissions and automatic cleanup; not in Strapi/logs;
- probe failure одного источника не запускает широкие retries остальных.

## Task 14: Расписание canary

**Objective:** Проверять drift регулярно, не удваивая нагрузку и не создавая второй orchestrator race.

**Files:**

- Modify: `api/src/cron/index.ts`
- Modify: `api/src/cron/__tests__/cron-registration.test.ts`
- Modify: pipeline lifecycle guard where needed.

**Schedule:**

- один daily canary window за несколько часов до `pipeline:daily`;
- если pipeline не idle, canary пропускается с observable reason;
- manual canary endpoint/command admin-only;
- повторный concurrent canary запрещен stable idempotency key.

**Important:** Не добавлять 10 независимых cron jobs. Один orchestrated canary run fan-out'ит source-scoped probe jobs и ждет только exact job IDs.

---

# Wave 4 — Alerts и controlled recovery

## Task 15: Реализовать deduplicated operational alerts

**Objective:** Сообщать о реальной деградации без писем на каждый лот/run.

**Files:**

- Create: `api/src/services/parser-health-alerts.ts`
- Create: `api/src/services/__tests__/parser-health-alerts.test.ts`
- Modify: `api/config/plugins.ts` only if current email plugin needs an explicit operational recipient setting.
- Modify: `.env.template`
- Modify: `api/src/services/pipeline/index.ts` and canary completion path.

**Configuration:**

```text
PARSER_ALERT_EMAIL=<ops recipient>
PARSER_ALERT_COOLDOWN_HOURS=24
```

**Dedupe key:** `source_slug + health_status + semantic_fingerprint + reason_code`.

**Notification policy:**

- immediate: `schema_changed`, source blocked, zero detail success with nonzero candidates;
- after 2 consecutive runs: ratio-based `degraded`;
- no repeat inside cooldown for unchanged dedupe key;
- one `recovered` notification after next healthy run;
- alert body contains source, run ID, stage, counters, fingerprint and safe reason; no raw HTML/addresses/secrets.

**Fallback:** SMTP failure записывается в Strapi logs/cron log и не меняет parser run result задним числом.

## Task 16: Controlled recovery policy

**Objective:** Сделать реакцию на drift безопасной и воспроизводимой.

**Files:**

- Create: `docs/parser-drift-runbook.md`
- Modify: `docs/gotchas.md`
- Modify: skill `aklab-parsers` после успешной implementation, если процедура подтверждена реальным использованием.

**Runbook:**

1. Проверить queue/run integrity до любых выводов.
2. Зафиксировать exact run ID, source, stage, status, counters и fingerprint.
3. Выполнить read-only live DOM/API inspection на 2–3 карточках.
4. Сохранить sanitised fixture.
5. Написать RED contract test.
6. Исправить source adapter без broad fallback.
7. Прогнать focused/full verification.
8. Review exact diff/SHA.
9. По отдельной команде — release/deploy.
10. После deploy — targeted source reparse или disposable catalog full reparse по согласованию.
11. Подтвердить recovery counters и отсутствие projection/party contamination violations.

**Automatic actions explicitly forbidden:**

- auto-disable/enable source без policy evidence;
- auto-edit parser selectors;
- auto-deploy;
- auto-clean catalog;
- unbounded retries;
- fallback к full page text.

---

# Wave 5 — Верификация и выпуск

## Task 17: Focused и полная локальная проверка

**Objective:** Доказать корректность кода без запуска локальных серверов.

**Commands:**

```bash
npm -w @aklab/service-shared run build
npm -w @aklab/parser-m-ets run build
npm -w @aklab/parser-aggregator-bankrot run build
npm -w @aklab/parser-etprf run build
npm -w @aklab/parser-alfalot run build

STRAPI_API_TOKEN=test-token NODE_ENV=test npx vitest run \
  services/_shared/src/__tests__/property-location.test.ts \
  services/parser-m-ets/src/__tests__/extraction.test.ts \
  services/parser-aggregator-bankrot/src/__tests__/extraction.test.ts \
  services/parser-etprf/src/__tests__/extraction.test.ts \
  services/parser-alfalot/src/__tests__/extraction.test.ts

STRAPI_API_TOKEN=test-token NODE_ENV=test npx vitest run
npm --prefix api run build
git diff --check
git status --short --branch
```

При Wave 2–4 дополнительно:

```bash
STRAPI_API_TOKEN=test-token NODE_ENV=test npx vitest run \
  services/_shared/__tests__/parse-handler.test.ts \
  services/_shared/__tests__/strapi-client.test.ts \
  api/src/services/__tests__/parser-run-telemetry.test.ts \
  api/src/services/__tests__/parser-source-health.test.ts \
  api/src/services/__tests__/parser-health-alerts.test.ts
```

**Acceptance:** Builds PASS, focused/full tests PASS, `git diff --check` clean. Никаких локальных `npm run dev|serve|start`.

## Task 18: Независимый review

**Objective:** Не принять coverage improvement ценой provenance regression.

**Review checklist:**

- нет `body.innerText`/title/excerpt geography fallback;
- party fields не передаются в location resolver;
- ETPRF imported helper отсутствует внутри evaluate callback;
- source paths точные и stable;
- `missing` после details не persist'ится как обычная недвижимость;
- telemetry counters internally consistent;
- raw HTML/addresses не попадают в telemetry/alerts;
- canary не имеет Property write path;
- no force/unsafe dependency changes;
- exact changed files соответствуют scope.

## Task 19: Release preparation — только после подтверждения

**Objective:** Подготовить проверяемый release без автоматического deployment.

**Steps:**

1. Обновить `docs/parser-source-contracts.md`, `docs/run-scoped-parser-telemetry.md`, `docs/parser-drift-runbook.md`.
2. Добавить changelog/version в release commit согласно AKLAB release workflow.
3. Commit feature branch → push → PR в `main`.
4. Дождаться CI и exact-head review.
5. Не merge/deploy, пока пользователь явно не подтвердил выпуск.

## Task 20: Production acceptance — отдельная явная команда

**Preconditions:**

- exact reviewed SHA merged в `main`;
- pipeline idle;
- queue active/pending = 0;
- backup/rollback point зафиксирован;
- один одобренный deploy через штатный `scripts/deploy-prod.sh`.

**Acceptance sequence:**

1. Deploy exact SHA штатным immutable script.
2. Проверить API/app health и PM2 только безопасными полями.
3. Запустить read-only canary.
4. Если canary healthy — согласовать targeted source reparse четырех источников или disposable catalog reparse.
5. После reparse посчитать по source:
   - found;
   - details attempted/ok;
   - confirmed address;
   - confirmed region-only;
   - missing/unresolved;
   - skipped;
   - failed.
6. Проверить:
   - persisted real-estate `property_location=missing` = 0;
   - projection violations = 0;
   - party contamination fixtures/runtime samples = 0;
   - `(source, external_id)` duplicates = 0;
   - pipeline/queue terminal и handlers не продолжают side effects после `done`.
7. Отдельно запустить analyze только если пользователь просит полный рабочий цикл после reparse.

**Rollback:** При schema_changed/contamination/contract regression остановить новый parse path, вернуть предыдущий exact SHA штатным release mechanism; уже записанные disposable Property очистить только через canonical confirmation-gated cleanup по отдельному согласованию.

---

## 4. Рекомендуемый порядок выпусков

Чтобы не делать один огромный рискованный PR:

### Release A — Location correctness

Tasks 1–7, 17–18:

- четыре source mappings;
- ETPRF browser-context fix;
- fixtures;
- skip unresolved real-estate persistence;
- local verification/review.

### Release B — Telemetry и health classification

Tasks 8–10, 17–18:

- extraction counters;
- semantic fingerprints;
- source health summary.

### Release C — Canary, alerts, runbook

Tasks 11–16, 17–18:

- all-source contract matrix;
- CI fixture gate;
- live probe;
- alert dedupe/recovery;
- operational documentation.

Каждый release проходит отдельный review; deploy каждого release требует отдельной явной команды.

---

## 5. Definition of Done

Работа считается завершенной, когда:

1. Для четырех текущих проблемных источников есть source-faithful positive/negative fixtures.
2. Focused tests и builds зеленые; full root suite зеленый.
3. ETPRF больше не вызывает imported Node helper внутри `page.evaluate()`.
4. Успешно обработанная недвижимость с итоговым `missing` не попадает в пользовательский каталог.
5. `confirmed_region_only` сохраняет безопасную региональную видимость без fake address.
6. Run-scoped telemetry показывает качество location extraction по каждому source/stage.
7. Schema drift классифицируется как `degraded/schema_changed`, а не маскируется пустыми полями или party address.
8. Fixture contracts запускаются в PR CI.
9. Live canary не делает Property writes и имеет bounded timeout/cancellation.
10. Алерты дедуплицируются и отправляют один recovery event.
11. Runbook описывает diagnosis → fixture → RED → fix → review → approved release → reparse.
12. AI отсутствует в runtime и dependency graph.
13. Production acceptance после отдельно одобренного release подтверждает persisted real-estate `property_location=missing = 0` и contamination violations `= 0`.
