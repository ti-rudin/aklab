## Обзор

AKLAB — сервис мониторинга коммерческой недвижимости. Автоматически
находит объекты (офисы, склады, торговые помещения), цена которых
на 20%+ ниже рыночной. Данные собираются с площадок банкротств
и аукционов, анализируются на предмет заниженной стоимости, после
чего формируется email-дайджест с самыми привлекательными лотами.

## Архитектура

Монорепо с npm workspaces. Все сервисы запускаются через PM2 на одном
сервере. Межсервисная коммуникация — через SQLite-очередь задач.

<div class="arch-diagram">
  <div class="arch-layer">
    <div class="arch-label">Frontend</div>
    <div class="arch-box frontend"><strong>Vue 3 + Vite</strong> <span>:4173 (preview)</span></div>
  </div>
  <div class="arch-arrow">↕ REST API (JWT)</div>
  <div class="arch-layer">
    <div class="arch-label">Backend</div>
    <div class="arch-box backend"><strong>Strapi 5.46.1 + SQLite</strong> <span>:1338</span></div>
  </div>
  <div class="arch-arrow">↕ SQLite-очередь (queue.db)</div>
  <div class="arch-layer">
    <div class="arch-label">Микросервисы</div>
    <div class="arch-services">
      <div class="arch-box parser"><strong>parser-fabrikant</strong> <span>:1345</span></div>
      <div class="arch-box parser"><strong>parser-torgi-gov</strong> <span>:1346</span></div>
      <div class="arch-box parser"><strong>parser-aggregator-bankrot</strong> <span>:1348</span></div>
      <div class="arch-box parser"><strong>parser-alfalot</strong> <span>:1349</span></div>
      <div class="arch-box parser"><strong>parser-etprf</strong> <span>:1350</span></div>
      <div class="arch-box parser"><strong>parser-sberbank-ast</strong> <span>:1351</span></div>
      <div class="arch-box parser"><strong>parser-invest-mosreg</strong> <span>:1352</span></div>
      <div class="arch-box parser"><strong>parser-investmoscow</strong> <span>:1353</span></div>
      <div class="arch-box parser"><strong>parser-roseltorg</strong> <span>:1354</span></div>
      <div class="arch-box parser"><strong>parser-m-ets</strong> <span>:1355</span></div>
      <div class="arch-box parser"><strong>analyzer</strong> <span>:1341</span></div>
      <div class="arch-box parser"><strong>digest</strong> <span>:1342</span></div>
    </div>
  </div>
</div>

### Зависимости пакетов

<div class="dep-tree">
  <div class="dep-item"><code>@aklab/sqlite-queue</code> <span class="text-muted">— базовая очередь на SQLite</span></div>
  <div class="dep-item dep-child"><code>@aklab/service-shared</code> <span class="text-muted">— конфиг, логгер, health-server, queue-worker, Strapi-клиент</span></div>
  <div class="dep-item dep-child2">10 парсеров + analyzer + digest</div>
</div>

Strapi (api/) — отдельное приложение, не зависит от workspace-пакетов.

## Сервисы

<div class="service-table">
  <div class="service-row header"><span>Сервис</span><span>Порт</span><span>Очередь</span><span>Описание</span></div>
  <div class="service-row"><span class="mono">aklab-api</span><span class="mono">1338</span><span class="mono">—</span><span>Strapi 5 backend (REST API, admin panel, SQLite)</span></div>
  <div class="service-row"><span class="mono">aklab-app</span><span class="mono">4173</span><span class="mono">—</span><span>Vue 3 frontend (vite preview)</span></div>
  <div class="service-row"><span class="mono">parser-fabrikant</span><span class="mono">1345</span><span class="mono">parse-fabrikant</span><span>Playwright HTML scraping, data-slot selectors</span></div>
  <div class="service-row"><span class="mono">parser-torgi-gov</span><span class="mono">1346</span><span class="mono">parse-torgi-gov</span><span>Чистый JSON API, без браузера</span></div>
  <div class="service-row"><span class="mono">parser-aggregator-bankrot</span><span class="mono">1348</span><span class="mono">parse-aggregator-bankrot</span><span>Fetch JSON API</span></div>
  <div class="service-row"><span class="mono">parser-alfalot</span><span class="mono">1349</span><span class="mono">parse-alfalot</span><span>Playwright SPA (ecosystem.alfalot.ru)</span></div>
  <div class="service-row"><span class="mono">parser-etprf</span><span class="mono">1350</span><span class="mono">parse-etprf</span><span>Playwright AJAX (sale.etprf.ru)</span></div>
  <div class="service-row"><span class="mono">parser-sberbank-ast</span><span class="mono">1351</span><span class="mono">parse-sberbank-ast</span><span>Playwright AJAX (utp.sberbank-ast.ru)</span></div>
  <div class="service-row"><span class="mono">parser-invest-mosreg</span><span class="mono">1352</span><span class="mono">parse-invest-mosreg</span><span>Fetch JSON API (/aapi/map/places)</span></div>
  <div class="service-row"><span class="mono">parser-investmoscow</span><span class="mono">1353</span><span class="mono">parse-investmoscow</span><span>Fetch + Nuxt SSR (__NUXT_DATA__)</span></div>
  <div class="service-row"><span class="mono">parser-roseltorg</span><span class="mono">1354</span><span class="mono">parse-roseltorg</span><span>Playwright SPA (is_active=0)</span></div>
  <div class="service-row"><span class="mono">parser-m-ets</span><span class="mono">1355</span><span class="mono">parse-m-ets</span><span>Playwright SPA</span></div>
  <div class="service-row"><span class="mono">analyzer</span><span class="mono">1341</span><span class="mono">analyze-property</span><span>Сравнение Property vs MarketReference</span></div>
  <div class="service-row"><span class="mono">digest</span><span class="mono">1342</span><span class="mono">digest-send</span><span>Email-дайджест через SMTP (nodemailer)</span></div>
</div>

## Поток данных

<div class="flow-steps">
  <div class="flow-step">
    <span class="flow-num">1</span>
    <div>
      <h3>Парсинг</h3>
      <p>Cron (или ручной запуск) ставит задачу в очередь <code>parse-&lt;slug&gt;</code>. Парсер забирает задачу, открывает сайт через Playwright (или делает HTTP-запрос), извлекает карточки объектов. Каждый объект проходит фильтр: обязательны цена и площадь (для расчёта ₽/м²). Дубликаты по <code>(source, external_id)</code> отбрасываются. Результат сохраняется в Strapi → таблица <code>properties</code>.</p>
    </div>
  </div>
  <div class="flow-step">
    <span class="flow-num">2</span>
    <div>
      <h3>Анализ</h3>
      <p>Ежедневно в 08:00 МСК (или вручную из Настроек) анализатор сравнивает новые объекты с рыночными эталонами (<code>market-references</code>). Эталон — справочная цена ₽/м² для конкретного города и типа недвижимости. Если отклонение превышает порог (по умолчанию 20%), объект помечается как <code>is_undervalued = true</code>.</p>
    </div>
  </div>
  <div class="flow-step">
    <span class="flow-num">3</span>
    <div>
      <h3>Дайджест</h3>
      <p>Утром (по расписанию из настроек) дайджест-сервис собирает топ-100 объектов из фокуса (по <code>focus_score</code>, threshold ≥ 20), фильтрует по регионам и цене, отправляет email через SMTP. Разделение: 🔥 Горячее (score ≥ 50) и 📋 Обычное (20–49). Если объектов нет — письмо не отправляется.</p>
    </div>
  </div>
</div>

## Парсеры

Каждый парсер — отдельный микросервис с собственным Playwright-браузером
(или HTTP-клиентом). Все используют `createParseHandler()`
из `@aklab/service-shared` — типовой обработчик очереди.

<div class="parser-cards">
  <div class="parser-card"><div class="parser-name">Fabrikant.ru</div><div class="parser-meta"><span class="parser-type">Playwright HTML</span><span class="parser-status inactive">Отключён</span></div><p class="parser-desc">Аукционы банкротств. Data-slot selectors, пагинация ?page=N. Отключён — нет коммерческой недвижимости.</p></div>
  <div class="parser-card"><div class="parser-name">Торги.Гов</div><div class="parser-meta"><span class="parser-type">JSON API</span><span class="parser-status active">Активен</span></div><p class="parser-desc">Государственные торги. Чистый REST API без браузера.</p></div>
  <div class="parser-card"><div class="parser-name">Агрегатор банкротств</div><div class="parser-meta"><span class="parser-type">JSON API</span><span class="parser-status active">Активен</span></div><p class="parser-desc">Агрегатор лотов. Fetch JSON API.</p></div>
  <div class="parser-card"><div class="parser-name">АльфаЛот</div><div class="parser-meta"><span class="parser-type">Playwright SPA</span><span class="parser-status active">Активен</span></div><p class="parser-desc">Экосистема аукционов alfalot.ru.</p></div>
  <div class="parser-card"><div class="parser-name">ЕТПРФ</div><div class="parser-meta"><span class="parser-type">Playwright AJAX</span><span class="parser-status active">Активен</span></div><p class="parser-desc">Электронная торговая площадка sale.etprf.ru.</p></div>
  <div class="parser-card"><div class="parser-name">Сбербанк-АСТ</div><div class="parser-meta"><span class="parser-type">Playwright AJAX</span><span class="parser-status active">Активен</span></div><p class="parser-desc">Торговая площадка Сбербанка.</p></div>
  <div class="parser-card"><div class="parser-name">ИнвестМосРег</div><div class="parser-meta"><span class="parser-type">JSON API</span><span class="parser-status active">Активен</span></div><p class="parser-desc">Инвестиционные площадки МО. Fetch JSON API.</p></div>
  <div class="parser-card"><div class="parser-name">ИнвестМосква</div><div class="parser-meta"><span class="parser-type">Nuxt SSR</span><span class="parser-status active">Активен</span></div><p class="parser-desc">Инвестиционные площадки Москвы. Fetch + __NUXT_DATA__.</p></div>
  <div class="parser-card"><div class="parser-name">Росэлторг</div><div class="parser-meta"><span class="parser-type">Playwright generic</span><span class="parser-status inactive">Отключён</span></div><p class="parser-desc">Электронные торги roseltorg.ru. Отключён — WAF блокирует.</p></div>
  <div class="parser-card"><div class="parser-name">М-ЕТС</div><div class="parser-meta"><span class="parser-type">Playwright SPA</span><span class="parser-status active">Активен</span></div><p class="parser-desc">Межрегиональная электронная торговая система.</p></div>
  <div class="parser-card"><div class="parser-name">Федресурс</div><div class="parser-meta"><span class="parser-type">Playwright</span><span class="parser-status inactive">Отключён</span></div><p class="parser-desc">Отключён — Qrator anti-bot блокирует все подходы.</p></div>
</div>

## Пайплайн

Единый оркестратор для парсинга, анализа и дайджеста. Все вызовы
(UI, cron, API) проходят через `pipeline.ts`. Прогресс
транслируется через SSE в реальном времени.

<div class="flow-steps">
  <div class="flow-step">
    <span class="flow-num">1</span>
    <div>
      <h3>Парсинг (scan + details)</h3>
      <p>Парсинг списка объектов (<code>parsing_scan</code>) → загрузка детальных страниц (<code>parsing_details</code>). Прогресс: <code>X/Y детальных</code>, счётчики обновляются через SSE.</p>
    </div>
  </div>
  <div class="flow-step">
    <span class="flow-num">2</span>
    <div>
      <h3>Анализ + Score</h3>
      <p>Сравнение с эталонами → <code>deviation_percent</code>, <code>is_undervalued</code>. Сразу применяются focus-rules → <code>focus_score</code>, <code>tags</code>. Один этап (раньше были отдельно).</p>
    </div>
  </div>
  <div class="flow-step">
    <span class="flow-num">3</span>
    <div>
      <h3>Дайджест</h3>
      <p>Email-дайджест с <code>is_undervalued</code> объектами за сутки. Пропускается если нет новых объектов или дайджест отключен.</p>
    </div>
  </div>
</div>

### Особенности

- **SSE** — реалтайм прогресс через EventSource (не polling)
- **Idempotency** — один pipeline одновременно
- **Error resilience** — ошибки не прерывают pipeline
- **Cancel** — кнопка «Отменить» в UI
- **Pipeline State** — персистентное состояние в БД, reconnect при refresh
- **Bulk counter reset** — счётчики всех источников сбрасываются ДО enqueue (v1.1.5)

## API

Strapi 5 REST API. Все endpoints (кроме auth) требуют JWT-токен.
Для программного доступа (парсеры, кроны) используется `STRAPI_API_TOKEN`.

<div class="api-table">
  <div class="api-row header"><span>Метод</span><span>Путь</span><span>Описание</span></div>
  <div class="api-row"><span class="mono get">GET</span><span class="mono">/api/properties</span><span>Список объектов (фильтры, пагинация)</span></div>
  <div class="api-row"><span class="mono get">GET</span><span class="mono">/api/properties/:documentId</span><span>Детали объекта</span></div>
  <div class="api-row"><span class="mono get">GET</span><span class="mono">/api/sources</span><span>Список источников</span></div>
  <div class="api-row"><span class="mono get">GET</span><span class="mono">/api/sources/:id/health</span><span>Health check парсера (прокси)</span></div>
  <div class="api-row"><span class="mono get">GET</span><span class="mono">/api/market-references</span><span>Рыночные эталоны</span></div>
  <div class="api-row"><span class="mono get">GET</span><span class="mono">/api/setting</span><span>Настройки (singleton)</span></div>
  <div class="api-row"><span class="mono put">PUT</span><span class="mono">/api/setting/:documentId</span><span>Обновить настройки</span></div>
  <div class="api-row"><span class="mono post">POST</span><span class="mono">/api/cron/parse/:slug</span><span>Ручной запуск парсера</span></div>
  <div class="api-row"><span class="mono post">POST</span><span class="mono">/api/cron/analyze</span><span>Ручной запуск анализатора</span></div>
  <div class="api-row"><span class="mono post">POST</span><span class="mono">/api/cron/digest</span><span>Ручной запуск дайджеста</span></div>
  <div class="api-row"><span class="mono get">GET</span><span class="mono">/api/cron/queue-stats</span><span>Статистика очередей задач</span></div>
  <div class="api-row"><span class="mono post">POST</span><span class="mono">/api/pipeline/start</span><span>Запуск полного пайплайна (SSE)</span></div>
  <div class="api-row"><span class="mono get">GET</span><span class="mono">/api/pipeline/status</span><span>Текущее состояние пайплайна</span></div>
  <div class="api-row"><span class="mono post">POST</span><span class="mono">/api/pipeline/cancel</span><span>Отмена выполняющегося пайплайна</span></div>
  <div class="api-row"><span class="mono get">GET</span><span class="mono">/api/pipeline/stream</span><span>SSE stream прогресса (EventSource)</span></div>
</div>

## Деплой

Деплой выполняется скриптом `scripts/deploy-prod.sh`.
Скрипт полностью автономный — не требует предварительной ручной сборки.

<div class="deploy-steps">
  <div class="deploy-step"><span class="deploy-num">1</span><div><strong>Git pull</strong><p>Загрузка последних изменений из origin/main</p></div></div>
  <div class="deploy-step"><span class="deploy-num">2</span><div><strong>Bump version</strong><p>Инкремент patch-версии (1.0.X)</p></div></div>
  <div class="deploy-step"><span class="deploy-num">3</span><div><strong>Pre-flight</strong><p>Проверка переменных окружения и места на диске (≥512 МБ)</p></div></div>
  <div class="deploy-step"><span class="deploy-num">4</span><div><strong>DB backup</strong><p>Бэкап SQLite через sqlite3 .backup (или cp)</p></div></div>
  <div class="deploy-step"><span class="deploy-num">5</span><div><strong>npm install</strong><p>Установка зависимостей (если изменился package-lock.json)</p></div></div>
  <div class="deploy-step"><span class="deploy-num">6</span><div><strong>Build</strong><p>Последовательная сборка: sqlite-queue → _shared → api → app → 12 сервисов</p></div></div>
  <div class="deploy-step"><span class="deploy-num">7</span><div><strong>PM2 restart</strong><p>Остановка и запуск всех 14 процессов</p></div></div>
  <div class="deploy-step"><span class="deploy-num">8</span><div><strong>Health check</strong><p>Проверка /_health Strapi (до 3 мин) + health-эндпоинты сервисов</p></div></div>
  <div class="deploy-step"><span class="deploy-num">9</span><div><strong>Changelog</strong><p>Генерация из git-коммитов, копирование в dist/</p></div></div>
  <div class="deploy-step"><span class="deploy-num">10</span><div><strong>Git commit</strong><p>Релизный коммит + push в origin/main</p></div></div>
</div>

### Порядок сборки

<div class="build-order">
  <code>@aklab/sqlite-queue</code> → <code>@aklab/service-shared</code> →
  <code>api (Strapi)</code> + <code>app (Vue)</code> →
  <code>12 микросервисов</code>
</div>

Парсеры зависят от service-shared, поэтому _shared собирается первым.
Strapi и Vue независимы друг от друга и от микросервисов.

## Разделы интерфейса

<ul class="doc-links">
  <li><a href="/properties"><span class="link-icon">📋</span><div><strong>Объекты</strong><span class="text-muted"> — найденные объекты с ценами, фильтрация по статусу и городу</span></div></a></li>
  <li><a href="/sources"><span class="link-icon">🔗</span><div><strong>Источники</strong><span class="text-muted"> — площадки, расписание парсинга, health-статусы</span></div></a></li>
  <li><a href="/market-references"><span class="link-icon">📊</span><div><strong>Рыночные эталоны</strong><span class="text-muted"> — справочные цены ₽/м² по городам и типам недвижимости</span></div></a></li>
  <li><a href="/settings"><span class="link-icon">⚙️</span><div><strong>Настройки</strong><span class="text-muted"> — порог анализа, email, расписание, ручной запуск пайплайна</span></div></a></li>
  <li><a href="/changelog"><span class="link-icon">📝</span><div><strong>История изменений</strong><span class="text-muted"> — что нового в каждом релизе</span></div></a></li>
</ul>
