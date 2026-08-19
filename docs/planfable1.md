# План работ по итогам аудита кода (planfable1)

Дата: 2026-08-19. База: `main @ 8731d60`.
Источник: полный аудит кода (backend, сервисы/библиотеки, frontend, инфраструктура),
все critical-находки перепроверены вручную по коду и git.

Правила выполнения: каждая группа — отдельная feature-ветка → PR в `main`.
Никаких git-операций и деплоя без отдельной команды пользователя.

---

## Исключено из плана (по указанию пользователя)

- **Fedresurs** — уже выключен в рантайме. В плане осталась только защитная мелочь
  (этап 2.6): сидер `api/src/seeders/sources.ts` до сих пор содержит `is_active: true`,
  идемпотентный сидер может включить источник обратно при bootstrap.
- **Админка** — не трогаем. Отложенные задачи перечислены в конце файла,
  чтобы не потерялись.

---

## Этап 0 — Утечки в git (критично, сделать первым)

- [ ] 0.1 Убрать из git `tests/.auth/storage.json` (содержит живой JWT для dev):
  `git rm --cached tests/.auth/storage.json`, добавить `tests/.auth/` в `.gitignore`.
- [ ] 0.2 Ротация: инвалидировать утёкший JWT и сменить пароль тестового
  пользователя на dev-стенде.
- [ ] 0.3 `tests/global-setup.ts:5-6` — убрать fallback-пароль `Test1234!` и
  fallback-email; только env (`TEST_USER_EMAIL`, `TEST_USER_PASSWORD`), fail-closed
  при отсутствии. Storage-файл генерировать в globalSetup.

Приёмка: `git ls-files tests/.auth/` пуст; grep по репо не находит тестовый пароль;
e2e проходят с env-переменными.

---

## Этап 1 — Безопасность (XSS, внешний периметр)

- [ ] 1.1 `app/src/views/DocumentationView.vue:19,58-65` — рендер markdown через
  `v-html` без санитизации и без проверки `res.ok`. Добавить проверку `res.ok`
  и санитизацию (DOMPurify или запрет raw HTML в marked). Это критично, потому что
  JWT лежит в localStorage: один XSS = захват сессии.
- [ ] 1.2 `app/src/api/strapi.ts:24-34` — обработка 401: сейчас чистится только
  localStorage без Pinia + hard redirect через `window.location`. Сделать единый
  `authStore.clearSession()` + `router.replace`, дедупликация параллельных 401.
- [ ] 1.3 `infra/traefik/docker-compose.yml:7-14`, `static.yml:1-3` — проверить на
  серверах, доступен ли `--api.insecure=true` (порт 8080) извне. Если да — закрыть
  (убрать insecure API, dashboard только через auth/VPN).
- [ ] 1.4 `api/src/api/source/controllers/source.ts:118-119` — публичный health
  отдаёт наружу сырой `fetchErr.message` (пути, DNS). Заменить на стабильный код
  `offline` без деталей. Сам endpoint публичный осознанно — не закрывать.
- [ ] 1.5 (обсудить) `api/config/plugins.ts:6-8` — JWT живёт 30 дней. Рекомендация:
  сократить до суток. Требует решения пользователя (частота перелогина).

Приёмка: XSS-пейлоад в markdown не исполняется; 401 корректно разлогинивает SPA;
внешний скан не видит Traefik dashboard.

---

## Этап 2 — Надёжность данных (очередь, воркеры, HTTP)

- [ ] 2.1 `services/_shared/src/queue-worker.ts:27-51` — `gracefulStopQueueWorker`
  синхронно зовёт `queue.close()`, таймер бесполезен, активные задачи обрываются
  при PM2 restart. Заменить на `await queue.gracefulClose(timeoutMs)`
  (метод уже есть: `lib/sqlite-queue/index.ts:478`). Убрать копии той же ошибки
  в `services/analyzer`, `services/digest`, `services/photo-fetcher` — вынести
  один общий shutdown в `_shared`. Поправить тест, который закрепляет `close()`.
- [ ] 2.2 `services/_shared/src/strapi-client.ts` — все fetch без таймаутов/ретраев;
  зависший HTTP держит lease очереди до stale-recovery. Общий `fetchWithTimeout`
  (15–30s) + retry на 5xx/сетевые, `PermanentError` на 4xx.
- [ ] 2.3 `services/_shared/src/strapi-client.ts:336-363` — `updateSourceStats`:
  GET → mutate → PUT без атомарности, параллельные парсеры теряют инкременты.
  Сделать атомарный инкремент на стороне API (internal endpoint `$inc`).
- [ ] 2.4 `lib/sqlite-queue/index.ts:90,128-130` — `auto_vacuum = INCREMENTAL`
  включён, но `PRAGMA incremental_vacuum` не вызывается — `queue.db` не сжимается.
  Вызывать после `cleanOldJobs`.
- [ ] 2.5 `lib/sqlite-queue/worker.ts:163-177`, `index.ts:109-126` — при потере
  lease `complete` с чужим `lease_token` — тихий no-op, возможны двойные
  side-effects. Проверять `isLeaseValid()` перед side-effects в handlers;
  при `complete.changes === 0` — явный warn/метрика.
- [ ] 2.6 `api/src/seeders/sources.ts` — fedresurs: `is_active: false`
  (источник выключен в рантайме, сидер не должен включать его обратно).
  Добавить unit-тест на паритет сидер ↔ `services/services.json`.
- [ ] 2.7 `services/parser-sberbank-ast/src/sources/sberbank-ast.ts:301-436` —
  `fetchDetails` игнорирует `sharedContext`: отдельный Chromium на каждый лот
  Phase 2 (риск OOM). Привести сигнатуру к `(url, sharedContext?)` как у
  alfalot/m-ets, закрывать page/ownBrowser в finally.

Приёмка: SIGTERM во время активного job дожидается завершения (лог
"stopped gracefully" после terminal state); vitest очереди зелёный; параллельный
прогон двух парсеров не теряет инкременты статистики.

---

## Этап 3 — Деплой (prod)

- [ ] 3.1 `scripts/deploy-prod.sh:355-360` — health приложения проверяется на
  `:4173`, прод живёт на `:5174` (`services/services.json`, Traefik). Единый
  `PORT_APP` из env для PM2 / vite preview / health-гейта; fail-closed при неответе.
  Разобрать рассинхрон `PORT` vs `PORT_APP` (`ecosystem.config.js:62`,
  `app/vite.config.ts`).
- [ ] 3.2 `scripts/deploy-prod.sh:362-373` — health микросервисов на prod только
  warning; сделать fail-closed → rollback, как в `deploy-dev.sh:108-121`.
- [ ] 3.3 `scripts/deploy-prod.sh:88-127,201-208` — rollback восстанавливает только
  `api/.tmp/data.db`, но не `queue.db` (бэкап которого делается). Добавить restore
  `queue.db` + WAL cleanup + integrity check в rollback-путь.
- [ ] 3.4 `scripts/deploy-prod.sh` — deploy-lock через `flock`, защита от
  параллельного запуска. Опционально: поэтапный restart вместо `pm2 stop` всех.
- [ ] 3.5 Мелочи: `PARSER_SLUGS` не используется (`deploy-prod.sh:20`,
  `deploy-dev.sh:69`); `CHECKOUT_SHA` не используется (`deploy-dev.sh:50`);
  `npm rebuild better-sqlite3 || true` глотает ошибки (`deploy-prod.sh:282-288`).

Приёмка: тестовый прогон деплоя на dev проходит все гейты; искусственно уроненный
парсер вызывает rollback; два параллельных запуска скрипта — второй отваливается.

---

## Этап 4 — Backend-логика (pipeline, cron)

- [ ] 4.1 `api/src/services/pipeline/state.ts:230-276`, `index.ts:524-531` — race
  read-modify-write в `updateState`: параллельные `recordJobIds`/cancel могут
  потерять `job_ids` → recovery заблокируется. Атомарный JSON-merge (`json_set`)
  или optimistic version.
- [ ] 4.2 `api/src/services/pipeline/index.ts:123-134` — при сбое персистенса в
  recovery in-memory locks (`activeRunId`, `recoveringRunId`) не снимаются,
  `forceReset` заблокирован до рестарта процесса. Снимать в catch/finally,
  durable `cancelling` оставить.
- [ ] 4.3 `api/src/cron/index.ts:90-102` — `cleanup:expired-auctions` удаляет
  property без графа зависимостей: orphan `user_comments`, `user_property_states`,
  `property_events`, файлы фото. Использовать DELETE_GRAPH из
  `property-catalog-cleanup.ts` + удаление фото-директорий, батчами.
- [ ] 4.4 `api/src/services/pipeline/stages.ts:421-441` — analyze грузит все
  необработанные property в память (`limit: -1`). Курсорная пагинация + лимит
  задач на запуск.
- [ ] 4.5 `api/src/api/property/.../schema.json` — индекс по `auction_end_at`
  для ежедневного cleanup.
- [ ] 4.6 `api/src/cron/index.ts:28-55` — уважать `digest_enabled` из настроек
  (сейчас игнорируется).
- [ ] 4.7 Выровнять `parse_depth`: schema max 5000
  (`setting/.../schema.json:52-57`) vs runtime max 1000
  (`pipeline/state.ts:104-107`).
- [ ] 4.8 `api/src/api/cron/controllers/cron.ts:42` — валидировать depth через
  `validateDepth` до enqueue.
- [ ] 4.9 Мёртвый код: SSE-broadcast без роута (`api/src/services/pipeline-sse.ts`),
  неиспользуемый `getSourceStats` (`pipeline/index.ts:773-783`) — удалить или
  задействовать (SSE-роут — с авторизацией).
- [ ] 4.10 Startup env validation (`api/src/index.ts:34-39`): требовать
  `STRAPI_API_TOKEN`, `QUEUE_DB_PATH`, `PRIVATE_PHOTO_ROOT`, `ENCRYPTION_KEY`,
  непустые `APP_KEYS`.
- [ ] 4.11 Сидеры: `smtp_to` fallback на личный email
  (`api/src/seeders/settings.ts:18,45`) — без `SMTP_TO` пропускать;
  test-user сбрасывает пароль при каждом bootstrap
  (`api/src/seeders/test-user.ts:27-34`) — только вне production.
- [ ] 4.12 `api/src/api/property/controllers/property.ts:527-530` — Nominatim URL
  и email захардкожены; вынести в `GEOCODER_URL` env + rate-limit на геокодинг.
- [ ] 4.13 `api/config/middlewares.ts:3-26` — CORS origins из env
  (обязательный `CORS_ORIGINS`), пересмотреть rate-limit 6000/мин, отдельный
  жёсткий лимит на login.

Приёмка: конкурентный тест recordJobIds не теряет id; после cleanup нет orphan-строк
(проверка COUNT по связям); bootstrap падает с понятной ошибкой без required env.

---

## Этап 5 — Сервисы: точность и производительность

- [ ] 5.1 `services/analyzer/src/handler.ts:42` — MR-кэш создаётся внутри job и
  никогда не даёт попаданий (один job = один объект). TTL-кэш уровня процесса
  (MarketReference меняется редко) или батч-анализ.
- [ ] 5.2 `services/analyzer/src/handler.ts:77` — `threshold = req.threshold || 0`:
  явный порог 0 игнорируется. Заменить на `??`.
- [ ] 5.3 `services/_shared/src/strapi-client.ts:154-159` — `preFilterProperty`
  не проверяет `areaTo` (createProperty проверяет) — лишние fetchDetails.
- [ ] 5.4 `services/_shared/src/parse-handler.ts:541-563` — `photo_urls` с
  detail-страниц не пробрасываются в `createProperty` — фото теряются.
- [ ] 5.5 `services/_shared/src/anti-ban.ts:48-65,181-194` — `sec-ch-ua` всегда
  Windows/Chrome 125 при любом UA (включая Firefox). Согласовать client-hints
  с выбранным UA, обновить версии пула.
- [ ] 5.6 `lib/sqlite-queue/worker.ts:112-113` — idle-polling 200ms × ~13 процессов.
  Адаптивный backoff при пустой очереди (200ms → 1–2s).
- [ ] 5.7 `services/photo-fetcher/src/handler.ts:72-88` — browser на каждый job,
  без stealth, UA Chrome 120. Общий browser + `createStealthContext`.
- [ ] 5.8 Debug `console.log` в prod-путях (`strapi-client.ts:342-392`,
  `parse-handler.ts`) — через `logger.debug`.

Приёмка: анализ N объектов делает ≤ (число пар город×тип) запросов MarketReference;
smoke зелёный.

---

## Этап 6 — Рефакторинг каркаса парсеров

Каркас 10 парсеров продублирован на ~90–95% (index.ts, handler.ts,
queue-worker.ts, config.ts). Уникален только extraction-код источников.

- [ ] 6.1 `_shared`: `createParserMicroservice({ name })` — health-сервер + queue
  worker + SIGTERM shutdown одним вызовом. Мигрировать все 10 парсеров.
- [ ] 6.2 `_shared`: `withBrowserContext(sharedContext, fn)` — launch args,
  stealth, retryGoto, гарантированное закрытие page/ownBrowser. Устраняет
  расхождения вроде sberbank-ast (2.7).
- [ ] 6.3 Удалить мёртвые per-parser `src/config.ts` (10 файлов, не импортируются).
- [ ] 6.4 `concurrency: 2` в shared queue-worker — вынести в env
  `PARSER_CONCURRENCY`.
- [ ] 6.5 Прочий мёртвый код: `MAX_AGE_HOURS` в alfalot, `stmtClaim` в
  sqlite-queue/worker, `matchPhase` в parse-rules (не используется в
  `matchesProfile`) — удалить или задействовать.

Приёмка: все парсеры собираются и проходят smoke; diff показывает удаление
~200+ строк дублированного кода на парсер; поведение Phase 1/Phase 2 не изменилось.

---

## Этап 7 — Frontend (без админки)

- [ ] 7.1 `app/src/composables/usePropertyData.ts:122-156`, `useFocusTab.ts:153-178`
  — гонки запросов: поздний ответ перетирает актуальный; сброс `page=1` +
  `watch(page)` даёт двойной fetch. Request-generation id / AbortController.
- [ ] 7.2 Ошибки загрузки каталога показывать в UI (сейчас только console.error):
  `usePropertyData.ts:130-133`, `PropertyAllTab.vue`, `PropertyFocusTab.vue` —
  toast или EmptyState с retry.
- [ ] 7.3 `PropertyDetailView.vue:792-796` — автозагрузка фото при каждом открытии
  карточки; авто — только если `photos_downloaded`, иначе кнопка.
- [ ] 7.4 Хардкоды: URL карты ЦИАН (`PropertyDetailView.vue:638-642`) →
  `VITE_CIAN_MAP_URL`; fallback `localhost:1338` (`app/src/api/strapi.ts:4`) →
  fail-fast в prod без `VITE_API_URL`.
- [ ] 7.5 Декомпозиция `PropertyDetailView.vue` (~810 строк): вынести PhotoGallery,
  Actions, Events; общий тип `Property` вместо локального дубля.
- [ ] 7.6 Мёртвый код: `usePolling` (только в тестах), пустой
  `ConfirmClearDialog.vue`, `lastAuthTime` (пишется, не читается),
  `auth.register` без UI, `focusAvgScore` (всегда null) — удалить.
- [ ] 7.7 Синхронизация табов с URL: ссылки дашборда `?status=new` не открывают
  нужный таб (`DashboardView.vue:24-26`, `PropertyListView.vue:60-66`);
  писать активный таб в query.
- [ ] 7.8 UX-мелочи: logout → `/auth` вместо `/` (`App.vue:189-193`); ошибки
  частичной загрузки событий/комментариев показывать
  (`PropertyDetailView.vue:709-719`); индикатор прогресса для CSV/bulk
  (`PropertyFocusTab.vue:250-287`).

Приёмка: быстрое переключение фильтров не даёт устаревших данных; при отключённом
API пользователь видит ошибку с retry; unit-тесты app зелёные.

---

## Этап 8 — Инфраструктура и гигиена

- [ ] 8.1 `ecosystem.config.js:23-28` — удалить несуществующее поле `health_check`
  (у PM2 такого нет; реальный watchdog — `health-watchdog.sh`).
- [ ] 8.2 `ecosystem.config.js` (6 мест) — PATH к Node захардкожен на v22.20.0;
  брать из env / nvm default.
- [ ] 8.3 Выровнять `better-sqlite3` на один major во всех пакетах
  (root/lib ^11 vs api/services 12.8) — риск native ABI mismatch.
- [ ] 8.4 `ecosystem-local.config.js:8-22` — не передавать весь `process.env`
  во все процессы; allowlist.
- [ ] 8.5 `scripts/notify-deploy.sh:74-95`, `health-watchdog.sh:118-139` — секреты
  SMTP интерполируются в argv `node -e` (видны в `ps`); читать из `process.env`.
- [ ] 8.6 Синхронизировать `.env.template` ↔ `.env.local.example` ↔
  `scripts/check-env.js`: template не содержит `AKLAB_APP_URL` и
  `STRAPI_API_TOKEN`, которые check-env требует; check-env не требует
  `ENCRYPTION_KEY`, `PRIVATE_PHOTO_ROOT`, `STRAPI_INTERNAL_URL`.
- [ ] 8.7 Добавить PM2 restart-политики (`min_uptime`, `max_restarts`,
  `kill_timeout`) и проверку `pm2-logrotate` в preflight деплоя.
- [ ] 8.8 (решение пользователя) CI полностью отключён (`disabled_manually`) —
  app-тесты (~40 unit) и e2e нигде не бегут автоматически. Рекомендация: включить
  хотя бы CI-workflow на PR (build + unit, включая `app/`).
- [ ] 8.9 Два e2e-харнесса (`tests/e2e.spec.ts` ~78KB и `app/e2e/`) с разными
  версиями Playwright — оставить один, выровнять версии.
- [ ] 8.10 Явный `vitest` в root `devDependencies` (сейчас тянется транзитивно).
- [ ] 8.11 Удалить legacy `.github/workflows/deploy-dev.yml` или переписать через
  `scripts/deploy-dev.sh --ref <sha>` (текущий делает `git pull` + рестарт только
  api/app, без парсеров и immutable SHA).

---

## Этап 9 — Документация

- [ ] 9.1 `docs/compact-doc.md:14-17` — «считает рыночную цену через похожие
  объекты в радиусе X км» не соответствует коду: analyzer сравнивает с
  `MarketReference` по паре город + тип. Поправить формулировку
  (или завести задачу на реализацию радиуса, если он планировался).
- [ ] 9.2 После этапов 2 и 6 обновить `docs/archparsers.md` и
  `docs/adding-source.md` под новый каркас (`createParserMicroservice`).
- [ ] 9.3 Отразить в `compact-doc.md` итоги плана (порты, shutdown-контракт).

---

## Отложено (по указанию пользователя — админку не трогать)

Зафиксировано, чтобы не потерялось. Вернуться по отдельной команде.

- Сломанные админ-кнопки «Анализ»/«Дайджест»: `analyzeAll` передаёт объект
  filters как `targetUserId`, `sendDigest` — undefined → `PipelineInputError`
  (`api/src/api/cron/controllers/cron.ts:108-161`).
- `GET /setting` отдаёт AKLAB-админу весь `pipeline_state` c `filter_snapshot`
  (фильтры всех пользователей), `PUT /setting` может перезаписать lifecycle
  (`api/src/api/setting/routes/setting.ts:7-8`). Фикс: deny-list `pipeline_state`
  в кастомных find/update или вынос lifecycle из Setting.
- `meta.requiresAdmin` на роуты админ-разделов фронта
  (`app/src/router/index.ts:44-48,88-90`) — сейчас скрыто только в UI.
- Seed-права authenticated в U&P шире необходимого
  (`api/src/seeders/permissions.ts:23-50`).
- `analyzeProgress` считает по legacy `status: 'new'`
  (`api/src/api/cron/controllers/cron.ts:253-256`).
- Хардкод health-портов в контроллере source
  (`api/src/api/source/controllers/source.ts:45-57`) — дублирует services.json.

---

## Рекомендуемый порядок PR

| # | Ветка | Этапы | Размер |
|---|-------|-------|--------|
| 1 | `fix/leaked-test-credentials` | 0 | XS |
| 2 | `fix/frontend-xss-auth` | 1.1, 1.2 | S |
| 3 | `fix/graceful-shutdown-queue` | 2.1, 2.4, 2.5 | M |
| 4 | `fix/strapi-client-timeouts-stats` | 2.2, 2.3 | M |
| 5 | `fix/sberbank-shared-context` | 2.7 | S |
| 6 | `fix/seed-fedresurs-inactive` | 2.6 | XS |
| 7 | `fix/deploy-prod-gates` | 3.1–3.5 | M |
| 8 | `fix/pipeline-state-races` | 4.1, 4.2 | M |
| 9 | `fix/cleanup-delete-graph` | 4.3, 4.5 | S |
| 10 | `fix/backend-hardening` | 4.4, 4.6–4.13 | L |
| 11 | `refactor/parser-microservice-shared` | 6.1–6.5, 5.3–5.8 | L |
| 12 | `fix/analyzer-cache-threshold` | 5.1, 5.2 | S |
| 13 | `fix/frontend-races-errors` | 7.1, 7.2 | M |
| 14 | `refactor/frontend-cleanup` | 7.3–7.8 | L |
| 15 | `chore/infra-hygiene` | 8.1–8.11 | M |
| 16 | `docs/audit-followup` | 9.1–9.3 | S |

Пункты 1.3 (Traefik на серверах), 1.5 (срок JWT) и 8.8 (включение CI) требуют
решения/действий пользователя — вне PR-цикла.
