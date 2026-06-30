# AKLAB E2E Test Inventory

Source: `tests/e2e.spec.ts` (914 lines)
Generated: 2026-06-30

## Summary

| Section | Name | Tests | Skipped | Positive | Negative |
|---------|------|-------|---------|----------|----------|
| 1 | Авторизация | 5 | 0 | 3 | 2 |
| 2 | Список объектов — Все объекты | 10 | 0 | 10 | 0 |
| 3 | Таб "В фокусе" | 18 | 0 | 18 | 0 |
| 4 | Страница объекта (detail) | 6 | 0 | 6 | 0 |
| 5 | Страница Источники | 2 | 0 | 2 | 0 |
| 6 | Страница Настройки | 2 | 0 | 2 | 0 |
| 7 | Страница Эталоны стоимости | 2 | 0 | 2 | 0 |
| 8 | Навигация | 6 | 0 | 6 | 0 |
| 9 | API Smoke Tests | 10 | 5 | 5 | 5 |
| 10 | Волна 4 — Dashboard, Rules, Event Log | 10 | 0 | 10 | 0 |
| 11 | Граничные случаи | 5 | 0 | 0 | 5 |
| 12 | Регрессия — фильтр city | 5 | 0 | 5 | 0 |
| **Total** | | **81** | **5** | **69** | **17** |

---

## 1. Авторизация (Auth)

| # | Description | What it tests | Type | Skipped |
|---|-------------|---------------|------|---------|
| 1.1 | Страница логина загружается | Login page renders with email, password fields and submit button | Positive | No |
| 1.2 | Успешный логин → редирект на /properties | Valid credentials redirect to properties page | Positive | No |
| 1.3 | Неверные credentials → показ ошибки | Invalid credentials show error message | Negative | No |
| 1.4 | Неавторизованный → редирект на /auth | Unauthenticated access to /properties redirects to /auth | Negative | No |
| 1.5 | Кнопка "Выйти" → редирект на /auth | Logout button works and redirects to auth | Positive | No |

## 2. Список объектов — Все объекты (Properties List)

| # | Description | What it tests | Type | Skipped |
|---|-------------|---------------|------|---------|
| 2.1 | Таблица загружается с данными | Table or empty state is visible | Positive | No |
| 2.2 | Табы "Все объекты" и "В фокусе" видны | Both tabs are visible | Positive | No |
| 2.3 | Активный таб "Все объекты" по умолчанию | "All objects" tab is active by default | Positive | No |
| 2.4 | Кнопки "Ручной запуск" и "Очистить список" видны | Action buttons are visible | Positive | No |
| 2.5 | Фильтры видны (город, статус, источник, тип) | Filter labels are present | Positive | No |
| 2.6 | Фильтр по городу (Москва) | City filter works without breaking page | Positive | No |
| 2.7 | Кнопка "Сбросить" фильтры | Reset filters button works | Positive | No |
| 2.8 | Клик по строке таблицы → переход на detail | Row click navigates to detail page | Positive | No |
| 2.9 | Сортировка по колонке (Площадь) | Column sorting (Area) toggles direction | Positive | No |
| 2.10 | Параметры запуска — раскрытие/сворачивание | Launch parameters panel expands showing price filters | Positive | No |

## 3. Таб "В фокусе" (Focus Tab)

| # | Description | What it tests | Type | Skipped |
|---|-------------|---------------|------|---------|
| 3.1 | Таб переключается на "В фокусе" | Focus tab switch shows threshold filters | Positive | No |
| 3.2 | Фильтр порога отображается | Threshold range slider is visible | Positive | No |
| 3.3 | Фильтр по городам (чекбоксы) | City checkboxes (Москва, МО) are visible | Positive | No |
| 3.4 | Focus таблица или пустое состояние | Focus table or empty state renders | Positive | No |
| 3.5 | Кнопка "Пересчитать" видна | Recalculate button is visible | Positive | No |
| 3.6 | Кнопка "CSV" экспорта видна | CSV export button is visible | Positive | No |
| 3.7 | Кнопка "Сбросить" фокус-фильтры | Reset focus filters works | Positive | No |
| 3.8 | Checkbox select — bulk actions появляются | Selecting rows shows bulk action bar (Просмотрено, Отклонён, CSV) | Positive | No |
| 3.9 | Сортировка по скору (клик по заголовку) | Score column sorting works | Positive | No |
| 3.10 | Клик по объекту → переход на detail | Click on focus row navigates to detail | Positive | No |
| 3.11 | Фильтр по тегам (мультиселект) | Tag multiselect filter works | Positive | No |
| 3.12 | Регрессия: снятие "Другие" → Москва/МО объекты всё ещё видны | Regression for comma-separated city bug | Positive | No |
| 3.13 | Выбрана только "Москва" → только moscow объекты | Single city filter (moscow only) | Positive | No |
| 3.14 | Все чекбоксы городов сняты → нет фильтра по городу | No city checkbox = no city filter (shows all) | Positive | No |
| 3.15 | Порог = 0 → максимум результатов | Threshold 0 shows maximum results | Positive | No |
| 3.16 | Порог = 100 → вероятно пустой список | Threshold 100 likely returns empty | Positive | No |
| 3.17 | Тип недвижимости + город → комбинация фильтров | Property type + city combined filter | Positive | No |
| 3.18 | Диапазон цены (от/до) | Price range (from/to) filter | Positive | No |

## 4. Страница объекта (Object Detail)

| # | Description | What it tests | Type | Skipped |
|---|-------------|---------------|------|---------|
| 4.1 | Detail страница загружается | Detail page loads with "К списку" button | Positive | No |
| 4.2 | Статус badge отображается | Status badge (Новый/В работе/Просмотрен/Отклонён) visible | Positive | No |
| 4.3 | Свойства объекта (grid) | Object properties grid (Адрес, Город, Площадь) | Positive | No |
| 4.4 | Кнопки действий (смена статуса) | Status change buttons (Новый, В работу, Просмотрено, Отклонено) | Positive | No |
| 4.5 | Секция комментариев | Comment section with input field | Positive | No |
| 4.6 | Кнопка "← К списку объектов" работает | Back to list button navigates to /properties | Positive | No |

## 5. Страница Источники (Sources)

| # | Description | What it tests | Type | Skipped |
|---|-------------|---------------|------|---------|
| 5.1 | Страница загружается | Sources page renders h1 | Positive | No |
| 5.2 | Список источников или пустое состояние | Source cards or empty state visible | Positive | No |

## 6. Страница Настройки (Settings)

| # | Description | What it tests | Type | Skipped |
|---|-------------|---------------|------|---------|
| 6.1 | Страница загружается | Settings page renders h1 | Positive | No |
| 6.2 | Форма настроек отображается | Settings form shows threshold, digest time, digest email | Positive | No |

## 7. Страница Эталоны стоимости (Market References)

| # | Description | What it tests | Type | Skipped |
|---|-------------|---------------|------|---------|
| 7.1 | Страница загружается | Market references page renders h1 | Positive | No |
| 7.2 | Форма добавления эталона | Add reference form (Город, Тип недвижимости, Цена за м²) | Positive | No |

## 8. Навигация (Navigation)

| # | Description | What it tests | Type | Skipped |
|---|-------------|---------------|------|---------|
| 8.1 | Навигация: Объекты | Nav link to Objects works | Positive | No |
| 8.2 | Навигация: Источники | Nav link to Sources works | Positive | No |
| 8.3 | Навигация: Эталоны | Nav link to Market References works | Positive | No |
| 8.4 | Навигация: Настройки | Nav link to Settings works | Positive | No |
| 8.5 | Логотип AKLAB → редирект на /properties | Logo click goes to properties | Positive | No |
| 8.6 | Переключение темы (тёмная/светлая) | Theme toggle doesn't break page | Positive | No |

## 9. API Smoke Tests

| # | Description | What it tests | Type | Skipped |
|---|-------------|---------------|------|---------|
| 9.1 | API health returns 204 | `/_health` returns 204 | Positive | No |
| 9.2 | API sources returns list | `GET /api/sources` returns non-empty list | Positive | No |
| 9.3 | API properties returns list | `GET /api/properties` returns paginated data | Positive | **Yes** |
| 9.4 | API focus endpoint works | `GET /api/properties/focus` returns data+meta | Positive | No |
| 9.5 | API queue-stats endpoint works | `GET /api/cron/queue-stats` returns ok+queues | Positive | No |
| 9.6 | API focus-rules endpoint works | `GET /api/focus-rules` returns data | Positive | **Yes** |
| 9.7 | API settings endpoint works | `GET /api/settings` returns data | Positive | **Yes** |
| 9.8 | API market-references endpoint works | `GET /api/market-references` returns data | Positive | **Yes** |
| 9.9 | API property-events endpoint works | `GET /api/property-events` returns data | Positive | **Yes** |
| 9.10 | API unauthorized → 401 | Unauthenticated API call returns ≥400 | Negative | No |

## 10. Волна 4 — Dashboard, Rules, Event Log (TODO — awaiting deploy)

### 10a. Dashboard

| # | Description | What it tests | Type | Skipped |
|---|-------------|---------------|------|---------|
| 10.1 | Dashboard loads after login | Dashboard page renders after login | Positive | No |
| 10.2 | Shows stats (new objects, focus count, avg score) | Stats cards visible | Positive | No |
| 10.3 | Shows top 5 objects | Top objects section visible | Positive | No |
| 10.4 | Shows sources status | Sources status section visible | Positive | No |
| 10.5 | Quick action buttons work | Quick action buttons visible | Positive | No |

### 10b. Rules page

| # | Description | What it tests | Type | Skipped |
|---|-------------|---------------|------|---------|
| 10.6 | Rules list loads | Rules page renders h1 | Positive | No |
| 10.7 | Can create new rule | Create rule button opens form | Positive | No |
| 10.8 | Can toggle rule active/inactive | Rule toggle switch works | Positive | No |
| 10.9 | Can delete rule | Delete rule button works with confirmation | Positive | No |

### 10c. Event Log on detail page

| # | Description | What it tests | Type | Skipped |
|---|-------------|---------------|------|---------|
| 10.10 | Event log section visible on detail page | Event log/history section shows on property detail | Positive | No |

## 11. Граничные случаи (Edge Cases & Resilience)

| # | Description | What it tests | Type | Skipped |
|---|-------------|---------------|------|---------|
| 11.1 | Несуществующий URL → 404 page | Unknown URL shows 404 page | Negative | No |
| 11.2 | Прямой переход на /properties без auth → редирект | Unauthenticated /properties redirects to /auth | Negative | No |
| 11.3 | Прямой переход на /sources без auth → редирект | Unauthenticated /sources redirects to /auth | Negative | No |
| 11.4 | Прямой переход на /settings без auth → редирект | Unauthenticated /settings redirects to /auth | Negative | No |
| 11.5 | Detail с несуществующим documentId → "не найден" | Invalid property ID shows not found | Negative | No |

## 12. Регрессия — фильтр city (запятые) (Regression — City filter)

| # | Description | What it tests | Type | Skipped |
|---|-------------|---------------|------|---------|
| 12.1 | GET /api/properties/focus?city=moscow,mo → возвращает результаты | Comma-separated city param splits correctly (IN clause) | Positive | No |
| 12.2 | GET /api/properties/focus?city=moscow → возвращает результаты | Single city param returns only that city | Positive | No |
| 12.3 | GET /api/properties/focus с невалидным threshold → корректная обработка | Invalid threshold (negative) doesn't crash (no 500) | Negative | No |
| 12.4 | GET /api/properties/focus с threshold=abc → корректная обработка | Non-numeric threshold doesn't crash (no 500) | Negative | No |
| 12.5 | GET /api/properties/focus с пустым city → все города | No city param returns all cities | Positive | No |

---

## Skipped Tests Detail

All 5 skipped tests use `test.skip()` and are in Section 9 (API Smoke Tests):
- **9.3** — properties endpoint (paginated list)
- **9.6** — focus-rules endpoint
- **9.7** — settings endpoint
- **9.8** — market-references endpoint
- **9.9** — property-events endpoint

These are likely skipped because the endpoints may not exist yet or return unexpected shapes on the deployed environment.

## Notes

- Many UI tests use conditional guards (`if (await ...isVisible().catch(() => false))`) — they pass silently when elements aren't found, which means they don't truly assert those features work when data is sparse.
- Section 10 tests are labeled "ожидает деплой" (awaiting deploy) — these test features not yet live.
- The `login()` helper retries up to 3 times with 3s delays, indicating flaky auth on the dev environment.
