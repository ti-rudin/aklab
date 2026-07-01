# AKLAB — Комплексный план доработки

> **Источник:** Аудит кодовой базы 2026-07-01 (3 исследователя: backend, frontend, deploy/CI)
> **Всего findings:** 97 — 7 CRITICAL, 24 HIGH, 40 MEDIUM, 26 LOW

---

## Обзор

| Область | CRITICAL | HIGH | MEDIUM | LOW |
|---------|----------|------|--------|-----|
| Backend (Strapi 5) | 2 | 8 | 14 | 12 |
| Frontend (Vue 3) | 1 | 9 | 15 | 7 |
| Deploy / CI/CD | 4 | 7 | 11 | 7 |
| **Итого** | **7** | **24** | **40** | **26** |

---

## Phase 0: Безопасность (CRITICAL — делать немедленно)

### 0.1 Ротация всех exposed credentials
**Severity:** CRITICAL (D6.1) | **Файлы:** `.env`, `.env.bak`, git history
**Проблема:** Реальные секреты (APP_KEYS, STRAPI_ADMIN_PASSWORD, STRAPI_API_TOKEN, EMAIL_SMTP_PASS, TEST_USER_PASSWORD) были закоммичены в git history. Удаление файла не удаляет из history.

**Действия:**
1. Сгенерировать новые APP_KEYS, JWT_SECRET, API_TOKEN_SALT, ADMIN_JWT_SECRET
2. Сменить пароль Strapi admin
3. Ротировать STRAPI_API_TOKEN (создать новый в admin panel, обновить во всех .env)
4. Сменить EMAIL_SMTP_PASS
5. Сменить TEST_USER_PASSWORD
6. Обновить .env на prod (213) и dev (151)
7. Перезапустить все PM2-процессы на обоих серверах

**Питфалл:** После ротации API-токена — все парсеры и микросервисы перестанут работать, пока не обновят токен. Обновить .env на ВСЕХ серверах ОДНОВРЕМЕННО.

### 0.2 Заменить `new Function()` на безопасный evaluator
**Severity:** CRITICAL (S1) | **Файл:** `api/src/services/focusEngine.ts:87`
**Проблема:** Custom focus rules используют `new Function(...fields, \`return (${rule.condition_value})\`)` — arbitrary code execution через БД.

**Действия:**
1. Установить `jexl` или `mathjs` как expression evaluator
2. Заменить `new Function()` на safe evaluator с whitelist операций
3. Добавить валидацию `condition_value` при сохранении focus-rule (запретить `;`, `require`, `import`, `process`)
4. Покрыть тестами: валидные выражения, injection attempts, edge cases

### 0.3 Добавить auth на cron endpoints
**Severity:** CRITICAL (S2) | **Файл:** `api/src/api/cron/routes/cron.ts`
**Проблема:** Все `/api/cron/*` endpoints имеют `auth: false` — анонимный пользователь может триггерить парсинг, анализ, дайджест и смотреть статус очередей.

**Действия:**
1. Заменить `config: { auth: false }` на `config: { auth: {} }` (Users-Permissions policy)
2. Или создать custom policy `is-api-token` который проверяет `Authorization: Bearer <STRAPI_API_TOKEN>`
3. Оставить `GET /api/cron/queue-stats` public (или authenticated) — нужен для frontend polling

### 0.4 Заменить hardcoded fallback secrets
**Severity:** CRITICAL (S4) | **Файл:** `api/config/admin.ts`
**Проблема:** `ADMIN_JWT_SECRET` дефолтит на `'default-admin-jwt-secret'`, `API_TOKEN_SALT` на `'default-api-token-salt'`.

**Действия:**
1. Убрать defaults — `env('ADMIN_JWT_SECRET')` без fallback (Strapi упадёт при старте если нет)
2. Добавить startup validation в bootstrap: проверить что все критичные env vars заданы

### 0.5 `set -o pipefail` в deploy-prod.sh
**Severity:** CRITICAL (D1.1) | **Файл:** `scripts/deploy-prod.sh:6`
**Проблема:** `set -e` без `set -o pipefail` — pipe failures молча проглатываются.

**Действия:**
```bash
# Было
set -e
# Стало
set -euo pipefail
```

### 0.6 Перестать прокидывать `...process.env` в PM2
**Severity:** CRITICAL (D2.1) | **Файл:** `ecosystem.config.js`
**Проблема:** `...process.env` прокидывает ВСЕ переменные окружения сервера в каждый PM2 процесс.

**Действия:**
1. Для каждого сервиса явно перечислить только нужные переменные
2. Базовый набор: `NODE_ENV`, `STRAPI_API_TOKEN`, `DATABASE_*`
3. Сервис-specific: `EMAIL_SMTP_*` только для digest, `PORT` для каждого уникальный

### 0.7 Зафиксировать Traefik/Docker в репозитории
**Severity:** CRITICAL (D5.1) | **Проблема:** Traefik config живёт только на сервере, нет version control.

**Действия:**
1. Скопировать `/etc/traefik/` и `/opt/traefik/docker-compose.yml` в `infra/` директорию
2. Добавить README с инструкцией по развёртыванию
3. Игнорировать секреты (TLS certs, passwords) — использовать env vars

---

## Phase 1: Безопасность (HIGH) + Deploy Stability

### 1.1 Auth на `clear-new` endpoint
**Severity:** HIGH (S3) | **Файл:** `api/src/api/property/routes/property.ts`
**Действия:** Добавить `config: { auth: {} }` (или admin-only policy) на `POST /api/properties/clear-new`

### 1.2 JWT: migration с localStorage на httpOnly cookies
**Severity:** HIGH (FE-S2) | **Файлы:** `app/src/stores/auth.ts`, `app/src/api/strapi.ts`
**Проблема:** JWT в localStorage уязвим к XSS.
**Действия (поэтапно):**
1. Backend: добавить endpoint `POST /api/auth/cookie-login` который ставит httpOnly cookie
2. Frontend: заменить `localStorage.getItem('jwt')` на cookie-based auth flow
3. Убрать `window.location.href` redirect при 401 → `router.push('/auth')`
4. Добавить CSRF protection

### 1.3 package-lock.json в git
**Severity:** HIGH (D5.2) | **Файл:** `.gitignore`
**Действия:** Убрать `package-lock.json` из `.gitignore`, закоммитить lockfile

### 1.4 Pin Node version
**Severity:** HIGH (D2.2, D3.3) | **Файлы:** `ecosystem.config.js`, `.github/workflows/*.yml`
**Действия:**
1. Вынести `NODE_VERSION=22.20.0` в переменную в ecosystem.config.js
2. CI: `node-version: '22'` вместо `'20'`
3. Добавить `"engines": {"node": ">=22.0.0"}` в все package.json

### 1.5 Hash-проверка workspace-пакетов в deploy-prod.sh
**Severity:** HIGH (D1.3) | **Файл:** `scripts/deploy-prod.sh:126-154`
**Действия:** Проверять hash всех `**/package-lock.json` или добавить проверку `! -d "services/_shared/node_modules"`

### 1.6 max_memory_restart в PM2
**Severity:** HIGH (D2.3) | **Файл:** `ecosystem.config.js`
**Действия:** Добавить `max_memory_restart: '512M'` для всех app definitions

### 1.7 Rollback: добавить queue.db backup
**Severity:** HIGH (D1.4) | **Файл:** `scripts/deploy-prod.sh`
**Действия:** В backup-section добавить `cp services/analyzer/queue.db "$BACKUP_DIR/queue.db.bak"`

### 1.8 Убрать hardcoded test credentials
**Severity:** HIGH (D4.1) | **Файл:** `scripts/smoke-test.js`
**Действия:** Убрать fallback `test@aklab.ti-soft.ru` / `test123456`, использовать только `process.env.*`

### 1.9 CI: version bump для всех package.json
**Severity:** HIGH (D3.2) | **Файл:** `.github/workflows/deploy-prod.yml:91-98`
**Действия:** `git add package.json api/package.json app/package.json app/public/changelog.json`

### 1.10 Fix Strapi 5 `documentId` usage
**Severity:** HIGH (G1, G2) | **Файлы:** `source/controllers/source.ts`, `cron/index.ts`
**Действия:**
1. `source.controller.findOne(id)` → `findOne({ where: { documentId: id } })` или фильтр
2. `cron/index.ts` cleanup: `entityService.delete(…, prop.id)` → `prop.documentId`

### 1.11 Fix undefined CSS variables (SourceListView)
**Severity:** CRITICAL→HIGH (FE-T1) | **Файл:** `app/src/views/SourceListView.vue`
**Действия:** Заменить `--bg`→`--bg-main`, `--text`→`--text-main`, `--card-bg`→`--bg-elevated` (9 мест)

### 1.12 Добавить недостающие CSS переменные
**Severity:** HIGH (FE-T2) | **Файл:** `app/src/assets/tailwind.css`
**Действия:** Добавить в `:root`:
```css
--text-primary: var(--text-main);
--text-secondary: var(--text-muted);
--error-bg: #fee;
--success-bg: #efe;
--bg-input: var(--bg-elevated);
```

### 1.13 Заменить alert()/confirm() на in-app UI
**Severity:** HIGH (FE-Q1) | **Файлы:** `PropertyListView.vue`, `PropertyDetailView.vue`, `MarketReferencesView.vue`
**Действия:** Создать `useToast()` composable + `<ToastNotification>` component. Заменить 6 мест.

---

## Phase 2: Архитектура + Качество (HIGH)

### 2.1 Дедупликация scoring logic
**Severity:** HIGH (A1, Q1, P1, P2) | **Файлы:** `focusEngine.ts`, `cron/controllers/cron.ts`
**Действия:**
1. Вынести `scorePropertiesBatch(filters?)` в `focusEngine.ts`
2. Оба вызова делегировать в shared функцию
3. Использовать batch DB operations (`updateMany`, `createMany`) вместо N+1

### 2.2 Разделить PropertyListView.vue (1462 строки)
**Severity:** HIGH (FE-A1, FE-P1) | **Файл:** `app/src/views/PropertyListView.vue`
**Действия:**
1. Выделить composables: `usePropertyFilters`, `useFocusTab`, `usePipeline`, `useCSVExport`
2. Выделить sub-components: `<PropertyAllTab>`, `<PropertyFocusTab>`
3. Итого: ~5 файлов вместо 1 монолита

### 2.3 Вынести хелперы в utils/formatters.ts
**Severity:** HIGH (FE-A2) | **Файлы:** `PropertyListView.vue`, `PropertyDetailView.vue`, `DashboardView.vue`
**Действия:** Создать `app/src/utils/formatters.ts` с `cityLabel()`, `typeLabel()`, `statusLabel()`, `statusStyle()`, `formatPrice()`

### 2.4 Убрать `(strapi as any)` casts
**Severity:** HIGH (Q2) | **Файлы:** ~20 мест по api/src/
**Действия:**
1. Определить `StrapiInstance` type (уже есть prototype в seeders)
2. Вынести в `_shared/types/strapi.ts`
3. Заменить все `(strapi as any)` на typed reference

### 2.5 Добавить error handling (swallowed catch blocks)
**Severity:** HIGH (FE-Q2, FE-H1) | **Файлы:** DashboardView, PropertyListView, PropertyDetailView
**Действия:**
1. Добавить `console.warn('[component]', error)` в dev-режиме
2. Показать non-intrusive error indicator в UI (маленький badge/alert)
3. Добавить retry button для загрузки данных

### 2.6 createCoreRouter → manual routes (4 модуля)
**Severity:** MEDIUM→preventive (G4) | **Файлы:** `focus-rule/`, `user-comment/`, `market-reference/`, `cron-log/`
**Действия:** Перевести на явные route definitions (как в `property/routes/property.ts`)

---

## Phase 3: Производительность (MEDIUM)

### 3.1 Batch DB operations в focusEngine
**Severity:** HIGH (P1) | **Файл:** `api/src/services/focusEngine.ts`
**Действия:** Заменить N× `db.query.update()` на batch. Заменить N× `entityService.create()` (events) на batch insert.

### 3.2 Добавить composite index
**Severity:** MEDIUM (P4) | **Файл:** `api/src/api/property/content-types/property/schema.json`
**Действия:** Добавить индекс `(focus_score, city, property_type)` для getFocus запросов

### 3.3 Добавить index на created_at
**Severity:** MEDIUM (P5) | **Файл:** `api/src/api/property/content-types/property/schema.json`
**Действия:** Добавить индекс `(created_at)` для cleanup cron

### 3.4 Кэшировать MarketReference в analyzer
**Severity:** MEDIUM (P6) | **Файл:** `services/analyzer/src/handler.ts`
**Действия:** In-memory Map<`city+type`, MarketReference> с per-batch invalidation

### 3.5 Batch deletion в cleanup cron
**Severity:** MEDIUM (Q4, P3) | **Файл:** `api/src/cron/index.ts`
**Действия:** Заменить `entityService.delete()` в loop на `db.query().deleteMany()`. Добавить max-iterations guard.

### 3.6 Code-split DocumentationView
**Severity:** MEDIUM (FE-P3) | **Файл:** `app/src/views/DocumentationView.vue`
**Действия:** Dynamic import или вынести контент в `/public/docs.md`

---

## Phase 4: Тестирование (MEDIUM)

### 4.1 Тесты для QueueService
**Severity:** HIGH (T1) | **Файл:** `api/src/services/queueService.ts`
**Действия:** Mock SqliteQueue, протестировать addToQueue, getDetailedStats, addAndWait, close

### 4.2 Тесты для seeders
**Severity:** HIGH (T2) | **Файл:** `api/src/seeders/index.ts`
**Действия:** Интеграционные тесты с in-memory SQLite

### 4.3 Parser HTML fixtures
**Severity:** MEDIUM (T4) | **Файлы:** `services/parser-*/src/sources/*.ts`
**Действия:** Сохранить sample HTML для каждого парсера. Тестировать extraction logic без Playwright.

### 4.4 Тесты для cron scheduler
**Severity:** MEDIUM (T3) | **Файл:** `api/src/cron/index.ts`
**Действия:** Mock `node-cron`, протестировать registration logic

---

## Phase 5: Инфраструктурные улучшения (MEDIUM)

### 5.1 Автоматические бэкапы БД
**Severity:** MEDIUM (D5.3)
**Действия:** Cron-скрипт: `cp data.db data.db.bak.$(date +%Y%m%d)` + ротация 30 дней + копирование на внешнее хранилище

### 5.2 Rollback: пересборка на ROLLBACK_SHA
**Severity:** MEDIUM (D1.6) | **Файл:** `scripts/deploy-prod.sh`
**Действия:** В rollback-блоке добавить `npm run build` после `git checkout`

### 5.3 check-env.js: расширить список
**Severity:** MEDIUM (D1.7, D4.5) | **Файл:** `scripts/check-env.js`
**Действия:** Добавить проверку: `STRAPI_API_TOKEN`, `EMAIL_SMTP_*`, `DATABASE_*`

### 5.4 Telegram нотификация: убрать token из URL
**Severity:** MEDIUM (D6.4) | **Файл:** `scripts/deploy-prod.sh`
**Действия:** Использовать `curl -H "Authorization: Bearer $TOKEN"` вместо встраивания в URL

### 5.5 exp_backoff_restart_delay в PM2
**Severity:** MEDIUM (D2.4) | **Файл:** `ecosystem.config.js`
**Действия:** Добавить `exp_backoff_restart_delay: 100` для всех app definitions

### 5.6 Нотификация: quoting fix
**Severity:** MEDIUM (D4.2) | **Файл:** `scripts/notify-deploy.sh`
**Действия:** Передавать SMTP_PASS через environment, не bash interpolation

---

## Phase 6: Код-гигиена (LOW)

### 6.1 Удалить dead code
- `_shared/src/photo-downloader.ts` — неиспользуемый модуль (A2, Q6)
- `_shared/src/strapi-client.ts` — `fetchUndervaluedProperties` не используется (A3)
- `api/src/api/cron/services/cron.ts` — пустой stub (A4)

### 6.2 Удалить legacy CSS
- `app/src/assets/main.css` и `base.css` — legacy Vite scaffolding, ломают Tailwind (FE-TC1)

### 6.3 Добавить OG мета-теги
- `app/index.html` — добавить `og:title`, `og:description`, `og:image`

### 6.4 Добавить `"engines"` в package.json
- Все package.json: `"engines": {"node": ">=22.0.0"}`

### 6.5 Health check: параметризовать порт
- `scripts/health-check.js` — принимать порт из args/env

### 6.6 PM2 log rotation
- Установить `pm2-logrotate`, настроить ротацию

### 6.7 Accessibility improvements
- Skip-to-content link в App.vue
- `aria-live` regions для dynamic content
- Keyboard navigation в lightbox

---

## Приоритеты выполнения

| Волна | Phase | Effort | Impact |
|-------|-------|--------|--------|
| 🔴 Немедленно | Phase 0 (всё) | 2-3 дня | Закрывает 7 CRITICAL |
| 🟠 Неделя 1 | Phase 1 (1.1–1.13) | 3-5 дней | Закрывает 13 HIGH |
| 🟠 Неделя 2 | Phase 2 (2.1–2.6) | 3-4 дня | Архитектура + качество |
| 🟡 Неделя 3 | Phase 3 + 4 | 3-4 дня | Производительность + тесты |
| 🟡 Неделя 4 | Phase 5 + 6 | 2-3 дня | Инфра + гигиена |

**Общая оценка:** 15-20 дней работы.

---

## Файлы с наибольшим числом findings

| Файл | Findings | Категория |
|------|----------|-----------|
| `scripts/deploy-prod.sh` | 8 | Deploy |
| `ecosystem.config.js` | 6 | Deploy |
| `api/src/services/focusEngine.ts` | 5 | Backend |
| `app/src/views/PropertyListView.vue` | 5 | Frontend |
| `.github/workflows/deploy-prod.yml` | 4 | CI/CD |
| `api/src/cron/index.ts` | 4 | Backend |
| `app/src/views/SourceListView.vue` | 3 | Frontend |
| `api/src/api/cron/routes/cron.ts` | 3 | Backend |
| `api/config/admin.ts` | 2 | Backend |
| `scripts/smoke-test.js` | 2 | Deploy |
