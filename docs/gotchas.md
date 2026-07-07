# AKLAB — Strapi 5 Gotchas

> Извлечено из docs/compact-doc.md. Нумерация сохранена.

## Strapi 5 — gotchas (для новой сессии)

1. **Структура v5 layout** (отличается от v4):
   `api/<name>/content-types/<name>/schema.json` + `controllers/<name>.ts` +
   `services/<name>.ts`. НЕ `api/<name>/schema.json` напрямую.
2. **`routes/<name>.ts` НЕ создавать без причины** — если файл существует,
   Strapi 5 **заменяет** авто-CRUD на твой массив routes. Если создаёшь —
   прописывай **все 5 CRUD-методов** руками. У нас routes/ удалены → авто-CRUD.
3. **dev-mode hot-reload НЕ подхватывает новые content-types в router** —
   после `rm -rf api/.tmp/data.db` или добавления нового content-type
   нужен `rm -rf dist` + production build (`strapi build`) + `strapi start`.
   `strapi develop` недостаточен.
4. **Strapi 5 пропускает `bootstrap()` без admin-юзера**: при первом
   старте (или после сброса БД) Strapi **не вызывает** наш
   `register()`/`bootstrap()`. Создание admin: либо через /admin
   web UI, либо через наш `seedAdmin` (читает .env), либо **SQL-инъекцией**
   в `up_users` (dev-only fallback).
5. **dist/src/index.js пустой после `tsc`** — это нормально, Strapi в
   dev-mode загружает TypeScript напрямую через ts-node, а не из dist.
   Но production build (`strapi build`) — собирает в dist по-настоящему.
6. **Custom controllers require path** — `require('../../services/queueService')`
   из `api/src/api/cron/controllers/cron.ts` НЕ работает в prod, т.к.
   dist-структура: `dist/src/api/cron/controllers/cron.js` → нужен путь
   `../../../services/queueService` (3 уровня вверх до `dist/src/`, затем
   `services/`). Проверять `node -e "require(...)"` на сервере.
7. **Fabrikant.ru — data-slot selectors** (НЕ CSS class selectors!):
   - Карточки: `[data-slot="card"][data-id]`
   - Title: `[data-slot="anchor"]` (первый A-элемент)
   - Цена: `[data-slot="text"]` содержащий "RUB"
   - Номер: `[data-slot="text"]` matching `/^\d+-\d+$/`
   - URL: `/procedure/search/sales` (вкладка "Продажи"), NOT `/procedure/search`
   - Пагинация: `?page=N`
8. **torgi.gov.ru — чистый JSON API** без авторизации:
   `GET /new/api/public/lotcards/search?lotStatus=PUBLISHED,APPLICATIONS_SUBMISSION&size=100`
   Параметр `subjectRFCode` НЕ работает как фильтр → фильтровать в коде.
   Площадь: `characteristics[].code === "totalAreaRealty"`.
9. **Fedresurs Qrator anti-bot** — блокирует ВСЕ API-подходы:
   `page.evaluate(fetch())` → 403, `page.request.get()` → 403,
   `page.goto(apiUrl)` → 403. Единственный рабочий вариант —
   перехват network response при навигации по UI-странице, но и это
   не удалось (Qrator проверяет TLS fingerprint). Отложен до решения
   с прокси/резидентным IP.
10. **Deploy: push BEFORE deploy** — `deploy-prod.sh` делает
    `git pull origin main` в самом начале. Если локальный коммит
    НЕ в origin/main — файл не попадёт на сервер. **Правило:**
    всегда `git push origin main` ДО запуска deploy. Иначе придётся
    делать pull + rebuild app вручную на сервере.
11. **Vite и public/ файлы** — Vite копирует `app/public/` → `app/dist/`
    при build. Если файл появился в public/ после build — нужно
    пересобирать: `cd app && npm run build`. Deploy-prod.sh делает
    это автоматически (build на шаге 6), но только если файл уже
    в репо на момент git pull.
12. **Changelog.json: build vs generate** — deploy-prod.sh генерирует
    changelog.json ПОСЛЕ build app (шаг 9 vs шаг 6). Нужно копировать
    `app/public/changelog.json` → `app/dist/changelog.json` после
    генерации. Иначе dist содержит старую версию.
13. **Strapi 5 custom routes + auth** — если заменить `createCoreRouter`
    на explicit routes с `config: { auth: {} }`, Users-Permissions
    требует явного grant для КАЖДОГО action. Без этого — 500 на всех
    endpoints. **Решение**: `createCoreRouter` для CRUD + отдельный
    файл `routes/health.ts` с `auth: false` для custom endpoints.
14. **Seeder идемпотентен** — при добавлении новых полей в schema
    существующие записи НЕ обновляются. Обновлять через API:
    `PUT /api/sources/:documentId { data: { schedule: "0 3 * * *" } }`.
15. **Changelog: русский язык + МСК** — генератор берёт текст из
    git-коммитов (английский). Словарь переводов в
    `scripts/generate-changelog.js` (TRANSLATIONS). Дата/время —
    `TZ=Europe/Moscow` + русские названия месяцев.
16. **Strapi 5 REST API — только documentId** — `GET/PUT/DELETE
    /api/sources/:id` принимает ТОЛЬКО `documentId` (строка вида
    `bv610wntnoe3l25gt3c6yd4t`), НЕ числовой `id`. `entityService`
    возвращает оба поля, но REST — только `documentId`. Баг v1.0.18:
    счётчики total_found/total_created/parse_count = 0, т.к.
    `updateSourceStats` передавал числовой id → 404 → молчаливый
    провал. Исправлено в v1.0.19.
17. **Seeder singleton через entityService** — `entityService.findMany`
    для singleton content-types (Setting) может не находить записи
    из-за draft/published state → seeder создаёт дубли при каждом
    bootstrap. **Решение**: использовать `db.query(uid).findOne({})`
    вместо `entityService.findMany`. Исправлено в v1.0.20.
18. **torgi.gov.ru API limitations** — параметр `size` игнорируется
    (всегда 10 на страницу), `subjectRFCode` не работает как фильтр,
    date параметры тоже игнорируются. Решение: увеличить MAX_PAGES,
    фильтровать в коде по `createDate` и `subjectRFCode`.
19. **Generic parsers** — invest-mosreg, investmoscow, roseltorg, m-ets
    использовали универсальные CSS-селекторы (`.card`, `[class*="card"]`).
    **Обновлено (02.07.2026):** investmoscow переписан на Nuxt SSR (__NUXT_DATA__),
    invest-mosreg на JSON API (/aapi/map/places), m-ets на SPA scraping.
    roseltorg отключён (WAF).
20. **Analyzer numeric id → documentId** — `analyzeAll` в cron controller
    отправлял `property_id: prop.id` (numeric) в очередь, а analyzer
    делал `GET /api/properties/${numericId}` → 404 (REST v5 принимает
    только documentId). Исправлено: `documentId: prop.documentId` +
    `fetchProperty(documentId: string)`. Три файла: cron controller,
    analyzer handler, analyzer strapi-client.
21. **Parser dist не собирается при deploy** — если новый парсер добавлен
    в `services/` но его нет в `scripts/deploy-prod.sh` списке build,
    `dist/` не создаётся → MODULE_NOT_FOUND при старте PM2. Проверять:
    `ls services/parser-*/dist/index.js` на сервере после deploy.
22. **Digest smtp_to fallback** — cron controller читает Setting через
    `entityService.findMany` (singleton, gotcha #17). Если не находит —
    `smtpTo = undefined` → digest использует `config.smtp.user`
    (tirobots@yandex.ru) вместо `Setting.smtp_to` (a@rudin.ru).
    Решение: использовать `db.query` как в seeder, или передавать
    smtpTo напрямую из БД.
23. **PM2 daemon Node version mismatch** — PM2 daemon хранит окружение
    от момента `pm2 start`. Если Node обновлён через nvm (напр. v20→v22),
    daemon продолжает использовать старую. `pm2 update` перезапускает
    daemon с текущим окружением. **Deploy-prod.sh** теперь проверяет
    автоматически и обновляет systemd-сервис. Симптом: `better-sqlite3`
    NODE_MODULE_VERSION mismatch при рестарте.
24. **API_TOKEN_SALT: .env ≠ PM2 daemon** — `access_key` в
    `strapi_api_tokens` = `HMAC-SHA512(plain_token, API_TOKEN_SALT)`.
    Если соль в `.env` отличается от PM2 daemon env — все сервисы
    получают 401. **НЕ** менять `.env` API_TOKEN_SALT вручную —
    PM2 daemon env = source of truth. Deploy-prod.sh синхронизирует.
25. **property_events.property_id** — в Strapi 5 manyToOne relation
    создаёт FK-колонку НЕ автоматически при миграции schema. Нужен
    `ALTER TABLE property_events ADD COLUMN property_id INTEGER` +
    индекс. Без этого raw SQL INSERT в focusEngine падает с
    "table has no column named property_id".
26. **torgi-gov API v2 price fields** — `priceMin`/`priceMax` на верхнем
    уровне объекта, НЕ в `priceInfo.startPrice`. API v2 изменил структуру.
27. **sberbank-ast XML structure** — Playwright загружает динамический XML
    в `input#xmlData` с корнем `<datarow><hits><_source>`. Теги:
    `purchName`, `purchAmount`, `GeoDataAddress`, `Latitude`, `Longitude`,
    `bidHrefTerm`, `BranchNameNew`. НЕ `PurchaseName`/`Amount`/`row`.
28. **investmoscow Nuxt SSR** — `__NUXT_DATA__` массив с обратными ссылками.
    Tender-объекты имеют `startPrice`, `objectArea`, `address` как числовые
    индексы. `coords` может быть невалидным — проверять `Array.isArray`
    и `typeof coords[0] === 'number'`.
29. **isCommercialProperty — доверять парсеру** — если `property_type` уже
    офис/склад/ритейл/производство/free_purpose/apartment → pass, не
    фильтровать по ключевым словам в title.
30. **3-фазный парсинг с fetchDetails** — parse-handler разбит на 3 фазы:
    - Фаза 1: `parser.parse(depth)` → массив properties
    - Фаза 2a: existence check → собираем `newProperties[]` (только новые)
    - Фаза 2b: fetchDetails + createProperty для каждого нового объекта
    `total_details_needed` вычисляется ОДИН РАЗ после phase 2a (= `newProperties.length`),
    `total_details_fetched` инкрементируется после каждого успешного fetchDetails.
    UI показывает `X/Y детальных` где Y фиксировано, X растёт.
31. **resetSourceDetailsCounters** — вызывается в начале КАЖДОГО parse-handler
    (для каждого источника). Обнуляет `total_details_fetched` и `total_details_needed`
    в 0 через PUT `/api/sources/:documentId`. Без этого счётчики кумулятивные.
    **ВАЖНО (v1.1.7):** Промежуточные fire-and-forget `updateSourceStats` УДАЛЕНЫ.
    `total_details_fetched` и `total_details_needed` пишутся ОДИН раз в конце
    (awaited). Stale PUT от предыдущего запуска мог arrive ПОСЛЕ bulk reset и
    перезаписать `total_details_fetched` → fetched > needed.
32. **JWT_SECRET в .env на сервере** — если JWT_SECRET отсутствует в `api/.env`,
    каждый restart API генерирует новую соль → все JWT инвалидируются → 500 Forbidden.
    Symptom: frontend редиректит на /auth. Fix: добавить `JWT_SECRET=<random>` в `.env`.
33. **Strapi 5 возвращает 500 вместо 401** — при невалидном JWT Strapi 5 может
    вернуть 500 + "Forbidden" вместо 401. Response interceptor на фронте должен
    ловить 500 + "Forbidden" и редиректить на /auth.
34. **detectCity — общая функция** — вынесена в `_shared/src/city-detect.ts`,
    используется всеми 7 парсерами. Раньше у каждого парсера была своя копия
    с одинаковым багом. Экспортируется из `@aklab/service-shared`.
35. **detectCity regex: «Москва-Кашира»** — `lower.includes('москва')` матчит
    название дороги «Москва-Кашира» → false positive → `city=moscow` для
    астраханского объекта. Фикс: regex `/(^|[\s,.])москва([\s,.)]|$)/i` —
    дефис НЕ в character class, поэтому «москва-кашира» не матчится.
    Баг: m-ets.ru показывает регион продавца (часто «г. Москва»), а не
    объекта. detectCity теперь проверяет title + description, а не region.
36. **Setting.parse_depth** — глубина парсинга по расписанию (cron). Дефолт 20,
    макс 5000. Cron читает из Setting и передаёт `depth` в `addToQueue()`.
    Поле в schema + UI на `/settings`. Отдельно от ручного запуска (свой ввод).
37. **setting.update permission для authenticated** — seeder НЕ добавлял
    `api::setting.setting.update` → PUT /api/setting возвращал 500 Forbidden
    при сохранении настроек. Fix: добавить в seeder + вручную в БД через
    `up_permissions` + `up_permissions_role_lnk`.
38. **replace_all=true ОПАСЕН для Vue** — `patch(..., replace_all: true)` в
    Vue-файлах с повторяющимися элементами (select/option) может затронуть
    НЕ тот элемент. Пример: замена option в селекте «Тип недвижимости»
    затронула селект «Город», т.к. оба содержат `value="office"`. Всегда
    проверять контекст вокруг заменяемого текста.
39. **property_type enum: apartment + land** — `property/schema.json`
    enum = `['apartment', 'commercial', 'land']`. `apartment` отображается
    как «Квартира», `land` как «Зем. участок». Добавлено в v1.0.102.
40. **classifyPropertyType DRY** — единая функция в
    `_shared/property-classifier.ts`. Все 10 парсеров импортируют оттуда.
    Раньше у каждого парсера была своя копия с расхождениями.
41. **Price/area filter — и парсинг, и анализ** — `price_from`/`price_to` и
    `area_from`/`area_to` в Setting фильтруют И парсинг (в `createProperty()`),
    И анализ. Раньше фильтровали только анализ. С v1.1.13 ParseRules передаётся
    из pipeline/cron через queue job data в parse-handler → createProperty().
42. **propertyExists fail-closed** — при non-OK ответе API (500, 401, etc.)
    `propertyExists` возвращает `true` (skip). Раньше возвращала `false`
    → при 500 от API парсер создавал дубликаты. Баг: 1241 дубликат из 3407.
43. **digest_enabled** — boolean в Setting, default true. 3 уровня защиты:
    cron/index.ts, cron controller, digest handler. `data !== false` для
    обратной совместимости (null/undefined → true).
44. **Pipeline singleton update requires id** — Strapi 5 `update()` для singleton
    content-types (Setting) требует `documentId` в where clause. Без него —
    "Update requires a where parameter" (500). Pipeline state обновляется через
    `db.query(uid).update({ where: { documentId }, data: { pipeline_state } })`.
45. **SSE reconnect при refresh** — pipeline state хранится в БД (не в памяти).
    При перезагрузке страницы фронтенд читает `/api/pipeline/status` → если
    `status === 'running'`, автоматически подключает SSE stream и показывает
    прогресс. Без персистентного state reconnect был бы невозможен.
46. **total_details_needed/fetched — единый awaited write** — оба счётчика
    пишутся ОДИН раз в конце parse-handler (awaited). Промежуточные
    fire-and-forget PUT'ы удалены в v1.1.7 — stale PUT от предыдущего запуска
    мог arrive ПОСЛЕ bulk reset и перезаписать fetched → fetched > needed.
    Bulk reset pipeline перед enqueue оставлен как дополнительная защита.
47. **ParseRules — rules не утекает в Strapi POST** — `createProperty()`
    деструктурирует `rules` из props (`const { rules, ...propertyData } = props`)
    и отправляет только `propertyData` в POST body. Без этого `rules` утекал
    бы в Strapi API payload (Strapi 5 молча игнорирует, но это data integrity issue).
48. **buildParseRules — DRY helper** — единая функция в `api/src/services/parseRules.ts`
    (для pipeline/cron) и `_shared/src/strapi-client.ts` (для парсеров). Дублирование
    из-за того что `api/` не зависит от `@aklab/service-shared`.

49. **vi.resetAllMocks() clears mockImplementation** — если в `beforeEach`
    вызывается `vi.resetAllMocks()`, то `mockImplementation`, заданный на
    уровне модуля, будет сброшен. Нужно восстанавливать его в `beforeEach`.
    Симптом: тесты падают с "X is not a function" только при запуске suite.
50. **Mock call order при нескольких вызовах одного мока** — если код вызывает
    `db.query().findMany()` дважды за итерацию (properties + currentProps),
    то `mockResolvedValueOnce` должны идти в ТОЧНОМ порядке вызовов.
51. **app/ не в npm workspaces** — `npm install` в корне НЕ ставит зависимости
    из `app/`. Для app-specific пакетов нужно `cd app && npm install` отдельно.
52. **services.json порт app** — порт был `4173`, фактически запускался на `5174`.
    Health-check показывал false positive offline. Проверять при изменении ecosystem.
53. **Pipeline POST routes — auth: false** — `POST /pipeline/start|cancel|reset`
    имеют `auth: false` (как GET /status и /stream). Фронтенд не шлёт JWT
    на pipeline endpoints — без `auth: false` POST запросы возвращали 500
    Forbidden. **Исторически** mutating routes (cron, pipeline) имели
    `config: {}` (JWT required), но pipeline — это UI-driven workflow
    без чувствительных данных, поэтому auth не нужен.
54. **Strapi 5 db.query.count()** — может отсутствовать. Безопасный паттерн:
    `const rows = await db.query(uid).findMany({where, select: ['id']}); count = rows.length;`
55. **express-rate-limit НЕ работает в Strapi 5 (Koa)** — пакет
    `express-rate-limit` создаёт middleware с сигнатурой `(req, res, next)`,
    а Strapi 5 использует Koa `(ctx, next)`. Симптом: rate-limit middleware
    не блокирует запросы, но и не считает лимиты (мёртвый код). Заменён на
    чистый Koa middleware с in-memory Map + sliding window.
56. **Rate-limit пропускает OPTIONS (CORS preflight)** — `ctx.method === 'OPTIONS'`
    должен return next() без подсчёта. Иначе браузерные preflight запросы
    (которые идут каждые 3 сек при polling) съедают лимит за минуту.
57. **resp.json() возвращает `unknown`** — в TypeScript strict mode `fetch().json()`
    возвращает `unknown`, не `any`. Нужен явный `as any[]` или `as Record<string, any>`.
    Symptom: `error TS18046: 'results' is of type 'unknown'`.
58. **FocusFilters.priceFrom — string из input** — Vue `<input type="number">` даёт
    `string`, не `number`. Интерфейс `FocusFilters` должен принимать `string | number | null`.
59. **Playwright config: BASE_URL env** — `app/playwright.config.ts` поддерживает
    `BASE_URL` env для запуска E2E против production. Если `BASE_URL` задан —
    webServer не запускается, используется указанный URL.
    ```bash
    BASE_URL=https://aklab.tirobots.ru TEST_USER_PASSWORD='***' HEADLESS=true \
      npx playwright test --project=chromium
    ```
    Тестовый юзер: `test@aklab.tirobots.ru` (id=2). Пароль задаётся через
    `TEST_USER_PASSWORD` env. Seeder обновляет пароль при каждом рестарте API —
    менять пароль напрямую в БД бессмысленно.
60. **Seeder перезаписывает пароль test user** — `seedTestUser` в bootstrap
    обновляет пароль из `TEST_USER_PASSWORD` env при каждом старте API.
    Если нужно сменить пароль — менять в `.env` и рестартить API.
61. **Terminal tool маскирует пароли (`***`)** — когда агент передаёт пароль
    через переменную окружения (например `TEST_USER_PASSWORD='xxx' npx playwright test`),
    инструмент terminal автоматически заменяет значение на `***` в выводе.
    Playwright получает `***` вместо реального пароля → тесты падают на auth.
    **Workaround**: записать пароль в файл (`echo "$PASSWORD" > /tmp/.e2e_password`)
    и читать из файла: `TEST_USER_PASSWORD=$(cat /tmp/.e2e_password)`.
    Альтернатива: задать в `.env` и не передавать через shell inline.

62. **API token не работает с `config: {}` (auth required)** — Strapi 5 routes
    без явного `config` или с `config: {}` требуют JWT. API-токен (из `.env`)
    не проходит auth на таких endpoints -> `ForbiddenError: 500`.
    **Решение**: в single-tenant приложении ВСЕ endpoints = `auth: false, policies: []`.
    Пострадали: `market-references`, `sources`, `setting`, `cron-log`.
    Gotcha #32/#24 (JWT протухает после restart) + этот = причина почему
    `config: {}` не работает в single-tenant.
63. **Analyzer deviation: отрицательная != недооценка** — формула:
    `deviation = (refPrice - actualPrice) / refPrice * 100`.
    deviation > 0 = объект ДЕШЕВЛЕ рынка (недооценён).
    deviation < 0 = объект ДОРОЖЕ рынка (переоценён).
    Старый баг: `isUndervalued = deviation >= threshold` — отрицательная
    deviation (-24%) считалась недооценкой. Фикс: `deviation > 0 && deviation >= threshold`.
64. **Analyzer обнулял deviation_percent для не-undervalued** —
    `deviation_percent: isUndervalued ? deviation : 0` терял реальное
    значение -> focus engine не мог считать скор. Фикс: всегда сохранять
    реальную deviation.

