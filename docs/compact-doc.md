# AKLAB — compact context

Быстрый onboarding для новой сессии. Прочитай этот файл целиком, прежде
чем что-то делать в проекте.

## Суть проекта

Сервис мониторинга коммерческой недвижимости. Автоматически находит
объекты (офисы, склады, торговые помещения), цена которых на 20%+ ниже
рыночной. Парсит 8 активных источников (Алфалот, Инвест Москва, Сбербанк-АСТ, М-ЕТС, Агрегатор Банкрот, ЕТПРФ, ГИС Торги, Инвест МО), считает
"рыночную" цену через похожие объекты в радиусе X км, шлёт алерты в
Telegram (мгновенно) и утренний дайджест на email.

Полная бизнес-логика — `docs/plan1.md`. Текущий статус — **prod + dev полностью работают**,
15 PM2 процессов, 10 парсеров, analyzer, digest, photo-fetcher.

## Архитектура

### Компоненты

| Компонент | Технология | Порт prod | Порт dev | Где крутится |
|-----------|-----------|-----------|----------|--------------|
| Frontend | Vue 3 + Vite | 5174 | 5174 | Vite preview (prod + dev) |
| Backend | Strapi 5.44.0 + SQLite | 1338 | 1338 | Strapi start (prod + dev) |
| Reverse proxy (prod) | Traefik v2.10 (Docker) | 80/443 | — | 213.184.136.221 (localhost) |
| Reverse proxy (dev) | Traefik v2.10 (Docker) | 80/443 | — | 192.168.11.131 (отдельный хост) |

PM2-процессы на проде (213.184.136.221): 15 процессов (api, app, 10 парсеров,
analyzer, digest, photo-fetcher). На dev (192.168.11.151): аналогично + рядом
`todoit-api`, `todoit-app` — это другой проект, не трогай.

### Домены

**Prod (213.184.136.221):**
- `https://aklab.tirobots.ru` → Traefik (localhost) → :5174 (Vite preview)
- `https://api-aklab.tirobots.ru` → Traefik (localhost) → :1338 (Strapi)

**Dev (192.168.11.151, Traefik на 131):**
- `https://aklab-dev.tirobots.ru` → Traefik (131) → 192.168.11.151:5174
- `https://api-aklab-dev.tirobots.ru` → Traefik (131) → 192.168.11.151:1338

- **СТАРЫЕ, УДАЛЕНЫ** из CORS и Traefik: `*.aklab.ti-soft.ru`, `todoit.ru`,
  `app.todoit.ru`, `api.todoit.ru`. Если где-то всплывут — это баг, не лечи.

### Source of truth

`~/aklab` на **213.184.136.221** — это **прод-репо**, его трогает `git pull`
при деплое. SSH: `ssh -p 5733 root@213.184.136.221` → `su - rudin`
`~/aklab` на **192.168.11.151** — это **dev-репо** (бывший prod)
@@ ~/github.nosync/aklab on your mac — local copy for development
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

Прямой push в `main` — только через PR из `dev`. Feature-ветки — из `dev`.

### Деплой (ТОЛЬКО по команде пользователя, не автоматически)

```bash
# Prod (213.184.136.221)
ssh -p 5733 root@213.184.136.221 'su - rudin -c "source ~/.nvm/nvm.sh && cd ~/aklab && bash scripts/deploy-prod.sh"'

# Dev (192.168.11.151) — вручную:
ssh rudin@192.168.11.151 'source ~/.nvm/nvm.sh && cd ~/aklab && git pull origin dev && cd api && npm run build && cd ../app && npm run build && pm2 restart aklab-api aklab-app'
```

Скрипт сам: git pull → bump patch-версии (1.0.X) → build (api 140s +
app 3s) → PM2 restart → health check 190s → **генерация changelog** →
release-коммит → push origin. Дай foreground-таймаут минимум 300s.

**Всегда логируй в файл** (`> /tmp/deploy.log 2>&1`) и читай файл через
`tail`. Иначе теряешь вывод и не понимаешь, упало или прошло.

### CI/CD (GitHub Actions)

**Workflows** (`.github/workflows/`):
- `ci.yml` — тесты на PR в main/dev (build + typecheck)
- `deploy-dev.yml` — ручной деплой на dev (backup → build → health → smoke → email)
- `deploy-prod.yml` — **авто-деплой при push в main** + ручной запуск с confirm. Deploy-prod.sh → verify → email. Release-коммит с `[skip ci]` чтобы избежать рекурсии.

**Скрипты:**
- `scripts/deploy-prod.sh` — полный деплой. Флаги: `--ci` (email вместо Telegram), `--force` (npm install)
- `scripts/generate-changelog-ai.js` — AI changelog через Xiaomi MiMo. Fallback: `generate-changelog.js`
- `scripts/notify-deploy.sh` — email на `a@rudin.ru`

**SSH ключ для CI:** `~/.ssh/aklab-ci` (ed25519, `github-actions-aklab`)
**GitHub Secrets:** `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, `DEPLOY_PORT` (+ PROD аналоги), `XIAOMIMIMO_API_KEY`
**Branch protection:** нет ни на `main`, ни на `dev`. PR workflow: dev → main.

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

## Текущее состояние (июль 2026, v1.0.106)

- Версия: 1.0.106
- **Инфраструктура (24.06.2026):**
  - **Prod:** 213.184.136.221:5733 (root), Ubuntu 26.04, 15GB RAM, 48GB SSD
  - **Dev:** 192.168.11.151 (rudin), бывший prod
  - **Traefik prod:** Docker на 213.184.136.221 (`/opt/traefik/`)
  - **Traefik dev:** Docker на 192.168.11.131 (редактировать `/home/rudin/home-traefik/traefik-config.yml`)
- **11 источников парсинга** (8 активных, 3 отключены: fedresurs, fabrikant, roseltorg):
  - `services/parser-alfalot/` — Playwright SPA (ecosystem.alfalot.ru), порт 1349
  - `services/parser-investmoscow/` — fetch + Nuxt SSR (__NUXT_DATA__), порт 1353
  - `services/parser-sberbank-ast/` — Playwright AJAX + XML (input#xmlData), порт 1351
  - `services/parser-m-ets/` — Playwright SPA, порт 1355
  - `services/parser-aggregator-bankrot/` — fetch JSON API, порт 1348
  - `services/parser-etprf/` — Playwright AJAX (sale.etprf.ru), порт 1350
  - `services/parser-torgi-gov/` — fetch JSON API (/new/api/public/lotcards), порт 1346
  - `services/parser-invest-mosreg/` — fetch JSON API (/aapi/map/places), порт 1352
  - `services/parser-fabrikant/` — Playwright SPA (fabrikant.ru/procedure/search/sales), порт 1345, **fetchDetails** (описание, контакты, фото)
  - `services/parser-roseltorg/` — Playwright SPA (roseltorg.ru/imuschestvo/nedvizhimost/kommercheskaya-nedvizhimost), порт 1354, **fetchDetails** (описание, контакты, фото). is_active=0 (нужно активировать)
  - ~~`services/parser-bankruptcy/`~~ — **УДАЛЁН** (legacy монолит)
- **15 PM2 процессов** на проде (api, app, 10 парсеров, analyzer, digest, photo-fetcher)
- **Cron расписание**: torgi-gov → 03:00, aggregator-bankrot/alfalot/etprf → 04:00, sberbank-ast/invest-mosreg/investmoscow → 05:00, m-ets → 06:00
- **Email-дайджест**: smtp_to=a@rudin.ru, 09:00 МСК
- **Telegram alerts**: УДАЛЕНЫ из плана
- **Health badges** на `/settings` (таб Парсеры) — 🟢 Online / 🔴 Offline (polling каждые 30с)
- **Per-source cron расписание** — cron expr в Source.schedule (дефолт `0 3 * * *`)
- **Inline-редактирование расписания** на `/settings` (таб Парсеры)
- **Health proxy** — `GET /api/sources/:id/health` → Strapi проксирует на сервис
- **Smoke test** — `npm run smoke` (health, auth, endpoints, data integrity, 12 микросервисов)
- **API security** — все endpoints требуют JWT (роль Authenticated).
  Public role: только login/register/forgot-password.
- **Changelog** — AI-генерация при deploy через Xiaomi MiMo (fallback: словарь TRANSLATIONS)
- **Footer** — колонка «Продукт»: Дашборд, Объекты, Настройки. «История изменений» + «Документация»
- **Frontend** — 7 страниц: `/` (Dashboard), `/properties` (3 таба: Все объекты, В фокусе, В работе), `/properties/:id` (полная карточка), `/settings` (4 таба: Дайджест, Правила, Парсеры, Эталоны), `/changelog`, `/documentation`, `/auth` + 404 catch-all. Навигация: Дашборд, Объекты, Настройки. Ранее отдельные `/sources`, `/market-references` объединены в табы `/settings`.
- **Карточка объекта (`/properties/:id`)** — отображает ВСЕ спарсённые данные: title, description (collapsible >300 символов), address, price, minimum_price, area, property_type, city, published_at_source, first_seen_at, focus_score + теги, «Информация о торгах» (для лотов), «Посмотреть соседей на ЦИАН» (геокодинг через Nominatim → latitude/longitude)
- **Пайплайн (3 триггера)**:
  1. **Запуск парсинга** (`/properties` → collapsible «Запуск парсинга») — только парсинг (глубина). Поллинг `GET /api/cron/queue-stats` каждые 3с, таймаут 100 мин.
  2. **Ручной запуск** (`/settings` → таб «Дайджест») — полный pipeline: парсинг → анализ → дайджест. Параметры: цена лота (от/до), город (Москва/МО/Другие), порог отсечения (1-99%, слайдер), глубина парсинга (1–5000, дефолт 20). Фильтры сохраняются в localStorage.
  3. **Пересчитать** (`/properties` → таб «В фокусе») — анализ (сравнение с эталонами → `deviation_percent`, `is_undervalued`) → scoring (применение focus-rules → `focus_score`, `tags`). Работает только над объектами со `status: 'new'`.
  - Mobile-first: инпуты стакаются на узких экранах, кнопки w-full.
- **Мониторинг регионов** — Setting.monitored_regions (json, дефолт `["moscow","mo"]`). Дайджест фильтрует по `city[$in]`. Мультиселект на `/settings`.
- **Глубина парсинга по расписанию** — Setting.parse_depth (integer, дефолт 20, макс 5000). Cron читает при каждом запуске и передаёт в `addToQueue()`. Поле на `/settings`.
- **Парсеры** (обновлено 05.07.2026):
  - **8 активных парсеров** + 2 готовых к активации (fabrikant, roseltorg), 1 отключён (fedresurs).
  - `alfalot` — Playwright SPA (ecosystem.alfalot.ru). 204 объекта, fetchDetails.
  - `investmoscow` — fetch + Nuxt SSR (`__NUXT_DATA__`). 28 объектов.
  - `sberbank-ast` — Playwright AJAX + XML (`input#xmlData`, `_source` теги). fetchDetails.
  - `m-ets` — Playwright SPA. 200 объектов, fetchDetails.
  - `aggregator-bankrot` — fetch JSON API. 71 объект, fetchDetails.
  - `etprf` — Playwright AJAX (sale.etprf.ru). 200 объектов, fetchDetails.
  - `torgi-gov` — fetch JSON API (`/new/api/public/lotcards`). fetchDetails.
  - `invest-mosreg` — fetch JSON API (`/aapi/map/places`). 5 объектов.
  - `fabrikant` — Playwright SPA (fabrikant.ru). **fetchDetails** (описание, контакты, фото). is_active=0.
  - `roseltorg` — Playwright SPA (roseltorg.ru). **fetchDetails** + URL с фильтрами (Москва, коммерческая). is_active=0.
  - `fedresurs` — **ОТКЛЮЧЁН** (Qrator anti-bot).
- Содержимое:
  - **api/src/api/** — 7 content-types (Property, Setting singleton,
    MarketReference, UserComment, CronLog, **Source**, **Cron** (custom routes))
  - **api/src/services/queueService.ts** — singleton-обёртка
  - **api/src/cron/index.ts** — 4 cron-задачи, читают active sources из Source коллекции
  - **api/src/seeders/index.ts** — seedSettings + seedSources + seedAuthenticatedPermissions + seedTestUser + seedStrapiAdmin
  - **services/_shared/** — `@aklab/service-shared` (config, logger, health-server, queue-worker, strapi-client, types, anti-ban, city-detect)
  - **services/parser-fabrikant/** — FabrikantParser (порт 1345, очередь `parse-fabrikant`)
  - **services/parser-torgi-gov/** — TorgiGovParser (порт 1346, очередь `parse-torgi-gov`)
  - **services/analyzer/** — сравнение Property с MarketReference
  - **services/digest/** — утренний email через nodemailer
  - **lib/sqlite-queue/** — `@aklab/sqlite-queue` v0.1.0
  - **app/src/views/** — Auth, PropertyListView (3 таба), PropertyDetailView,
    SettingsView (4 таба: Дайджест, Правила, Парсеры, Эталоны), ChangelogView, NotFoundView
  - **app/src/components/** — Footer, SkeletonLoader, SkeletonTable
  - **app/src/stores/** — auth.ts (Pinia)
  - **app/src/api/** — strapi.ts (shared axios instance с JWT interceptor)
  - **scripts/smoke-test.js** — smoke тест (npm run smoke)
  - **scripts/generate-changelog.js** — генератор changelog из git commits
- На проде (213.184.136.221): 15 PM2 процессов (api, app, 10 парсеров,
  analyzer, digest, photo-fetcher). Playwright chromium установлен.
- В .env на проде: `STRAPI_ADMIN_EMAIL=admin@aklab.tirobots.ru`,
  `TEST_USER_EMAIL=test@aklab.tirobots.ru`
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
41. **Price filter: анализ, не парсинг** — `price_from`/`price_to` в Setting
    фильтруют АНАЛИЗ (auto-analyze 08:00 + digest), а не парсинг. Парсеры
    всегда парсят все объекты, фильтр применяется при сравнении с эталонами.
42. **propertyExists fail-closed** — при non-OK ответе API (500, 401, etc.)
    `propertyExists` возвращает `true` (skip). Раньше возвращала `false`
    → при 500 от API парсер создавал дубликаты. Баг: 1241 дубликат из 3407.
43. **digest_enabled** — boolean в Setting, default true. 3 уровня защиты:
    cron/index.ts, cron controller, digest handler. `data !== false` для
    обратной совместимости (null/undefined → true).

## Session handoff (v1.0.37 → следующая сессия)

**Сделано в сессии 24 июня 2026 (v1.0.37 — миграция инфраструктуры):**
- ✅ **Новый prod-сервер** — 213.184.136.221:5733 (root, Ubuntu 26.04, nedvizhka, 15GB RAM)
- ✅ **Node v20.20.2 + PM2 7.0.1 + gh (ti-rudin)** — настроено на новом сервере
- ✅ **aklab клонирован и развёрнут** — 15 PM2 процессов online, Strapi health: 204
- ✅ **Traefik v2.10 (Docker)** — `/opt/traefik/docker-compose.yml`, ports 80/443/8080
- ✅ **Playwright chromium** установлен для парсеров
- ✅ **PM2 startup** — systemd service `pm2-rudin.service`
- ✅ **DNS** — aklab.tirobots.ru + api-aklab.tirobots.ru → 213.184.136.221
- ✅ **151 → dev** — Traefik на 131 обновлён (dev-домены), app/.env VITE_API_URL, CORS
- ✅ **aklab skill и compact-doc.md** обновлены

**✅ Инфраструктура полностью работает (25.06.2026):**
- Порты 80/443 открыты через pfSense NAT на провайдере
- Let's Encrypt сертификаты получены автоматически
- Frontend: `https://aklab.tirobots.ru/` → 200
- API health: `https://api-aklab.tirobots.ru/_health` → 204
- Admin: `https://api-aklab.tirobots.ru/admin` → 200

**Gotcha: Docker networking** — Traefik в контейнере не видит `127.0.0.1:port` хоста. В `dynamic.yml` нужно указывать приватный IP: `http://192.168.31.147:5174`.

**Gotchas миграции:**
- `api/` и `app/` — НЕ workspace-пакеты, нужен отдельный `npm install` в каждой
- `strapi build` (admin panel) занимает ~40с на новом сервере (vs ~140с на 151)
- `ecosystem.config.js` содержит PATH с версией Node — при смене версии обновить v20.20.2
- Seeder отработал при первом старте: admin@aklab.ti-soft.ru, 11 sources, 1 test user
- SQLite quoting в SSH+paramiko — проблема с экранированием, использовать Python-скрипт на сервере

**Сделано в сессии 2 июля 2026 (v1.0.53 — hotfix prod + deploy hardening):**
- ✅ **better-sqlite3 rebuild** — PM2 daemon работал на Node 20.20.2, приложения на Node 22.20.0. `npm rebuild better-sqlite3` на проде + перезапуск всех 15 процессов.
- ✅ **property_events.property_id** — колонка отсутствовала в SQLite (Strapi 5 manyToOne не создаёт FK автоматически). `ALTER TABLE` + индекс. Score endpoint заработал: 178 объектов, 23 в фокусе, 124 события.
- ✅ **PUT permission для authenticated** — добавлена `api::property.property.update` в `up_permissions` + link к роли authenticated (id=1).
- ✅ **API_TOKEN_SALT sync** — `.env` содержал соль `ElTI...`, PM2 daemon env — `EYJG...` (старое окружение). `access_key` в БД пересчитан через HMAC-SHA512. Strapi 5: hash = `crypto.createHmac('sha512', salt).update(token).digest('hex')`.
- ✅ **deploy-prod.sh hardened** — 4 новых проверки: PM2 daemon Node version (→ `pm2 update` + systemd), .env ↔ PM2 env sync, `npm rebuild better-sqlite3` (root + api + services), rebuild в rollback-блоке.
- ✅ **Sources health fix** — фронтенд отправлял числовой `id` вместо `documentId` → 400 ошибка. Пересобран frontend на проде.

**Сделано в сессии 2 июля 2026 (починка парсеров — 8/10 рабочих):**
- ✅ **apartment enum** — добавлен `apartment` в Strapi property_type schema. Квартиры парсятся.
- ✅ **isCommercialProperty** — COMMERCIAL_TYPES (office, warehouse, retail, production, free_purpose) → доверять парсеру.
- ✅ **torgi-gov price fix** — `priceMin`/`priceMax` (API v2) вместо `priceInfo.startPrice`.
- ✅ **sberbank-ast XML fix** — `_source` теги вместо `row`, `purchName`/`purchAmount`/`GeoDataAddress`/`Latitude`/`Longitude`.
- ✅ **investmoscow Nuxt fix** — coords валидация (Array.isArray + typeof number), `__NUXT_DATA__` парсинг объектов с startPrice+objectArea+address.
- ✅ **m-ets, invest-mosreg, investmoscow** — переписаны парсеры с нуля (JSON API / fetch / Nuxt SSR).
- ✅ **fabrikant/roseltorg ОТКЛЮЧЕНЫ** — fabrikant не содержит коммерческую недвижимость, roseltorg WAF блокирует.
- ✅ **Smart stop 3→10** — увеличен порог дублей подряд.
- ✅ **apartment в classifyPropertyType** — все 8 парсеров классифицируют квартиры.
- ✅ **БД очищена**, счётчики сброшены. 8 активных источников.
- ✅ **Anti-ban модуль** (`_shared/src/anti-ban.ts`) — `randomDelay(min, max)`, `getRandomUA()`, `createStealthContext(browser)` (рандомный UA, ru-RU locale), `retryGoto(page, url, maxAttempts)` с exponential backoff.
- ✅ **Глубина парсинга UI** — input «Глубина парсинга» (default 50, min 1, max 500) рядом с кнопкой «Ручной запуск» на `/settings`. Параметр `depth` передаётся в `POST /cron/parse/:slug`.
- ✅ **parse-handler рефактор** — `ParseOptions`/`ParseResult` типы, `createParseHandler(parser)` принимает `depth` из `job.data`, smart stop (3+ дубля подряд → break), depth limit (`created >= depth → break`), `randomDelay(500, 1500)` между `propertyExists` проверками.
- ✅ **10/10 парсеров рефакторены** — все принимают `parse(depth?: number)`, используют `createStealthContext`, `randomDelay`, `retryGoto`. Пагинация ограничена depth (`maxPages = Math.ceil(depth / ITEMS_PER_PAGE)`).
- ✅ **234/234 тестов** зелёные, `tsc --noEmit` чистый во всех 12+ сервисах.

**Сделано в сессии 11 июня 2026 (v1.0.36):**
- ✅ **Photo-fetcher cwd mismatch (v1.0.36)** — photo-fetcher писал фото в свой `data/photos/`, API читал из своего → 404. Фикс: handler.ts пишет в `../../api/data/photos/` (env override `PHOTOS_BASE_DIR`). 28 папок с фото перенесены на проде вручную.

**Сделано в сессии 10 июня 2026 (v1.0.28–v1.0.34):**
- ✅ **Страница «Документация»** (`/documentation`) — подробная архитектура: диаграмма, таблица сервисов с портами, карточки парсеров, поток данных, API endpoints, шаги деплоя, порядок сборки.
- ✅ **Footer** — "Changelog" → "История изменений", добавлена "Документация".
- ✅ **Ручной запуск пайплайна** — кнопка на `/settings`, поллинг очередей через `GET /api/cron/queue-stats` каждые 3с (без фиксированных таймаутов). Этапы: парсинг (6 мин) → анализ (3 мин) → дайджест (90 сек).
- ✅ **Мониторинг регионов** — `Setting.monitored_regions` (json, дефолт `["moscow","mo"]`). Дайджест фильтрует объекты по `city[$in]`. Мультиселект чекбоксов на `/settings`.
- ✅ **Test user credentials** — смена email с `test@aklab.ti-soft.ru` на `test@aklab.tirobots.ru`. Gotcha: username `test` конфликтует → нужно удалять старого юзера перед созданием нового.
- ✅ **Deploy script** — подтверждён как самодостаточный (строит всё: lib → _shared → api → app → 12 сервисов). Обновлена ошибка в aklab skill.
- ✅ **Параметры запуска (v1.0.33)** — collapsible панель на `/properties`: цена лота (от/до), город (Москва/МО/Другие), порог отсечения (1-99%, слайдер). Фильтры сохраняются в localStorage. Backend: `POST /cron/analyze` принимает `{ priceFrom, priceTo, city, threshold }`.
- ✅ **Дефолтные регионы** — `moscow + mo + other` (включая other). Раньше был только moscow + mo.
- ✅ **Результаты пайплайна (v1.0.33)** — подробные результаты: парсинг (источники + объекты + ошибки), анализ (по городам), дайджест (отправлен/пропущен).
- ✅ **Кнопка «Запустить ещё раз»** — теперь активна после завершения пайплайна (`pipelineStage === done`).
- ✅ **SMTP to fix (v1.0.34)** — `entityService.findMany` для singleton → `db.query.findOne({})`. Теперь digest шлёт на `Setting.smtp_to` (a@rudin.ru), а не на `config.smtp.user` (tirobots@yandex.ru).
- ✅ **Mobile-first UI** — кнопки `w-full sm:w-auto`, цена инпуты `grid-cols-1 sm:grid-cols-[1fr_auto_1fr]`, чекбоксы `grid-cols-3`, фильтры `grid-cols-2 sm:flex`, слайдер `min-w-0`.

**Что НЕ делать**:
- ❌ Не удалять `api/.tmp/data.db` повторно
- ❌ Не запускать миграции Strapi
- ❌ Не удалять routes файлы

**Следующие шаги**:
1. **Запустить пайплайн на проде** — БД пуста, счётчики сброшены. Запустить парсинг 8 источников через `/settings` → таб Дайджест → «Запуск парсинга».
2. **Проверить эталоны** — 18 записей market_references восстановлены на prod (с dev). Проверить актуальность цен.
3. **fedresurs** — обход Qrator (прокси/резидентный IP) — по запросу
4. **fabrikant** — если появятся коммерческие лоты, можно включить обратно
5. **roseltorg** — нужен прокси для обхода WAF

**Локальное состояние (25.06.2026):**
- `~/github.nosync/aklab` — ветка `main`, последний коммит `11fc709` (Merge PR #1: dev → main)
- Ветка `dev` — синхронизирована с main
- CI/CD: GitHub Actions (ci.yml, deploy-dev.yml, deploy-prod.yml)
- Scripts: deploy-prod.sh (--ci), generate-changelog-ai.js, notify-deploy.sh
- SSH ключ CI: `~/.ssh/aklab-ci`

## Известные баги / TODO

- **E2E тесты на проде — network isolation** — dev-server (192.168.11.151) не может достучаться до `api-aklab.tirobots.ru` / `213.184.136.221` (connection timeout). E2E тесты на прод нужно запускать **с того же сервера** или из GitHub Actions (prod network). `global-setup.ts` использует `BASE_URL` env — для прод-тестов нужен `FRONTEND_URL=https://aklab.tirobots.ru`. **Нерешено.**
- **5 skipped E2E тестов** — API smoke tests (section 9): 4 работают но skipped из-за rate limiter, 1 (settings endpoint) возвращает 404 (singleton).
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
- **Photo-fetcher cwd mismatch** — ИСПРАВЛЕНО (v1.0.36): photo-fetcher
  и API — разные PM2-процессы с разными cwd. `process.cwd()/data/photos/`
  в photo-fetcher ≠ то же в API → фото не отдавались (404). Фикс:
  handler.ts пишет в `../../api/data/photos/`.

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

**Сделано в сессии 3 июля 2026 (v1.0.76–v1.0.84 — fetchDetails, настройки, city detection):**
- ✅ **3-фазный парсинг** — parse-handler переписан: parse → existence check → fetchDetails + createProperty
- ✅ **fetchDetails progress UI** — `X/Y детальных` на `/properties`, needed=fixed, fetched=grows
- ✅ **resetSourceDetailsCounters** — счётчики обнуляются перед каждым запуском
- ✅ **queue-stats fix** — плоская структура (без двойной вложенности)
- ✅ **JWT_SECRET fix** — добавлен в `api/.env` на сервере
- ✅ **Response interceptor** — ловит 500 + "Forbidden" → редирект на /auth
- ✅ **clearNew feedback** — `alert()` с результатом
- ✅ **Автодеплой отключён** — workflow_dispatch only
- ✅ **Setting.parse_depth** — глубина парсинга по крону (UI на /settings, дефолт 20, макс 5000)
- ✅ **setting.update permission** — добавлено в seeder (authenticated роль)
- ✅ **detectCity shared** — общая функция в `_shared/src/city-detect.ts`, regex fix для «Москва-Кашира»
- ✅ **Таймаут парсинга 6→100 мин** — maxAttempts 120→2000
- ✅ **БД пересканирована** — 29 объектов исправлено (city detection)
- ✅ **depth=1000 тест** — 1961 объект, 3509 детальных, ~2.5 часа
- ✅ **234/234 тестов** зелёные

## Связанные документы

- `docs/plan1.md` — что делает продукт (бизнес-логика, источники данных)
- `docs/plan2.md` — план MVP (9 фаз)
- `docs/plan3.md` — план микросервисов парсеров (6 фаз)
- `docs/adding-source.md` — инструкция добавления нового источника
- `docs/setup-local.md` — пошаговая установка локально с нуля
- Глобальные правила (CLAUDE.md пользователя) — НЕ дублируются тут, см.
  родительский `~/.claude/CLAUDE.md`

---

## Инсайты из сессий

### 2026-07-05: Property types + DRY refactor (v1.0.99 → v1.0.102)

**Что произошло:** добавлены типы `apartment`/`land`, вынесена `classifyPropertyType` в shared, фильтрация по цене, рефакторинг 10 парсеров.

**Инсайты:**
1. **`replace_all` в Vue-файлах — ловушка.** Патч `option value="apartment"` с `replace_all=true` затронул селект «Город», а не «Тип недвижимости». Оба содержат одинаковые option'ы. **Правило:** в Vue с повторяющимися элементами — уникальный контекст вокруг патча.
2. **Build падает → deploy откатывается.** deploy-prod.sh проверяет health check. Если Vue build падает (невалидный HTML), deploy остаётся на предыдущей версии. Это хорошая защита, но нужно проверять build локально перед пушем.
3. **DRY для парсеров критичен.** 10 копий `classifyPropertyType` с расхождениями в логике (одни пропускали apartment, другие нет). Вынос в shared устранил inconsistency.
4. **Цена фильтрует анализ, не парсинг.** Пользователь ожидал что парсеры будут фильтровать по цене. Но бизнес-логика: парсим всё, фильтруем при анализе. Это правильно — данные нужны для истории.

### 2026-07-05: Dedup bug + digest toggle (v1.0.102+)

**Что произошло:** найден критический баг — 1241 дубликат из 3407 объектов (36%). Причина: `propertyExists()` при 500 от API возвращала `false` (не существует) вместо `true` (skip).

**Инсайты:**
1. **fail-closed vs fail-open.** `if (!res.ok) return false` — это fail-open (при ошибке считаем что НЕТ). Правильно: `return true` (при ошибке считаем что ЕСТЬ). Разница критична при нестабильном API.
2. **2 линии защиты.** `propertyExists` в parse-handler + `propertyExists` в `createProperty`. Если первая пропустит — вторая поймает.
3. **Порядок фильтров.** Быстрый фильтр (price_per_sqm) должен быть ДО API-вызовов (propertyExists). Экономит запросы.
4. **Дедуп скрипт.** `scripts/dedup-properties.js` — оставляет самый ранний объект в группе source+external_id, удаляет фото с диска.
5. **digest_enabled toggle.** 3 уровня защиты: cron, controller, handler. `data.digest_enabled !== false` (default true для обратной совместимости).

44. **resetSourceDetailsCounters: сбрасывать ВСЕ счётчики** — `total_found` и `total_created` должны обнуляться перед каждым парсингом иначе кумулятивные (6015 вместо 52). В v1.0.103 сбрасывались только `total_details_fetched/needed`. Исправлено в v1.0.104.
45. **Analyzer: объекты без эталона → analyzed=true** — если `MarketReference` не найден для city/property_type, объект помечается `is_undervalued: false, deviation_percent: 0` вместо `analyzed: false`. Без этого `analyzeProgress.done` никогда не достигается (зависание 48/77). v1.0.104.
46. **Pipeline: два поля «Глубина»** — на `/settings` есть ОТДЕЛЬНОЕ поле «Глубина парсинга (по расписанию)» (form.parse_depth, для cron) и поле «Глубина:» в секции ручного запуска (parseDepth, для pipeline). Они НЕ связаны. Пользователь может поменять одно и удивиться что другое не изменилось. Нужно синкать или убрать дублирование.
47. **fabrikant/roseltorg: fetchDetails** — добавлены в v1.0.105. Все 8 парсеров с HTML scraping теперь имеют fetchDetails. investmoscow/invest-mosreg — JSON API, им не нужно. fabrikant и roseltorg is_active=0 (нужно активировать вручную).
48. **roseltorg URL** — правильный URL: `/imuschestvo/nedvizhimost/kommercheskaya-nedvizhimost?sale=all&okato[]=45000000000&status[]=5&status[]=0&status[]=1` (Москва, коммерческая, активные). Раньше парсер пробовал случайные URL'ы (/lot-search, /search и т.д.) которые не существовали.
49. **fabrikant data-slot selectors** — карточки: `[data-slot="card"][data-id]`, title: `[data-slot="anchor"]`, цена: `[data-slot="text"]` содержащий "RUB", URL: `/procedure/search/sales` (вкладка "Продажи"), пагинация: `?page=N`.

### 2026-07-05: Pipeline progress + analyzer fix (v1.0.104 → v1.0.106)

**Что произошло:** три бага в pipeline, fetchDetails для fabrikant/roseltorg, roseltorg URL.

**Инсайты:**
1. **cumulative total_created.** `resetSourceDetailsCounters` не сбрасывал `total_found/total_created`. Каждый парсинг прибавлял к старым значениям. 52 реальных объектов → 6015 в UI. Фикс: обнулять ВСЕ 4 поля.
2. **Analyzer hang 48/77.** 29 объектов (land/apartment) без MarketReference → `analyzed: false` → progress никогда не `done`. Фикс: `analyzed: true, is_undervalued: false`.
3. **Pipeline depth vs settings depth.** Два независимых поля «Глубина» — одно для cron, другое для ручного запуска. Пользователь менял одно, ожидал что второе применится.
4. **Парсеры без fetchDetails.** investmoscow/invest-mosreg не нужен (JSON API). fabrikant/roseltorg — просто не был реализован. Добавлен в v1.0.105.
5. **roseltorg URL guessing.** Парсер пробовал 5 случайных URL'ов вместо одного правильного. Всегда лучше один проверенный URL с фильтрами, чем угадывание.
