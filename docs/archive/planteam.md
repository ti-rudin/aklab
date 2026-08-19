# AKLAB — Комплексный план доработки

> **Источник:** Аудит кодовой базы 2026-07-01 (3 исследователя: backend, frontend, deploy/CI)
> **Всего findings:** 97 — 7 CRITICAL, 24 HIGH, 40 MEDIUM, 26 LOW
> **Обновлено:** 2026-07-01 — после полного цикла фиксов и успешного деплоя

---

## Обзор

| Область | CRITICAL | HIGH | MEDIUM | LOW |
|---------|----------|------|--------|-----|
| Backend (Strapi 5) | 2 | 8 | 14 | 12 |
| Frontend (Vue 3) | 1 | 9 | 15 | 7 |
| Deploy / CI/CD | 4 | 7 | 11 | 7 |
| **Итого** | **7** | **24** | **40** | **26** |

## Статус выполнения

| Phase | Статус | Детали |
|-------|--------|--------|
| Phase 0 (CRITICAL) | ✅ DONE | safeEval, cron auth, secrets cleanup, pipefail, ecosystem, Traefik |
| Phase 1 (HIGH + Deploy) | ✅ DONE | CSS vars, documentId, lockfile, Node pin, memory, backoff |
| Phase 2 (Architecture) | ✅ DONE | formatters.ts, composables, scoring dedup, startup validation |
| Phase 3 (Performance) | ✅ DONE | batch DB ops, composite index, MR cache |
| Phase 4 (Testing) | ✅ DONE | QueueService (10), cron registration (7) = 234 tests total |
| Phase 5 (Infra) | ✅ DONE | check-env, rollback rebuild, Telegram safety, engines |
| Phase 6 (Hygiene) | ✅ DONE | OG tags, a11y, legacy CSS, health check port, pm2-logrotate |
| **Deploy fixes** | ✅ DONE | 4 deploy-pipeline bugs found and fixed |
| **TypeScript 6.0 migration** | ✅ DONE | TS 6.0.3 across all projects |

---

## Deploy Pipeline — Баги найденные и исправленные

Deploy-скрипт (`scripts/deploy-prod.sh`) был протестирован впервые с `set -euo pipefail`.
Выявлено и исправлено **4 бага**:

| # | Баг | Фикс | Commit |
|---|-----|------|--------|
| 1 | `set -e` без `pipefail` — pipe failures молча проглатывались | `set -euo pipefail` | `069590f` |
| 2 | `npm install` только в root — app/ и api/ не в workspaces | Добавлен `npm install` в api/ и app/ | `a07796b` |
| 3 | Rollback через `git checkout -- .` — файлы не откатывались | `git reset --hard` | `90f60c9` |
| 4 | TS 6.0 + `moduleResolution: "node10"` — ошибка вместо warning | `ignoreDeprecations: "6.0"` в _shared/analyzer tsconfig | `a3b489b` |

---

## TypeScript 6.0 Migration

Обновлено с TS 5.9.3 → 6.0.3 во всех проектах:
- Root: `typescript: 6.0.3`
- `api/`: `typescript: 6.0.3`
- `app/`: `typescript: 6.0.3`, `vite: 8.1.2`, `vue-tsc: 3.3.6`
- `_shared/`, `analyzer/`: добавлен `ignoreDeprecations: "6.0"` в tsconfig.json
- Остальные сервисы: TS < 6.0, `ignoreDeprecations` НЕ нужен (вызывает ошибку)
- 15 tsconfig.json файлов модифицировано

---

## Commits (dev branch)

~25+ коммитов, основные PR:
- PR #13 — Phase 0–2 (первая волна фиксов)
- PR #14 — Phase 3–6 + deploy stability
- PR #15 — TS 6.0 migration + deploy pipeline fixes

**Текущая версия на проде:** v1.0.52

---

## Phase 0: Безопасность (CRITICAL — делать немедленно)

### 0.1 ~~Ротация всех exposed credentials~~ SKIPPED
Пользователь решил не ротировать.

### 0.2 ✅ Заменить `new Function()` на безопасный evaluator
**Status:** DONE — `jexl` установлен, safe evaluator с whitelist

### 0.3 ✅ Добавить auth на cron endpoints
**Status:** DONE — `config: { auth: {} }` на всех POST endpoints

### 0.4 ✅ Заменить hardcoded fallback secrets
**Status:** DONE — startup validation добавлена

### 0.5 ✅ `set -o pipefail` в deploy-prod.sh
**Status:** DONE — `set -euo pipefail`

### 0.6 ✅ Перестать прокидывать `...process.env` в PM2
**Status:** DONE — явные env vars в ecosystem.config.js

### 0.7 ✅ Зафиксировать Traefik/Docker в репозитории
**Status:** DONE — `infra/traefik/` с redacted secrets

---

## Phase 1: Безопасность (HIGH) + Deploy Stability

### 1.1 ✅ Auth на `clear-new` endpoint
### 1.2 JWT: migration на httpOnly cookies — DEFERRED (requires full auth rewrite)
### 1.3 ✅ package-lock.json в git
### 1.4 ✅ Pin Node version
### 1.5 ✅ Hash-проверка workspace-пакетов
### 1.6 ✅ max_memory_restart в PM2
### 1.7 ✅ Rollback: queue.db backup
### 1.8 ✅ Убрать hardcoded test credentials
### 1.9 ✅ CI: version bump для всех package.json
### 1.10 ✅ Fix Strapi 5 `documentId` usage
### 1.11 ✅ Fix undefined CSS variables
### 1.12 ✅ Добавить недостающие CSS переменные
### 1.13 alert()/confirm() → `console.warn()` (partial — full UI toast DEFERRED)

---

## Phase 2–6: см. git log

Все пункты Phase 2–6 выполнены и закоммичены. Подробности в `git log dev --oneline`.

---

## Remaining / DEFERRED

| Item | Причина |
|------|---------|
| JWT → httpOnly cookies | Требует полного rewrite auth flow |
| alert() → Toast UI | Заменено на console.warn, полный UI — отдельная задача |
| PropertyListView split | Composables извлечены, main component пока 1462 строки |
| Parser HTML fixtures | Не критично, парсеры работают |
| Автобэкапы БД | Ручной backup в deploy, автоматизация — потом |
| Code-split DocumentationView | Не критично |

---

## Инфраструктура

| Сервер | IP | Назначение |
|--------|-----|-----------|
| Prod | 213.184.136.221:5733 | Production AKLAB |
| Dev | 192.168.11.151 | Development |

**PM2 на проде:** 16 процессов (api, app, 4 парсера, analyzer, digester, _shared watcher, scheduler, 6 превью-сервисов)

**Deploy workflow:** push to `main` → `.github/workflows/deploy-prod.yml` → SSH → `deploy-prod.sh`

**Тесты:** 234 passing (vitest)
