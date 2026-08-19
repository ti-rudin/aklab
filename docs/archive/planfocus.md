# План: "В фокусе" — модернизация AKLAB

> Рабочая ветка: `dev` (192.168.11.151)
> Цель: превратить AKLAB из "списка недооценённых объектов" в инструмент аналитика с scoring, тегами, правилами и дашбордом.

---

## Архитектурные решения

### Scoring вместо boolean

Сейчас `is_undervalued = true/false`. Заменяем на `focus_score: integer (0-100)` — взвешенная сумма критериев. "В фокусе" = `focus_score >= threshold` (настраивается).

| Критерий | Баллы | Тег | Источник |
|----------|-------|-----|----------|
| Недооценённость −20–30% | +30 | `undervalued` | analyzer (сравнение с MarketReference) |
| Недооценённость −30–50% | +50 | `undervalued` | analyzer |
| Недооценённость −50%+ | +70 | `undervalued` | analyzer |
| Минимальная цена (торги) | +20 | `has_minimum_price` | парсер (поле minimum_price) |
| Новый объект (< 24ч) | +10 | `new` | auto при создании |
| Большая площадь (> 500м²) | +5 | `large_area` | analyzer |
| Москва / МО | +5 | `moscow` / `mo` | analyzer (поле city) |

### Теги вместо флагов

`tags: json` (массив строк) вместо `is_undervalued: boolean`. Пример:
```json
["undervalued", "has_minimum_price", "new", "moscow"]
```

Фильтрация в SQLite: `json_each(tags)` или `LIKE '%"undervalued"%'`.

### Двухфазный analyzer

**Фаза 1 — Scoring** (автоматически после парсинга, по cron 08:00):
- Проходит по всем объектам с `status='new'`
- Считает `focus_score` по активным правилам
- Ставит теги
- Пишет event в `property_events`

**Фаза 2 — Selection** (по запросу, мгновенно):
- `GET /api/properties/focus?threshold=20&city=moscow&sort=-focus_score`
- SQL WHERE `focus_score >= threshold` + фильтры
- Отдаёт ранжированный список

### Event log

```
property_events:
  id          INTEGER PRIMARY KEY
  property_id INTEGER (FK → properties)
  event_type  TEXT (created | entered_focus | left_focus | score_changed | status_changed)
  old_value   TEXT (nullable)
  new_value   TEXT (nullable)
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
```

### Правила через UI

Content-type `focus_rule`:
```
name          TEXT (e.g. "Недооценённость −30%+")
condition     TEXT (e.g. "deviation_percent <= -30")
score         INTEGER (e.g. 50)
tag           TEXT (e.g. "undervalued")
is_active     BOOLEAN (default true)
priority      INTEGER (порядок вычисления)
```

Analyzer загружает активные правила → применяет к каждому объекту.

---

## Волны реализации

### Волна 1: Schema + Data (backend)

**1.1 — Новые поля в Property schema**
- [ ] `focus_score: integer` (default 0)
- [ ] `tags: json` (default [])
- [ ] `minimum_price: decimal` (nullable)
- [ ] `first_seen_at: datetime` (auto при создании)
- [ ] Индексы: `focus_score`, `tags` (json_each)

Файлы: `api/src/api/property/content-types/property/schema.json`

**1.2 — Content-type `focus_rule`**
- [ ] Schema: name, condition, score, tag, is_active, priority
- [ ] Routes + controller + service (CRUD)
- [ ] Seeder: дефолтные правила (из таблицы выше)

Файлы: `api/src/api/focus-rule/`

**1.3 — Content-type `property_event`**
- [ ] Schema: property_id (FK), event_type, old_value, new_value, created_at
- [ ] Routes: GET с фильтрами (property_id, event_type, date range)
- [ ] Не нужен seeder

Файлы: `api/src/api/property-event/`

**1.4 — Миграция существующих данных**
- [ ] Скрипт миграции: проставить `focus_score` и `tags` для существующих объектов
- [ ] `is_undervalued=true` → `focus_score=30`, `tags=["undervalued"]`
- [ ] `first_seen_at = createdAt` для существующих
- [ ] Запустить на dev, потом на prod

Файлы: `scripts/migrate-focus-fields.js`

**1.5 — Обновить парсеры: minimum_price**
- [ ] `_shared/src/parse-handler.ts` — добавить `minimum_price` в createProperty
- [ ] Парсеры которые дают минимальную цену: torgi-gov, fabrikant, alfalot, aggregator-bankrot
- [ ] Пока не извлекают → поле null, не блокирует

---

### Волна 2: Scoring Engine (backend)

**2.1 — Rule engine service**
- [ ] `api/src/services/focusEngine.ts`
- [ ] `scoreProperty(property, rules[])` → { score, tags, events }
- [ ] Загружает активные правила из `focus_rule`
- [ ] Применяет каждое правило: eval condition → добавляет score + tag
- [ ] Пишет events при изменении score/tags

**2.2 — Refactor analyzer: двухфазный**
- [ ] Фаза 1 (`scoreAll`): проход по `status='new'` → scoreProperty → обновить focus_score, tags
- [ ] Фаза 2 (выборка): SQL `WHERE focus_score >= threshold` + фильтры
- [ ] Endpoint: `POST /api/cron/score` (вместо `/api/cron/analyze`)
- [ ] Endpoint: `GET /api/properties/focus` (быстрая выборка)

Файлы: `services/analyzer/src/handler.ts`, `api/src/api/cron/controllers/cron.ts`

**2.3 — Обновить cron**
- [ ] `analyze:properties` → `score:properties` (08:00 МСК)
- [ ] Сохранить ручной триггер `POST /api/cron/score` с параметрами (threshold)

---

### Волна 3: Frontend — "В фокусе" + UI (frontend)

**3.1 — Разделить "Ручной запуск"**
- [ ] На `/sources`: кнопка "Запустить парсинг" (`POST /api/cron/parse-all`)
- [ ] На `/properties` (таб "В фокусе"): кнопка "Пересчитать" (`POST /api/cron/score`)
- [ ] Убрать монолитный пайплайн с `/properties`
- [ ] Прогресс парсинга — на странице "Источники"

**3.2 — Табы на `/properties`**
- [ ] Два таба: "Все объекты" | "В фокусе"
- [ ] "Все объекты" = текущий список (без изменений)
- [ ] "В фокусе" = `GET /api/properties/focus?threshold=N`
- [ ] Параметры: порог (ползунок), город, тип, цена

**3.3 — Scoring-столбцы и теги**
- [ ] В таблице "В фокусе": столбец "Скор" (кликаемый, сортировка)
- [ ] Цветовые бейджи по скору: 0-30 жёлтый, 30-50 оранжевый, 50+ красный
- [ ] Теги как цветные pills в строке: 🟡 undervalued, 🔵 has_minimum_price, 🟢 new
- [ ] В "Все объекты": столбец "Оценка" остаётся как есть (deviation_percent)

**3.4 — Фильтры "В фокусе"**
- [ ] Город (checkboxes: МСК, МО, Другие)
- [ ] Тип недвижимости (select)
- [ ] Цена (от/до)
- [ ] Площадь (от/до)
- [ ] Теги (multiselect: undervalued, has_minimum_price, new, ...)
- [ ] Порог скорa (ползунок 0-100, дефолт 20)
- [ ] Сохранение в localStorage

**3.5 — Сортировка (все столбцы)**
- [ ] Кликаемые заголовки: Название, Площадь, ₽/м², Скор, Дата
- [ ] Направление: asc/desc (клик переключает)
- [ ] Индикатор направления (↑/↓)

**3.6 — Bulk-операции**
- [ ] Чекбоксы в таблице (выделить все / по одному)
- [ ] Плавающая панель: "Выбрано: N · Просмотрено · Отклонён · Экспорт CSV"
- [ ] Endpoint: `PATCH /api/properties/bulk` { ids: [], status: 'viewed' }
- [ ] Горячая клавиша: Escape = снять выделение

**3.7 — Статистика "В фокусе"**
- [ ] Шапка: "В фокусе: N объектов · Средний скор: X · Новых за сегодня: Y"
- [ ] Мини-график: количество в фокусе за 7 дней (sparkline)

**3.8 — Цветовая индикация серьёзности**
- [ ] −20–30% → жёлтый 🟡
- [ ] −30–50% → оранжевый 🟠
- [ ] −50%+ → красный 🔴
- [ ] minimum_price → 🔵 синий "Торги"
- [ ] Применить в таблице и в карточке

**3.9 — Экспорт CSV**
- [ ] Кнопка "Экспорт" на "В фокусе"
- [ ] Колонки: название, адрес, город, тип, площадь, цена, ₽/м², скор, теги, ссылка
- [ ] Учёт текущих фильтров (экспортируется только видимое)
- [ ] `GET /api/properties/export?format=csv` или frontend-only (генерация из текущих данных)

---

### Волна 4: Dashboard + Правила UI (frontend + backend)

**4.1 — Dashboard на `/`**
- [ ] Сегодня: "N новых объектов, M в фокусе, средний скор X"
- [ ] Топ-5: самые горячие объекты (по скору) — карточки с фото
- [ ] Источники: статус парсеров (🟢/🔴), последний запуск
- [ ] Быстрые действия: "Запустить парсинг", "Пересчитать выборку"
- [ ] График: объекты в фокусе за 7 дней (chart.js или sparkline)

**4.2 — Правила "В фокусе" (страница `/rules`)**
- [ ] Список правил: название, условие, баллы, тег, вкл/выкл
- [ ] CRUD: создать, редактировать, удалить, включить/выключить
- [ ] Drag & drop для приоритета
- [ ] Валидация: условие должно быть валидным JS-выражением
- [ ] Тест: "Проверить на 10 случайных объектах" (preview результата)

**4.3 — Event log в карточке объекта**
- [ ] На `/properties/:id` — секция "История"
- [ ] Timeline: создан → вошёл в фокус → скор изменился → статус изменён
- [ ] Фильтр по типам событий

**4.4 — Умные email-уведомления**
- [ ] Дайджест: "3 новых объекта в фокусе (средний скор 45)"
- [ ] Порог: только объекты с `focus_score >= N` в дайджест
- [ ] Разделение: "горячее" (score 50+) и "обычное" (score 20-50)

---

## Зависимости между волнами

```
Волна 1 (Schema) → Волна 2 (Scoring) → Волна 3 (Frontend) → Волна 4 (Dashboard)
                                                            ↗
                                    Волна 1.5 (Парсеры) ----
```

- Волна 1 — foundation, ничего не ломает (новые поля nullable)
- Волна 2 — заменяет analyzer, нужно тестировать
- Волна 3 — frontend, можно делать инкрементально (3.1 → 3.2 → 3.3 → ...)
- Волна 4 — enhancement, не блокирует основной workflow

## Scope MVP vs потом

**MVP (Волна 1-3):**
- Scoring + теги в schema
- Двухфазный analyzer
- "В фокусе" таб + фильтры + сортировка
- Цветовые бейджи
- Разделение парсинг/анализ
- Bulk-операции
- CSV экспорт

**Потом (Волна 4):**
- Dashboard
- Правила через UI
- Event log в карточке
- Умные email-уведомления

## Технические риски

1. **SQLite JSON performance** — `json_each()` для фильтрации по тегам может быть медленным на 10k+ объектов. Mitigation: индексы, лимит результатов.
2. **Eval rule conditions** — `eval(condition)` в rule engine = XSS. Mitigation: whitelist операторов, sandbox (vm2 или собственный парсер).
3. **Миграция данных** — проставить focus_score для существующих объектов. Mitigation: dry-run на dev, бэкап перед prod.
4. **Breaking change** — `is_undervalued` используется в дайджесте и парсерах. Mitigation: оставить поле как deprecated, новый код работает через focus_score + tags.
