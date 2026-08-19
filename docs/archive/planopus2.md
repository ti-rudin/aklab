# Аудит проекта AKLAB — 2 (рекомендации и план работ)

> Дата аудита: 06.07.2026 (v1.1.26). Повторный аудит по исходному коду
> (api/, app/, services/, lib/, scripts/, config/, docs/).
> Это продолжение `docs/planopus.md` (аудит v1.1.13). Здесь: (а) что из
> прошлого плана уже сделано, (б) новые находки на текущем состоянии кода.

## Как читать этот документ

Сначала — сводка выполненного с прошлого аудита (чтобы не повторять уже
закрытые пункты). Затем — новые находки по областям с приоритетами
(P0 — критично/безопасность, P1 — важно, P2 — желательно). В конце —
приоритизированный чеклист.

---

## 0. Что уже сделано с прошлого аудита (v1.1.13 → v1.1.26)

Прошлый план (`planopus.md`) в значительной мере закрыт. Проверено по коду:

| Из planopus.md | Статус | Подтверждение в коде |
|---|---|---|
| P0 `safeEval` без `new Function()` | ✅ Сделано | `focusEngine.ts` — recursive-descent parser (строки 33-182), eval/Function отсутствуют |
| P0 raw SQL интерполяция в batch update | ✅ Сделано | `scorePropertiesBatch` использует `db.query().update()` / `entityService.create()` |
| P1 дублирование `buildParseRules` | ✅ Сделано | `parseRules.ts` — re-export из `@aklab/parse-rules`, единый источник |
| P1 общий `queue-worker` | ✅ Сделано | `_shared/src/queue-worker.ts` + `parse-handler.ts` — общий код для всех парсеров |
| P1 тонкий controller (`getFocus` → service) | ✅ Сделано | `property/controllers/property.ts` 115 строк, SQL в `services/property.ts` |
| P1 `.nvmrc` + `engines.node` | ✅ Сделано | `engines.node >=22` в root package.json |
| P1 Playwright унифицирован, start-скрипты | ✅ Сделано | все парсеры на `^1.60.0`, у всех 10 есть `start` |
| P1 `PropertyListView` разбит | ✅ Сделано | 1118 → 145 строк, табы вынесены в компоненты |
| P2 `pipeline.ts` разбит на модули | ✅ Сделано | `pipeline/{state,stages,index}.ts` |
| P2 единый манифест сервисов | ✅ Сделано | `services/services.json` |
| P2 `DocumentationView` в markdown | 🟡 Частично | 850 → 490 строк (не 120, как в compact-doc — расхождение) |
| P2 `gotchas.md` вынесен | ✅ Сделано | `docs/gotchas.md`, `docs/sessions.md` |
| P2 тесты composables | 🟡 Частично | `usePropertyData`, `useFocusTab`, `useTheme` покрыты; `usePropertyFilters` — нет |

**Вывод:** обе P0-находки прошлого аудита (безопасность) закрыты. Проект
заметно вырос в зрелости. Ниже — то, что осталось и появилось нового.

---

## 1. Мёртвый код и дублирование во frontend (НОВОЕ, P1)

**P1. Три view-компонента не подключены к роутеру — мёртвый код (~1050 строк).**
`app/src/router/index.ts` содержит только 8 маршрутов (Dashboard, Auth,
PropertyList, PropertyDetail, Settings, Changelog, Documentation, NotFound).
При этом в `app/src/views/` лежат неиспользуемые файлы:
- `SourceListView.vue` (476 строк) — заменён на `SourcesPanel.vue` (таб Настроек)
- `MarketReferencesView.vue` (304 строки) — заменён на `MarketReferencesPanel.vue`
- `RulesView.vue` (269 строк) — заменён на `RulesPanel.vue`

Это классический след рефакторинга «отдельные страницы → табы Настроек»
(отражён в compact-doc): панели созданы, а старые view забыли удалить.
Риск: путаница при навигации по коду, случайные правки не того файла,
рассинхронизация логики (панель и view могут разойтись).
**Рекомендация:** удалить три файла + их тесты/импорты, если есть.
Проверить `grep -r "SourceListView\|MarketReferencesView\|RulesView" app/src`
перед удалением.

**P2. Логика запуска pipeline дублируется между компонентами.**
`ParseLaunchPanel.vue` (253) и `SettingsView.vue` (584, таб «Дайджест»)
реализуют один и тот же сценарий: старт pipeline (`POST /pipeline/start`),
подписка на SSE (`/pipeline/stream`), отмена, отображение прогресса.
Согласно compact-doc — «3 триггера в UI для одного pipeline».
**Рекомендация:** вынести в composable `usePipeline.ts` (единая точка:
подключение SSE с reconnect, start/cancel, реактивный state), которым
пользуются оба места. Это уберёт риск, что один триггер починят, а
другой — нет, и сократит `SettingsView.vue`.

---

## 2. Производительность (НОВОЕ, P1/P2)

**P1. `scorePropertiesBatch` называется «batch», но это N+1.**
`focusEngine.ts` (строки 397-419): комментарий гласит «Batch update…
(параметризованные запросы)», но фактически внутри цикла по 200 записям
идут **по одному** запросу на каждую запись:
```js
for (const u of updates) {
  await s.db.query('api::property.property').update({ where: { id: u.id }, ... });
}
for (const evt of allEvents) {
  await s.entityService.create('api::property-event.property-event', { ... });
}
```
При тысячах объектов (parse_depth до 5000) это тысячи последовательных
`await`-запросов к SQLite — минуты работы и блокировка. Безопасность уже
исправлена (нет raw SQL), но производительность просела.
**Рекомендация:** (а) оборачивать пачку в транзакцию
(`strapi.db.transaction`), чтобы не было fsync на каждую строку;
(б) для событий — пропускать создание, если `events` пуст (сейчас так и
есть), но батчить `createMany` где возможно; (в) не создавать
`property-event` для каждого пересчёта score, если тег не изменился
(это генерит лишние записи при регулярном re-score).

**P2. `randomDelay(500-1500ms)` на КАЖДУЮ проверку существования.**
`parse-handler.ts` (строки 61-63): перед каждым `propertyExists()` стоит
антибан-задержка 0.5-1.5с. Но `propertyExists` бьёт в **собственный**
Strapi API (localhost), а не в сайт-источник — антибан там не нужен.
При depth=5000 это добавляет ~1с × 5000 = **до 1.5 часов** чистого
ожидания на пустом месте.
**Рекомендация:** убрать `randomDelay` из фазы existence-check (2a),
оставить только в фазе fetchDetails (2b, строка 115), где реально идёт
запрос на внешний сайт. Existence-check к своему API можно гонять без
пауз (или с минимальным батч-запросом «какие external_id уже есть»).

**P2. `getFocusQuery` — сырой SQL в обход ORM + тройное дублирование фильтров.**
Логика построения фильтров `city`/`property_type`/`price` реализована
трижды и по-разному:
- `services/property.ts` `getFocusQuery` — вручную собранный SQL-строкой
  (`SELECT * FROM properties WHERE ... ORDER BY ...`), с ручным маппингом
  всех полей строки в объект (строки 117-138);
- `focusEngine.ts` `scorePropertiesBatch` — через ORM `where` (`$in`, `$gte`);
- `cron.ts` `analyzeAll` — снова через ORM `where`.
`getFocusQuery` параметризован (`?`) и `sortField` из whitelist
`ALLOWED_SORTS` — SQL-инъекции нет. Но ручной маппинг 20 полей хрупкий
(добавили колонку в схему → забыли в маппинге), и три разных подхода к
одному и тому же — источник расхождений.
**Рекомендация:** по возможности перевести `getFocusQuery` на ORM
(`db.query().findMany` + `count`) — Strapi умеет `$in`, сортировку,
пагинацию; фильтр по тегам (`LIKE '%"tag"%"'`) вынести в отдельный
хелпер. Если raw SQL оставить ради производительности — извлечь общий
`buildPropertyWhere(filters)` и переиспользовать во всех трёх местах.

---

## 3. Backend: дрейф логики cron ↔ pipeline (P1/P2)

**P1. `cron/controllers/cron.ts` (265 строк) держит параллельный путь анализа.**
compact-doc заявляет: «Cron → pipeline: cron делегируют в `pipeline.run()`,
нет копипасты». Но `cron.ts` `analyzeAll` (строки 56-134) **напрямую**
строит фильтры, делает force-reset и раскидывает `analyze-property` в
очередь — минуя `PipelineService`. Аналогично `scoreProperties`
дергает `scorePropertiesBatch` напрямую. Это тот самый «параллельный
путь», о риске которого предупреждал прошлый аудит (planopus #P2 backend).
Пока UI-триггеры и cron идут через pipeline, а эти ручки — исторические
manual-эндпоинты, они могут дать другой результат (другая фильтрация,
другой порядок стадий).
**Рекомендация:** проверить, какие из ручек `cron.ts` реально
используются фронтом (`grep` по `app/src` на `/cron/analyze`, `/cron/score`,
`/cron/parse`). Неиспользуемые — удалить. Используемые (например,
`analyzeProgress`, `queueStats`) оставить как read-only, а мутирующие
(`analyzeAll`, `sendDigest`) переключить на `pipeline.run()`/делегаты,
чтобы был один путь.

**P2. `PipelineService.acquireLock` — не атомарен (гонка).**
`pipeline/index.ts` (строки 51-67): между `getState()` (read) и
`updateState({status:'running'})` (write) есть `await`. Два одновременных
`run()` теоретически оба прочитают `idle` и оба захватят лок. В одном
Node-процессе при текущей нагрузке риск низкий (нет реального
параллелизма между этими await без внешнего триггера), но при добавлении
второго триггера или масштабировании — реальный баг двойного запуска.
**Рекомендация:** задокументировать инвариант «один процесс» либо
реализовать атомарный CAS-лок (условный UPDATE `WHERE status != 'running'`
и проверка `affectedRows`), а не read-then-write.

---

## 4. Тесты парсеров (P1, частично из прошлого плана)

**P1. Unit-тесты есть только у 4 из 10 парсеров.**
`__tests__/` присутствуют в: `aggregator-bankrot`, `alfalot`, `fabrikant`,
`torgi-gov`. Отсутствуют в: `etprf`, `invest-mosreg`, `investmoscow`,
`m-ets`, `roseltorg`, `sberbank-ast`. Прошлый аудит уже указывал на это;
работа начата (4/10), но не завершена. Парсинг живых сайтов — самый
нестабильный код (ломается при смене верстки источника).
**Рекомендация:** для оставшихся 6 добавить unit-тесты на чистые функции
извлечения (`extractPrice`, `extractArea`, детекция города/типа) на
сохранённых HTML/JSON-фикстурах (`__fixtures__/`), по образцу уже
покрытых парсеров. Не требует Playwright — только парс фикстуры.

---

## 5. Наблюдаемость (observability) — не сдвинулось с прошлого аудита (P1)

**P1. По-прежнему нет рантайм-алертинга и агрегации логов.**
`scripts/health-check.js` существует и проверяет все сервисы, но
запускается **только при деплое** — периодического мониторинга нет
(поиск по `scripts/*.js` на `cron|setInterval|alert` не нашёл планировщика).
Логи — только `pm2 logs` на каждом из 2 серверов. При инциденте (упал
парсер в 04:00) никто не узнает до утреннего дайджеста или ручной проверки.
**Рекомендация (минимальный шаг):** превратить `health-check.js` в
периодическую проверку — system cron каждые 5 мин или `node-cron` внутри
api-процесса — с отправкой алерта (email на `a@rudin.ru`, механизм уже
есть в `notify-deploy.sh`) при недоступности сервиса > N минут.
Следующий шаг (по стеку `.clinerules`) — self-hosted GlitchTip/Sentry на
существующей Docker/Traefik-инфраструктуре для error tracking.

---

## 6. Безопасность и конфигурация (P2)

**P2. Rate limiter не сконфигурирован явно.**
`api/config/middlewares.ts` содержит только стандартный набор Strapi
(logger, errors, security, cors, …) — **явного rate-limit middleware нет**.
Прошлый аудит и E2E-тесты упоминают «rate limiter» (5 skipped тестов) —
это встроенный лимит Strapi на `/auth/*`, не настраиваемый в конфиге.
**Рекомендация:** явно задокументировать/настроить rate limiting
(`strapi-plugin-rate-limit` или на уровне Traefik middleware — уже в
стеке) для публичных `/auth/local`, `/auth/forgot-password`. Сейчас это
неявная защита, всплывающая как побочный эффект в тестах.

**P2. CORS — жёсткий список origin (ок), но дублирует source-of-truth доменов.**
`middlewares.ts` перечисляет 6 origin вручную. Домены также фигурируют в
Traefik-конфиге и compact-doc. Не критично, но при смене домена — правка
в нескольких местах.
**Рекомендация:** вынести список разрешённых origin в env-переменную
(`CORS_ORIGINS`, split по запятой) — тогда prod/dev задают свой список
без правки кода.

---

## 7. Документация (P2)

**P2. `DocumentationView.vue` (490 строк) vs заявленные ~120.**
compact-doc утверждает, что DocumentationView сведён к «~120 строк Vue»
рендером markdown, но по факту файл — 490 строк. Либо контент не до конца
вынесен в `app/public/docs/`, либо документация устарела.
**Рекомендация:** проверить, весь ли контент рендерится из markdown;
дописать вынос оставшегося HTML в `.md`; обновить цифру в compact-doc.

**P2. Расхождение цифр в compact-doc с фактическим кодом.**
Пример выше (DocumentationView 120 vs 490). compact-doc — «живой документ»
и местами опережает/отстаёт от кода. Стоит при каждой сессии сверять
ключевые метрики (размеры файлов, число парсеров с тестами) или
генерировать часть цифр скриптом.

---

## 8. Прочее (технический долг, P2)

- **`seeders/index.ts` (491 строка)** — самый крупный файл в `api/src`.
  Смешивает seed admin / setting / sources / permissions / test-user.
  Разбить на `seeders/{settings,sources,permissions,admin}.ts` + `index.ts`.
- **Branch protection** — по compact-doc всё ещё нет ни на `main`, ни на
  `dev` (persist из прошлого аудита). Включить хотя бы запрет force-push +
  обязательный `ci.yml` перед merge в `main`.
- **SSE broadcast single-process** — `pipeline-sse.ts` работает в рамках
  одного Node-процесса. Пока Strapi — один инстанс, ок. Заложить в план
  роста: при масштабировании за Traefik LB — Redis pub/sub (уже в стеке
  `.clinerules`) для кросс-инстанс broadcast.
- **Redis / Node-RED из стека `.clinerules` не задействованы.** Не проблема
  для текущего масштаба, но Redis логично применить для: (а) кеша
  `getFocusQuery`/dashboard-статистики, (б) замены самодельного SSE,
  (в) очереди вместо/поверх SQLite при росте нагрузки.

---

## 9. Сводный план работ (приоритизированный чеклист)

### P0 — критично
_Нет открытых P0. Обе находки прошлого аудита (safeEval, raw SQL) закрыты._

### P1 — важно (ближайшие спринты)
- [ ] Удалить мёртвые view: `SourceListView.vue`, `MarketReferencesView.vue`,
      `RulesView.vue` (~1050 строк) + их тесты/импорты (раздел 1).
- [ ] `scorePropertiesBatch`: обернуть пачку в транзакцию, не плодить
      `property-event` при неизменных тегах (раздел 2).
- [ ] Убрать `randomDelay` из фазы existence-check в `parse-handler.ts`
      (осталось до 1.5ч простоя на глубоких прогонах) (раздел 2).
- [ ] Свести `cron.ts` `analyzeAll`/`sendDigest` на `pipeline.run()` или
      удалить неиспользуемые ручки — убрать параллельный путь (раздел 3).
- [ ] Добавить unit-тесты оставшимся 6 парсерам (etprf, invest-mosreg,
      investmoscow, m-ets, roseltorg, sberbank-ast) на фикстурах (раздел 4).
- [ ] Периодический health-check с алертом при простое сервиса (раздел 5).

### P2 — желательно (технический долг)
- [ ] Вынести логику запуска pipeline в composable `usePipeline.ts`,
      переиспользовать в `ParseLaunchPanel` и `SettingsView` (раздел 1).
- [ ] Извлечь общий `buildPropertyWhere(filters)` / перевести
      `getFocusQuery` на ORM — убрать тройное дублирование фильтров (раздел 2).
- [ ] Атомарный лок в `PipelineService.acquireLock` (CAS вместо
      read-then-write) либо явно задокументировать инвариант (раздел 3).
- [ ] Явно настроить/задокументировать rate limiting для `/auth/*` (раздел 6).
- [ ] Вынести CORS origin в env `CORS_ORIGINS` (раздел 6).
- [ ] Довести вынос `DocumentationView` в markdown, обновить цифры в
      compact-doc (раздел 7).
- [ ] Разбить `seeders/index.ts` (491 строка) на модули (раздел 8).
- [ ] Включить branch protection на `main` (запрет force-push + CI-gate).
- [ ] Тесты для `usePropertyFilters` composable (раздел 0, частично).
- [ ] Заложить Redis (кеш dashboard/focus, pub/sub для SSE) при росте.

---

## Итоговая оценка (обновлённая)

| Область | Было (v1.1.13) | Стало (v1.1.26) | Комментарий |
|---|---|---|---|
| Архитектура | 7/10 | 7.5/10 | pipeline разбит на модули, единый манифест сервисов |
| Безопасность | 6/10 | 8/10 | обе P0 закрыты (safeEval, raw SQL); осталась гигиена (rate-limit, CORS в env) |
| Backend (Strapi) | 7/10 | 7.5/10 | контроллеры тонкие; остался дрейф cron↔pipeline и N+1 в score |
| Парсер-сервисы | 6/10 | 7.5/10 | унифицированы deps/скрипты, общий queue-worker; тесты 4/10 |
| Frontend | 6.5/10 | 7/10 | PropertyListView разбит; остался мёртвый код и дубль pipeline-логики |
| Тестирование | 6.5/10 | 7/10 | +composables, +4 парсера; пробел в 6 парсерах |
| CI/CD | 6/10 | 6.5/10 | стабильно; branch protection всё ещё нет |
| Observability | 4/10 | 4/10 | без изменений — нет рантайм-алертинга |
| Документация | 8/10 | 8/10 | образцовая, но местами расходится с кодом |

**Общая оценка: 6.5/10 → ~7.2/10.** Проект закрыл оба критичных риска
безопасности и значительную часть техдолга из прошлого аудита. Главные
оставшиеся направления: (1) чистка мёртвого кода и дублей во frontend,
(2) производительность score/parse (N+1, лишние задержки), (3) единый
путь оркестрации (убрать параллельный analyze в cron), (4) наблюдаемость
(рантайм-алертинг), (5) дотесты 6 парсеров.
</content>
<parameter name="task_progress">- [x] Прочитать docs/compact-doc.md
- [x] Прочитать существующий planopus.md
- [x] Изучить структуру (api, app, services, lib)
- [x] Проанализировать код ключевых модулей
- [x] Выявить проблемы и антипаттерны
- [x] Сформировать рекомендации
- [x] Записать план работ в docs/planopus2.md