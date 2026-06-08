# AKLAB — локальная разработка

Этот документ описывает полный цикл локальной работы: от клона до запуска
приложения в браузере. Деплой на прод (192.168.11.151) делается
**только вручную** командой `bash scripts/deploy-prod.sh` на сервере.

## Предусловия

- macOS или Linux
- Node.js v22 (используется на проде; рекомендую `nvm` или `fnm`)
- PM2 глобально: `npm i -g pm2`
- SQLite (`sqlite3` CLI — опционально, для отладки)
- SSH-ключ для GitHub (аккаунт `ti-rudin`)

## 1. Клонирование

```bash
git clone https://github.com/ti-rudin/aklab.git ~/github.nosync/aklab
cd ~/github.nosync/aklab
```

## 2. Установка зависимостей

В проекте три `package.json`: корневой, в `api/` (Strapi) и в `app/` (Vue+Vite).

```bash
# Корень — для скриптов (deploy, health-check)
npm install

# Strapi backend
cd api && npm install --include=dev && cd ..

# Vue frontend
cd app && npm install --include=dev && cd ..
```

> **Важно:** в репо НЕТ коммитов `api/package-lock.json` и
> `app/package-lock.json` (см. `.gitignore` строка `package-lock.json`).
> Это сделано чтобы не путать lock-файлы между окружениями.

## 3. Настройка .env

Скопируйте шаблон и отредактируйте:

```bash
cp .env.local.example .env
$EDITOR .env
```

Минимально нужно заполнить:

- `APP_KEYS` — для локальной разработки подойдут `dev_key_1,dev_key_2,...`
- `API_TOKEN_SALT`, `ADMIN_JWT_SECRET`, `JWT_SECRET`, `TRANSFER_TOKEN_SALT`,
  `ENCRYPTION_KEY`, `ADMIN_AUTH_SECRET` — любые непустые строки
- `STRAPI_ADMIN_EMAIL` / `STRAPI_ADMIN_PASSWORD` — будут созданы при первом
  старте Strapi
- `TEST_USER_EMAIL` / `TEST_USER_PASSWORD` — test user для локальной разработки

`.env` уже в `.gitignore`, **не коммитьте его**.

## 4. Запуск через PM2

В репо есть готовый `ecosystem-local.config.js` — он поднимает оба
процесса (`aklab-api` на 1338 и `aklab-app` на 5174) в dev-режиме.

```bash
# Старт
pm2 start ecosystem-local.config.js

# Логи (оба процесса)
pm2 logs

# Логи только api
pm2 logs aklab-api

# Статус
pm2 list

# Стоп
pm2 stop ecosystem-local.config.js

# Полное удаление из PM2
pm2 delete ecosystem-local.config.js
```

После старта:
- `http://localhost:5174` — фронт (Vite dev-сервер с HMR)
- `http://localhost:1338/admin` — Strapi Admin (логин/пароль из `STRAPI_ADMIN_*`)
- `http://localhost:1338/_health` — health-check (должен вернуть 204)

В dev-режиме Vite проксирует `/api/*` на `http://localhost:1338` — фронт
может ходить по относительному `/api/users/me` без CORS-проблем.

## 5. Git workflow

Прямой push в `main` — **запрещён** (правило такое же, как в CLAUDE.md
для tirobots). Используем feature-ветки.

```bash
# Новая фича
git checkout -b feat/<короткое-имя>
# ... правки ...
git add -A
git commit -m "feat: <что сделано>"
git push -u origin feat/<короткое-имя>
```

Дальше: PR в `main` на GitHub → merge. После merge — см. раздел «Деплой».

## 6. Деплой на прод (только по команде пользователя)

Деплой **никогда** не запускается автоматически. Только вручную.

```bash
# На 192.168.11.151
ssh rudin@192.168.11.151
cd ~/aklab
bash scripts/deploy-prod.sh
```

Скрипт делает:
1. `git pull origin main`
2. Pre-flight checks (env-переменные, диск)
3. Бэкап SQLite (`api/.tmp/data.db.bak`)
4. `npm install` (только если изменился `package-lock.json`)
5. `npm run build` для api и app
6. `pm2 restart aklab-api aklab-app`
7. Health-check (ждёт `_health` 30 сек)
8. Release-коммит + push в `main`
9. Telegram-уведомление (если `TELEGRAM_BOT_TOKEN` задан)

В случае ошибки — автоматический rollback к предыдущему коммиту +
восстановление БД из бэкапа.

## 7. Частые проблемы

### Vite блокирует запросы
Сообщение "Blocked request. This host is not allowed" — добавьте домен в
`allowedHosts` в `app/vite.config.ts`.

### CORS ошибки в консоли браузера
Проверьте `api/config/middlewares.ts` — в `origin` массиве должен быть
адрес фронта (`http://localhost:5174` для dev, `https://aklab.tirobots.ru`
для прода).

### Strapi не поднимается
Смотрите `pm2 logs aklab-api` — обычно проблема в env или в том, что
порт 1338 уже занят. Проверьте `lsof -i :1338`.

### npm install падает на M1/M2 Mac
Strapi 5.x требует Node 18+. Используйте `nvm install 22 && nvm use 22`.

## 8. Структура проекта

```
~/github.nosync/aklab/
├── api/                    # Strapi 5 backend
│   ├── config/             # middlewares (CORS), server, plugins
│   ├── src/api/            # content-types (создаются)
│   └── .tmp/data.db        # локальный SQLite (в .gitignore)
├── app/                    # Vue 3 + Vite frontend
│   ├── src/                # components, views, router
│   └── vite.config.ts      # dev-proxy, allowedHosts
├── scripts/
│   ├── deploy-prod.sh      # production deploy
│   ├── health-check.js     # проверка состояния сервисов
│   └── check-env.js        # валидация env перед деплоем
├── ecosystem.config.js         # PM2 для прода (build + preview)
├── ecosystem-local.config.js   # PM2 для локального dev
├── .env.local.example          # шаблон локального .env
└── docs/
    ├── plan1.md
    └── setup-local.md          # ← этот файл
```
