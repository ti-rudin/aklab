# AKLAB — compact context

Быстрый onboarding для новой сессии. Прочитай этот файл целиком, прежде
чем что-то делать в проекте.

Актуальная версия: `cat package.json | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['version'])"`

---

## Суть проекта

Сервис мониторинга коммерческой недвижимости. Автоматически находит
объекты (офисы, склады, торговые помещения), цена которых на 20%+ ниже
рыночной. Парсит 10 активных источников (Алфалот, Инвест Москва,
Сбербанк-АСТ, М-ЕТС, Агрегатор Банкрот, ЭТПРФ, ГИС Торги, Инвест МО,
Фабрикант, Росэлторг), сравнивает цену с рыночным эталоном (MarketReference)
по паре «город + тип объекта», шлёт утренний дайджест на email.

Полная бизнес-логика — `docs/plan1.md`.

---

## Архитектура

### Компоненты

| Компонент | Технология | Порт |
|-----------|-----------|------|
| Frontend | Vue 3 + Vite | 5174 |
| Backend | Strapi 5 + SQLite | 1338 |
| Reverse proxy prod | Traefik v2.10 (Docker) | 80/443 |
| Reverse proxy dev | Traefik v2.10 (Docker) | 80/443 |

### PM2-процессы (единственный источник правды — `services/services.json`)

На проде (213.184.136.221): **api, app, 10 парсеров, analyzer, digest, photo-fetcher** = 15 процессов.
На dev (192.168.11.151): аналогично + рядом `todoit-api`, `todoit-app` — другой проект, не трогай.

Актуальный список процессов: `node -e "const s=require('./services/services.json'); console.log([...s.core,...s.parsers,...s.workers].map(x=>x.pm2_name).join('\n'))"`

### Порты микросервисов (из services.json)

| Сервис | Порт |
|--------|------|
| api (Strapi) | 1338 |
| app (Vite) | 5174 |
| analyzer | health 1341 |
| digest | health 1342 |
| parser-fabrikant | 1345 |
| parser-torgi-gov | 1346 |
| parser-aggregator-bankrot | 1348 |
| parser-alfalot | 1349 |
| parser-etprf | 1350 |
| parser-sberbank-ast | 1351 |
| parser-invest-mosreg | 1352 |
| parser-investmoscow | 1353 |
| parser-roseltorg | 1354 |
| parser-m-ets | 1355 |
| photo-fetcher | health 1356 |

**Следующий свободный порт: 1357.**

### Домены

**Prod (213.184.136.221):**
- `https://aklab.tirobots.ru` → Traefik (localhost) → :5174
- `https://api-aklab.tirobots.ru` → Traefik (localhost) → :1338

**Dev (192.168.11.151, Traefik на .131):**
- `https://aklab-dev.tirobots.ru` → Traefik (131) → 192.168.11.151:5174
- `https://api-aklab-dev.tirobots.ru` → Traefik (131) → 192.168.11.151:1338

**УДАЛЕНЫ** из CORS и Traefik: `*.aklab.ti-soft.ru`, `*.todoit.ru`. Если всплывут — баг, не лечи.

### Source of truth

- `~/aklab` на **213.184.136.221** — прод-репо, его трогает `git pull` при деплое
  SSH: `ssh -p 5733 root@213.184.136.221` → `su - rudin`
- `~/aklab` на **192.168.11.151** — dev-репо
- `~/github.nosync/aklab` на mac — локальная копия для разработки
- GitHub: `https://github.com/ti-rudin/aklab.git` (авторизация через `gh` CLI от `ti-rudin`)

---

## Структура репо

```
~/github.nosync/aklab/
├── api/                        # Strapi 5 backend
│   ├── config/                 # middlewares (CORS), server, plugins
│   └── src/
│       ├── api/                # 16 content-types:
│       │   │                   # property, setting (singleton), market-reference,
│       │   │                   # user-comment, cron-log, source, parser-run,
│       │   │                   # parser-run-source, user-profile, user-property-state,
│       │   │                   # focus-rule, digest-projection, property-event
│       │   │                   # + cron, pipeline (custom routes)
│       ├── cron/index.ts       # 2 задачи: pipeline:daily + cleanup:expired-auctions
│       ├── services/
│       │   ├── queueService.ts # singleton @aklab/sqlite-queue
│       │   ├── parseRules.ts   # re-export buildParseRules из @aklab/parse-rules
│       │   └── pipeline/       # state.ts, stages.ts, index.ts
│       └── seeders/index.ts    # idempotent seeds: admin, Setting, Source, permissions
├── app/                        # Vue 3 + Vite frontend
│   ├── src/
│   │   ├── views/              # Auth, PropertyListView, PropertyDetailView,
│   │   │                       # SettingsView, ChangelogView, NotFoundView
│   │   ├── components/         # properties/, settings/, Footer, SkeletonLoader
│   │   ├── composables/        # usePropertyData, useFocusTab, useToast,
│   │   │                       # useFocusParams, usePolling, usePropertyFilters
│   │   ├── stores/auth.ts      # Pinia
│   │   └── api/strapi.ts       # axios + JWT interceptor
│   └── vite.config.ts          # dev-proxy /api/* → :1338, allowedHosts
├── lib/
│   ├── sqlite-queue/           # @aklab/sqlite-queue (WAL, polling 200ms)
│   └── parse-rules/            # @aklab/parse-rules — ParseRules + buildParseRules
├── services/
│   ├── services.json           # единый манифест: slug, port, health_port, pm2_name
│   ├── _shared/                # @aklab/service-shared (config, logger, anti-ban, city-detect)
│   ├── parser-*/               # 10 парсеров + parser-fedresurs (отключён)
│   ├── analyzer/               # сравнение Property с MarketReference
│   ├── digest/                 # утренний email через nodemailer
│   └── photo-fetcher/          # скачивание фото
├── scripts/
│   ├── deploy-prod.sh          # production deploy (fail-closed, exact SHA)
│   ├── deploy-dev.sh           # dev deploy (аналог)
│   ├── health-check.js         # проверяет все 15 сервисов из services.json
│   ├── smoke-test.js           # smoke: health, auth, endpoints, data integrity
│   └── check-env.js
├── ecosystem.config.js         # PM2 prod — генерируется из services.json
├── ecosystem-local.config.js   # PM2 dev
├── .env.template               # шаблон .env (cp .env.template .env)
└── docs/
    ├── compact-doc.md          # ← ЭТОТ ФАЙЛ
    ├── sessions.md             # хронология изменений по сессиям
    ├── gotchas.md              # Strapi 5 gotchas (90+ пунктов)
    ├── adding-source.md        # инструкция добавления нового источника
    ├── setup-local.md          # пошаговая установка локально
    ├── plan1.md                # бизнес-логика
    ├── run-scoped-parser-telemetry.md
    ├── multiuser.md
    └── archive/                # выполненные планы (plan2-3, planopus*, etc.)
```

---

## Workflow: разработка → деплой

### Локальная разработка

```bash
cd ~/github.nosync/aklab
pm2 start ecosystem-local.config.js   # api:1338, app:5174 в dev-режиме
pm2 logs
pm2 stop ecosystem-local.config.js
```

### Git workflow

```
feature-ветка → PR → main
```

1. `git checkout -b feat/<имя>` (или `fix/<имя>`) от `main`
2. Правки → `git commit -m "..."`
3. `git push -u origin feat/<имя>`
4. PR в `main` на GitHub → merge

**Прямой push в `main` запрещён.** Branch protection настроена на GitHub.

### Деплой (ТОЛЬКО по команде пользователя, не автоматически)

Release готовится до production — один commit с version, `package-lock.json` и `app/public/changelog.json`.

```bash
# Prod (213.184.136.221); SHA — уже merged release из origin/main
ssh -p 5733 root@213.184.136.221 'su - rudin -c "source ~/.nvm/nvm.sh && cd ~/aklab && bash scripts/deploy-prod.sh --ref <release-sha>"'
```

`deploy-prod.sh` fail-closed: требует ветку `main` и чистый `git status --porcelain`.
Использует только fast-forward. Rollback к предыдущему SHA при ошибке.
Дай foreground-таймаут минимум 300s.

**GitHub Actions:** все три workflow (CI, Deploy-Dev, Deploy-Prod) отключены вручную.
Не удалять Secrets без отдельной команды.

### После успешного деплоя — локально:

```bash
git pull --ff-only origin main
```

---

## Ключевые технические решения

### Очередь задач

`@aklab/sqlite-queue` — файл `queue.db` (WAL), polling 200ms, stale recovery, retention.
Singleton в `api/src/services/queueService.ts`.

### Pipeline Orchestrator

Единый сервис `api/src/services/pipeline/` — оркестрирует парсинг → анализ → дайджест.

- **API:** `POST /api/pipeline/start`, `GET /api/pipeline/status`, `POST /api/pipeline/cancel`, `POST /api/pipeline/reset` — все требуют authenticated AKLAB Admin policy.
- **Статусы:** `idle | running | cancelling`
- **Стадии:** `parsing_scan → parsing_scan_done → parsing_details → parsing_done → analyzing → analyzing_done → digesting → done`
- **Двуфазный парсинг:** Phase 1 (scan) → Phase 2 (details) — Phase 2 начинается только после завершения ВСЕХ Phase 1.
- **Pre-filter:** `preFilterProperty()` фильтрует по city, stop-словам, площади, цене ДО fetchDetails.
- **Idempotency:** один pipeline одновременно, reject если уже `running`.

### Cron

`api/src/cron/index.ts`, timezone Europe/Moscow:
- `pipeline:daily` — проверяет каждый час, запускает в `digest_time` из settings (mode=`full`)
- `cleanup:expired-auctions` — 03:15, удаляет только записи с явным прошедшим `auction_end_at`

### Парсеры (10 активных, 1 отключён)

| Парсер | Метод | Особенности |
|--------|-------|-------------|
| alfalot | Playwright SPA | ecosystem.alfalot.ru |
| investmoscow | fetch + Nuxt SSR | `__NUXT_DATA__` |
| sberbank-ast | Playwright AJAX | XML `input#xmlData` |
| m-ets | Playwright SPA | фильтр `auction_type=bankruptcy` |
| aggregator-bankrot | fetch JSON API | max_memory_restart 1024M |
| etprf | Playwright AJAX | sale.etprf.ru |
| torgi-gov | fetch JSON API | `/new/api/public/lotcards` |
| invest-mosreg | fetch JSON API | цена в млн.руб., площадь в га → конвертация ×1M / ×10000 |
| fabrikant | Playwright SPA | multi-lot expand + lot-scoped fetchDetails; `FABRIKANT_BASE_URL` |
| roseltorg | Playwright SPA | fetchDetails + URL с фильтрами (Москва, коммерческая) |
| ~~fedresurs~~ | — | **ОТКЛЮЧЁН** (Qrator anti-bot) |

### Run-scoped telemetry

`parser_run` идентифицируется immutable `run_id`. `parser_run_source` — `identity_key = runId:sourceSlug:stage`.
Строка создаётся `queued` до enqueue, worker переводит `running` → terminal.
После `waitForJobs()` terminal SQLite Queue является authoritative.
Подробности — `docs/run-scoped-parser-telemetry.md`.

### Фотографии (ГИС Торги)

Chromium не доверяет российской CA-цепочке через `NODE_EXTRA_CA_CERTS` → не открывает карточку Torgi через Playwright.
Использовать lot API `/new/api/public/lotcards/{compoundId}`, валидировать `lotImages` как 24-символьные hex ID,
скачивать с `/new/image-preview/v1/{fileId}?disposition=inline`.
Не добавлять `resize=600x600!`. Node worker: `NODE_EXTRA_CA_CERTS=/usr/local/share/ca-certificates/russian-ca-chain.pem`.

### Ссылки ГИС Торги

Публичная карточка: `/new/public/lots/lot/{noticeNumber}_{lotNumber}`.
Устаревший маршрут `/new/public/lots/reg/lot-card/…` возвращает 200 с SPA 404 → URL-аудит обязан проверять hydrated DOM.

### Deadline parser

Timezone-less даты нормализуются как МСК. ISO с явным `Z`/offset — как исходное UTC.
`torgi-gov`: срок подачи из `biddEndTime`; не подменять датой начала аукциона.

### SQLite boundary rules

- `strapi.db.query().create()` не делает REST JSON transform: `tags` и `photo_urls` нужно сериализовать вручную перед записью, иначе `better-sqlite3` даёт 500.
- Raw focus query отдаёт `first_seen_at` epoch milliseconds, REST путь — ISO. Digest freshness parser обязан поддерживать оба формата.

### Multi-user

Архитектура additive: legacy `Setting`/`Property.status` сохраняются. Private photo-root через `PRIVATE_PHOTO_ROOT`.
Подробности — `docs/multiuser.md`.

### Правила парсинга

Единая функция `buildParseRules(setting)` в `@aklab/parse-rules`.
Параметры из `Setting`: `stop_words`, `price_from/price_to`, `area_from/area_to`, `monitored_regions`, `filter_rent`.
Применяются в `createProperty()` через `_shared/src/strapi-client.ts`.

---

## Безопасность (не нарушать)

- **НИКОГДА** не запускать `npm run dev` (Vite/HMR) на серверах — CVE-2025-30208.
  На серверах только `npm run build && vite preview` (ecosystem.config.js).
- **API security — НЕ single-tenant больше.** Pipeline endpoints требуют JWT + AKLAB Admin policy.
  Новые endpoints создавать с явной policy. Не копировать старый паттерн `auth: false, policies: []` слепо — уточнять по контексту.
- Секреты prod и dev — **ВСЕГДА РАЗНЫЕ**, не дублировать.
- `.env` в `.gitignore`, никогда не логировать и не показывать в чате.
- Публичный email: `tirobots@yandex.ru`. Другие `@tirobots.ru` не существуют.
- `npm audit` — проверять при каждом деплое на critical/high уязвимости.
- `safeEval` — recursive-descent expression parser (не `new Function()`).

---

## Strapi 5 — особенности

**Подробный reference (90+ пунктов):** `docs/gotchas.md`

Критичные, часто встречающиеся:

- `env.array('FOO', [])` — обязателен явный дефолт `[]`, иначе TS2322 при build.
- `strapi build` занимает ~140 сек. Startup после: ~10-20 сек. Итого до `/_health`: ~150-160 сек.
  Health check timeout в deploy-prod.sh: 190s.
- **Routes нужно создавать ВРУЧНУЮ** через `factories.createCoreRouter(uid)`.
  Strapi 5 НЕ авто-генерирует CRUD-routes. Без явного файла роутов — 404.
- `strapi.db.query()` для relations, НЕ `entityService`.
- `createdAt` (camelCase), НЕ `created_at` в sort.
- Seeder идемпотентен — при добавлении новых полей в Source обновлять через PUT.

---

## Git / .gitignore

В `.gitignore`: `.env`, `.env.local`, `.env.*.local`, `package-lock.json`
(и в api/, и в app/), `queue.db*`, `api/src/extensions/documentation/…/full_documentation.json`.

Если что-то случайно закоммитишь: `git rm --cached <file>`.

---

## Тестирование

```bash
npm run test            # vitest (unit)
npm run smoke           # smoke: health, auth, endpoints, 15 сервисов
cd app && npx playwright test --project=chromium   # E2E
```

E2E против production: `BASE_URL=https://aklab.tirobots.ru`.
Пароль из файла `/tmp/.e2e_password` (workaround: terminal маскирует env `***`).

---

## Ссылки на дополнительные доки

| Документ | Содержимое |
|----------|-----------|
| `docs/gotchas.md` | Strapi 5 gotchas (90+ пунктов) |
| `docs/sessions.md` | Хронология изменений по сессиям |
| `docs/adding-source.md` | Добавление нового источника |
| `docs/setup-local.md` | Локальная установка |
| `docs/run-scoped-parser-telemetry.md` | Telemetry контракт |
| `docs/multiuser.md` | Multi-user rollout |
| `docs/archparsers.md` | Архитектура парсеров |
| `docs/plan1.md` | Бизнес-логика |
| `docs/planlot.md` | Fabrikant: сплит многолотовых процедур |
| `docs/plan-lots-audit.md` | Аудит многолотовости остальных парсеров |
| `docs/archive/` | Выполненные планы (plan2-3, planopus*, etc.) |
