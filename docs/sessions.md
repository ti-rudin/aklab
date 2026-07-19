# AKLAB — Session Handoff Notes

> Извлечено из docs/compact-doc.md. Хронологический порядок.

## Session handoff (v1.1.75 — восстановление фотографий ГИС Торги)
**Сделано 19 июля 2026:**
- ✅ Production-логи показали причину spinner: `photo-fetcher` падал с `net::ERR_CERT_AUTHORITY_INVALID`, потому что Chromium не использует `NODE_EXTRA_CA_CERTS`; после retry `photos_downloaded` оставался `false`.
- ✅ Для `torgi-gov` Playwright заменён на официальный lot API: compound ID → `/new/api/public/lotcards/{id}` → валидированные `lotImages` → `/new/image-preview/v1/{fileId}?disposition=inline`.
- ✅ В env `aklab-photo-fetcher-prod` добавлена Russian CA chain для Node TLS; глобальное отключение TLS-проверки не используется.
- ✅ Добавлены retry для временных `429/5xx`; полный провал скачивания теперь бросает ошибку и активирует retry очереди.
- ✅ На реальном production endpoint проверены 5/5 оригиналов: HTTP 200, MIME совпадает с magic bytes. Resize-вариант не используется из-за наблюдавшихся `503` и MIME/magic mismatch.
- ✅ Tests photo-fetcher 13/13 и TypeScript build прошли.

## Session handoff (v1.1.74 — исправление ссылок ГИС Торги)
**Сделано 19 июля 2026:**
- ✅ Найдена причина неработающих ссылок: устаревший маршрут `/new/public/lots/reg/lot-card/{notice}/{lot}` отдавал HTTP 200, но после SPA hydration показывал внутреннюю страницу 404.
- ✅ Подтверждён актуальный маршрут на реальном production DOM: `/new/public/lots/lot/{notice}_{lot}`.
- ✅ Парсер `torgi-gov` генерирует новый URL и извлекает compound lot ID для detail API; добавлены регрессионные тесты, 25/25 targeted tests и parser build прошли.
- ✅ PR #34 merged, production deploy v1.1.74 успешен; API 204, frontend 200, PM2 16/16 online.
- ✅ После отдельного SQLite backup атомарно обновлены URL всех 149 существующих `torgi-gov` объектов: current=149, legacy=0, missing=0; `PRAGMA integrity_check=ok`.
- **Инсайт:** HTTP 200 для SPA route не доказывает существование страницы — проверять hydrated DOM/body на внутренний 404.

## Session handoff (v1.1.73 — production pipeline recovery)
**Сделано 17 июля 2026:**
- ✅ Production hotfix `v1.1.72` (`b3d32dd`): `POST /properties/upsert` через `strapi.db.query().create()` передавал JSON default `tags=[]` raw-массивом в `better-sqlite3` → `500` на каждой валидной записи. Перед ORM boundary сериализуются `tags` и `photo_urls`; RED regression test, 80 targeted tests, API TypeScript и Strapi build прошли.
- ✅ Manual pipeline `08e751dc-a5e9-44e8-aa77-da1b2a2c0416` после v1.1.72: создано 35 объектов, обработано 35, `undervalued=6`, без errors. Но digest ошибочно написал `No focus properties`.
- ✅ Production hotfix `v1.1.73` (`0e00456`): raw focus SQL возвращает `first_seen_at` как SQLite epoch milliseconds, а digest freshness-filter принимал только ISO. Digest теперь принимает strict ISO и positive safe epoch milliseconds, старые/future/invalid записи по-прежнему отсекаются. RED test + 19/19 digest tests + digest build + CI прошли.
- ✅ Manual verification run `725b64cf-08b8-4782-a08a-6088399d4763`: 10/10 sources, 29 объектов созданы и проанализированы, `undervalued=2`, pipeline без errors; digest подтвердил `Email sent: 2 hot + 27 regular`.
- ✅ После каждого deploy PM2 logs очищены по явной команде пользователя; API health `204`, frontend `200`, все 16 процессов online.
- ⚠️ Server-local diagnostics/lockfile изменения сохранены нетронутыми: `package-lock.json`, `check-pipeline*.js`, `clear-queue.js`, `fix-sources.js`, тестовые scripts и broken symlink.

## Session handoff (v1.1.71 — run-scoped parser telemetry)
**Сделано 16 июля 2026:**
- ✅ Добавлены `parser_runs` и `parser_run_sources`: immutable `run_id` и `identity_key = runId:sourceSlug:stage`; source-stage создаётся до enqueue, затем получает точный numeric SQLite Queue `job_id`.
- ✅ Lifecycle: `queued → running → terminal`. Worker отправляет running/terminal snapshot через service-token protected internal aliases; контроллер валидирует allowlist, exact counters и ownership job ID.
- ✅ После `waitForJobs()` SQLite Queue terminal state authoritative: queue failure/cancellation исправляет преждевременный worker success.
- ✅ Документация: `docs/run-scoped-parser-telemetry.md`; tests 87/87 + API/shared/Strapi builds passed.
- ✅ PR #31 merged (`b1bcf7d`), production deploy v1.1.71 (`7ccc111`) successful; domains: API 204, frontend 200.
- ⚠️ Не запускали production pipeline специально: фактическая E2E telemetry verification остаётся отдельным действием, так как создаёт нагрузку и writes.

## Session handoff (v1.1.59 — page/context leak + cron simplification)
**Сделано в сессии 15 июля 2026 (Playwright page leak fix + cron rewrite):**
- ✅ **Playwright page/context leak** — v1.1.58 закрывал browser в finally, но каждый fetchDetails создавал page+context из browser без закрытия. На проде: 1545 pages+contexts → 198 zombie chrome → 7GB RAM → OOM. FIX: parse-handler создаёт `sharedContext` один раз для Phase 2, передаёт его парсерам. Каждый парсер: `page = await context.newPage()` → `finally { page.close() }`
- ✅ **sharedContext pattern** — parse-handler: `sharedBrowser.launch()` → `sharedContext = browser.newPage().context()` (или `browser.newContext()`). Парсеры получают context вместо browser. Standalone fallback: парсер создаёт свой browser+context и закрывает оба
- ✅ **6 парсеров обновлены** — alfalot, etprf, m-ets, fabrikant, roseltorg, aggregator-bankrot: fetchDetails принимает context, создаёт page, закрывает page в finally
- ✅ **Cron simplification** — удалено 10 per-source parse crons (Source.schedule), analyze cron (08:00), digest:morning cron. Один `pipeline:daily` — проверяет каждый час, запускается в digest_time, mode='full'. `rescheduleSource` = no-op. Оставлен `cleanup:old` (03:00)
- ✅ **583 тестов passing** — cron-registration.test.ts обновлён
- **Итого:** pending deploy. v1.1.59 (page leak fix + cron simplification)

### Playwright architecture (v1.1.59)
- parse-handler Phase 2: `sharedBrowser.launch()` → `sharedContext = await browser.newContext()` → передаётся в fetchDetails
- Каждый fetchDetails: `page = await context.newPage()` → работа → `finally { page.close() }`
- parse-handler finally: `await sharedContext.close()` → `await sharedBrowser.close()`
- Standalone mode (без sharedContext): парсер создаёт browser+context, закрывает оба в finally
- **Правило:** page.close() в finally каждого fetchDetails. context.close() в finally parse-handler. browser.close() в finally parse-handler.

## Session handoff (v1.1.58 — browser leak fix)
**Сделано в сессии 15 июля 2026 (Playwright memory leak + avtopoliv cleanup):**
- ✅ **Playwright zombie processes** — на aklab-prod (213) обнаружено 211 chrome-headless-shell процессов (6.1GB RSS из 7.4GB RAM). Причина: `sharedBrowser.close()` в parse-handler.ts был НЕ в finally блоке — при падении Phase 2 браузер не закрывался
- ✅ **parse-handler.ts fix** — `sharedBrowser.close()` перенесён в `finally` блок. Гарантированное закрытие при любом исключении
- ✅ **Chrome cleanup** — `pkill -9 -f chrome-headless-shell` → память 7.3G → 1.4G
- ✅ **avtopoliv-api удалён** — `pm2 delete avtopoliv-api` на s121, `pm2 save --force`. Известный баг path-to-regexp (241k рестартов). Остался только avtopoliv-front
- ✅ **v1.1.58 задеплоен** — deploy-prod.sh, все 16 сервисов online
- **Итого:** 1 коммит. v1.1.58 (browser leak fix)

### Playwright memory leak — архитектура
- `parse-handler.ts` Phase 2: один `chromium.launch()` на всю фазу
- `fetchDetails(url, sharedBrowser)` — парсеры принимают общий browser
- Fallback: если shared browser не запустился — каждый парсер свой
- **Критично:** browser.close() ВСЕГДА в finally — иначе zombie процессы растут после каждого pipeline run
- На проде 7.4GB RAM — 2-3 утечки и OOM

## Session handoff (v1.1.58)
**Сделано в сессии 14 июля 2026 (полный аудит парсеров):**
- ✅ **parse-handler fix** — `Object.assign(prop, details)` → мерждим только non-null/non-undefined. fetchDetails больше не перезаписывает Phase 1 данные undefined'ами
- ✅ **etprf fetchDetails переписан** — jQuery UI табы `#tabPage*` удалены с сайта. Новые селекторы: `.details-table` + `.td-label`/`.td-value`. Цена (210М), адрес, описание, contacts — всё извлекается
- ✅ **etprf address fix** — "Почтовый адрес" организатора (Ярославль) ≠ адрес объекта (Москва). Ищем адрес в описании имущества
- ✅ **alfalot regex fix** — `адрес` → `адрес\w*` для дательного падежа ("адресу:")
- ✅ **alfalot SPA hydration** — waitForSelector('.address, h3') вместо контейнера + пауза 1s
- ✅ **m-ets price fix** — `meta[itemprop="price"]` как primary (multi-lot страницы брали цену первого лота)
- ✅ **m-ets address regex** — расширен: "Адрес:", "местонахождение:", "по адресу:" + падежи
- ✅ **sberbank-ast stop word fix** — "на право заключения" убран из глобальных stop words (фильтровал 100% лотов)
- ✅ **Skill aklab-parsers обновлён** — детальные алгоритмы по всем 11 парсерам
- **Итого:** 3 коммита. v1.1.57→v1.1.58

### Fedresurs — архитектура
- Python клиент: `services/parser-fedresurs/src/fedresurs_client.py`
- TS парсер: `services/parser-fedresurs/src/sources/fedresurs.ts`
- Build: `tsc && cp src/fedresurs_client.py dist/sources/`
- Health: :1357
- Endpoints: `/backend/pledged-subjects` + `/backend/biddings` + `/backend/biddings/{guid}/lots`
- Фильтр: Москва + коммерческая недвижимость (client-side)

## Session handoff (v1.1.52)
**Сделано в сессии 13 июля 2026 (parser audit + city detection + focus engine):**
- ✅ **detectCity blacklist** — не-московские регионы (Дагестан, Башкортостан и т.д.) → return 'other' до проверки "Москва". +7 тестов
- ✅ **description убран из city fallback** — описание с детальных страниц содержало "Москва" в шаблонном тексте → ложные срабатывания
- ✅ **first_seen_at auto-set** — заполняется при создании объекта в createProperty. Focus rule "Новый объект" (score 10) теперь работает
- ✅ **minimum_price extraction** — fabrikant, aggregator-bankrot, alfalot, etprf теперь извлекают начальную цену торгов. Focus rule "Торги" (score 20) теперь работает
- ✅ **Torgi-gov SSL fix** — установлен Russian Trusted Root CA сертификат на prod сервере. API torgi.gov.ru теперь работает
- ✅ **Fabrikant keyword filter** — убраны generic keywords ('объект', 'имущество', 'актив') — парсер перестал ловить гвозди и балки
- ✅ **Roseltorg header filter** — фильтрация строк заголовков таблицы
- ✅ **Analyzer** — запущен для 10 объектов с NULL deviation, все 37 объектов теперь имеют deviation
- ✅ **Focus engine** — 4 объекта в фокусе (undervalued, score=50, deviation ~85%)
- **Итого:** 7 коммитов + SSL сертификат. v1.1.49→v1.1.52

### Парсеры — определение города

| Парсер | Источник | Надёжность |
|--------|----------|------------|
| investmoscow | hardcoded 'moscow' | 🟢 100% |
| invest-mosreg | hardcoded 'mo' | 🟢 100% |
| torgi-gov | API regionCode '77' | 🟢 API |
| m-ets | detectCity(title+region+desc) | 🟡 3 поля |
| alfalot | detectCity(card.region) | 🟡 поле |
| etprf | detectCity(row.subject) | 🟡 поле |
| sberbank-ast | detectCity(GeoDataAddress) | 🟡 XML |
| fabrikant | detectCity(title) + Moscow fallback | 🔴 regex |
| aggregator-bankrot | detectCity(excerpt) + Moscow fallback | 🔴 regex |
| roseltorg | detectCity(title+excerpt) + Moscow fallback | 🔴 regex |

### Проблемы найдены (не исправлены, низкий приоритет)
- Sberbank-ast: stop word "на право заключения" фильтрует все лоты (аренда, не продажа) — ожидаемое поведение
- Torgi-gov: API может вернуть 0 если нет опубликованных лотов в Москве
- Fabrikant: федеральная площадка, мало московских объектов
- Roseltorg: мало московских объектов на площадке

## Session handoff (v1.1.48)
**Сделано в сессии 13 июля 2026 (reject from list + deploy hardening):**
- ✅ **Быстрое отклонение из списка** — кнопка «Отклонить» на каждой карточке (без чекбокса) + столбец «Действия» в таблице
- ✅ **Отклонённые скрыты из фокуса** — `status != 'rejected'` в getFocusQuery (raw SQL)
- ✅ **deploy-dev.sh** — скрипт деплоя для dev (аналог deploy-prod.sh)
- ✅ **VITE_API_URL fix на dev** — .env содержал prod URL, фронт ходил на prod API
- ✅ **Правило: деплой ТОЛЬКО скриптами** — ручные SSH-команды приводят к пропуску шагов
- Gotcha: `pm2 update` при первом запуске deploy-prod.sh убивает SSH-сессию (daemon restart)
- Gotcha: localStorage фильтры (city, property_type) сохраняются и автоматически применяются — проверять первым делом при «мало объектов»

## Session handoff (v1.1.44)
**Сделано в сессии 7 июля 2026 (UI cleanup):**
- Убрана секция «Парсеры» с дашборда — лишний запрос `/sources`, виджет удалён
- `free_purpose` → «Св. назначения» (было «Свободного назначения») в typeLabel
- Тег `moscow_mo` (МСК/МО) скрыт из UI — город и так отображается отдельно
  - `HIDDEN_TAGS` массив в `useFocusTab.ts`, фильтрация в PropertyCard, PropertyTable, Dashboard
  - Focus engine по-прежнему генерирует тег для скоринга
- Rate limit увеличен до 6000 req/мин (v1.1.43)

## Session handoff (v1.0.37 -> следующая сессия)
**Сделано в сессии 7 июля 2026 (pipeline/analyzer/auth fixes):**
- Фильтры формы -> parseAll (P1) -- `parseAll()` принимает `filters` из формы ручного запуска.
  Раньше `PipelineService.run()` передавал filters только в `analyze()`, не в `parseAll()`.
  Парсеры всегда читали глобальные настройки из БД, игнорируя форму.
- Analyzer deviation fix (A1) -- отрицательная deviation не = undervalued.
  `isUndervalued = deviation > 0 && deviation >= threshold` (было `deviation >= threshold`).
- Analyzer deviation_percent fix (A2) -- всегда сохраняем реальную deviation.
  Было: `deviation_percent: isUndervalued ? deviation : 0` -- обнуляло для не-undervalued.
- auth:false на всех routes (B5) -- `market-references`, `sources`, `setting`, `cron-log`.
  API-токен не работает с `config: {}` в Strapi 5. Gotcha #62.
- Документация обновлена -- gotchas 62-64, sessions, compact-doc.

**Сделано в сессии 6 июля 2026 (v1.1.29 — planopus3: аудит -> реализация):**
- ✅ **Toast уведомления (U1,U2,U3)** — `console.warn`/`alert()`/silent catch → `useToast()` в 4 Vue файлах
- ✅ **Серверный поиск focus (U4)** — `search` param в getFocusQuery, debounce 300ms, client-side фильтр убран
- ✅ **Backend geocoding endpoint (U5)** — `GET /properties/:id/geocode` с кэшем в БД, клиентский Nominatim убран
- ✅ **CIAN commercial link (U6)** — `offer_type=commercial`, object_type офис/торговля/склад
- ✅ **tagLabel() formatter (U7)** — 10 переводов slug-тегов, применён в Dashboard
- ✅ **a11y lightbox (U8)** — keyboard (Esc/←/→), Teleport, role="dialog", aria-modal
- ✅ **a11y bulk bar (U9)** — role="toolbar", aria-live, aria-label на кнопках
- ✅ **useFocusParams composable (U11)** — buildFocusParams + buildAnalyzeBody, дедуп в 3 функциях
- ✅ **documentId скрыт из UI (U12)**
- ✅ **usePolling composable (U13)** — auto-cleanup на unmount, замена for-loop
- ✅ **getStats оптимизация (B3)** — 6→4 параллельных SQL-запроса
- ✅ **undervaluedCount fix (B4)** — limit:1 → db.query + length
- ✅ **Закрыты публичные endpoints (B1)** — /focus и /stats требуют JWT
- ✅ **578/578 тестов**, vue-tsc чисто, smoke test 26/26
- Gotcha: `resp.json()` → `unknown` в TS strict (gotcha #57), FocusFilters string/number (gotcha #58)
- Новые файлы: `composables/useFocusParams.ts`, `composables/usePolling.ts`

**Сделано в сессии 24 июня 2026 (v1.0.37 — миграция инфраструктуры):**
- ✅ **Новый prod-сервер** — 213.184.136.221:5733 (root, Ubuntu 26.04, nedvizhka, 15GB RAM)
- ✅ **Node v20.20.2 + PM2 7.0.1 + gh (ti-rudin)** — настроено на новом сервере
- ✅ **aklab клонирован и развёрнут** — 15 PM2 процессов online, Strapi health: 204
- ✅ **Traefik v2.10 (Docker)** — `/opt/traefik/docker-compose.yml`, ports 80/443/8080
- ✅ **Playwright chromium** установлен для парсеров
- ✅ **PM2 startup** — systemd service `pm2-rudin.service`
- ✅ **DNS** — aklab.tirobots.ru + api-aklab.tirobots.ru → 213.184.136.221
- ✅ **151 → dev** — Traefik на 131 обновлён (dev-домены), app/.env VITE_API_URL, CORS
- ✅ **aklab skill и compact-doc.md** обновлены

**✅ Инфраструктура полностью работает (25.06.2026):**
- Порты 80/443 открыты через pfSense NAT на провайдере
- Let's Encrypt сертификаты получены автоматически
- Frontend: `https://aklab.tirobots.ru/` → 200
- API health: `https://api-aklab.tirobots.ru/_health` → 204
- Admin: `https://api-aklab.tirobots.ru/admin` → 200

**Gotcha: Docker networking** — Traefik в контейнере не видит `127.0.0.1:port` хоста. В `dynamic.yml` нужно указывать приватный IP: `http://192.168.31.147:5174`.

**Gotchas миграции:**
- `api/` и `app/` — НЕ workspace-пакеты, нужен отдельный `npm install` в каждой
- `strapi build` (admin panel) занимает ~40с на новом сервере (vs ~140с на 151)
- `ecosystem.config.js` содержит PATH с версией Node — при смене версии обновить v20.20.2
- Seeder отработал при первом старте: admin@aklab.ti-soft.ru, 11 sources, 1 test user
- SQLite quoting в SSH+paramiko — проблема с экранированием, использовать Python-скрипт на сервере

**Сделано в сессии 2 июля 2026 (v1.0.53 — hotfix prod + deploy hardening):**
- ✅ **better-sqlite3 rebuild** — PM2 daemon работал на Node 20.20.2, приложения на Node 22.20.0. `npm rebuild better-sqlite3` на проде + перезапуск всех 15 процессов.
- ✅ **property_events.property_id** — колонка отсутствовала в SQLite (Strapi 5 manyToOne не создаёт FK автоматически). `ALTER TABLE` + индекс. Score endpoint заработал: 178 объектов, 23 в фокусе, 124 события.
- ✅ **PUT permission для authenticated** — добавлена `api::property.property.update` в `up_permissions` + link к роли authenticated (id=1).
- ✅ **API_TOKEN_SALT sync** — `.env` содержал соль `ElTI...`, PM2 daemon env — `EYJG...` (старое окружение). `access_key` в БД пересчитан через HMAC-SHA512. Strapi 5: hash = `crypto.createHmac('sha512', salt).update(token).digest('hex')`.
- ✅ **deploy-prod.sh hardened** — 4 новых проверки: PM2 daemon Node version (→ `pm2 update` + systemd), .env ↔ PM2 env sync, `npm rebuild better-sqlite3` (root + api + services), rebuild в rollback-блоке.
- ✅ **Sources health fix** — фронтенд отправлял числовой `id` вместо `documentId` → 400 ошибка. Пересобран frontend на проде.

**Сделано в сессии 2 июля 2026 (починка парсеров — 8/10 рабочих):**
- ✅ **apartment enum** — добавлен `apartment` в Strapi property_type schema. Квартиры парсятся.
- ✅ **isCommercialProperty** — COMMERCIAL_TYPES (office, warehouse, retail, production, free_purpose) → доверять парсеру.
- ✅ **torgi-gov price fix** — `priceMin`/`priceMax` (API v2) вместо `priceInfo.startPrice`.
- ✅ **sberbank-ast XML fix** — `_source` теги вместо `row`, `purchName`/`purchAmount`/`GeoDataAddress`/`Latitude`/`Longitude`.
- ✅ **investmoscow Nuxt fix** — coords валидация (Array.isArray + typeof number), `__NUXT_DATA__` парсинг объектов с startPrice+objectArea+address.
- ✅ **m-ets, invest-mosreg, investmoscow** — переписаны парсеры с нуля (JSON API / fetch / Nuxt SSR).
- ✅ **fabrikant/roseltorg ОТКЛЮЧЕНЫ** — fabrikant не содержит коммерческую недвижимость, roseltorg WAF блокирует.
- ✅ **Smart stop 3→10** — увеличен порог дублей подряд.
- ✅ **apartment в classifyPropertyType** — все 8 парсеров классифицируют квартиры.
- ✅ **БД очищена**, счётчики сброшены. 8 активных источников.
- ✅ **Anti-ban модуль** (`_shared/src/anti-ban.ts`) — `randomDelay(min, max)`, `getRandomUA()`, `createStealthContext(browser)` (рандомный UA, ru-RU locale), `retryGoto(page, url, maxAttempts)` с exponential backoff.
- ✅ **Глубина парсинга UI** — input «Глубина парсинга» (default 50, min 1, max 500) рядом с кнопкой «Ручной запуск» на `/settings`. Параметр `depth` передаётся в `POST /cron/parse/:slug`.
- ✅ **parse-handler рефактор** — `ParseOptions`/`ParseResult` типы, `createParseHandler(parser)` принимает `depth` из `job.data`, smart stop (3+ дубля подряд → break), depth limit (`created >= depth → break`), `randomDelay(500, 1500)` между `propertyExists` проверками.
- ✅ **10/10 парсеров рефакторены** — все принимают `parse(depth?: number)`, используют `createStealthContext`, `randomDelay`, `retryGoto`. Пагинация ограничена depth (`maxPages = Math.ceil(depth / ITEMS_PER_PAGE)`).
- ✅ **234/234 тестов** зелёные, `tsc --noEmit` чистый во всех 12+ сервисах.

**Сделано в сессии 11 июня 2026 (v1.0.36):**
- ✅ **Photo-fetcher cwd mismatch (v1.0.36)** — photo-fetcher писал фото в свой `data/photos/`, API читал из своего → 404. Фикс: handler.ts пишет в `../../api/data/photos/` (env override `PHOTOS_BASE_DIR`). 28 папок с фото перенесены на проде вручную.

**Сделано в сессии 10 июня 2026 (v1.0.28–v1.0.34):**
- ✅ **Страница «Документация»** (`/documentation`) — подробная архитектура: диаграмма, таблица сервисов с портами, карточки парсеров, поток данных, API endpoints, шаги деплоя, порядок сборки.
- ✅ **Footer** — "Changelog" → "История изменений", добавлена "Документация".
- ✅ **Ручной запуск пайплайна** — кнопка на `/settings`, поллинг очередей через `GET /api/cron/queue-stats` каждые 3с (без фиксированных таймаутов). Этапы: парсинг (6 мин) → анализ (3 мин) → дайджест (90 сек).
- ✅ **Мониторинг регионов** — `Setting.monitored_regions` (json, дефолт `["moscow","mo"]`). Дайджест фильтрует объекты по `city[$in]`. Мультиселект чекбоксов на `/settings`.
- ✅ **Test user credentials** — смена email с `test@aklab.ti-soft.ru` на `test@aklab.tirobots.ru`. Gotcha: username `test` конфликтует → нужно удалять старого юзера перед созданием нового.
- ✅ **Deploy script** — подтверждён как самодостаточный (строит всё: lib → _shared → api → app → 12 сервисов). Обновлена ошибка в aklab skill.
- ✅ **Параметры запуска (v1.0.33)** — collapsible панель на `/properties`: цена лота (от/до), город (Москва/МО/Другие), порог отсечения (1-99%, слайдер). Фильтры сохраняются в localStorage. Backend: `POST /cron/analyze` принимает `{ priceFrom, priceTo, city, threshold }`.
- ✅ **Дефолтные регионы** — `moscow + mo + other` (включая other). Раньше был только moscow + mo.
- ✅ **Результаты пайплайна (v1.0.33)** — подробные результаты: парсинг (источники + объекты + ошибки), анализ (по городам), дайджест (отправлен/пропущен).
- ✅ **Кнопка «Запустить ещё раз»** — теперь активна после завершения пайплайна (`pipelineStage === done`).
- ✅ **SMTP to fix (v1.0.34)** — `entityService.findMany` для singleton → `db.query.findOne({})`. Теперь digest шлёт на `Setting.smtp_to` (a@rudin.ru), а не на `config.smtp.user` (tirobots@yandex.ru).
- ✅ **Mobile-first UI** — кнопки `w-full sm:w-auto`, цена инпуты `grid-cols-1 sm:grid-cols-[1fr_auto_1fr]`, чекбоксы `grid-cols-3`, фильтры `grid-cols-2 sm:flex`, слайдер `min-w-0`.

**Что НЕ делать**:
- ❌ Не удалять `api/.tmp/data.db` повторно
- ❌ Не запускать миграции Strapi
- ❌ Не удалять routes файлы

**Следующие шаги**:
1. **Запустить пайплайн на проде** — БД пуста, счётчики сброшены. Запустить парсинг 8 источников через `/settings` → таб Дайджест → «Запуск парсинга».
2. **Проверить эталоны** — 18 записей market_references восстановлены на prod (с dev). Проверить актуальность цен.
3. **fedresurs** — обход Qrator (прокси/резидентный IP) — по запросу
4. **fabrikant** — если появятся коммерческие лоты, можно включить обратно
5. **roseltorg** — нужен прокси для обхода WAF

**Локальное состояние (25.06.2026):**
- `~/github.nosync/aklab` — ветка `main`, последний коммит `11fc709` (Merge PR #1: dev → main)
- Ветка `dev` — синхронизирована с main
- CI/CD: GitHub Actions (ci.yml, deploy-dev.yml, deploy-prod.yml)
- Scripts: deploy-prod.sh (--ci), generate-changelog-ai.js, notify-deploy.sh
- SSH ключ CI: `~/.ssh/aklab-ci`

**Сделано в сессии 5 июля 2026 (v1.0.104–v1.1.0 — pipeline resilience):**
- ✅ **SSE-based Pipeline Orchestrator** — `api/src/services/pipeline.ts` (568 строк), `pipeline-sse.ts`, 4 API endpoint (start/cancel/status/stream).
- ✅ **Pipeline State в БД** — `setting.pipeline_state` (JSON singleton), персистентный. SSE reconnect работает.
- ✅ **Cron → pipeline** — cron/auto-analyze/digest делегируют в `pipeline.run()`, нет дублирования кода.
- ✅ **Score + Analysis = один этап** — `scorePropertiesBatch` встроен в `analyzeAll`.
- ✅ **Error resilience** — ошибки не прерывают pipeline, копятся в `errors[]`.
- ✅ **Cancel button** — статус `cancelling`, graceful stop.
- ✅ **Singleton update fix** — Strapi 5 требует `documentId` в where clause для Setting update.
- ✅ **Счётчики details (v1.0.108–v1.0.110)** — прямой SET вместо additive, единая точка сброса, race condition устранена.
- ✅ **fetchDetails для fabrikant + roseltorg** — описание, контакты, фото.
- ✅ **Price filter** — `price_from`/`price_to` в Setting, фильтрует анализ (не парсинг).
- ✅ **classifyPropertyType DRY** — единая функция в `_shared/property-classifier.ts`.
- ✅ **propertyExists fail-closed** — non-OK → skip (не создавать дубликаты).
- ✅ **digest_enabled** — boolean в Setting, 3 уровня защиты.
- ✅ **236/236 тестов** зелёные.

## Известные баги / TODO

- **E2E тесты на проде — network isolation** — ~~dev-server (192.168.11.151) не может достучаться до `api-aklab.tirobots.ru` / `213.184.136.221` (connection timeout).~~ **РЕШЕНО:** `playwright.config.ts` поддерживает `BASE_URL` env — webServer не запускается, тесты идут напрямую на `https://aklab.tirobots.ru`. Запуск: `BASE_URL=https://aklab.tirobots.ru TEST_USER_PASSWORD='***' HEADLESS=true npx playwright test --project=chromium`.
- **5 skipped E2E тестов** — API smoke tests (section 9): 4 работают но skipped из-за rate limiter, 1 (settings endpoint) возвращает 404 (singleton).
- **Странный коммит `795fdbf "11"` в истории main** — пользовательский,
  squash не делал (force-push опасен). Можно пережить.
- В `deploy-prod.sh` строка ошибки `err "Strapi не поднялся за 30 секунд!"`
  устарела — реальный таймаут 180s, но текст говорит 30. Косметика.
- `trap rollback ERR` в deploy-prod.sh хрупкий — может не сработать при
  exit 1 из health check. Если deploy упал по health — проверить руками
  через `pm2 list` и `curl /_health`.
- `api/src/extensions/documentation/documentation/1.0.0/full_documentation.json`
  один раз попал в коммит, был untrack'нут, добавлен в .gitignore.
- **Seeder Setting дубли** — ИСПРАВЛЕНО (v1.0.20): `entityService.findMany`
  не находил записи из-за draft/published state → seeder создавал дубль
  при каждом bootstrap. Переписано на `db.query.findOne`.
- **Email-дайджест** — рабочий, но зависит от наличия недооценённых
  объектов. Если analyzer не нашёл `is_undervalued=true` — письмо не
  отправляется (это нормальное поведение).
- **Digest smtp_to fallback** — ИСПРАВЛЕНО (v1.0.25): `getSetting()` в cron controller использует `db.query.findOne` вместо `entityService.findMany`.
- **Parser handlers created++** — `createProperty` возвращает `null`
  для отфильтрованных объектов, но handlers не проверяют → `total_created`
  завышается. Косметика.
- **`[class*="cost"]` selector bug** — ИСПРАВЛЕНО (v1.0.26): generic parsers
  (m-ets, roseltorg, invest-mosreg, investmoscow) использовали `[class*="cost"]`
  для поиска цены, но это матчит `.cost-block` содержащий "Осталось: N дней".
  `parsePrice` склеивал все цифры → цена x100. Фикс: `.cost` (exact class).
- **aggregator-bankrot extractArea** — ИСПРАВЛЕНО (v1.0.26): regex брал
  площадь из excerpt (помещение 13 м²) вместо title (комплекс 9484 м²).
  Фикс: title-first приоритет + fallback regex + сотки (×100).
- **Analyzer false positives** — земельные участки и гаражи в регионах
  (267 ₽/м²) сравниваются с эталоном "other/other" = 65,200 ₽/м² → 99%
  deviation. Нужны реальные эталоны с разделением типов недвижимости.
- **Photo-fetcher cwd mismatch** — ИСПРАВЛЕНО (v1.0.36): photo-fetcher
  и API — разные PM2-процессы с разными cwd. `process.cwd()/data/photos/`
  в photo-fetcher ≠ то же в API → фото не отдавались (404). Фикс:
  handler.ts пишет в `../../api/data/photos/`.

## Полезные команды

```bash
# Smoke test
npm run smoke

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

**Сделано в сессии 3 июля 2026 (v1.0.76–v1.0.84 — fetchDetails, настройки, city detection):**
- ✅ **3-фазный парсинг** — parse-handler переписан: parse → existence check → fetchDetails + createProperty
- ✅ **fetchDetails progress UI** — `X/Y детальных` на `/properties`, needed=fixed, fetched=grows
- ✅ **resetSourceDetailsCounters** — счётчики обнуляются перед каждым запуском
- ✅ **queue-stats fix** — плоская структура (без двойной вложенности)
- ✅ **JWT_SECRET fix** — добавлен в `api/.env` на сервере
- ✅ **Response interceptor** — ловит 500 + "Forbidden" → редирект на /auth
- ✅ **clearNew feedback** — `alert()` с результатом
- ✅ **Автодеплой отключён** — workflow_dispatch only
- ✅ **Setting.parse_depth** — глубина парсинга по крону (UI на /settings, дефолт 20, макс 5000)
- ✅ **setting.update permission** — добавлено в seeder (authenticated роль)
- ✅ **detectCity shared** — общая функция в `_shared/src/city-detect.ts`, regex fix для «Москва-Кашира»
- ✅ **Таймаут парсинга 6→100 мин** — maxAttempts 120→2000
- ✅ **БД пересканирована** — 29 объектов исправлено (city detection)
- ✅ **depth=1000 тест** — 1961 объект, 3509 детальных, ~2.5 часа
- ✅ **234/234 тестов** зелёные

## Связанные документы

- `docs/plan1.md` — что делает продукт (бизнес-логика, источники данных)
- `docs/plan2.md` — план MVP (9 фаз)
- `docs/plan3.md` — план микросервисов парсеров (6 фаз)
- `docs/adding-source.md` — инструкция добавления нового источника
- `docs/setup-local.md` — пошаговая установка локально с нуля
- Глобальные правила (CLAUDE.md пользователя) — НЕ дублируются тут, см.
  родительский `~/.claude/CLAUDE.md`

---

## Инсайты из сессий

### 2026-07-05: Property types + DRY refactor (v1.0.99 → v1.0.102)

**Что произошло:** добавлены типы `apartment`/`land`, вынесена `classifyPropertyType` в shared, фильтрация по цене, рефакторинг 10 парсеров.

**Инсайты:**
1. **`replace_all` в Vue-файлах — ловушка.** Патч `option value="apartment"` с `replace_all=true` затронул селект «Город», а не «Тип недвижимости». Оба содержат одинаковые option'ы. **Правило:** в Vue с повторяющимися элементами — уникальный контекст вокруг патча.
2. **Build падает → deploy откатывается.** deploy-prod.sh проверяет health check. Если Vue build падает (невалидный HTML), deploy остаётся на предыдущей версии. Это хорошая защита, но нужно проверять build локально перед пушем.
3. **DRY для парсеров критичен.** 10 копий `classifyPropertyType` с расхождениями в логике (одни пропускали apartment, другие нет). Вынос в shared устранил inconsistency.
4. **Цена фильтрует анализ, не парсинг.** Пользователь ожидал что парсеры будут фильтровать по цене. Но бизнес-логика: парсим всё, фильтруем при анализе. Это правильно — данные нужны для истории.

### 2026-07-05: Dedup bug + digest toggle (v1.0.102+)

**Что произошло:** найден критический баг — 1241 дубликат из 3407 объектов (36%). Причина: `propertyExists()` при 500 от API возвращала `false` (не существует) вместо `true` (skip).

**Инсайты:**
1. **fail-closed vs fail-open.** `if (!res.ok) return false` — это fail-open (при ошибке считаем что НЕТ). Правильно: `return true` (при ошибке считаем что ЕСТЬ). Разница критична при нестабильном API.
2. **2 линии защиты.** `propertyExists` в parse-handler + `propertyExists` в `createProperty`. Если первая пропустит — вторая поймает.
3. **Порядок фильтров.** Быстрый фильтр (price_per_sqm) должен быть ДО API-вызовов (propertyExists). Экономит запросы.
4. **Дедуп скрипт.** `scripts/dedup-properties.js` — оставляет самый ранний объект в группе source+external_id, удаляет фото с диска.
5. **digest_enabled toggle.** 3 уровня защиты: cron, controller, handler. `data.digest_enabled !== false` (default true для обратной совместимости).

44. **resetSourceDetailsCounters: сбрасывать ВСЕ счётчики** — `total_found` и `total_created` должны обнуляться перед каждым парсингом иначе кумулятивные (6015 вместо 52). В v1.0.103 сбрасывались только `total_details_fetched/needed`. Исправлено в v1.0.104.
45. **Analyzer: объекты без эталона → analyzed=true** — если `MarketReference` не найден для city/property_type, объект помечается `is_undervalued: false, deviation_percent: 0` вместо `analyzed: false`. Без этого `analyzeProgress.done` никогда не достигается (зависание 48/77). v1.0.104.
46. **Pipeline: два поля «Глубина»** — на `/settings` есть ОТДЕЛЬНОЕ поле «Глубина парсинга (по расписанию)» (form.parse_depth, для cron) и поле «Глубина:» в секции ручного запуска (parseDepth, для pipeline). Они НЕ связаны. Пользователь может поменять одно и удивиться что другое не изменилось. Нужно синкать или убрать дублирование.
47. **fabrikant/roseltorg: fetchDetails** — добавлены в v1.0.105. Все 8 парсеров с HTML scraping теперь имеют fetchDetails. investmoscow/invest-mosreg — JSON API, им не нужно. fabrikant и roseltorg is_active=1 (включены в v1.1.12).
48. **roseltorg URL** — правильный URL: `/imuschestvo/nedvizhimost/kommercheskaya-nedvizhimost?sale=all&okato[]=45000000000&status[]=5&status[]=0&status[]=1` (Москва, коммерческая, активные). Раньше парсер пробовал случайные URL'ы (/lot-search, /search и т.д.) которые не существовали.
49. **fabrikant data-slot selectors** — карточки: `[data-slot="card"][data-id]`, title: `[data-slot="anchor"]`, цена: `[data-slot="text"]` содержащий "RUB", URL: `/procedure/search/sales` (вкладка "Продажи"), пагинация: `?page=N`.
50. **Focus endpoint: comma-separated property_type** — `GET /api/properties/focus?property_type=office,warehouse` поддерживает множественные типы через запятую → SQL `IN (?,?)`. Фронтенд передаёт массив как `join(',')`. v1.1.12.
51. **Фильтры мультиселект** — `filters.city` и `filters.property_type` в PropertyListView теперь `string[]` (были `string`). Strapi query builder использует `$in` вместо `$eq`. Composable `useFocusTab` тоже мигрирован. localStorage загрузка совместима со старым форматом (строка → массив). v1.1.12.

### 2026-07-05: Pipeline progress + analyzer fix (v1.0.104 → v1.0.106)

**Что произошло:** три бага в pipeline, fetchDetails для fabrikant/roseltorg, roseltorg URL.

**Инсайты:**
1. **cumulative total_created.** `resetSourceDetailsCounters` не сбрасывал `total_found/total_created`. Каждый парсинг прибавлял к старым значениям. 52 реальных объектов → 6015 в UI. Фикс: обнулять ВСЕ 4 поля.
2. **Analyzer hang 48/77.** 29 объектов (land/apartment) без MarketReference → `analyzed: false` → progress никогда не `done`. Фикс: `analyzed: true, is_undervalued: false`.
3. **Pipeline depth vs settings depth.** Два независимых поля «Глубина» — одно для cron, другое для ручного запуска. Пользователь менял одно, ожидал что второе применится.
4. **Парсеры без fetchDetails.** investmoscow/invest-mosreg не нужен (JSON API). fabrikant/roseltorg — просто не был реализован. Добавлен в v1.0.105.
5. **roseltorg URL guessing.** Парсер пробовал 5 случайных URL'ов вместо одного правильного. Всегда лучше один проверенный URL с фильтрами, чем угадывание.
