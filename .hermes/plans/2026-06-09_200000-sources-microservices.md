# Раздел Sources: микросервисы, health, расписание

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Каждый парсер — отдельный микросервис с health-эндпоинтом. На странице /sources — статус здоровья каждого сервиса и управление расписанием (cron). Плюс инструкция по добавлению нового источника.

**Architecture:** Разбиваем монолитный `parser-bankruptcy` на отдельные сервисы по одному на источник. Каждый сервис — копия структуры `parser-bankruptcy` со своим парсером, портом, PM2-процессом. Strapi API проксирует health-checkи. Расписание хранится в Source (cron-выражение, по умолчанию `0 3 * * *`).

**Tech Stack:** TypeScript, Express (health), @aklab/sqlite-queue, node-cron, Playwright, Vue 3, Strapi 5

---

## Что меняется

### Текущее состояние
- Один сервис `services/parser-bankruptcy/` (порт 1340) содержит 3 парсера
- Cron в `api/src/cron/index.ts` запускает ВСЕ активные источники каждый час
- На /sources — статус парсинга (success/error/running), но нет health микросервисов
- Расписание не настраивается (фиксировано "каждый час")

### Целевое состояние
- Каждый парсер = отдельный сервис: `services/parser-fabrikant/`, `services/parser-torgi-gov/`, ...
- Каждый сервис: свой порт, health-эндпоинт, PM2-процесс
- Source schema: поля `schedule` (cron expr) и `health_port`
- Cron в Strapi: вместо фиксированного "каждый час" — читает `schedule` из каждого Source
- /sources: badge здоровья сервиса (online/offline) + поле расписания
- Документ `docs/adding-source.md` — пошаговая инструкция

---

## Phase 1: Подготовка шаблона микросервиса

### Task 1.1: Рефакторинг — вынести общие типы и утилиты в shared

**Objective:** Не дублировать types.ts, logger, strapi-client между сервисами.

**Files:**
- Create: `services/_shared/types.ts` (копия `parser-bankruptcy/src/sources/types.ts`)
- Create: `services/_shared/logger.ts` (универсальный, имя сервиса из env)
- Create: `services/_shared/strapi-client.ts` (универсальный)
- Create: `services/_shared/health-server.ts` (универсальный Express health)
- Create: `services/_shared/queue-worker.ts` (универсальный)
- Create: `services/_shared/index.ts` (реэкспорт)
- Create: `services/_shared/package.json` (`@aklab/service-shared`)

**Step 1:** Создать `services/_shared/package.json`:
```json
{
  "name": "@aklab/service-shared",
  "version": "0.1.0",
  "private": true,
  "main": "dist/index.js",
  "types": "src/index.ts",
  "scripts": {
    "build": "tsc"
  },
  "dependencies": {
    "@aklab/sqlite-queue": "*",
    "better-sqlite3": "12.8.0",
    "express": "^4.21.0",
    "winston": "^3.17.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7",
    "@types/express": "^4",
    "@types/node": "^20",
    "typescript": "^5"
  }
}
```

**Step 2:** Перенести `types.ts`, `logger.ts`, `strapi-client.ts`, `server.ts` (health), `queue-worker.ts` в `services/_shared/src/`, обобщив имя сервиса (из env `SERVICE_NAME`).

**Step 3:** Добавить `_shared` в workspaces в корневом `package.json` (если pattern `services/*` уже ловит — ок).

**Step 4:** Верификация: `cd services/_shared && npx tsc --noEmit`

---

### Task 1.2: Создать `services/parser-fabrikant/` на базе parser-bankruptcy

**Objective:** Первый сервис-донор. Копируем структуру, оставляем только FabrikantParser.

**Files:**
- Create: `services/parser-fabrikant/package.json`
- Create: `services/parser-fabrikant/tsconfig.json`
- Create: `services/parser-fabrikant/src/index.ts`
- Create: `services/parser-fabrikant/src/config.ts` (PORT=1345, SERVICE_NAME=parser-fabrikant)
- Create: `services/parser-fabrikant/src/handler.ts`
- Create: `services/parser-fabrikant/src/sources/fabrikant.ts` (копия из parser-bankruptcy)
- Create: `services/parser-fabrikant/src/sources/types.ts` (реимпорт из shared или локальная копия)

**Step 1:** Скопировать структуру из `parser-bankruptcy`, заменить:
- package.json name → `@aklab/parser-fabrikant-service`
- config.ts PORT → 1345, SERVICE_NAME → `parser-fabrikant`
- queue-worker.ts слушает очередь `parse-fabrikant`
- handler.ts вызывает FabrikantParser напрямую (без маппинга sources/index.ts)
- index.ts — тот же паттерн (health server + queue worker + graceful shutdown)

**Step 2:** `cd services/parser-fabrikant && npx tsc --noEmit` — компиляция без ошибок.

---

### Task 1.3: Создать `services/parser-torgi-gov/`

**Objective:** Второй сервис. Аналогично Task 1.2, но с TorgiGovParser.

**Files:**
- Create: `services/parser-torgi-gov/` (та же структура)
- PORT=1346, SERVICE_NAME=parser-torgi-gov, очередь=`parse-torgi-gov`

**Step 1:** Копия parser-fabrikant, заменить парсер на TorgiGovParser.
**Step 2:** `npx tsc --noEmit`

---

## Phase 2: Strapi backend — расписание и health proxy

### Task 2.1: Расширить Source schema — поля `schedule` и `health_port`

**Objective:** Хранить cron-выражение и порт health-сервиса для каждого источника.

**Files:**
- Modify: `api/src/api/source/content-types/source/schema.json`

Добавить в attributes:
```json
"schedule": {
  "type": "string",
  "maxLength": 50,
  "default": "0 3 * * *",
  "regex": "^[0-9*/,-]+ [0-9*/,-]+ [0-9*/,-]+ [0-9*/,-]+ [0-9*/,-]+$"
},
"health_port": {
  "type": "integer",
  "min": 1024,
  "max": 65535
}
```

**Step 1:** Правка schema.json
**Step 2:** На сервере: `cd ~/aklab && npm run build -w api` — Strapi подхватит новую схему при старте.

---

### Task 2.2: Обновить seeder — заполнить schedule и health_port для существующих источников

**Objective:** Существующие fabrikant и torgi-gov получат правильные порты и расписание.

**Files:**
- Modify: `api/src/seeders/index.ts`

В `seedSources` добавить поля:
- fabrikant: `schedule: '0 3 * * *'`, `health_port: 1345`
- torgi-gov: `schedule: '0 3 * * *'`, `health_port: 1346`
- fedresurs: `schedule: '0 3 * * *'`, `health_port: 1347` (inactive)

---

### Task 2.3: Health proxy endpoint в Strapi

**Objective:** Фронтенд запрашивает `/api/sources/:id/health` → Strapi проксирует на `http://localhost:{health_port}/health`.

**Files:**
- Modify: `api/src/api/source/controllers/source.ts` — добавить custom action `healthCheck`
- Modify: `api/src/api/source/routes/source.ts` — добавить custom route

```typescript
// controllers/source.ts
export default factories.createCoreController('api::source.source', ({ strapi }) => ({
  async healthCheck(ctx) {
    const { id } = ctx.params;
    const source = await strapi.entityService.findOne('api::source.source', id);
    if (!source) return ctx.notFound('Source not found');
    if (!source.health_port) return ctx.badRequest('No health_port configured');

    try {
      const res = await fetch(`http://127.0.0.1:${source.health_port}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      const data = await res.json();
      ctx.body = { data };
    } catch (err: any) {
      ctx.body = { data: { status: 'offline', error: err.message } };
    }
  },
}));
```

```typescript
// routes/source.ts — ДОБАВИТЬ к существующим routes (не заменять createCoreRouter!)
{
  method: 'GET',
  path: '/sources/:id/health',
  handler: 'api::source.source.healthCheck',
  config: { auth: {} },
}
```

**Важно:** Т.к. сейчас routes/source.ts использует `createCoreRouter` (auto-CRUD), нужно переписать на явный массив routes, включив и CRUD-методы, и custom health. Или — создать отдельный custom route файл. В Strapi 5 проще расширить controller через `createCoreController` с custom actions.

**Step 1:** Правка controllers/source.ts
**Step 2:** Правка routes/source.ts
**Step 3:** `npx tsc --noEmit` в api/

---

### Task 2.4: Переписать cron — per-source расписание

**Objective:** Вместо фиксированного "каждый час" — читать `schedule` из каждого Source.

**Files:**
- Modify: `api/src/cron/index.ts`

Новая логика `parse:per-source`:
```typescript
// Каждые 5 минут проверяем: пора ли запускать каждый активный источник?
// Сравниваем текущее время с cron-выражением из Source.schedule.
// Альтернатива: регистрировать отдельный cron job на каждый Source при старте
// и перерегистрировать при изменении расписания.

// Проще: node-cron.schedule(source.schedule, ...) для каждого active source.
// При старте Strapi — читаем все active sources, создаём cron job для каждого.
// Endpoint POST /api/sources/:id/schedule — обновляет расписание (пересоздаёт cron job).
```

Реализация:
1. При bootstrap: читаем все active sources → `cron.schedule(src.schedule, ...)` для каждого
2. Храним Map<sourceId, ScheduledTask> для возможности пересоздания
3. При изменении Source.schedule через API — пересоздаём cron job
4. Очередь: `parse-${src.slug}` вместо общего `parse-bankruptcy`

---

## Phase 3: Frontend — health и расписание на /sources

### Task 3.1: Показать health badge на карточке источника

**Objective:** Зелёный/красный индикатор — жив ли микросервис.

**Files:**
- Modify: `app/src/views/SourceListView.vue`

Добавить:
1. Поле `health` в интерфейс Source (или отдельный fetch)
2. `fetchHealth()` — для каждого source с `health_port`, делаем `GET /api/sources/${id}/health`
3. Badge: 🟢 Online / 🔴 Offline / ⚪ No port
4. Вызывать `fetchHealth()` после `fetchSources()` и периодически (каждые 30с)

```typescript
const healthStatuses = ref<Record<number, { status: string; error?: string }>>({})

async function fetchHealth() {
  for (const src of sources.value) {
    if (!src.health_port) continue
    try {
      const res = await api.get(`/sources/${src.id}/health`)
      healthStatuses.value[src.id] = res.data?.data || { status: 'offline' }
    } catch {
      healthStatuses.value[src.id] = { status: 'offline' }
    }
  }
}
```

---

### Task 3.2: Поле расписания на карточке + редактирование

**Objective:** Показывать cron-выражение, позволять менять (по умолчанию `0 3 * * *`).

**Files:**
- Modify: `app/src/views/SourceListView.vue`

Добавить:
1. В карточке: строка "Расписание: 0 3 * * * (ежедневно в 03:00)" с иконкой 🕐
2. По клику — inline-редактирование (input + кнопка "Сохранить")
3. PUT `/api/sources/${id}` с новым `schedule`
4. Human-readable подпись: "каждый час", "ежедневно в 03:00", "каждые 30 мин" (библиотека cronstrue или своя функция)

---

### Task 3.3: Обновить AvailableParsers и форму добавления

**Objective:** Форма добавления источника — только реальные парсеры, с дефолтным портом.

**Files:**
- Modify: `app/src/views/SourceListView.vue`

- `availableParsers` → только те, для которых создан микросервис
- При выборе парсера — автозаполнение health_port (fabrikant→1345, torgi-gov→1346)
- Поле schedule в форме (дефолт `0 3 * * *`)

---

## Phase 4: PM2 и деплой

### Task 4.1: Обновить ecosystem.config.js — новые процессы

**Objective:** Добавить PM2-процессы для parser-fabrikant и parser-torgi-gov.

**Files:**
- Modify: `ecosystem.config.js`

Добавить:
```javascript
{
  name: 'aklab-parser-fabrikant',
  cwd: '/home/rudin/aklab/services/parser-fabrikant',
  script: 'node',
  args: 'dist/index.js',
  interpreter: 'none',
  env: {
    ...process.env,
    NODE_ENV: 'production',
    PORT: '1345',
    SERVICE_NAME: 'parser-fabrikant',
    STRAPI_URL: process.env.STRAPI_INTERNAL_URL || 'http://localhost:1338',
    STRAPI_API_TOKEN: process.env.STRAPI_API_TOKEN || '',
    QUEUE_DB_PATH: '/home/rudin/aklab/queue.db',
  },
},
// аналогично для parser-torgi-gov (PORT=1346)
```

---

### Task 4.2: Обновить ecosystem-local.config.js

**Objective:** Локальная разработка — те же процессы.

---

### Task 4.3: Обновить deploy-prod.sh

**Objective:** Сборка новых сервисов + health check.

**Files:**
- Modify: `scripts/deploy-prod.sh`

В Step 6 (Build services) добавить parser-fabrikant, parser-torgi-gov.
В Step 7 (PM2 restart) — новые имена процессов.
В Step 8 (Health check) — проверка портов 1345, 1346.

---

## Phase 5: Миграция и cleanup

### Task 5.1: Миграция — удалить parser-bankruptcy после перехода

**Objective:** Когда parser-fabrikant и parser-torgi-gov работают — удалить монолит.

**Files:**
- Delete: `services/parser-bankruptcy/` (или оставить как архив)
- Remove: PM2 process `aklab-parser-bankruptcy-prod`
- Update: cron/index.ts — убрать parse:bankruptcy

---

### Task 5.2: Smoke test — обновить

**Objective:** Добавить health check новых сервисов в smoke test.

**Files:**
- Modify: `scripts/smoke-test.js`

---

## Phase 6: Документация

### Task 6.1: Создать `docs/adding-source.md`

**Objective:** Пошаговая инструкция для добавления нового источника парсинга.

**Files:**
- Create: `docs/adding-source.md`

Содержание:
```
# Добавление нового источника парсинга

## Обзор
Каждый источник — отдельный микросервис в `services/parser-<slug>/`.
Микросервис: health server + queue worker + парсер.

## Шаги

### 1. Создать сервис
Скопировать `services/parser-fabrikant/` → `services/parser-<slug>/`

Изменить:
- package.json: name → `@aklab/parser-<slug>-service`
- config.ts: PORT (следующий свободный, 1345+), SERVICE_NAME, QUEUE_NAME
- handler.ts: импорт своего парсера
- sources/<parser>.ts: реализация парсинга

### 2. Реализовать парсер
Файл: `services/parser-<slug>/src/sources/<parser>.ts`

Реализовать интерфейс SourceParser:
- name: string (совпадает с slug)
- parse(): Promise<ParsedProperty[]>

### 3. Зарегистрировать в Strapi
- Добавить slug в enum поля `parser` в
  `api/src/api/source/content-types/source/schema.json`
- Обновить seeder в `api/src/seeders/index.ts`

### 4. Добавить в PM2
- `ecosystem.config.js` — prod процесс
- `ecosystem-local.config.js` — dev процесс
- Следующий свободный PORT (1345, 1346, 1347, ...)

### 5. Обновить фронтенд
- `app/src/views/SourceListView.vue`:
  availableParsers добавить slug, healthPortMap добавить порт

### 6. Обновить deploy
- `scripts/deploy-prod.sh`: build + restart + health check

### 7. Деплой
git push → deploy-prod.sh

### 8. Проверить
- PM2: `pm2 list` — процесс online
- Health: `curl http://localhost:<PORT>/health`
- UI: /sources — badge зелёный
- Ручной запуск: кнопка "Запустить" на /sources
```

---

## Сводка портов

| Сервис               | Порт | Очередь                | PM2 name                    |
|----------------------|------|------------------------|-----------------------------|
| api (Strapi)         | 1338 | —                      | aklab-api                   |
| app (Vite preview)   | 5174 | —                      | aklab-app                   |
| parser-fabrikant     | 1345 | parse-fabrikant        | aklab-parser-fabrikant      |
| parser-torgi-gov     | 1346 | parse-torgi-gov        | aklab-parser-torgi-gov      |
| parser-fedresurs     | 1347 | parse-fedresurs        | aklab-parser-fedresurs (OFF)|
| analyzer             | 1341 | analyze-property       | aklab-analyzer-prod         |
| digest               | 1342 | digest-send            | aklab-digest-prod           |

## Порядок реализации

1. Phase 1 (shared + шаблоны сервисов) — можно локально
2. Phase 2 (Strapi schema + cron + health proxy) — локально + тест
3. Phase 3 (Frontend) — локально
4. Phase 4 (PM2 + deploy) — на сервере
5. Phase 5 (cleanup parser-bankruptcy) — после проверки
6. Phase 6 (docs) — в любой момент

## Риски

- **Очередь sqlite-queue**: все сервисы пишут в один `queue.db`. WAL mode позволяет параллельный доступ, но при >5 сервисах может быть contention. Пока ОК.
- **node-cron per-source**: при изменении расписания нужно пересоздать cron job. Нужен Map<sourceId, ScheduledTask> и endpoint для обновления.
- **Strapi 5 routes**: custom route `/sources/:id/health` нужно добавить аккуратно, не сломав auto-CRUD.
