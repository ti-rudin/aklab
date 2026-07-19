# AKLAB — compact context

Быстрый onboarding для новой сессии. Прочитай этот файл целиком, прежде
чем что-то делать в проекте.

## Суть проекта

Сервис мониторинга коммерческой недвижимости. Автоматически находит
объекты (офисы, склады, торговые помещения), цена которых на 20%+ ниже
рыночной. Парсит 10 активных источников (Алфалот, Инвест Москва, Сбербанк-АСТ, М-ЕТС, Агрегатор Банкрот, ЕТПРФ, ГИС Торги, Инвест МО, Фабрикант, Росэлторг), считает
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

### Run-scoped parser telemetry и production проверки (v1.1.71–v1.1.73)

Pipeline telemetry хранится отдельно от агрегированного `Source`: `parser_run` идентифицируется immutable `run_id`, `parser_run_source` — `identity_key = runId:sourceSlug:stage`. Строка этапа создаётся `queued` **до enqueue**, получает реальный numeric `job_id` после enqueue, worker переводит её `running`, затем посылает exact terminal counters через internal aliases с `global::service-token`.

После `waitForJobs()` terminal SQLite Queue является authoritative: failure/cancellation исправляет преждевременный worker `success`. Contract и таблица counters — `docs/run-scoped-parser-telemetry.md`. Runtime E2E подтверждён production runs 2026-07-17: terminal telemetry internal calls 200, workers корректно завершают source stages.

**SQLite boundary rules:**
- `strapi.db.query().create()` не делает REST JSON transform: для property parser upsert сериализовать `tags` и `photo_urls`, иначе `better-sqlite3` даёт `500`.
- Raw focus query отдаёт `first_seen_at` epoch milliseconds, REST путь — ISO. Digest freshness parser обязан поддерживать оба формата; production v1.1.73 подтвердил email `2 hot + 27 regular` после fix.

### Ссылки ГИС Торги (v1.1.74)

Публичная карточка torgi.gov.ru использует маршрут `/new/public/lots/lot/{noticeNumber}_{lotNumber}`. Устаревший `/new/public/lots/reg/lot-card/{noticeNumber}/{lotNumber}` возвращает HTTP 200 со SPA-страницей 404, поэтому URL-аудит обязан проверять hydrated DOM/body. В production исправлены все 149 существующих ссылок; parser генерирует новый формат.

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
  Europe/Moscow). 2 cron: `pipeline:daily` (ежечасная проверка, запуск в digest_time) и `cleanup:old` (03:00).
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
│   ├── sqlite-queue/           # @aklab/sqlite-queue (донор tirobots)
│   └── parse-rules/            # @aklab/parse-rules — единый ParseRules + buildParseRules
├── services/                   # микросервисы (npm workspaces)
│   ├── services.json           # единый манифест: slug, port, health_port, pm2_name
│   └── _shared/                # @aklab/service-shared (config, logger, anti-ban, city-detect)
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

## Текущее состояние (июль 2026, v1.1.74)

Версия: 1.1.74 (исправлены публичные ссылки ГИС Торги; все существующие записи обновлены)
- **Инфраструктура (24.06.2026):**
  - **Prod:** 213.184.136.221:5733 (root), Ubuntu 26.04, 15GB RAM, 48GB SSD
  - **Dev:** 192.168.11.151 (rudin), бывший prod
  - **Traefik prod:** Docker на 213.184.136.221 (`/opt/traefik/`)
  - **Traefik dev:** Docker на 192.168.11.131 (редактировать `/home/rudin/home-traefik/traefik-config.yml`)
- **11 источников парсинга** (10 активных, 1 отключён: fedresurs):
  - `services/parser-alfalot/` — Playwright SPA (ecosystem.alfalot.ru), порт 1349
  - `services/parser-investmoscow/` — fetch + Nuxt SSR (__NUXT_DATA__), порт 1353
  - `services/parser-sberbank-ast/` — Playwright AJAX + XML (input#xmlData), порт 1351
  - `services/parser-m-ets/` — Playwright SPA, порт 1355
  - `services/parser-aggregator-bankrot/` — fetch JSON API, порт 1348
  - `services/parser-etprf/` — Playwright AJAX (sale.etprf.ru), порт 1350
  - `services/parser-torgi-gov/` — fetch JSON API (/new/api/public/lotcards), порт 1346
  - `services/parser-invest-mosreg/` — fetch JSON API (/aapi/map/places), порт 1352
  - `services/parser-fabrikant/` — Playwright SPA (fabrikant.ru/procedure/search/sales), порт 1345, **fetchDetails** (описание, контакты, фото). is_active=1.
  - `services/parser-roseltorg/` — Playwright SPA (roseltorg.ru/imuschestvo/nedvizhimost/kommercheskaya-nedvizhimost), порт 1354, **fetchDetails** (описание, контакты, фото). is_active=1.
  - ~~`services/parser-bankruptcy/`~~ — **УДАЛЁН** (legacy монолит)
- **15 PM2 процессов** на проде (api, app, 10 парсеров, analyzer, digest, photo-fetcher)
- **Cron расписание**: ONE `pipeline:daily` — проверяет каждый час, запускается в `digest_time` из settings (mode='full': parseAll → analyze → digest). + `cleanup:old` в 03:00
- **Email-дайджест**: top-100 объектов из фокуса (по focus_score), smtp_to=a@rudin.ru, 09:00 МСК. Разделение на 🔥 Горячее (score≥50) и 📋 Обычное (20-49).
- **Telegram alerts**: УДАЛЕНЫ из плана
- **Health badges** на `/settings` (таб Парсеры) — 🟢 Online / 🔴 Offline (polling каждые 30с)
- **Per-source cron расписание** — УДАЛЁН (v1.1.59). `rescheduleSource` — no-op. Все источники парсятся в одном pipeline:daily
- **Health proxy** — `GET /api/sources/:id/health` → Strapi проксирует на сервис
- **Smoke test** — `npm run smoke` (health, auth, endpoints, data integrity, 12 микросервисов)
- **Unit тесты** — `npm run test` (vitest). 27 файлов, 578 тестов (root) + 14 файлов (app). Включают buildParseRules, createProperty, queue, pipeline, cron, focusEngine, buildPropertyWhere, **extractPrice/extractArea всех 10 парсеров**, **composables (usePropertyData, useFocusTab, usePropertyFilters, useToast)**.
- **E2E тесты** — `cd app && HEADLESS=true npx playwright test --project=chromium`. **56/56 тестов passing** в 14 describe-блоках: unauthenticated (7), auth flow (4), dashboard (5), properties (6), settings (5), property detail (2), pagination (3), focus tab (3), detail extended (4), settings digest (4), settings rules (2), settings sources (4), market references (3), changelog+docs+404 (4). Пароль из файла `/tmp/.e2e_password` (workaround: terminal tool маскирует `***` при передаче через env). Против production: `BASE_URL=https://aklab.tirobots.ru`. **Ключевые фиксы (v1.1.32):** API-based login попробован, но откатился на UI login (стабильнее). Заменён table-row click на `navigateToFirstProperty` (API-based). `switchToTableView` возвращает boolean + handle empty tables. Селекторы: `Цена→₽`, conditional dashboard types. Hash routing timeout + double-login removed. Rate limit users-permissions 50→300. Auto-seed в deploy-prod.sh.
- **Playwright на Ubuntu 26.04** — chromium symlinks в deploy-prod.sh (workaround). HEADLESS=true env var для headless mode.
- **API security** — single-tenant: все endpoints `auth: false, policies: []`.
  API-токен не работает с `config: {}` (gotcha #62). JWT протухает после `pm2 restart`.
- **Changelog** — AI-генерация при deploy через Xiaomi MiMo (fallback: словарь TRANSLATIONS)
- **Footer** — колонка «Продукт»: Дашборд, Объекты, Настройки. «История изменений» + «Документация»
- **Frontend** — 7 страниц: `/` (Dashboard — статистика, горячие объекты, таблица типов недвижимости с кликабельными кнопками → фильтр по типу), `/properties` (3 таба: Все объекты, В фокусе, В работе), `/properties/:id` (полная карточка), `/settings` (4 таба: Дайджест, Правила, Парсеры, Эталоны), `/changelog`, `/documentation`, `/auth` + 404 catch-all. Навигация: Дашборд, Объекты, Настройки. Ранее отдельные `/sources`, `/market-references` объединены в табы `/settings`.
- **Фильтры мультиселект** — тип недвижимости и город во вкладках «Все объекты» и «В фокусе» реализованы как чекбоксы (pill-стиль), не select. Множественный выбор, query builder использует `$in`. Dashboard → `/properties?property_type=X` передаёт фильтр.
- **Карточка объекта (`/properties/:id`)** — отображает ВСЕ спарсённые данные: title, description (collapsible >300 символов), address, price, minimum_price, area, property_type, city, published_at_source, first_seen_at, focus_score + теги, «Информация о торгах» (для лотов), «Посмотреть соседей на ЦИАН» (геокодинг через Nominatim → latitude/longitude)
- **Pipeline Orchestrator** (v1.1.0, разбит на модули в v1.1.25):
  - **Единый сервис** `api/src/services/pipeline/` — оркестрирует парсинг → анализ → дайджест.
    Разбит на 3 модуля: `state.ts` (get/update/reset state), `stages.ts` (parseAll/analyze/digest), `index.ts` (run/cancel/orchestrate).
  - **SSE** (`api/src/services/pipeline-sse.ts`) — реалтайм прогресс через EventSource (без polling).
  - **Pipeline State** — персистентное состояние в `setting.pipeline_state` (JSON singleton).
    Статусы: `idle | running | cancelling`. Стадии: `parsing_scan → parsing_scan_done → parsing_details → parsing_done → analyzing → analyzing_done → digesting → done`.
  - **Idempotency** — `if pipeline_state.status === 'running'` → reject (один pipeline одновременно).
  - **Error resilience** — ошибки отдельных источников копятся в `errors[]`, pipeline идёт до конца.
  - **Cancel** — кнопка «Отменить» в UI, статус `cancelling`.
  - **Cron → pipeline** — cron дайджеста и auto-analyze делегируют в `pipeline.run()`, нет копипасты.
  - **Score встроен в analyze** — один этап вместо двух (analyze + score были отдельно).
  - **Pre-filter** (v1.1.37) — preFilterProperty() в parse-handler фильтрует по city, stop words, area, price ДО fetchDetails. Экономия: вместо 291 fetchDetails → 15.
  - **Двуфазный парсинг** (v1.1.37) — parse-handler разделён на Phase 1 (scan: парсинг списков + дедуп + предфильтр → файл) и Phase 2 (details: чтение файла + fetchDetails + createProperty). Pipeline синхронизирует фазы глобально: Phase 2 начинается ТОЛЬКО после завершения ВСЕХ Phase 1. Счётчики НЕ прыгают.  - API: `POST /api/pipeline/start`, `GET /api/pipeline/status`, `POST /api/pipeline/cancel`, `POST /api/pipeline/reset`, `GET /api/pipeline/stream` (SSE). Все endpoints — `auth: false`.
  - **3 триггера в UI:**
    1. **Запуск парсинга** (`/properties` → collapsible) — полный pipeline: парсинг → анализ → дайджест. Фильтры: цена (от/до), город (мультиселект), глубина. Вызывает `POST /pipeline/start` с `mode: 'full'`.
    2. **Ручной запуск** (`/settings` → таб «Дайджест») — полный pipeline: парсинг → анализ → дайджест. SSE reconnect при перезагрузке страницы.
    3. **Пересчитать** (`/properties` → таб «В фокусе») — только scoring.
  - **Дайджест** — top-100 объектов из фокуса (по focus_score), НЕ только is_undervalued. Разделение на 🔥 Горячее (score≥50) и 📋 Обычное (20-49).
  - Mobile-first: инпуты стакаются на узких экранах, кнопки w-full.
- **Мониторинг регионов** — Setting.monitored_regions (json, дефолт `["moscow","mo"]`). Дайджест фильтрует по `city[$in]`. Мультиселект на `/settings`.
- **Глубина парсинга по расписанию** — Setting.parse_depth (integer, дефолт 20, макс 5000). Cron читает при каждом запуске и передаёт в `addToQueue()`. Поле на `/settings`.
- **Правила парсинга** (v1.1.13):
  - **Стоп-слова** — Setting.stop_words (json массив, дефолт `["земельный участок", "земельные участки", "зу", "участок"]`). Парсер пропускает объекты содержащие эти слова в title/description.
  - **Диапазон цен** — Setting.price_from/price_to (decimal). Объекты вне диапазона пропускаются при парсинге.
  - **Диапазон площади** — Setting.area_from/area_to (decimal). Объекты вне диапазона пропускаются при парсинге.
  - **Города** — Setting.monitored_regions (json). Объекты из неотслеживаемых городов пропускаются.
  - **Правила применяются в** `createProperty()` (`_shared/src/strapi-client.ts`) — через `ParseRules` interface, передаётся из pipeline и cron через queue job data.
  - **UI** — `/settings` → таб «Правила» → секция «Правила парсинга» (ParsingRulesPanel.vue). Глубина, цена, площадь, города перенесены из «Дайджеста».
  - **Предзаполнение** — формы ручного запуска на `/properties` и `/settings` предзаполняются из Setting.
  - **buildParseRules(setting)** — единая функция в `lib/parse-rules/` (`@aklab/parse-rules`). Re-export из `api/src/services/parseRules.ts` и `_shared/src/strapi-client.ts`.
- **Парсеры** (обновлено 07.07.2026):
  - **10 активных парсеров** + 1 отключён (fedresurs — Qrator anti-bot).
  - `alfalot` — Playwright SPA (ecosystem.alfalot.ru). 204 объекта, fetchDetails.
  - `investmoscow` — fetch + Nuxt SSR (`__NUXT_DATA__`). 28 объектов.
  - `sberbank-ast` — Playwright AJAX + XML (`input#xmlData`, `_source` теги). fetchDetails.
  - `m-ets` — Playwright SPA. 200 объектов, fetchDetails. **Фильтр:** `auction_type='bankruptcy'` (не marketplace — там автомобили/права требования).
  - `aggregator-bankrot` — fetch JSON API. 71 объект, fetchDetails.
  - `etprf` — Playwright AJAX (sale.etprf.ru). 200 объектов, fetchDetails.
  - `torgi-gov` — fetch JSON API (`/new/api/public/lotcards`). fetchDetails.
  - `invest-mosreg` — fetch JSON API (`/aapi/map/places`). 5 объектов. **Важно:** API отдаёт цену в млн.руб. и площадь в гектарах — парсер конвертирует (×1M, ×10000).
  - `fabrikant` — Playwright SPA (fabrikant.ru). **fetchDetails** (описание, контакты, фото). is_active=1.
  - `roseltorg` — Playwright SPA (roseltorg.ru). **fetchDetails** + URL с фильтрами (Москва, коммерческая). is_active=1.
  - `fedresurs` — **ОТКЛЮЧЁН** (Qrator anti-bot).
- Содержимое:
  - **api/src/api/** — 7 content-types (Property, Setting singleton,
    MarketReference, UserComment, CronLog, **Source**, **Cron** (custom routes))
  - **api/src/services/queueService.ts** — singleton-обёртка
  - **api/src/services/parseRules.ts** — re-export из `@aklab/parse-rules` (единый buildParseRules)
  - **api/src/cron/index.ts** — 2 cron-задачи: pipeline:daily + cleanup:old
  - **api/src/seeders/index.ts** — seedSettings + seedSources + seedAuthenticatedPermissions + seedTestUser + seedStrapiAdmin
  - **services/_shared/** — `@aklab/service-shared` (config, logger, health-server, queue-worker, strapi-client, types, anti-ban, city-detect)
  - **services/parser-fabrikant/** — FabrikantParser (порт 1345, очередь `parse-fabrikant`)
  - **services/parser-torgi-gov/** — TorgiGovParser (порт 1346, очередь `parse-torgi-gov`)
  - **services/analyzer/** — сравнение Property с MarketReference
  - **services/digest/** — утренний email через nodemailer
  - **lib/sqlite-queue/** — `@aklab/sqlite-queue` v0.1.0
  - **lib/parse-rules/** — `@aklab/parse-rules` v0.1.0 (ParseRules interface + buildParseRules)
  - **app/src/views/** — Auth, PropertyListView (тонкая оболочка 145 строк, 3 таба → подкомпоненты), PropertyDetailView,
    SettingsView (4 таба: Дайджест, Правила, Парсеры, Эталоны), ChangelogView, NotFoundView
  - **app/src/components/** — Footer, SkeletonLoader, SkeletonTable
  - **app/src/components/properties/** — ParseLaunchPanel, PropertyAllTab, PropertyFocusTab, ConfirmClearDialog, PropertyTable, PropertyCard
  - **app/src/components/settings/** — RulesPanel, ParsingRulesPanel, SourcesPanel, MarketReferencesPanel
  - **app/src/composables/** — usePropertyData, useFocusTab, useToast, **useFocusParams** (buildFocusParams/buildAnalyzeBody), **usePolling** (auto-cleanup on unmount)
  - **app/src/stores/** — auth.ts (Pinia)
  - **app/src/api/** — strapi.ts (shared axios instance с JWT interceptor)
  - **app/src/utils/formatters.ts** — cityLabel, typeLabel, statusLabel, statusStyle, formatPrice, **tagLabel** (10 переводов slug-тегов)
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
- **Geocoding endpoint** — `GET /api/properties/:id/geocode` → Nominatim + кэш lat/lng в БД (auth required)
- **Серверный поиск в focus** — `GET /api/properties/focus?search=...` → SQL LIKE по title/address (debounce 300ms на фронте)
- **CIAN deep-link** — commercial параметры: `offer_type=commercial`, `object_type[0]=1&[1]=2&[2]=5` (офис/торговля/склад)
- Cron: pipeline:daily запускает парсинг ВСЕХ источников в digest_time. Per-source crons удалены (v1.1.59)
- **Strapi 5 sort** — поле `createdAt` (camelCase), НЕ `created_at`. Если
  sort вернёт пустой массив — проверить имя поля.
- Seeder **идемпотентен** — при добавлении новых полей в Source нужно
  обновлять существующие записи через API (PUT /api/sources/:docId).
- Документация: `docs/adding-source.md` — инструкция добавления нового источника
- CORS в `api/config/middlewares.ts` уже включает
  `https://aklab.tirobots.ru` и `http://localhost:5174`
- **safeEval** — recursive-descent expression parser (НЕ `new Function()`). Поддерживает `+−*/%`, сравнения, `&&||`, скобки. Whitelist переменных.
- **scorePropertiesBatch** — параметризованные запросы через `db.query().update()` (НЕ raw SQL).
- **ecosystem.config.js** — генерирует PM2 конфиг из `services/services.json` (единый манифест).
- **deploy-prod.sh** — читает списки сервисов из `services/services.json` (6 мест хардкода → 1 источник).
- **.nvmrc** — Node 22, `engines.node` в package.json.
- **Auto-deploy на prod отключён** — только `workflow_dispatch` (ручной запуск).
- **DocumentationView** — контент вынесен в `app/public/docs/architecture.md`, рендер через marked (850→~120 строк Vue).
- **health-check.js** — проверяет все 15 сервисов из services.json (было 2).


## Strapi 5 — gotchas

**Вынесено в отдельный файл:** см. [docs/gotchas.md](gotchas.md)
(78 пронумерованных пунктов, стабильный reference)

## Session handoff

**Вынесено в отдельный файл:** см. [docs/sessions.md](sessions.md)
(хронология изменений по сессиям + инсайты)
