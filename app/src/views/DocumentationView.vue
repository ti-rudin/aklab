<template>
  <div class="documentation-page">
    <header class="doc-header">
      <h1 style="color: var(--text-primary)">Документация</h1>
      <p style="color: var(--text-muted)">Архитектура и руководство по AKLAB</p>
    </header>

    <nav class="doc-toc">
      <h3 style="color: var(--text-muted)">Содержание</h3>
      <ul>
        <li><a href="#overview" style="color: var(--text-muted)">Обзор</a></li>
        <li><a href="#architecture" style="color: var(--text-muted)">Архитектура</a></li>
        <li><a href="#services" style="color: var(--text-muted)">Сервисы</a></li>
        <li><a href="#data-flow" style="color: var(--text-muted)">Поток данных</a></li>
        <li><a href="#parsers" style="color: var(--text-muted)">Парсеры</a></li>
        <li><a href="#pipeline" style="color: var(--text-muted)">Пайплайн</a></li>
        <li><a href="#api" style="color: var(--text-muted)">API</a></li>
        <li><a href="#deploy" style="color: var(--text-muted)">Деплой</a></li>
        <li><a href="#sections" style="color: var(--text-muted)">Разделы интерфейса</a></li>
      </ul>
    </nav>

    <div class="doc-content">

      <!-- Обзор -->
      <section id="overview" class="doc-section">
        <h2 style="color: var(--text-primary)">Обзор</h2>
        <p style="color: var(--text-secondary)">
          AKLAB — сервис мониторинга коммерческой недвижимости. Автоматически
          находит объекты (офисы, склады, торговые помещения), цена которых
          на 20%+ ниже рыночной. Данные собираются с площадок банкротств
          и аукционов, анализируются на предмет заниженной стоимости, после
          чего формируется email-дайджест с самыми привлекательными лотами.
        </p>
      </section>

      <!-- Архитектура -->
      <section id="architecture" class="doc-section">
        <h2 style="color: var(--text-primary)">Архитектура</h2>
        <p style="color: var(--text-secondary)" class="mb-4">
          Монорепо с npm workspaces. Все сервисы запускаются через PM2 на одном
          сервере. Межсервисная коммуникация — через SQLite-очередь задач.
        </p>

        <div class="arch-diagram">
          <div class="arch-layer">
            <div class="arch-label">Frontend</div>
            <div class="arch-box frontend">
              <strong>Vue 3 + Vite</strong>
              <span>:4173 (preview)</span>
            </div>
          </div>
          <div class="arch-arrow">↕ REST API (JWT)</div>
          <div class="arch-layer">
            <div class="arch-label">Backend</div>
            <div class="arch-box backend">
              <strong>Strapi 5.46.1 + SQLite</strong>
              <span>:1338</span>
            </div>
          </div>
          <div class="arch-arrow">↕ SQLite-очередь (queue.db)</div>
          <div class="arch-layer">
            <div class="arch-label">Микросервисы</div>
            <div class="arch-services">
              <div class="arch-box parser" v-for="svc in services" :key="svc.name">
                <strong>{{ svc.name }}</strong>
                <span>:{{ svc.port }}</span>
              </div>
            </div>
          </div>
        </div>

        <h3 class="mt-6 mb-2" style="color: var(--text-primary)">Зависимости пакетов</h3>
        <div class="dep-tree">
          <div class="dep-item"><code>@aklab/sqlite-queue</code> <span style="color: var(--text-muted)">— базовая очередь на SQLite</span></div>
          <div class="dep-item dep-child"><code>@aklab/service-shared</code> <span style="color: var(--text-muted)">— конфиг, логгер, health-server, queue-worker, Strapi-клиент</span></div>
          <div class="dep-item dep-child2">10 парсеров + analyzer + digest</div>
        </div>
        <p style="color: var(--text-secondary)" class="mt-2">
          Strapi (api/) — отдельное приложение, не зависит от workspace-пакетов.
        </p>
      </section>

      <!-- Сервисы -->
      <section id="services" class="doc-section">
        <h2 style="color: var(--text-primary)">Сервисы</h2>
        <div class="service-table">
          <div class="service-row header">
            <span>Сервис</span>
            <span>Порт</span>
            <span>Очередь</span>
            <span>Описание</span>
          </div>
          <div class="service-row" v-for="s in serviceTable" :key="s.name">
            <span class="mono">{{ s.name }}</span>
            <span class="mono">{{ s.port }}</span>
            <span class="mono">{{ s.queue }}</span>
            <span>{{ s.desc }}</span>
          </div>
        </div>
      </section>

      <!-- Поток данных -->
      <section id="data-flow" class="doc-section">
        <h2 style="color: var(--text-primary)">Поток данных</h2>
        <div class="flow-steps">
          <div class="flow-step">
            <span class="flow-num">1</span>
            <div>
              <h3 style="color: var(--text-primary)">Парсинг</h3>
              <p style="color: var(--text-secondary)">
                Cron (или ручной запуск) ставит задачу в очередь
                <code>parse-&lt;slug&gt;</code>. Парсер забирает задачу,
                открывает сайт через Playwright (или делает HTTP-запрос),
                извлекает карточки объектов. Каждый объект проходит фильтр:
                обязательны цена и площадь (для расчёта ₽/м²). Дубликаты
                по <code>(source, external_id)</code> отбрасываются.
                Результат сохраняется в Strapi → таблица <code>properties</code>.
              </p>
            </div>
          </div>
          <div class="flow-step">
            <span class="flow-num">2</span>
            <div>
              <h3 style="color: var(--text-primary)">Анализ</h3>
              <p style="color: var(--text-secondary)">
                Ежедневно в 08:00 МСК (или вручную из Настроек) анализатор сравнивает новые
                объекты с рыночными эталонами (<code>market-references</code>).
                Эталон — справочная цена ₽/м² для конкретного города и типа
                недвижимости. Если отклонение превышает порог (по умолчанию 20%),
                объект помечается как <code>is_undervalued = true</code>.
              </p>
            </div>
          </div>
          <div class="flow-step">
            <span class="flow-num">3</span>
            <div>
              <h3 style="color: var(--text-primary)">Дайджест</h3>
              <p style="color: var(--text-secondary)">
                Утром (по расписанию из настроек) дайджест-сервис собирает
                топ-100 объектов из фокуса (по <code>focus_score</code>,
                threshold ≥ 20), фильтрует по регионам и цене, отправляет
                email через SMTP. Разделение: 🔥 Горячее (score ≥ 50) и
                📋 Обычное (20–49). Если объектов нет — письмо не отправляется.
              </p>
            </div>
          </div>
        </div>
      </section>

      <!-- Парсеры -->
      <section id="parsers" class="doc-section">
        <h2 style="color: var(--text-primary)">Парсеры</h2>
        <p style="color: var(--text-secondary)" class="mb-4">
          Каждый парсер — отдельный микросервис с собственным Playwright-браузером
          (или HTTP-клиентом). Все используют <code>createParseHandler()</code>
          из <code>@aklab/service-shared</code> — типовой обработчик очереди.
        </p>

        <div class="parser-cards">
          <div class="parser-card" v-for="p in parsers" :key="p.slug">
            <div class="parser-name">{{ p.name }}</div>
            <div class="parser-meta">
              <span class="parser-type">{{ p.type }}</span>
              <span class="parser-status" :class="p.active ? 'active' : 'inactive'">
                {{ p.active ? 'Активен' : 'Отключён' }}
              </span>
            </div>
            <p class="parser-desc" style="color: var(--text-muted)">{{ p.desc }}</p>
          </div>
        </div>
      </section>

      <!-- Пайплайн -->
      <section id="pipeline" class="doc-section">
        <h2 style="color: var(--text-primary)">Пайплайн</h2>
        <p style="color: var(--text-secondary)" class="mb-4">
          Единый оркестратор для парсинга, анализа и дайджеста. Все вызовы
          (UI, cron, API) проходят через <code>pipeline.ts</code>. Прогресс
          транслируется через SSE в реальном времени.
        </p>

        <div class="flow-steps">
          <div class="flow-step">
            <span class="flow-num">1</span>
            <div>
              <h3 style="color: var(--text-primary)">Парсинг (scan + details)</h3>
              <p style="color: var(--text-secondary)">
                Парсинг списка объектов (<code>parsing_scan</code>) → загрузка
                детальных страниц (<code>parsing_details</code>). Прогресс:
                <code>X/Y детальных</code>, счётчики обновляются через SSE.
              </p>
            </div>
          </div>
          <div class="flow-step">
            <span class="flow-num">2</span>
            <div>
              <h3 style="color: var(--text-primary)">Анализ + Score</h3>
              <p style="color: var(--text-secondary)">
                Сравнение с эталонами → <code>deviation_percent</code>,
                <code>is_undervalued</code>. Сразу применяются focus-rules →
                <code>focus_score</code>, <code>tags</code>. Один этап
                (раньше были отдельно).
              </p>
            </div>
          </div>
          <div class="flow-step">
            <span class="flow-num">3</span>
            <div>
              <h3 style="color: var(--text-primary)">Дайджест</h3>
              <p style="color: var(--text-secondary)">
                Email-дайджест с <code>is_undervalued</code> объектами за сутки.
                Пропускается если нет новых объектов или дайджест отключен.
              </p>
            </div>
          </div>
        </div>

        <h3 class="mt-6 mb-2" style="color: var(--text-primary)">Особенности</h3>
        <ul style="color: var(--text-secondary); font-size: 0.85rem; line-height: 1.7; padding-left: 1.25rem;">
          <li><strong>SSE</strong> — реалтайм прогресс через EventSource (не polling)</li>
          <li><strong>Idempotency</strong> — один pipeline одновременно</li>
          <li><strong>Error resilience</strong> — ошибки не прерывают pipeline</li>
          <li><strong>Cancel</strong> — кнопка «Отменить» в UI</li>
          <li><strong>Pipeline State</strong> — персистентное состояние в БД, reconnect при refresh</li>
        </ul>
      </section>

      <!-- API -->
      <section id="api" class="doc-section">
        <h2 style="color: var(--text-primary)">API</h2>
        <p style="color: var(--text-secondary)" class="mb-4">
          Strapi 5 REST API. Все endpoints (кроме auth) требуют JWT-токен.
          Для программного доступа (парсеры, кроны) используется <code>STRAPI_API_TOKEN</code>.
        </p>

        <div class="api-table">
          <div class="api-row header">
            <span>Метод</span>
            <span>Путь</span>
            <span>Описание</span>
          </div>
          <div class="api-row" v-for="ep in endpoints" :key="ep.path">
            <span class="mono" :class="ep.method.toLowerCase()">{{ ep.method }}</span>
            <span class="mono">{{ ep.path }}</span>
            <span>{{ ep.desc }}</span>
          </div>
        </div>
      </section>

      <!-- Deploy -->
      <section id="deploy" class="doc-section">
        <h2 style="color: var(--text-primary)">Деплой</h2>
        <p style="color: var(--text-secondary)" class="mb-4">
          Деплой выполняется скриптом <code>scripts/deploy-prod.sh</code>.
          Скрипт полностью автономный — не требует предварительной ручной сборки.
        </p>

        <div class="deploy-steps">
          <div class="deploy-step" v-for="(step, i) in deploySteps" :key="i">
            <span class="deploy-num">{{ i + 1 }}</span>
            <div>
              <strong style="color: var(--text-primary)">{{ step.title }}</strong>
              <p style="color: var(--text-muted)">{{ step.desc }}</p>
            </div>
          </div>
        </div>

        <h3 class="mt-6 mb-2" style="color: var(--text-primary)">Порядок сборки</h3>
        <div class="build-order">
          <code>@aklab/sqlite-queue</code> → <code>@aklab/service-shared</code> →
          <code>api (Strapi)</code> + <code>app (Vue)</code> →
          <code>12 микросервисов</code>
        </div>
        <p style="color: var(--text-muted)" class="mt-2 text-xs">
          Парсеры зависят от service-shared, поэтому _shared собирается первым.
          Strapi и Vue независимы друг от друга и от микросервисов.
        </p>
      </section>

      <!-- Разделы -->
      <section id="sections" class="doc-section">
        <h2 style="color: var(--text-primary)">Разделы интерфейса</h2>
        <ul class="doc-links">
          <li>
            <router-link to="/properties">
              <span class="link-icon">📋</span>
              <div>
                <strong>Объекты</strong>
                <span style="color: var(--text-muted)">— найденные объекты с ценами, фильтрация по статусу и городу</span>
              </div>
            </router-link>
          </li>
          <li>
            <router-link to="/sources">
              <span class="link-icon">🔗</span>
              <div>
                <strong>Источники</strong>
                <span style="color: var(--text-muted)">— площадки, расписание парсинга, health-статусы</span>
              </div>
            </router-link>
          </li>
          <li>
            <router-link to="/market-references">
              <span class="link-icon">📊</span>
              <div>
                <strong>Рыночные эталоны</strong>
                <span style="color: var(--text-muted)">— справочные цены ₽/м² по городам и типам недвижимости</span>
              </div>
            </router-link>
          </li>
          <li>
            <router-link to="/settings">
              <span class="link-icon">⚙️</span>
              <div>
                <strong>Настройки</strong>
                <span style="color: var(--text-muted)">— порог анализа, email, расписание, ручной запуск пайплайна</span>
              </div>
            </router-link>
          </li>
          <li>
            <router-link to="/changelog">
              <span class="link-icon">📝</span>
              <div>
                <strong>История изменений</strong>
                <span style="color: var(--text-muted)">— что нового в каждом релизе</span>
              </div>
            </router-link>
          </li>
        </ul>
      </section>

    </div>
  </div>
</template>

<script setup lang="ts">
const services = [
  { name: 'parser-fabrikant', port: 1345 },
  { name: 'parser-torgi-gov', port: 1346 },
  { name: 'parser-aggregator-bankrot', port: 1348 },
  { name: 'parser-alfalot', port: 1349 },
  { name: 'parser-etprf', port: 1350 },
  { name: 'parser-sberbank-ast', port: 1351 },
  { name: 'parser-invest-mosreg', port: 1352 },
  { name: 'parser-investmoscow', port: 1353 },
  { name: 'parser-roseltorg', port: 1354 },
  { name: 'parser-m-ets', port: 1355 },
  { name: 'analyzer', port: 1341 },
  { name: 'digest', port: 1342 },
]

const serviceTable = [
  { name: 'aklab-api', port: '1338', queue: '—', desc: 'Strapi 5 backend (REST API, admin panel, SQLite)' },
  { name: 'aklab-app', port: '4173', queue: '—', desc: 'Vue 3 frontend (vite preview)' },
  { name: 'parser-fabrikant', port: '1345', queue: 'parse-fabrikant', desc: 'Playwright HTML scraping, data-slot selectors' },
  { name: 'parser-torgi-gov', port: '1346', queue: 'parse-torgi-gov', desc: 'Чистый JSON API, без браузера' },
  { name: 'parser-aggregator-bankrot', port: '1348', queue: 'parse-aggregator-bankrot', desc: 'Fetch JSON API' },
  { name: 'parser-alfalot', port: '1349', queue: 'parse-alfalot', desc: 'Playwright SPA (ecosystem.alfalot.ru)' },
  { name: 'parser-etprf', port: '1350', queue: 'parse-etprf', desc: 'Playwright AJAX (sale.etprf.ru)' },
  { name: 'parser-sberbank-ast', port: '1351', queue: 'parse-sberbank-ast', desc: 'Playwright AJAX (utp.sberbank-ast.ru)' },
  { name: 'parser-invest-mosreg', port: '1352', queue: 'parse-invest-mosreg', desc: 'Fetch JSON API (/aapi/map/places)' },
  { name: 'parser-investmoscow', port: '1353', queue: 'parse-investmoscow', desc: 'Fetch + Nuxt SSR (__NUXT_DATA__)' },
  { name: 'parser-roseltorg', port: '1354', queue: 'parse-roseltorg', desc: 'Playwright SPA (is_active=0)' },
  { name: 'parser-m-ets', port: '1355', queue: 'parse-m-ets', desc: 'Playwright SPA' },
  { name: 'analyzer', port: '1341', queue: 'analyze-property', desc: 'Сравнение Property vs MarketReference' },
  { name: 'digest', port: '1342', queue: 'digest-send', desc: 'Email-дайджест через SMTP (nodemailer)' },
]

const parsers = [
  { slug: 'fabrikant', name: 'Fabrikant.ru', type: 'Playwright HTML', active: false, desc: 'Аукционы банкротств. Data-slot selectors, пагинация ?page=N. Отключён — нет коммерческой недвижимости.' },
  { slug: 'torgi-gov', name: 'Торги.Гов', type: 'JSON API', active: true, desc: 'Государственные торги. Чистый REST API без браузера.' },
  { slug: 'aggregator-bankrot', name: 'Агрегатор банкротств', type: 'JSON API', active: true, desc: 'Агрегатор лотов. Fetch JSON API.' },
  { slug: 'alfalot', name: 'АльфаЛот', type: 'Playwright SPA', active: true, desc: 'Экосистема аукционов alfalot.ru.' },
  { slug: 'etprf', name: 'ЕТПРФ', type: 'Playwright AJAX', active: true, desc: 'Электронная торговая площадка sale.etprf.ru.' },
  { slug: 'sberbank-ast', name: 'Сбербанк-АСТ', type: 'Playwright AJAX', active: true, desc: 'Торговая площадка Сбербанка.' },
  { slug: 'invest-mosreg', name: 'ИнвестМосРег', type: 'JSON API', active: true, desc: 'Инвестиционные площадки МО. Fetch JSON API.' },
  { slug: 'investmoscow', name: 'ИнвестМосква', type: 'Nuxt SSR', active: true, desc: 'Инвестиционные площадки Москвы. Fetch + __NUXT_DATA__.' },
  { slug: 'roseltorg', name: 'Росэлторг', type: 'Playwright generic', active: false, desc: 'Электронные торги roseltorg.ru. Отключён — WAF блокирует.' },
  { slug: 'm-ets', name: 'М-ЕТС', type: 'Playwright SPA', active: true, desc: 'Межрегиональная электронная торговая система.' },
  { slug: 'fedresurs', name: 'Федресурс', type: 'Playwright', active: false, desc: 'Отключён — Qrator anti-bot блокирует все подходы.' },
]

const endpoints = [
  { method: 'GET', path: '/api/properties', desc: 'Список объектов (фильтры, пагинация)' },
  { method: 'GET', path: '/api/properties/:documentId', desc: 'Детали объекта' },
  { method: 'GET', path: '/api/sources', desc: 'Список источников' },
  { method: 'GET', path: '/api/sources/:id/health', desc: 'Health check парсера (прокси)' },
  { method: 'GET', path: '/api/market-references', desc: 'Рыночные эталоны' },
  { method: 'GET', path: '/api/setting', desc: 'Настройки (singleton)' },
  { method: 'PUT', path: '/api/setting/:documentId', desc: 'Обновить настройки' },
  { method: 'POST', path: '/api/cron/parse/:slug', desc: 'Ручной запуск парсера' },
  { method: 'POST', path: '/api/cron/analyze', desc: 'Ручной запуск анализатора' },
  { method: 'POST', path: '/api/cron/digest', desc: 'Ручной запуск дайджеста' },
  { method: 'GET', path: '/api/cron/queue-stats', desc: 'Статистика очередей задач' },
  { method: 'POST', path: '/api/pipeline/start', desc: 'Запуск полного пайплайна (SSE)' },
  { method: 'GET', path: '/api/pipeline/status', desc: 'Текущее состояние пайплайна' },
  { method: 'POST', path: '/api/pipeline/cancel', desc: 'Отмена выполняющегося пайплайна' },
  { method: 'GET', path: '/api/pipeline/stream', desc: 'SSE stream прогресса (EventSource)' },
]

const deploySteps = [
  { title: 'Git pull', desc: 'Загрузка последних изменений из origin/main' },
  { title: 'Bump version', desc: 'Инкремент patch-версии (1.0.X)' },
  { title: 'Pre-flight', desc: 'Проверка переменных окружения и места на диске (≥512 МБ)' },
  { title: 'DB backup', desc: 'Бэкап SQLite через sqlite3 .backup (или cp)' },
  { title: 'npm install', desc: 'Установка зависимостей (если изменился package-lock.json)' },
  { title: 'Build', desc: 'Последовательная сборка: sqlite-queue → _shared → api → app → 12 сервисов' },
  { title: 'PM2 restart', desc: 'Остановка и запуск всех 14 процессов' },
  { title: 'Health check', desc: 'Проверка /_health Strapi (до 3 мин) + health-эндпоинты сервисов' },
  { title: 'Changelog', desc: 'Генерация из git-коммитов, копирование в dist/' },
  { title: 'Git commit', desc: 'Релизный коммит + push в origin/main' },
]
</script>

<style scoped>
.documentation-page {
  max-width: 52rem;
  margin: 0 auto;
  padding: 2rem 1rem;
}

.doc-header {
  text-align: center;
  margin-bottom: 2rem;
}

.doc-header h1 {
  font-size: 1.75rem;
  font-weight: 700;
  margin-bottom: 0.5rem;
}

.doc-header p {
  font-size: 0.9rem;
}

/* TOC */
.doc-toc {
  margin-bottom: 2.5rem;
  padding: 1rem 1.25rem;
  border: 1px solid var(--border-subtle);
  border-radius: 0.5rem;
  background: var(--bg-elevated);
}

.doc-toc h3 {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 0.5rem;
}

.doc-toc ul {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 1.5rem;
}

.doc-toc a {
  text-decoration: none;
  font-size: 0.85rem;
}

.doc-toc a:hover {
  opacity: 0.7;
}

/* Sections */
.doc-content {
  display: flex;
  flex-direction: column;
  gap: 2.5rem;
}

.doc-section h2 {
  font-size: 1.25rem;
  font-weight: 600;
  margin-bottom: 1rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid var(--border-subtle);
}

.doc-section p {
  font-size: 0.9rem;
  line-height: 1.7;
}

.doc-section h3 {
  font-size: 1rem;
  font-weight: 600;
}

/* Architecture diagram */
.arch-diagram {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin: 1rem 0;
}

.arch-layer {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.arch-label {
  width: 6rem;
  flex-shrink: 0;
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
  text-align: right;
}

.arch-box {
  padding: 0.5rem 1rem;
  border-radius: 0.375rem;
  font-size: 0.85rem;
  border: 1px solid var(--border-subtle);
  background: var(--bg-elevated);
}

.arch-box strong {
  color: var(--text-primary);
}

.arch-box span {
  font-size: 0.75rem;
  color: var(--text-muted);
  margin-left: 0.5rem;
}

.arch-box.frontend { border-left: 3px solid #3b82f6; }
.arch-box.backend { border-left: 3px solid #059669; }
.arch-box.parser { border-left: 3px solid #d97706; font-size: 0.75rem; padding: 0.35rem 0.75rem; }

.arch-services {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.arch-arrow {
  text-align: center;
  font-size: 0.75rem;
  color: var(--text-muted);
  padding: 0.15rem 0;
}

/* Dependency tree */
.dep-tree {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.85rem;
}

.dep-item {
  padding: 0.35rem 0;
}

.dep-item code {
  font-size: 0.8rem;
  padding: 0.15rem 0.35rem;
  border-radius: 0.25rem;
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
}

.dep-child { padding-left: 1.5rem; }
.dep-child2 { padding-left: 3rem; font-size: 0.8rem; color: var(--text-muted); }

/* Service table */
.service-table {
  font-size: 0.8rem;
  border: 1px solid var(--border-subtle);
  border-radius: 0.5rem;
  overflow: hidden;
}

.service-row {
  display: grid;
  grid-template-columns: 10rem 3.5rem 11rem 1fr;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  align-items: center;
  border-bottom: 1px solid var(--border-subtle);
}

.service-row:last-child { border-bottom: none; }

.service-row.header {
  background: var(--bg-elevated);
  font-weight: 600;
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--text-muted);
}

.service-row .mono {
  font-family: monospace;
  font-size: 0.75rem;
}

/* Parser cards */
.parser-cards {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
}

.parser-card {
  padding: 0.75rem 1rem;
  border: 1px solid var(--border-subtle);
  border-radius: 0.5rem;
  background: var(--bg-elevated);
}

.parser-name {
  font-weight: 600;
  font-size: 0.9rem;
  color: var(--text-primary);
  margin-bottom: 0.25rem;
}

.parser-meta {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.parser-type {
  font-size: 0.7rem;
  padding: 0.1rem 0.4rem;
  border-radius: 0.25rem;
  background: #dbeafe;
  color: #3b82f6;
}

.parser-status {
  font-size: 0.7rem;
  padding: 0.1rem 0.4rem;
  border-radius: 0.25rem;
}

.parser-status.active { background: #d1fae5; color: #059669; }
.parser-status.inactive { background: #fee2e2; color: #dc2626; }

.parser-desc {
  font-size: 0.78rem;
  line-height: 1.4;
}

/* API table */
.api-table {
  font-size: 0.8rem;
  border: 1px solid var(--border-subtle);
  border-radius: 0.5rem;
  overflow: hidden;
}

.api-row {
  display: grid;
  grid-template-columns: 3.5rem 16rem 1fr;
  gap: 0.75rem;
  padding: 0.5rem 0.75rem;
  align-items: center;
  border-bottom: 1px solid var(--border-subtle);
}

.api-row:last-child { border-bottom: none; }

.api-row.header {
  background: var(--bg-elevated);
  font-weight: 600;
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--text-muted);
}

.api-row .mono {
  font-family: monospace;
  font-size: 0.75rem;
}

.api-row .get { color: #059669; }
.api-row .post { color: #3b82f6; }
.api-row .put { color: #d97706; }

/* Deploy steps */
.deploy-steps {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.deploy-step {
  display: flex;
  gap: 0.75rem;
  align-items: flex-start;
}

.deploy-num {
  flex-shrink: 0;
  width: 1.5rem;
  height: 1.5rem;
  border-radius: 50%;
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--text-muted);
  margin-top: 0.1rem;
}

.deploy-step strong {
  font-size: 0.85rem;
}

.deploy-step p {
  font-size: 0.78rem;
  margin-top: 0.1rem;
}

.build-order {
  font-family: monospace;
  font-size: 0.8rem;
  padding: 0.75rem 1rem;
  border: 1px solid var(--border-subtle);
  border-radius: 0.375rem;
  background: var(--bg-elevated);
  line-height: 1.8;
  color: var(--text-secondary);
}

/* Flow steps */
.flow-steps {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.flow-step {
  display: flex;
  gap: 1rem;
  align-items: flex-start;
}

.flow-num {
  flex-shrink: 0;
  width: 2rem;
  height: 2rem;
  border-radius: 50%;
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-muted);
  margin-top: 0.15rem;
}

.flow-step h3 {
  font-size: 0.95rem;
  font-weight: 600;
  margin-bottom: 0.25rem;
}

.flow-step p {
  font-size: 0.85rem;
  line-height: 1.5;
}

/* Links */
.doc-links {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.doc-links a {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  border: 1px solid var(--border-subtle);
  border-radius: 0.5rem;
  text-decoration: none;
  transition: all 0.15s;
  background: var(--bg-elevated);
}

.doc-links a:hover {
  border-color: var(--text-muted);
}

.doc-links strong {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--text-primary);
}

.doc-links span:not(.link-icon) {
  font-size: 0.8rem;
}

.link-icon {
  font-size: 1.25rem;
  flex-shrink: 0;
}

/* Responsive */
@media (max-width: 640px) {
  .parser-cards {
    grid-template-columns: 1fr;
  }
  .service-row {
    grid-template-columns: 1fr;
    gap: 0.15rem;
  }
  .service-row.header { display: none; }
  .api-row {
    grid-template-columns: 3rem 1fr;
  }
  .api-row span:last-child {
    grid-column: 1 / -1;
    font-size: 0.75rem;
    color: var(--text-muted);
  }
}
</style>
