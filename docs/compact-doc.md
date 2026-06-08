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

### Архитектура (донор tirobots)

- **Очередь задач** — `@aklab/sqlite-queue` (пакет в `lib/sqlite-queue/`,
  копия `@tirobots/sqlite-queue`). Один файл `queue.db` (WAL), polling 200ms,
  stale recovery, retention. Singleton в `api/src/services/queueService.ts`.
- **Cron-планировщик** — `node-cron` в `api/src/cron/index.ts` (timezone
  Europe/Moscow). `registerCrons(strapi)` вызывается из `bootstrap()`.
- **Микросервисы** — `services/<name>/` (npm workspaces), каждый под
  отдельным процессом PM2, слушает свою очередь. На Фазе 0 — пусто,
  наполнится в Фазах 4-7.
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
app 3s) → PM2 restart → health check 190s → release-коммит → push origin.
Дай foreground-таймаут минимум 300s.

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

- Версия: 1.0.3 (после Фазы 0, до push Фазы 1)
- **Фаза 0 завершена** (8 июня 2026): `@aklab/sqlite-queue` в `lib/`,
  workspaces, `queueService.ts` singleton, `cron/index.ts` stub,
  слоты в PM2 под будущие сервисы. ✅ коммит `f913ea0`, push в origin main.
- **Фаза 1 завершена** (8 июня 2026): 5 content-types созданы, 5
  routes-файлов (`factories.createCoreRouter`), dist пересобран,
  register+bootstrap работают, таблицы в БД созданы, Setting засеян,
  public permissions добавлены (25 actions), endpoints возвращают 200. ✅
  Коммит `1803f60` + `(pending)` для routes.
- Содержимое:
  - **api/src/api/** — 5 content-types (Property, Setting singleton,
    MarketReference, UserComment, CronLog) + controllers + services +
    **routes** (фабрики `createCoreRouter(uid)` для каждого)
  - **api/src/services/queueService.ts** — singleton-обёртка
  - **api/src/cron/index.ts** — stub `registerCrons()`
  - **api/src/seeders/index.ts** — `seedSettings()` + `seedPublicPermissions()`
    + admin seed (через .env: `STRAPI_ADMIN_EMAIL`/`STRAPI_ADMIN_PASSWORD`)
  - **api/src/index.ts** — register (`QueueService.init`) + bootstrap
    (`registerCrons` + `runSeeders`)
  - **lib/sqlite-queue/** — `@aklab/sqlite-queue` v0.1.0
  - **services/** — пустая папка (заготовка под Фазы 4-7)
- В .env на проде: `STRAPI_ADMIN_EMAIL=admin@aklab.ti-soft.ru`,
  `STRAPI_ADMIN_PASSWORD=…` (см. .env), `TEST_USER_EMAIL=test@aklab.ti-soft.ru`
- В БД на проде admin `ax.rudin@gmail.com` (создан Strapi через /admin
  first-run форму, не из env). После деплоя с seed'ами должен появиться
  ВТОРОЙ admin с email из .env
- Vite proxy: `/api/*` → `http://localhost:1338` (только в dev-режиме)
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

## Session handoff (Фаза 1 → следующая сессия)

**Сделано в Фазе 1** (8 июня 2026):
- ✅ 5 content-types + controllers + services
- ✅ 5 routes-файлов через `factories.createCoreRouter(uid)`
- ✅ `api/config/plugins.ts` — `jwtSecret: env('JWT_SECRET')` (фикс,
  иначе users-permissions bootstrap падал)
- ✅ dist пересобран, register+bootstrap работают
- ✅ 5 таблиц в `api/.tmp/data.db` созданы
- ✅ 25 public permissions (find/findOne/create/update/delete × 5)
- ✅ Все endpoints возвращают HTTP 200 (для пустых коллекций `data: []`,
  для singleton `setting` — `data: {...}`)

**Найдено и исправлено по ходу Фазы 1**:
- ❌→✅ Endpoints `/api/*` → 404 (root cause: Strapi 5 НЕ авто-генерирует
  routes; нужен явный `routes/<name>.ts` через `factories.createCoreRouter`)
- ❌→✅ `Missing jwtSecret` при `strapi start` (root cause:
  `api/config/plugins.ts` был пустым с момента merge 151)

**Что НЕ делать**:
- ❌ Не удалять `api/.tmp/data.db` повторно (там уже таблицы и admin).
- ❌ Не запускать миграции Strapi (`strapi migration`) — мы на dev-режиме.
- ❌ Не удалять `api/src/api/<name>/routes/<name>.ts` — без них
  endpoints возвращают 404 (см. "Найдено и исправлено" выше).

**Следующие шаги** (после чекпоинта Фазы 1):
1. Push коммитов Фазы 1 (`1803f60` + `(pending)` для routes) в origin main
2. Задеплоить на 192.168.11.151 через `scripts/deploy-prod.sh`
3. **Фаза 1.5** — UI для MarketReference (Vue-компонент, fetch с /api)
4. **Фаза 2** — Email digest (HTML-шаблоны, расписание через cron)

**Локальное состояние**:
- `~/github.nosync/aklab` — ветка `main`, последний коммит `1803f60`
  (jwtSecret фикс). `routes/<name>.ts` — в pending, плюс обновлён
  `docs/compact-doc.md`.
- Фаза 1 проверена локально: все endpoints /api/* возвращают 200,
  /api/setting отдаёт singleton, /api/properties/1 → 404 (нет записи,
  это правильно).
- pm2: локально крутится `proc_bdb001e47ac3` (Strapi production), на 151
  — `aklab-api` / `aklab-app`.

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

## Полезные команды

```bash
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
- `docs/setup-local.md` — пошаговая установка локально с нуля
- Глобальные правила (CLAUDE.md пользователя) — НЕ дублируются тут, см.
  родительский `~/.claude/CLAUDE.md`
