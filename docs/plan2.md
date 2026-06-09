# AKLAB — план работ v2

**Статус (9 июня 2026):** Фазы 0–8 завершены, MVP задеплоен.
Дополнительно: Фаза 9 (Sources CRUD + parsers), Фаза 10 (auth-only + smoke + changelog).
Текущая версия: v1.0.12. См. `compact-doc.md` для актуального состояния.

MVP: мониторинг торгов по банкротству/приватизации, поиск объектов с
ценой ниже ручного эталона. Архитектура — донор tirobots
(`@tirobots/sqlite-queue`, node-cron, микросервисы под PM2).

## Зафиксированные решения

| Развилка | Решение |
|----------|---------|
| Архитектура | Донор tirobots: `@tirobots/sqlite-queue` + node-cron + микросервисы под PM2 |
| Источники | Торги: bankrot.fedresurs.ru, xn----etbpba5admdlad.xn--p1ai, torgi.gov.ru, investmoscow.ru, invest.mosreg.ru, roseltorg.ru, fabrikant.ru, alfalot.ru, etprf.ru, sberbank-ast.ru, m-ets.ru |
| Регион | Москва+МО в MVP, остальные потом |
| Геокодер | НЕТ — парсим адрес строкой |
| Анализатор | Сравнение с **ручным эталоном** (см. Фазу 1.5), не с медианой похожих |
| Telegram | НЕТ в MVP (только web + SMTP) |
| SMTP | Тот же что в tirobots (Yandex, smtp.yandex.ru:465), `strapi::email` (nodemailer) |
| Email-дайджест | Простой HTML-список, 9:00 МСК, на 1 адрес из Setting.smtp_to |
| Web UI | Один риелтор, минимальная авторизация |
| Локальный запуск | Через PM2 (`ecosystem-local.config.js`) |
| Хостинг микросервисов | **На 192.168.11.151 рядом со Strapi** (тот же PM2, новые процессы) |

---

## Фаза 0. Подготовка (1-2ч)

Чистая кодовая база с архитектурой tirobots, готовая к наполнению.

- Создать директории: `lib/sqlite-queue/`, `services/` (заготовки)
- В `lib/sqlite-queue/` — копия из tirobots, переименовать пакет в `@aklab/sqlite-queue`
- В `api/src/index.ts` — `register()`: инициализация QueueService; `bootstrap()`: `registerCrons(strapi)`
- `api/src/cron/index.ts` — пустой пока, будет наполняться в Фазе 3
- В `package.json` — npm workspaces для `lib/*` и `services/*`
- В `ecosystem-local.config.js` — закомментированные слоты под будущие микросервисы
- В `ecosystem.config.js` (прод) — то же самое
- Обновить `docs/compact-doc.md` — зафиксировать архитектуру

**Checkpoint**: `pm2 start ecosystem-local.config.js` стартует, Strapi живой,
фронт живой, `queue.db` создаётся, логи чистые.

---

## Фаза 1. Content-types (3-4ч)

**Property** (коммерческая недвижимость):
- `source` (enum: fedresurs, aggregator-bankrot, torgi-gov, investmoscow, invest-mosreg, roseltorg, fabrikant, alfalot, etprf, sberbank-ast, m-ets)
- `external_id` (string, unique в паре с source)
- `url` (string)
- `title` (string)
- `address` (text) — как в источнике
- `city` (enum: moscow, mo, other)
- `area_sqm` (decimal)
- `price` (decimal)
- `price_per_sqm` (decimal) — вычисляется
- `property_type` (enum: office, warehouse, retail, production, free_purpose, other)
- `auction_type` (enum: bankruptcy, privatization, marketplace)
- `status` (enum: new, in_progress, viewed, rejected) — workflow риелтора
- `is_undervalued` (boolean) — выставляется analyzer'ом
- `deviation_percent` (decimal) — на сколько % ниже эталона (если undervalued)
- `manual_price_per_sqm` (decimal, nullable) — эталон, использованный при сравнении
- `published_at` (datetime) — из источника
- `description` (text, nullable)
- `contacts` (text, nullable)
- timestamps

**Setting** (глобальные настройки, **singleton**):
- `threshold_percent` (decimal, default 20) — минимальное отклонение для алерта
- `work_hours_start` (integer, default 9)
- `work_hours_end` (integer, default 21)
- `digest_time` (string, default "09:00") — формат "HH:MM"
- `retention_months` (integer, default 6)
- `active_sources` (json) — массив source'ов, которые парсим
- `smtp_to` (string) — куда слать дайджест
- timestamps

**MarketReference** (ручной эталон рыночной цены за м²) — **новое в v2**:
- `city` (enum: moscow, mo, other) — пока MVP
- `property_type` (enum: office, warehouse, retail, production, free_purpose, other)
- `price_per_sqm` (decimal) — вручную введённая цена
- `effective_from` (date) — с какой даты действует
- `notes` (text, nullable) — "по данным ЦИАН, на дату"
- `created_by` (string) — кто ввёл (для аудита)
- `is_active` (boolean, default true) — можно деактивировать
- timestamps
- **unique constraint** на пару (city, property_type, effective_from) — нельзя
  иметь две записи за одну дату

**UserComment** (комментарии риелтора к объекту):
- `property_id` (relation → Property, manyToOne)
- `text` (text)
- timestamps

**CronLog** (для отладки cron'ов):
- `name` (string) — имя cron-задачи
- `started_at`, `finished_at` (datetime)
- `items_processed` (integer)
- `error` (text, nullable)
- timestamps

**Seed'ы**:
- В `api/src/seeders/index.ts` добавить `seedSettings()` — создаёт дефолтную
  запись Setting если нет. НЕ сидит MarketReference (его вводит риелтор
  руками через UI).

**Checkpoint**: Strapi admin показывает все content-types, можно создать
Property и Setting руками. `/api/properties` отдаёт 200.

---

## Фаза 1.5. UI для MarketReference (1-2ч)

**Только web-форма**, без бэкенд-логики. CRUD-страница для ручного
ввода эталонов.

- Vue view `MarketReferencesView.vue`:
  - Таблица существующих эталонов (city, property_type, price_per_sqm,
    effective_from, is_active, notes)
  - Форма добавления: city (select), property_type (select),
    price_per_sqm (number), effective_from (date picker), notes (textarea)
  - Inline edit price_per_sqm
  - Кнопка "Деактивировать" (не удалять, чтобы сохранить историю)
- Strapi endpoints с permissions:
  - `GET /api/market-references?filters[city]=...&filters[property_type]=...`
  - `POST /api/market-references`
  - `PATCH /api/market-references/:id`
  - `DELETE /api/market-references/:id` (опционально, soft delete лучше)
- В `SettingsView.vue` — ссылка/таб на MarketReference
- Валидация на клиенте: positive number, valid date, not duplicate
  (city+property_type+effective_from)
- Anti-patterns: TanStack Query (НЕ axios), все запросы с `correlationId`
  в headers (через interceptor), throw на ошибки

**Checkpoint**: открыл Settings → MarketReference, добавил эталон
"Москва, офис, 250000 ₽/м², с 01.06.2026", запись появилась в таблице.
Изменил цену — сохранилось.

---

## Фаза 2. Email-провайдер (30м)

Рабочий SMTP.

- Копирую `email` секцию из tirobots `strapi/config/plugins.ts` в
  `api/config/plugins.ts`
- В `api/.env` (и `.env.local.example`):
  `EMAIL_SMTP_HOST=smtp.yandex.ru`, `EMAIL_SMTP_PORT=465`,
  `EMAIL_SMTP_SECURE=true`, `EMAIL_SMTP_USER`, `EMAIL_SMTP_PASS`,
  `EMAIL_DEFAULT_FROM`, `EMAIL_DEFAULT_REPLY_TO`
- Тест из Strapi admin (Settings → Email → Send test email)

**Checkpoint**: тестовое письмо с localhost приходит.

---

## Фаза 3. SQLite-queue + cron bootstrap (2-3ч)

Очередь и планировщик работают.

- `lib/sqlite-queue/` — копия из tirobots, пакет `@aklab/sqlite-queue`
- `api/src/services/queueService.ts` — singleton, маппинг requestType → queue:
  - `parse:bankruptcy:request` → `parse-bankruptcy`
  - `analyze:property:request` → `analyze-property`
  - `digest:send:request` → `digest-send`
- `api/src/cron/index.ts`:
  - `parse:bankruptcy` (cron: `0 * * * *`, timezone: `Europe/Moscow`,
    `noOverlap: true`) — дёргает `parse-bankruptcy` для всех active_sources
  - `analyze:properties` (cron: `*/30 * * * *`) — дёргает
    `analyze-property` для всех `status=new`
  - `digest:morning` (cron: `0 ${setting.digest_time.split(':')[0]} * * *`,
    читается динамически из Setting) — дёргает `digest-send`
  - `cleanup:old` (cron: `0 3 * * *`) — удаляет Property старше
    `setting.retention_months`
- Anti-patterns: native fetch, throw, correlationId в payload

**Checkpoint**: в логах `Cron registered: parse:bankruptcy (every hour)`
и т.д. При ручном вызове `queueService.sendMessage('parse-bankruptcy', ...)`
в `queue.db` появляется job.

---

## Фаза 4. parser-bankruptcy микросервис (4-5ч)

Первый парсер работает end-to-end.

- Структура `services/parser-bankruptcy/`:
  - `package.json` (name: `@aklab/parser-bankruptcy-service`)
  - `tsconfig.json`, `ecosystem.config.js`, `ecosystem.dev.config.js`
  - `src/index.ts` (entry, graceful shutdown)
  - `src/server.ts` (HTTP :PORT для health/metrics)
  - `src/queue-worker.ts` (слушает `parse-bankruptcy`)
  - `src/handler.ts` (бизнес-логика: вызывает нужный source-парсер)
  - `src/sources/fedresurs.ts` (первый источник)
  - `src/sources/index.ts` (маппинг source → парсер)
  - `src/strapi-client.ts` (REST к Strapi с API-токеном)
  - `src/config.ts` (env: PORT, QUEUE_DB_PATH, STRAPI_URL, STRAPI_API_TOKEN)
  - `src/utils/logger.ts` (Winston)
- Handler:
  - Получает `source: 'fedresurs'`
  - Парсит HTML через `fetch` + `cheerio`
  - Для каждого объекта: дедупликация (GET /api/properties?filters[source][$eq]=fedresurs&filters[external_id][$eq]=X),
    если есть — skip
  - POST /api/properties (с raw JSON, Strapi сам создаст relations)
  - При сетевых ошибках → throw (worker ретраит)
  - При 4xx → PermanentError (не ретраить)
- PM2 в `ecosystem.config.js` на 151: `aklab-parser-bankruptcy-prod`
- PM2 в `ecosystem-local.config.js`: `aklab-parser-bankruptcy-dev`

**Checkpoint**: `pm2 list` показывает `aklab-parser-bankruptcy-prod`.
Вручную добавляю job в очередь → через 5-10 сек вижу новые Property в
Strapi admin.

---

## Фаза 5. Web UI MVP (4-6ч)

Риелтор видит объекты в браузере.

- Strapi endpoints с permissions:
  - `GET /api/properties?filters[city]=msk&pagination[pageSize]=50&sort=created_at:desc&populate=comments`
  - `PATCH /api/properties/:id` (status, comment)
  - `GET /api/properties/:id?populate=*`
  - `GET /api/setting`
  - `PATCH /api/setting`
  - `GET /api/market-references?...` (создано в Фазе 1.5)
  - `POST /api/market-references`, `PATCH /api/market-references/:id`
- Vue views:
  - `PropertyListView.vue` — таблица с фильтрами (city, status, source,
    date range, undervalued only)
  - `PropertyDetailView.vue` — карточка + кнопки
    "В работу / Просмотрено / Отклонено" + поле комментария + бейдж
    "⚠️ Недооценён на X%" если `is_undervalued`
  - `SettingsView.vue` — общие настройки (threshold, sources, smtp_to,
    digest_time) + **ссылка на MarketReference**
  - `MarketReferencesView.vue` — из Фазы 1.5
- TanStack Query для всех запросов
- Auth: 1 admin (seed'ится), вход через `STRAPI_ADMIN_EMAIL`

**Checkpoint**: зашёл на `http://localhost:5174`, вижу пустой список. После
Фазы 4 — собранные объекты. Меняю статус, добавляю эталон — сохраняется.

---

## Фаза 6. analyzer микросервис (3-4ч)

Сравнивает с MarketReference (а не с медианой похожих).

- Структура `services/analyzer/`:
  - `src/queue-worker.ts` (слушает `analyze-property`)
  - `src/handler.ts`:
    1. Получает property_id
    2. Берёт Property (city, property_type, price_per_sqm)
    3. Ищет **активный** MarketReference: `filters[city]=X&filters[property_type]=Y&filters[is_active][$eq]=true&sort=effective_from:desc&pagination[limit]=1`
    4. Если эталон есть:
       - `deviation_percent = (manual - actual) / manual * 100`
       - Если `deviation_percent >= setting.threshold_percent` →
         `is_undervalued = true`, `deviation_percent = X`, `manual_price_per_sqm = Y`
       - Иначе → `is_undervalued = false`, `deviation_percent = 0`
    5. Если эталона нет → ничего не делаем (Property остаётся
       `is_undervalued = null`, риелтор оценивает руками)
  - `src/strapi-client.ts` (GET/PATCH к Strapi)
- Cron `analyze:properties` (Фаза 3) дёргает `analyze-property` для всех
  Property с `status=new && is_undervalued=null`

**Checkpoint**: добавил эталон "Москва, офис, 250000 ₽/м²", перезапустил
analyze для тестового Property с ценой 180000/м² → `is_undervalued = true`,
`deviation_percent = 28.0`. В UI подсвечивается бейдж.

**Edge cases**:
- Эталон устарел (effective_from < 6 мес назад) — warning в логах
- Несколько эталонов (исторические) — берём самый свежий с `is_active=true`
- Эталон деактивирован — берём предыдущий активный (если есть)

---

## Фаза 7. digest микросервис (2-3ч)

Утренний email.

- Структура `services/digest/`:
  - `src/queue-worker.ts` (слушает `digest-send`)
  - `src/handler.ts`:
    1. Получает payload (date, smtpTo)
    2. Берёт Property за последние 12 часов с
       `is_undervalued=true && status != rejected`
    3. Формирует HTML (минимальный: для каждого объекта — title, address,
       city, area, price, price_per_sqm, deviation, ссылка)
    4. Отправляет через прямой вызов nodemailer (создаёт transport из
       `EMAIL_SMTP_*` env, а не через Strapi — проще)
- Cron `digest:morning` шлёт `sendMessage('digest-send', { date, smtpTo })`
- Тест: меняем cron на `*/2 * * * *` → получаем email через 2 мин

**Checkpoint**: 9:00 МСК (или по тестовому cron) → email приходит с
списком недооценённых объектов.

---

## Фаза 8. Deploy на 151 (2-3ч)

Прод-окружение работает.

- `scripts/deploy-prod.sh` дополнить под микросервисы:
  - `npm install` для каждого `services/*` через workspaces
  - `npm run build` для каждого
  - `pm2 start ecosystem.config.js` (там уже все процессы)
- `ecosystem.config.js` на проде: добавить процессы
  - `aklab-parser-bankruptcy-prod`
  - `aklab-analyzer-prod`
  - `aklab-digest-prod`
- `ecosystem-local.config.js` — те же в dev
- Проверить что на 151 хватает памяти (Strapi 270mb + каждый сервис ~100-200mb)
- `queue.db` на проде — путь `~/aklab/queue.db` (не в `api/.tmp/`, чтобы
  микросервисы могли читать)

**Checkpoint**: `https://aklab.tirobots.ru` работает, `pm2 list` на 151
показывает 5+ процессов, через час вижу первые собранные объекты.

---

## Фаза 9 (опционально). Дополнительные источники

В `services/parser-bankruptcy/src/sources/` добавляем `torgi-gov.ts`,
`investmoscow.ts`, `roseltorg.ts` и т.д. Каждый ~100-200 строк.
Включаются через `Setting.active_sources`.

---

## Сводка

| Фаза | Что | Время | Зависит от |
|------|-----|-------|------------|
| 0 | Подготовка архитектуры | 1-2ч | — |
| 1 | Content-types (вкл. MarketReference) | 3-4ч | 0 |
| 1.5 | UI для MarketReference | 1-2ч | 1 |
| 2 | Email-провайдер | 30м | 0 |
| 3 | Queue + cron | 2-3ч | 0 |
| 4 | parser-bankruptcy | 4-5ч | 1, 3 |
| 5 | Web UI MVP | 4-6ч | 1, 1.5 |
| 6 | analyzer | 3-4ч | 1, 1.5, 3 |
| 7 | digest | 2-3ч | 2, 3 |
| 8 | Deploy + бой | 2-3ч | всё |
| **MVP** | | **~25-30ч** | |

**Параллелить можно**: 1.5 и 2 (UI и email), 4 и 5 (parser и UI).
Остальное последовательно.

## Стек

- **Backend**: Strapi 5.46.1 + SQLite + `@aklab/sqlite-queue`
- **Frontend**: Vue 3 + Vite + TanStack Query (как в tirobots)
- **Cron**: node-cron в `api/src/cron/index.ts` (timezone Europe/Moscow)
- **Email**: strapi::email (nodemailer), smtp.yandex.ru:465
- **Хостинг**: один сервер 192.168.11.151, всё под PM2
- **Мониторинг**: `pm2 list`, `pm2 logs`, health endpoint каждого сервиса

## Открытые вопросы

1. **SMTP_USER для aklab** — есть отдельный ящик `aklab@yandex.ru`, или
   используем `a-samurai-mail@yandex.ru` (как в tirobots)?
2. **Fedresurs — официальный API?** Если нет, парсим HTML.
3. **Yandex API для парсинга** — не используется, или есть нюансы?
4. **Cron timezone** — везде Europe/Moscow (предлагаю).
5. **Frequency парсинга** — каждый час (предлагаю) или чаще/реже?
