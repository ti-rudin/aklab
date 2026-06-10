# AKLAB — compact context

Быстрый onboarding для новой сессии. Прочитай этот файл целиком, прежде
чем что-то делать в проекте.

## Суть проекта

Сервис мониторинга коммерческой недвижимости. Автоматически находит
объекты (офисы, склады, торговые помещения), цена которых на 20%+ ниже
рыночной. Парсит CIAN + Avito по настраиваемому списку городов, считает
"рыночную" цену через похожие объекты в радиусе X км, шлёт алерты в
Telegram (мгновенно) и утренний дайджест на email.

Полная бизнес-логика — `docs/plan1.md`. Текущий статус — MVP на старте:
content-types ещё не созданы, кроме стандартных `users` (admin) и
`up_users` (Users-Permissions).

## Архитектура

### Компоненты

| Компонент | Технология | Порт prod | Порт dev | Где крутится |
|-----------|-----------|-----------|----------|--------------|
| Frontend | Vue 3 + Vite | 5174 | 5174 | Vite preview (prod), vite dev (локально) |
| Backend | Strapi 5.46.1 + SQLite | 1338 | 1338 | Strapi start (prod), strapi develop (локально) |
| Reverse proxy | Traefik v2.10 | 80/443 | — | 192.168.11.131 (отдельный хост) |

PM2-процессы на проде: `aklab-api`, `aklab-app`. Плюс рядом `todoit-api`,
`todoit-app` — это другой проект, не трогай.

### Домены

- `https://aklab.tirobots.ru` → Traefik → 192.168.11.151:5174 (Vite preview)
- `https://api-aklab.tirobots.ru` → Traefik → 192.168.11.151:1338 (Strapi)
- **СТАРЫЕ, УДАЛЕНЫ** из CORS и Traefik: `*.aklab.ti-soft.ru`, `todoit.ru`,
  `app.todoit.ru`, `api.todoit.ru`. Если где-то всплывут — это баг, не лечи.

### Source of truth

- `~/aklab` (bare-репа) на **192.168.11.151** — это **прод-репо**, его
  трогает `git pull` при деплое
- `~/github.nosync/aklab` на твоём маке — локальная копия для разработки
- GitHub: `https://github.com/ti-rudin/aklab.git` (HTTPS, авторизация
  через `gh` CLI от аккаунта `ti-rudin`)

### Архитектура

- **Очередь задач** — `@aklab/sqlite-queue` (пакет в `lib/sqlite-queue/`).
  Один файл `queue.db` (WAL), polling 200ms, stale recovery, retention.
  Singleton в `api/src/services/queueService.ts`.
- **Cron-планировщик** — `node-cron` в `api/src/cron/index.ts` (timezone
  Europe/Moscow). Per-source расписание из `Source.schedule` (cron expr,
  дефолт `0 3 * * *`).
- **Микросервисы парсеров** — каждый парсер = отдельный сервис в
  `services/parser-<slug>/` с shared модулями в `services/_shared/`
  (`@aklab/service-shared`). Health server + queue worker + парсер.
  Порты: fabrikant=1345, torgi-gov=1346, analyzer=1341, digest=1342.
  Следующий свободный: 1348.
- **Health proxy** — `GET /api/sources/:id/health` проксирует на
  `http://127.0.0.1:{health_port}/health`.
- **Workspaces** в `package.json`: `lib/*` и `services/*`. Совместная
  `node_modules/` в корне.

## Структура репо

```
~/github.nosync/aklab/
├── api/                        # Strapi 5 backend
│   ├── config/                 # middlewares (CORS), server, plugins
│   ├── src/
│   │   ├── api/                # content-types (5 шт. — Фаза 1)
│   │   │   ├── property/{content-types/property,controllers/property,services/property}
│   │   │   ├── setting/{content-types/setting,controllers/setting,services/setting}  # singleton
│   │   │   ├── market-reference/{content-types/market-reference,...}
│   │   │   ├── user-comment/{content-types/user-comment,...}  # relation → property
│   │   │   └── cron-log/{content-types/cron-log,...}
│   │   ├── cron/index.ts       # node-cron регистрация (Фаза 0: stub)
│   │   ├── services/queueService.ts  # singleton @aklab/sqlite-queue
│   │   ├── seeders/index.ts    # bootstrap seeds: admin + Setting + public permissions
│   │   └── index.ts            # bootstrap: QueueService.init + registerCrons + runSeeders
│   └── .tmp/data.db            # SQLite (в .gitignore)
├── app/                        # Vue 3 + Vite frontend
│   ├── src/                    # components, views, router
│   └── vite.config.ts          # dev-proxy, allowedHosts
├── lib/                        # shared библиотеки (npm workspaces)
│   └── sqlite-queue/           # @aklab/sqlite-queue (донор tirobots)
├── services/                   # микросервисы (npm workspaces, появятся в Фазах 4-7)
├── scripts/
│   ├── deploy-prod.sh          # production deploy (полный цикл)
│   ├── health-check.js
│   └── check-env.js
├── ecosystem.config.js         # PM2 prod (build + preview)
├── ecosystem-local.config.js   # PM2 dev (npm run dev)
├── .env.local.example          # шаблон локального .env
├── docs/
│   ├── compact-doc.md          # ← ЭТОТ ФАЙЛ
│   ├── plan1.md                # бизнес-логика проекта
│   ├── plan2.md                # план MVP (9 фаз)
│   └── setup-local.md          # пошаговая установка локально
└── package.json                # workspaces: ["lib/*", "services/*"]
```

## Workflow: разработка → деплой

### Локальная разработка

```bash
cd ~/github.nosync/aklab
pm2 start ecosystem-local.config.js   # api:1338, app:5174 в dev-режиме
pm2 logs                              # логи обоих процессов
pm2 stop ecosystem-local.config.js    # остановить
```

### Правки

1. Создай feature-ветку: `git checkout -b feat/<короткое-имя>`
2. Правки → `git add -A` → `git commit -m "..."`
3. `git push -u origin feat/<короткое-имя>`
4. PR в `main` на GitHub → merge

Прямой push в `main` допустим для маленьких fix'ов (как vite allowedHosts
или .gitignore), но feature-ветки — основной путь.

### Деплой (ТОЛЬКО по команде пользователя, не автоматически)

```bash
ssh rudin@192.168.11.151 'cd ~/aklab && export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && bash scripts/deploy-prod.sh > /tmp/deploy.log 2>&1; echo "EXIT: $?"; tail -30 /tmp/deploy.log'
```

Скрипт сам: git pull → bump patch-версии (1.0.X) → build (api 140s +
app 3s) → PM2 restart → health check 190s → **генерация changelog** →
release-коммит → push origin. Дай foreground-таймаут минимум 300s.

**Всегда логируй в файл** (`> /tmp/deploy.log 2>&1`) и читай файл через
`tail`. Иначе теряешь вывод и не понимаешь, упало или прошло.

### После успешного деплоя — в локали:

```bash
cd ~/github.nosync/aklab
git pull --ff-only origin main
```

Без этого локаль отстанет от прод-репо (там появится release-коммит от
deploy-prod.sh + бамп версии).

## Правила (проверены, не нарушать)

### Безопасность

- **НИКОГДА** не запускать `npm run dev` (Vite/HMR) на серверах —
  CVE-2025-30208, чтение произвольных файлов через `?import&raw`.
  На серверах ТОЛЬКО `npm run build && npm run serve:prod` (или
  `vite preview`, что в ecosystem.config.js).
- Секреты prod и dev — **ВСЕГДА РАЗНЫЕ**. Не дублировать между окружениями.
- `.env` **в .gitignore**, никогда не логировать и не показывать в чате.
- Публичный email проекта: `tirobots@yandex.ru`. Другие `@tirobots.ru`
  адреса не существуют.

### Strapi 5.46.1 — особенности

- `env.array('FOO')` возвращает `string[] | undefined`, а
  `Core.Config.Server.app.keys: string[]` (не optional) → TS-ошибка
  TS2322 в build. Лечить: `env.array('FOO', [])` — явный дефолт `[]`.
- Admin build (`strapi build`) занимает **~140 секунд**. Это не баг.
- Strapi startup после build: ещё **~10-20 сек**. Итого от PM2 restart
  до ответа на `/_health` нужно ~150-160 сек.
- Health check timeout в deploy-prod.sh: 190s (10s initial + 18×10s).
  Если упадёт — Strapi обычно стартует, просто скрипт не дождался.
- **Admin при первом старте создаётся через /admin web UI**, не через env.
  Чтобы авто-seed из env — есть `api/src/seeders/index.ts`.
- **Routes нужно создавать ВРУЧНУЮ через `factories.createCoreRouter(uid)`**.
  Strapi 5 НЕ авто-генерирует CRUD-routes из content-types. Без
  `api/src/api/<name>/routes/<name>.ts` файл endpoints возвращают 404
  (хотя contentTypes зарегистрированы и таблицы в БД созданы).
  Это противоречит тому, что пишут в некоторых старых туториалах для
  Strapi 4 — для v5 нужен явный routes-файл.

### Git / .gitignore

В .gitignore: `.env`, `.env.local`, `.env.*.local`, `package-lock.json`
(и в api/, и в app/), `api/src/extensions/documentation/documentation/*/full_documentation.json`
(Strapi регенерит при dev/start). Если что-то из этого случайно
закоммитишь — `git rm --cached <file>`.

### Локальный .env

Не трогать без необходимости. Если менять — только переменные, не
формат/комментарии. Backup перед правкой: `cp .env .env.bak.<date>`.

## Текущее состояние (июнь 2026)

- Версия: 1.0.26
- **11 источников парсинга** (10 активных, fedresurs OFF):
  - `services/parser-fabrikant/` — Playwright, порт 1345, очередь `parse-fabrikant`
  - `services/parser-torgi-gov/` — JSON API, порт 1346, очередь `parse-torgi-gov`
  - `services/parser-aggregator-bankrot/` — Playwright HTML, порт 1348
  - `services/parser-alfalot/` — Playwright SPA (ecosystem.alfalot.ru), порт 1349
  - `services/parser-etprf/` — Playwright AJAX (sale.etprf.ru), порт 1350
  - `services/parser-sberbank-ast/` — Playwright AJAX (utp.sberbank-ast.ru), порт 1351
  - `services/parser-invest-mosreg/` — Playwright generic, порт 1352
  - `services/parser-investmoscow/` — Playwright generic, порт 1353
  - `services/parser-roseltorg/` — Playwright generic, порт 1354
  - `services/parser-m-ets/` — Playwright generic, порт 1355
  - `services/parser-bankruptcy/` — УДАЛЁН (legacy монолит)
- **14 PM2 процессов** на проде (api, app, 10 парсеров, analyzer, digest)
- **Cron расписание**: fabrikant/torgi-gov → 03:00, aggregator-bankrot/alfalot/etprf → 04:00, sberbank-ast/invest-mosreg/investmoscow → 05:00, roseltorg/m-ets → 06:00
- **Email-дайджест**: smtp_to=a@rudin.ru, 09:00 МСК
- **Telegram alerts**: УДАЛЕНЫ из плана
- **Health badges** на `/sources` — 🟢 Online / 🔴 Offline (polling каждые 30с)
- **Per-source cron расписание** — cron expr в Source.schedule (дефолт `0 3 * * *`)
- **Inline-редактирование расписания** на `/sources`
- **Health proxy** — `GET /api/sources/:id/health` → Strapi проксирует на сервис
- **Smoke test** — `npm run smoke` (health, auth, endpoints, data integrity, 12 микросервисов)
- **API security** — все endpoints требуют JWT (роль Authenticated).
  Public role: только login/register/forgot-password.
- **Changelog** — автогенерация при deploy (v1.0.0–v1.0.22)
- **Frontend** — 8 страниц: `/properties`, `/properties/:id`, `/sources`, `/market-references`, `/settings`, `/changelog`, `/auth` + 404 catch-all
  `POST /api/cron/parse/:slug` для ручного запуска. ✅
- **Парсеры** (9 июня 2026):
  - `fabrikant` — Playwright, HTML scraping `/procedure/search/sales`
    (data-slot selectors: `[data-slot="card"][data-id]`, title from
    `[data-slot="anchor"]`, price from RUB in text slots). Пагинация
    ?page=N, max 5 pages. Фильтр: keywords + exclude (жильё/транспорт).
  - `torgi-gov` — **чистый JSON API** (`/new/api/public/lotcards/search`),
    без Playwright. Фильтрация Москвы/МО в коде (subjectRFCode).
    Площадь из characteristics.totalAreaRealty + fallback из title.
    Цены обычно нет (аренда). 5 запросов по разным keywords.
  - `fedresurs` — **ОТКЛЮЧЁН** (Qrator 403 anti-bot, не обходится
    ни page.evaluate(fetch), ни page.request.get, ни navigate+intercept).
    Парсер код есть, Source.is_active=false.
- Содержимое:
  - **api/src/api/** — 7 content-types (Property, Setting singleton,
    MarketReference, UserComment, CronLog, **Source**, **Cron** (custom routes))
  - **api/src/services/queueService.ts** — singleton-обёртка
  - **api/src/cron/index.ts** — 4 cron-задачи, читают active sources из Source коллекции
  - **api/src/seeders/index.ts** — seedSettings + seedSources + seedAuthenticatedPermissions
  - **services/_shared/** — `@aklab/service-shared` (config, logger, health-server, queue-worker, strapi-client, types)
  - **services/parser-fabrikant/** — FabrikantParser (порт 1345, очередь `parse-fabrikant`)
  - **services/parser-torgi-gov/** — TorgiGovParser (порт 1346, очередь `parse-torgi-gov`)
  - **services/analyzer/** — сравнение Property с MarketReference
  - **services/digest/** — утренний email через nodemailer
  - **lib/sqlite-queue/** — `@aklab/sqlite-queue` v0.1.0
  - **app/src/views/** — Auth, PropertyListView, PropertyDetailView,
    SourceListView, MarketReferencesView, SettingsView, ChangelogView, NotFoundView
  - **app/src/components/** — Footer, SkeletonLoader, SkeletonTable
  - **app/src/stores/** — auth.ts (Pinia)
  - **app/src/api/** — strapi.ts (shared axios instance с JWT interceptor)
  - **scripts/smoke-test.js** — smoke тест (npm run smoke)
  - **scripts/generate-changelog.js** — генератор changelog из git commits
- На проде (192.168.11.151): 6 PM2 процессов (api, app, parser-fabrikant,
  parser-torgi-gov, analyzer, digest), все health OK. Playwright chromium установлен.
- В .env на проде: `STRAPI_ADMIN_EMAIL=admin@aklab.ti-soft.ru`,
  `STRAPI_ADMIN_PASSWORD=…` (см. .env), `TEST_USER_EMAIL=test@aklab.ti-soft.ru`
- В БД на проде admin `ax.rudin@gmail.com` (создан Strapi через /admin
  first-run форму, не из env). После деплоя с seed'ами должен появиться
  ВТОРОЙ admin с email из .env
- Vite proxy: `/api/*` → `http://localhost:1338` (только в dev-режиме)
- Source schema: +schedule (cron expr, дефолт "0 3 * * *"), +health_port (int)
- Health proxy: `GET /api/sources/:id/health` → Strapi проксирует на `localhost:{health_port}/health`
- Cron per-source: каждый Source получает свой cron job по `Source.schedule`
- **Strapi 5 sort** — поле `createdAt` (camelCase), НЕ `created_at`. Если
  sort вернёт пустой массив — проверить имя поля.
- Seeder **идемпотентен** — при добавлении новых полей в Source нужно
  обновлять существующие записи через API (PUT /api/sources/:docId).
- Документация: `docs/adding-source.md` — инструкция добавления нового источника
- CORS в `api/config/middlewares.ts` уже включает
  `https://aklab.tirobots.ru` и `http://localhost:5174`

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
    используют универсальные CSS-селекторы (`.card`, `[class*="card"]`).
    Работают, но могут давать мало результатов. При проблемах —
    уточнить селекторы через browser research на конкретном сайте.

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

## Session handoff (v1.0.26 → следующая сессия)

**Сделано в сессии 10 июня 2026 (v1.0.26):**
- ✅ **m-ets price parsing bug** — `[class*="cost"]` матчил `.cost-block` с текстом "Осталось: N дней", склеивая цифры (11757600 → 1175760040). Фикс: `.cost` вместо `[class*="cost"]`. Затронуло roseltorg, invest-mosreg, investmoscow (превентивно).
- ✅ **aggregator-bankrot area extraction** — `extractArea(excerpt)` брал площадь помещения (13 м²) вместо комплекса (9484 м²). Фикс: title → excerpt приоритет + fallback regex без "площадь" + сотки (1 сотка = 100 м²).
- ✅ **Чистка БД** — удалено 89 объектов с неверными данными (бэкап data.db.bak.20260610)
- ✅ **Деплой** — _shared + 5 парсеров пересобраны на проде
- ✅ **Парсеры** — 10 запущено, 5 дали результаты: alfalot(57), aggregator-bankrot(20), etprf(14), m-ets(10), fabrikant(1). Итого 102 объекта.
- ✅ **Analyzer** — запущен, 66/102 "недооценены" (много ложных: земля/гаражи в регионах vs грубые эталоны)
- ✅ **Digest** — отправлен, 50 объектов

**Что НЕ делать**:
- ❌ Не удалять `api/.tmp/data.db` повторно
- ❌ Не запускать миграции Strapi
- ❌ Не удалять routes файлы

**Следующие шаги**:
1. **Установить реальные эталоны** — текущие 18 market references с тестовыми ценами. Земельные участки и гаражи дают ложные срабатывания. Нужны реальные рыночные цены по городам и типам.
2. **investmoscow/roseltorg/invest-mosreg** — селекторы не матчат карточки (хватает мусор: телефоны, "База знаний"). Нужно обновить CSS-селекторы через browser research.
3. **sberbank-ast** — фильтрует как некоммерцию (аренда вместо продажи). Проверить `isCommercialProperty()`.
4. **torgi-gov** — 0 результатов (нет коммерческих лотов по фильтру). Нормальное поведение.
5. **m-ets дубли** — каждый объект x2 (внешние ID совпадают?). Проверить `external_id` генерацию.
6. **fedresurs** — обход Qrator (прокси/резидентный IP) — по запросу

**Локальное состояние**:
- `~/github.nosync/aklab` — ветка `main`, последний коммит `fa2a27b` (fix: aggregator-bankrot extractArea — сотки)

## Известные баги / TODO

- **Странный коммит `795fdbf "11"` в истории main** — пользовательский,
  squash не делал (force-push опасен). Можно пережить.
- В `deploy-prod.sh` строка ошибки `err "Strapi не поднялся за 30 секунд!"`
  устарела — реальный таймаут 180s, но текст говорит 30. Косметика.
- `trap rollback ERR` в deploy-prod.sh хрупкий — может не сработать при
  exit 1 из health check. Если deploy упал по health — проверить руками
  через `pm2 list` и `curl /_health`.
- `api/src/extensions/documentation/documentation/1.0.0/full_documentation.json`
  один раз попал в коммит, был untrack'нут, добавлен в .gitignore.
- **Seeder Setting дубли** — ИСПРАВЛЕНО (v1.0.20): `entityService.findMany`
  не находил записи из-за draft/published state → seeder создавал дубль
  при каждом bootstrap. Переписано на `db.query.findOne`.
- **Email-дайджест** — рабочий, но зависит от наличия недооценённых
  объектов. Если analyzer не нашёл `is_undervalued=true` — письмо не
  отправляется (это нормальное поведение).
- **Digest smtp_to fallback** — ИСПРАВЛЕНО (v1.0.25): `getSetting()` в cron controller использует `db.query.findOne` вместо `entityService.findMany`.
- **Parser handlers created++** — `createProperty` возвращает `null`
  для отфильтрованных объектов, но handlers не проверяют → `total_created`
  завышается. Косметика.
- **`[class*="cost"]` selector bug** — ИСПРАВЛЕНО (v1.0.26): generic parsers
  (m-ets, roseltorg, invest-mosreg, investmoscow) использовали `[class*="cost"]`
  для поиска цены, но это матчит `.cost-block` содержащий "Осталось: N дней".
  `parsePrice` склеивал все цифры → цена x100. Фикс: `.cost` (exact class).
- **aggregator-bankrot extractArea** — ИСПРАВЛЕНО (v1.0.26): regex брал
  площадь из excerpt (помещение 13 м²) вместо title (комплекс 9484 м²).
  Фикс: title-first приоритет + fallback regex + сотки (×100).
- **Analyzer false positives** — земельные участки и гаражи в регионах
  (267 ₽/м²) сравниваются с эталоном "other/other" = 65,200 ₽/м² → 99%
  deviation. Нужны реальные эталоны с разделением типов недвижимости.

## Полезные команды

```bash
# Smoke test
npm run smoke

# Проверить что на 151 живо
ssh rudin@192.168.11.151 'pm2 list && cd ~/aklab && git log --oneline -5 && grep version package.json | head -1'

# Tail логи API
ssh rudin@192.168.11.151 'export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && pm2 logs aklab-api --lines 50 --nostream'

# Быстрый health
curl -sS -o /dev/null -w "aklab → %{http_code}\n" -m 10 https://aklab.tirobots.ru/
curl -sS -o /dev/null -w "api → %{http_code}\n" -m 10 https://api-aklab.tirobots.ru/_health

# Локальный дев старт
cd ~/github.nosync/aklab && pm2 start ecosystem-local.config.js

# БД на проде
ssh rudin@192.168.11.151 'cd ~/aklab/api && sqlite3 .tmp/data.db "SELECT id, email, firstname FROM admin_users;"'
```

## Связанные документы

- `docs/plan1.md` — что делает продукт (бизнес-логика, источники данных)
- `docs/plan2.md` — план MVP (9 фаз)
- `docs/plan3.md` — план микросервисов парсеров (6 фаз)
- `docs/adding-source.md` — инструкция добавления нового источника
- `docs/setup-local.md` — пошаговая установка локально с нуля
- Глобальные правила (CLAUDE.md пользователя) — НЕ дублируются тут, см.
  родительский `~/.claude/CLAUDE.md`
