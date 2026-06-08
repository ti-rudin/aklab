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
│   │   ├── api/                # content-types (ПУСТО, будут создаваться)
│   │   ├── cron/index.ts       # node-cron регистрация (Фаза 0: stub)
│   │   ├── services/queueService.ts  # singleton @aklab/sqlite-queue
│   │   ├── seeders/index.ts    # bootstrap seeds: admin + test user
│   │   └── index.ts            # bootstrap: seeders + cron + QueueService
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

### Git / .gitignore

В .gitignore: `.env`, `.env.local`, `.env.*.local`, `package-lock.json`
(и в api/, и в app/), `api/src/extensions/documentation/documentation/*/full_documentation.json`
(Strapi регенерит при dev/start). Если что-то из этого случайно
закоммитишь — `git rm --cached <file>`.

### Локальный .env

Не трогать без необходимости. Если менять — только переменные, не
формат/комментарии. Backup перед правкой: `cp .env .env.bak.<date>`.

## Текущее состояние (июнь 2026)

- Версия: 1.0.2 (после первого успешного деплоя)
- **Фаза 0 завершена** (8 июня 2026): `@aklab/sqlite-queue` в `lib/`,
  workspaces, `queueService.ts` singleton, `cron/index.ts` stub,
  слоты в PM2 под будущие сервисы. Content-types ещё не созданы.
- Содержимое:
  - **api/src/api/ — пусто**, content-types не созданы
  - **app/src/ — есть** (минимум: Auth, ZameryView, SettingsView)
  - **api/src/services/queueService.ts** — singleton-обёртка
  - **api/src/cron/index.ts** — stub `registerCrons()`
  - **lib/sqlite-queue/** — `@aklab/sqlite-queue` v0.1.0
  - **services/** — пустая папка (заготовка под Фазы 4-7)
  - В .env на проде задан `STRAPI_ADMIN_EMAIL=admin@aklab.ti-soft.ru`,
    `TEST_USER_EMAIL=test@aklab.ti-soft.ru`
  - В БД на проде admin `ax.rudin@gmail.com` (создан Strapi через /admin
    first-run форму, не из env). После деплоя с seed'ами должен появиться
    ВТОРОЙ admin с email из .env
- Vite proxy: `/api/*` → `http://localhost:1338` (только в dev-режиме)
- CORS в `api/config/middlewares.ts` уже включает
  `https://aklab.tirobots.ru` и `http://localhost:5174`

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
