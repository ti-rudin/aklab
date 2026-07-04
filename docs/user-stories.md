# AKLAB — User Stories

> Comprehensive user stories based on all Vue view files, UI elements, and interactions.
> Generated: 2026-06-30
> Updated: 2026-07-05

---

## Table of Contents

1. [Authentication (Auth.vue)](#1-authentication)
2. [App Layout & Navigation (App.vue, Footer.vue)](#2-app-layout--navigation)
3. [Dashboard (DashboardView.vue)](#3-dashboard)
4. [Property List — All Objects Tab (PropertyListView.vue)](#4-property-list--all-objects-tab)
5. [Property List — Focus Tab (PropertyListView.vue)](#5-property-list--focus-tab)
6. [Property Detail (PropertyDetailView.vue)](#6-property-detail)
7. [Sources (SourceListView.vue)](#7-sources)
8. [Market References (MarketReferencesView.vue)](#8-market-references)
9. [Settings (SettingsView.vue)](#9-settings)
10. [Focus Rules (RulesView.vue)](#10-focus-rules)
11. [Changelog (ChangelogView.vue)](#11-changelog)
12. [Documentation (DocumentationView.vue)](#12-documentation)
13. [404 Not Found (NotFoundView.vue)](#13-404-not-found)
14. [Routing & Guards (router/index.ts)](#14-routing--guards)

---

## 1. Authentication

### US-1.1: Login with email and password
As a **user**, I want to **log in with my email and password** so that **I can access the protected AKLAB dashboard**.

Acceptance criteria:
- Email input field (type=email, required, autocomplete=email)
- Password input field (type=password, required, autocomplete=current-password)
- "Войти" submit button with loading spinner state
- Error message displayed in red box on failed login
- On success, redirect to `/properties`
- Already-authenticated users redirect away from `/auth`

UI elements: `#email` input, `#password` input, "Войти" button, error alert box, AKLAB logo text

---

## 2. App Layout & Navigation

### US-2.1: Navigate between main sections
As an **authenticated user**, I want to **navigate between Dashboard, Properties, Rules, Sources, References, and Settings** so that **I can access all features of the application**.

Acceptance criteria:
- Sticky top navigation bar with glass effect
- Navigation links: Дашборд (`/`), Объекты (`/properties`), Правила (`/rules`), Источники (`/sources`), Эталоны (`/market-references`), Настройки (`/settings`)
- Active link highlighted with accent color and soft background
- AKLAB logo links to home page with gradient text (dark/light variants)
- Only shown when authenticated

UI elements: `<nav>` sticky header, 6 router-links, AKLAB logo link

### US-2.2: Mobile hamburger menu
As a **mobile user**, I want to **open a hamburger menu** so that **I can navigate the app on small screens**.

Acceptance criteria:
- Hamburger icon (☰) visible on screens < 640px (sm breakpoint)
- Clicking toggles mobile menu with slide-down animation
- Menu contains all nav items + "Выйти" button
- Menu closes automatically on route change
- Close icon (✕) shown when menu is open

UI elements: Hamburger button, mobile nav links, "Выйти" button in mobile menu

### US-2.3: Toggle dark/light theme
As a **user**, I want to **switch between dark and light themes** so that **I can use the app comfortably in different lighting conditions**.

Acceptance criteria:
- Sun icon button (in dark mode) / Moon icon button (in light mode)
- Theme persisted across sessions
- All UI elements adapt to theme via CSS variables

UI elements: Theme toggle button with sun/moon SVG icons

### US-2.4: Logout
As an **authenticated user**, I want to **log out of the application** so that **my session is ended and my data is protected**.

Acceptance criteria:
- "Выйти" button in desktop nav (hidden on mobile)
- "Выйти" button in mobile menu
- "Выйти" button on Settings page
- Clears auth state and redirects to `/`

UI elements: "Выйти" button (3 locations)

### US-2.5: View footer links
As a **user**, I want to **see footer navigation** so that **I can quickly access key sections and informational pages**.

Acceptance criteria:
- Two-column footer: "Продукт" and "AKLAB" sections
- Product links: Объекты, Источники, Рыночные эталоны, Настройки
- Info links: История изменений, Документация
- Copyright notice with current year

UI elements: Footer with 6 router-links, description text, copyright

---

## 3. Dashboard

### US-3.1: View summary statistics
As a **user**, I want to **see key statistics at a glance** so that **I can quickly understand the current state of monitored properties**.

Acceptance criteria:
- Three stat cards in a row: "Всего объектов", "Добавленные в фокус", "Средний скор"
- "Всего объектов" card is clickable — navigates to `/properties`
- "Добавленные в фокус" card is clickable — navigates to `/properties#focus`
- Skeleton loading placeholders while data loads
- Error message on failure

UI elements: 3 stat cards with label + large number, 2 clickable cards with navigation

### US-3.2: See hot (top) properties
As a **user**, I want to **see the top-5 highest-scored focus properties** so that **I can quickly identify the most promising opportunities**.

Acceptance criteria:
- "🔥 Горячие объекты" section title
- Up to 5 property cards with score badge, title, address/city, and tags (max 3)
- Score badge color-coded: red (≥70), amber (≥50), blue (<50)
- Clicking a property navigates to its detail page
- "Нет объектов в фокусе" shown when empty

UI elements: Property row cards with score badge, title, address, tag badges, clickable rows

### US-3.3: Run score recalculation
As a **user**, I want to **trigger a recalculation of property scores** so that **focus scores reflect the latest market data**.

Acceptance criteria:
- "🔄 Пересчитать выборку" button (outlined style)
- Loading state: "Запуск…"
- Disabled while any action is running
- Success message: "Скоринг запущен"

UI elements: "🔄 Пересчитать выборку" button

### US-3.4: View 7-day trend
As a **user**, I want to **see a 7-day trend of properties entering focus** so that **I can track momentum over time**.

Acceptance criteria:
- "📈 Тренд (7 дней)" section title
- Horizontal bar chart with date labels and count
- Bar width proportional to max count
- Data fetched with pageSize=5000 for comprehensive coverage
- "Нет данных" when empty

UI elements: Trend bar rows with date label, progress bar, count number

### US-3.5: Refresh dashboard
As a **user**, I want to **refresh all dashboard data** so that **I can see the latest information**.

Acceptance criteria:
- "↻ Обновить" button in header
- Disabled and shows "Загрузка…" while refreshing
- Fetches stats, top properties, and trend in parallel

UI elements: "↻ Обновить" button

---

## 4. Property List — All Objects Tab

### US-4.1: View all properties table
As a **user**, I want to **see all properties in a sortable table** so that **I can browse and compare available commercial properties**.

Acceptance criteria:
- Desktop: full table with columns: Название, Адрес, Город, Тип, Площадь, Цена, ₽/м², Статус, Оценка
- Mobile: card-based layout with same data
- Clicking a row navigates to property detail
- Loading skeleton while fetching
- "Нет объектов" when empty
- Total count shown in header ("N шт.")

UI elements: Data table (desktop), property cards (mobile), skeleton loader

### US-4.2: Sort property table columns
As a **user**, I want to **sort the table by area, price/m², or deviation** so that **I can find properties matching my criteria**.

Acceptance criteria:
- Sortable columns: Площадь, ₽/м², Оценка (deviation_percent)
- Click header to toggle asc/desc with arrow indicator (↑/↓)
- Resets to page 1 on sort change

UI elements: Clickable table headers with sort arrows

### US-4.3: Filter properties
As a **user**, I want to **filter properties by city, status, source, type, and undervalued flag** so that **I can narrow down the list to relevant properties**.

Acceptance criteria:
- City dropdown: Все, Москва, МО, Другой
- Status dropdown: Все, Новый, В работе, Просмотрен, Отклонён
- Source dropdown: Все (dynamically populated from known sources)
- Type dropdown: Все, Офис, Склад, Торговля, Производство, Св. назначения, Другое
- "Только недооценённые" checkbox
- "Сбросить" button to clear all filters
- Filters reset to page 1 on change

UI elements: 4 select dropdowns, 1 checkbox, 1 reset button

### US-4.4: Paginate property list
As a **user**, I want to **navigate between pages of properties** so that **I can browse the full list**.

Acceptance criteria:
- Pagination with page numbers, ellipsis for large ranges
- Previous (‹) and Next (›) buttons
- Current page highlighted
- Mobile: simple "N / M" text with prev/next
- Disabled state for first/last page buttons

UI elements: Pagination buttons, page numbers, prev/next arrows

### US-4.5: Run manual pipeline
As a **user**, I want to **run the full pipeline (parsing → analysis → digest)** so that **I can get a complete update of property data and email digest on demand**.

Acceptance criteria:
- "Ручной запуск" button (idle state)
- "Выполняется..." during execution
- "Готово — запустить ещё раз" on completion (green)
- Three-stage progress indicator:
  - **Парсинг**: shows N/M sources processed, total objects, errors
  - **Анализ**: shows queue size, then undervalued count by city
  - **Дайджест**: shows email sent count or "нет объектов"
- Summary line on completion
- Error display on failure
- Disabled during execution

UI elements: Pipeline button, 3 progress rows with status icons (⏳/✓/○), summary/error lines

### US-4.6: Configure launch parameters
As a **user**, I want to **configure analysis parameters before running the pipeline** so that **the analysis step uses my preferred filters**.

Acceptance criteria:
- "Параметры запуска" collapsible section (▶/▼ toggle)
- Active filter count badge
- Price range inputs (от/до in ₽)
- City checkboxes: Москва, МО, Другие
- Threshold slider (1–99%) with number input
- "Сбросить" button to reset defaults
- "Фильтры применяются к этапу анализа" hint
- Persisted in localStorage

UI elements: Collapsible panel, 2 number inputs, 3 checkboxes, range slider + number input, reset button

### US-4.7: Clear new properties
As a **user**, I want to **delete all properties with "Новый" status** so that **I can clean up the list after reviewing new items**.

Acceptance criteria:
- "Очистить" button
- Confirmation dialog before deletion
- Shows count of deleted items
- Loading state: "Удаление..."

UI elements: "Очистить" button, confirm dialog, alert with count

### US-4.8: View 'В работе' tab
As a **user**, I want to **view properties that are currently in progress** so that **I can track properties I am actively working on**.

Acceptance criteria:
- "В работе" tab in the tab switcher alongside "Все объекты" and "В фокусе"
- Filters properties by status=in_progress
- Same table layout as "Все объекты" tab
- Shows count of in-progress properties
- "Нет объектов в работе" when empty

UI elements: Tab button "В работе", filtered property table

---

## 5. Property List — Focus Tab

### US-5.1: View focus properties
As a **user**, I want to **see properties in the "В фокусе" tab** so that **I can focus on the highest-priority opportunities**.

Acceptance criteria:
- Tab switcher: "Все объекты" | "В фокусе" | "В работе"
- Stats header: count of focus objects + average score
- Desktop table columns: checkbox, Название, Адрес, Город, Тип, Площадь, ₽/м², Скор, Теги, Оценка
- Mobile: card layout with checkbox, title, address, metrics, tags
- Color-coded deviation badges (red ≤-50%, orange ≤-30%, amber ≤-20%, grey otherwise)
- "Торги" badge for minimum-price items
- Tag badges: Недооценён, Торги, Новый, Большая пл., МСК/МО
- "Нет объектов в фокусе" when empty

UI elements: Tab buttons, stats line, data table with checkboxes, tag badges, deviation badges

### US-5.2: Sort focus table
As a **user**, I want to **sort the focus table by title, area, ₽/m², score, or deviation** so that **I can prioritize my review**.

Acceptance criteria:
- Sortable columns: Название, Площадь, ₽/м², Скор, Оценка
- Click to toggle asc/desc with arrow indicator

UI elements: Clickable table headers

### US-5.3: Filter focus properties
As a **user**, I want to **filter focus properties by threshold, city, type, tags, and price range** so that **I can find the most relevant properties**.

Acceptance criteria:
- Threshold slider (0–100) with number input
- City checkboxes: Москва, МО, Другие
- Property type dropdown: Все, Офис, Склад, Торговля, Производство, Св. назначения, Другое
- Tag checkboxes: Недооценён, Торги, Новый, Большая пл., МСК/МО
- Price range inputs (от/до in ₽)
- "Сбросить фильтры" button
- Auto-refresh on filter change
- Persisted in localStorage

UI elements: Range slider + number input, 3 city checkboxes, select dropdown, 5 tag checkboxes, 2 number inputs, reset button

### US-5.4: Recalculate focus scores
As a **user**, I want to **recalculate focus scores** so that **the focus list reflects the latest scoring rules and market data**.

Acceptance criteria:
- "🔄 Пересчитать" button
- Loading state: "Пересчёт..."
- Uses current focus filters (threshold, city, price range)
- Refreshes list after recalculation

UI elements: "🔄 Пересчитать" button

### US-5.5: Export focus properties to CSV
As a **user**, I want to **export the focus list to a CSV file** so that **I can share or analyze the data in a spreadsheet**.

Acceptance criteria:
- "📥 Экспорт CSV" button
- Downloads CSV with BOM (UTF-8) for Excel compatibility
- Columns: Название, Адрес, Город, Тип, Площадь, Цена, ₽/м², Скор, Теги, Ссылка
- Filename: `focus_export_YYYY-MM-DD.csv`
- Respects current filters

UI elements: "📥 Экспорт CSV" button

### US-5.6: Bulk select and act on focus properties
As a **user**, I want to **select multiple focus properties and perform bulk actions** so that **I can efficiently manage my review workflow**.

Acceptance criteria:
- Checkbox per row (click doesn't navigate to detail)
- "Select all" checkbox in table header
- Floating action bar at bottom when items selected: "Выбрано: N"
- Bulk actions: "Просмотрено" (green), "Отклонён" (red), "CSV" (blue)
- Clear selection after bulk action

UI elements: Checkboxes, floating action bar with 3 action buttons

### US-5.7: Paginate focus list
As a **user**, I want to **navigate between pages of focus properties** so that **I can browse the full focus list**.

Acceptance criteria:
- "‹ Назад" and "Вперёд ›" buttons
- Shows "Показано X-Y из Z" range
- Page size: 20

UI elements: Prev/Next pagination buttons, range text

### US-5.8: Hash-based routing to focus tab
As a **user**, I want to **automatically switch to the focus tab when the URL contains `#focus`** so that **I can share direct links to the focus view or navigate from dashboard stat cards**.

Acceptance criteria:
- URL hash `#focus` (e.g., `/properties#focus`) automatically activates the "В фокусе" tab on mount
- Works when navigating from dashboard "Добавленные в фокус" stat card
- Tab state reflects URL hash

UI elements: Hash-based tab auto-switch logic

---

## 6. Property Detail

### US-6.1: View property details
As a **user**, I want to **see full details of a property** so that **I can evaluate whether it's worth pursuing**.

Acceptance criteria:
- "← К списку объектов" back link
- Title with status badge and undervalued badge
- Property fields in grid: Адрес, Город, Тип недвижимости, Площадь, Цена, Цена за м², Источник, Тип торгов, Эталон ₽/м² (if undervalued), Минимальная цена (if auction), Дата публикации на источнике, Дата первого обнаружения, Focus скор
- Source link "Открыть на источнике →" (opens in new tab)
- Description text (pre-formatted, with show more/less toggle)
- Contacts text
- Skeleton loading state
- "Объект не найден" when missing

UI elements: Back link, title, 2 badges, 12–14 field rows, external link, description block, contacts block

### US-6.2: View property photos
As a **user**, I want to **view and load photos of properties** so that **I can visually assess the property**.

Acceptance criteria:
- **Lazy photo loading** for undervalued objects:
  - `triggerPhotoFetch()` auto-called on component mount when `is_undervalued && !photos_downloaded`
  - Spinner displayed while photos are being fetched
  - Polls for completion every 2 seconds, up to 60 seconds max
  - Manual "Загрузить фотографии" button shown for triggering fetch on demand
- Photo gallery (only for properties with photos)
- Grid layout: 2 cols mobile, 3 cols tablet, 4 cols desktop
- Click photo to open lightbox
- Lightbox: close button (✕), prev (‹), next (›), counter "N / M"
- Click outside image to close lightbox

UI elements: Photo fetch trigger, loading spinner, manual fetch button, photo grid, lightbox overlay with nav buttons and counter

### US-6.3: Change property status
As a **user**, I want to **change the status of a property** so that **I can track my review progress**.

Acceptance criteria:
- Status buttons: Новый (blue), В работу (amber), Просмотрено (green), Отклонено (red)
- Current status highlighted with colored background
- Disabled for current status and during save
- Updates immediately on click

UI elements: 4 status buttons with color styling

### US-6.4: Add comment to property
As a **user**, I want to **add a comment to a property** so that **I can record my notes and observations**.

Acceptance criteria:
- Text input with "Ваш комментарий…" placeholder
- "Добавить" button (accent color)
- Enter key submits
- Disabled when empty or saving
- Comment appears in comments list after submission
- Comments list shows text and timestamp

UI elements: Comment input, "Добавить" button, comments list

### US-6.5: View property event history
As a **user**, I want to **see the event history of a property** so that **I can track how it has changed over time**.

Acceptance criteria:
- "📋 История" section title
- Timeline of events with colored dots
- Event types: Создан, Вошёл в фокус, Вышел из фокуса, Скор изменён, Статус изменён, Цена изменена
- Each event shows: type label, old→new value (if applicable), timestamp
- Up to 50 events

UI elements: Event timeline with colored dots, type labels, value badges, timestamps

### US-6.6: View auction info
As a **user**, I want to **see auction-specific information for a property** so that **I can evaluate auction-type listings separately from regular sales**.

Acceptance criteria:
- "📋 Информация о торгах" section
- Displays auction-related fields: тип торгов, минимальная цена, дата торгов
- Only shown for properties with auction type (Торги / minimum_price set)
- Clear visual separation from main property details

UI elements: Auction info section with labeled fields

### US-6.7: Open CIAN listing with geocoding
As a **user**, I want to **open the property listing on CIAN with pre-filled geocoded location** so that **I can cross-reference the property on Russia's largest real estate platform**.

Acceptance criteria:
- "🔗 Смотреть на CIAN" link button
- URL constructed with property address as geocoded query parameter
- Opens in new tab
- Only shown when CIAN link is available

UI elements: CIAN external link button

### US-6.8: Toggle description 'show more'
As a **user**, I want to **expand and collapse long property descriptions** so that **I can read the full description when needed without excessive scrolling**.

Acceptance criteria:
- Long descriptions truncated by default (e.g., first 300 characters)
- "Показать полностью" / "Свернуть" toggle button
- Smooth expand/collapse transition
- Short descriptions shown in full without toggle

UI elements: Description text block, show more/less toggle button

---

## 7. Sources

### US-7.1: View source list
As a **user**, I want to **see all configured parsing sources** so that **I can monitor the data collection pipeline**.

Acceptance criteria:
- "Источники парсинга" page title
- Each source card shows:
  - Name, health badge, active/inactive badge, parse status badge
  - Parser name, URL, region
  - Schedule (cron expression with human-readable description)
  - Statistics: Найдено, Создано, Запусков
  - Last error (if any, red box)
  - Last parse timestamp
- Loading skeleton
- "Источников пока нет" when empty

UI elements: Source cards with badges, stats, schedule info, error display

### US-7.2: Toggle source active/inactive
As a **user**, I want to **enable or disable a source** so that **I can control which sources participate in parsing**.

Acceptance criteria:
- "Выключить" / "Включить" button per source
- Updates active state immediately

UI elements: Toggle button per source

### US-7.3: Run parser for a source
As a **user**, I want to **manually trigger parsing for a specific source** so that **I can test or refresh data from that source**.

Acceptance criteria:
- "▶ Запустить" button per source
- Loading state: "⏳ Парсинг..."
- Polls for completion (up to 2 minutes)
- Disabled during parsing

UI elements: "▶ Запустить" button per source

### US-7.4: Edit source schedule
As a **user**, I want to **edit the cron schedule for a source** so that **I can control when parsing runs**.

Acceptance criteria:
- "Изменить" button next to schedule display
- Inline edit mode with cron input and human-readable preview
- ✓ save button, ✕ cancel button
- Updates schedule on save

UI elements: "Изменить" button, cron input, ✓/✕ buttons, schedule description

### US-7.5: View source health status
As a **user**, I want to **see the health status of parser services** so that **I know if the parser infrastructure is operational**.

Acceptance criteria:
- Health badge per source: 🟢 Сервис ОК, 🔴 Сервис оффлайн, ⏳ Проверка..., ⚪ Нет порта
- Auto-refreshes every 30 seconds

UI elements: Health status badges

### US-7.6: Add new source (hidden/seeded)
As an **admin**, I want to **add a new parsing source** so that **I can expand data collection to new platforms**.

Acceptance criteria:
- Form with fields: Название, Slug, URL, Парсер (select), Тип торгов (select), Регион, Расписание (cron), Health порт
- "Создать" button (disabled until name, slug, parser filled)
- Parser select auto-fills health port
- Note: "Кнопка 'Добавить' скрыта — источники управляются через seeders"

UI elements: Form with 8 inputs, "Создать" button

---

## 8. Market References

### US-8.1: Add new market reference
As a **user**, I want to **add a new market reference (₽/m² benchmark)** so that **the analyzer can compare property prices against market rates**.

Acceptance criteria:
- Form with fields: Город* (select), Тип недвижимости* (select), Цена за м²* (number), Действует с* (date), Примечание (text)
- "Добавить" button (disabled until valid)
- Validation: city, type, price >0, and date required
- Form resets on success
- "← Настройки" back link

UI elements: 5 form fields, "Добавить" submit button, back link

### US-8.2: View market references table
As a **user**, I want to **see all market references in a table** so that **I can review and manage pricing benchmarks**.

Acceptance criteria:
- Desktop table columns: Город, Тип, ₽/м², С даты, Примечание, Статус, Actions
- Mobile: card layout
- Active references shown at full opacity, inactive at 50%
- Status badge: "Активен" (green) / "Неактивен" (red)
- Loading skeleton
- "Эталоны не добавлены" when empty

UI elements: Data table (desktop), reference cards (mobile), status badges

### US-8.3: Edit market reference price
As a **user**, I want to **edit the price of a market reference** so that **I can update benchmarks as market conditions change**.

Acceptance criteria:
- "Изменить цену" link (only for active references)
- Inline edit: number input replaces displayed price
- "Сохранить" and "Отмена" buttons
- Desktop: inline in table row
- Mobile: inline in card

UI elements: "Изменить цену" link, price input, "Сохранить"/"Отмена" buttons

### US-8.4: Activate/deactivate market reference
As a **user**, I want to **activate or deactivate a market reference** so that **I can control which benchmarks are used in analysis**.

Acceptance criteria:
- "Деактивировать" link (red) for active references
- "Активировать" link (green) for inactive references
- Updates immediately

UI elements: Activate/Deactivate link

---

## 9. Settings

### US-9.1: Configure deviation threshold
As a **user**, I want to **set the minimum deviation threshold percentage** so that **only properties significantly below market price trigger notifications**.

Acceptance criteria:
- Number input (1–99), default 20
- Description: "Минимальное отклонение от рыночной цены для уведомления"

UI elements: Number input for threshold_percent

### US-9.2: Configure digest time
As a **user**, I want to **set the morning digest email time** so that **I receive the email at my preferred time**.

Acceptance criteria:
- Time input (HH:MM format), default 09:00
- Description: "Время отправки email-дайджеста (МСК)"

UI elements: Time input for digest_time

### US-9.3: Configure digest email recipients
As a **user**, I want to **set the email address(es) for the digest** so that **the right people receive the morning digest**.

Acceptance criteria:
- Text input, supports comma-separated multiple addresses
- Placeholder: "email@example.com"

UI elements: Text input for smtp_to

### US-9.4: Configure monitored regions
As a **user**, I want to **select which regions are included in monitoring** so that **the digest only includes properties from relevant areas**.

Acceptance criteria:
- Checkboxes: Москва, Московская область, Другие регионы
- Description: "Объекты из неотмеченных регионов не попадут в дайджест"
- All checked by default

UI elements: 3 checkboxes for monitored_regions

### US-9.5: Save settings
As a **user**, I want to **save my settings** so that **my preferences are persisted**.

Acceptance criteria:
- "Сохранить" button (full width, accent color)
- Loading state: "Сохранение..."
- Success message: "Сохранено ✓" (disappears after 3s)
- Error message on failure
- Creates or updates settings singleton

UI elements: "Сохранить" button, success/error messages

### US-9.6: Navigate to market references
As a **user**, I want to **navigate to market references from settings** so that **I can manage pricing benchmarks**.

Acceptance criteria:
- "Рыночные эталоны" link card with description "Ручные цены за м² для сравнения" and arrow

UI elements: Router-link card to `/market-references`

### US-9.7: Logout from settings
As a **user**, I want to **log out from the settings page** so that **I can end my session**.

Acceptance criteria:
- "Выйти" button (full width, outlined)
- Redirects to `/auth`

UI elements: "Выйти" button

---

## 10. Focus Rules

### US-10.1: View focus rules
As a **user**, I want to **see all focus scoring rules** so that **I understand how focus scores are calculated**.

Acceptance criteria:
- "Правила фокуса" page title
- Each rule card shows: name, score badge ("+N очк."), tag badge, condition type + value, description
- Inactive rules shown at 50% opacity
- "Нет правил" when empty with guidance text
- Loading skeleton

UI elements: Rule cards with badges, condition text, description

### US-10.2: Create new focus rule
As a **user**, I want to **create a new focus rule** so that **I can customize the scoring algorithm**.

Acceptance criteria:
- "+ Новое правило" button in header
- Modal dialog with form:
  - Название* (text input)
  - Описание (textarea, 2 rows)
  - Тип условия* (select: Порог отклонения, Наличие поля, Совпадение города, Произвольное)
  - Значение условия (text input)
  - Очки* (number input, min 1)
  - Тег* (text input)
  - Приоритет (number input, min 0)
- "Отмена" and "Сохранить" buttons
- Saves and refreshes list

UI elements: "+ Новое правило" button, modal with 7 form fields, 2 action buttons

### US-10.3: Edit focus rule
As a **user**, I want to **edit an existing focus rule** so that **I can adjust scoring parameters**.

Acceptance criteria:
- Edit icon (pencil) button per rule
- Same modal as create, pre-filled with rule data
- Title changes to "Редактировать правило"

UI elements: Edit icon button, same modal form

### US-10.4: Toggle focus rule active/inactive
As a **user**, I want to **enable or disable a focus rule** so that **I can experiment with different scoring configurations**.

Acceptance criteria:
- Toggle switch per rule (pill-shaped)
- Active: accent color with knob on right
- Inactive: grey with knob on left
- Updates immediately

UI elements: Toggle switch per rule

### US-10.5: Delete focus rule
As a **user**, I want to **delete a focus rule** so that **I can remove rules that are no longer needed**.

Acceptance criteria:
- Delete icon (trash) button per rule
- Confirmation dialog: "Удалить правило «name»?"
- Removes from list on confirm

UI elements: Delete icon button, confirm dialog

---

## 11. Changelog

### US-11.1: View changelog
As a **user**, I want to **see the history of AKLAB updates** so that **I know what features and fixes have been released**.

Acceptance criteria:
- "Changelog" page title with description
- Timeline of releases, each with: version (monospace), date, list of items
- Each item has: type icon (✦ new, ↑ improvement, • fix), text, type badge
- Loaded from `/changelog.json`
- Loading skeleton

UI elements: Release cards with version, date, item list with type badges

### US-11.2: Filter changelog by category
As a **user**, I want to **filter the changelog by change type** so that **I can focus on specific types of updates**.

Acceptance criteria:
- Filter buttons: Все, Новое, Улучшения, Исправления
- Active filter highlighted with category-specific color (grey, green, blue, amber)
- Releases without matching items are hidden
- Resets pagination on filter change

UI elements: 4 filter buttons (pill-shaped)

### US-11.3: Load more changelog entries
As a **user**, I want to **load more changelog entries** so that **I can see older releases**.

Acceptance criteria:
- "Показать ещё" button when more releases exist
- Loads 10 releases at a time
- "Все обновления загружены" when all shown

UI elements: "Показать ещё" button, end-of-list text

---

## 12. Documentation

### US-12.1: Read AKLAB documentation
As a **user**, I want to **read the AKLAB architecture and usage documentation** so that **I understand how the system works**.

Acceptance criteria:
- Table of contents with anchor links: Обзор, Архитектура, Сервисы, Поток данных, Парсеры, API, Деплой, Разделы интерфейса
- Sections with structured content:
  - **Обзор**: Product description
  - **Архитектура**: Diagram (Frontend → Backend → Microservices), dependency tree
  - **Сервисы**: Table of services with name, port, queue, description
  - **Поток данных**: 3-step flow (Парсинг → Анализ → Дайджест)
  - **Парсеры**: Cards for each parser with name, type, status, description
  - **API**: Table of endpoints with method, path, description
  - **Деплой**: Step-by-step deployment process
  - **Разделы интерфейса**: Links to Properties, Sources, Market References, Settings, Changelog

UI elements: TOC links, architecture diagram, service table, flow steps, parser cards, API table, deploy steps, section links

---

## 13. 404 Not Found

### US-13.1: Handle unknown routes
As a **user**, I want to **see a friendly 404 page when I visit a non-existent URL** so that **I can recover and navigate to a valid page**.

Acceptance criteria:
- Large "404" text in accent color
- "Страница не найдена" heading
- Explanation text
- "Перейти к объектам" button linking to `/properties`

UI elements: "404" display, heading, description, "Перейти к объектам" button

---

## 14. Routing & Guards

### US-14.1: Require authentication for protected pages
As a **system**, I want to **redirect unauthenticated users to the login page** so that **only authorized users can access the application**.

Acceptance criteria:
- All routes except `/auth` require authentication
- Unauthenticated users redirected to `/auth`
- Authenticated users visiting `/auth` redirected to `/properties`
- Auth store initialized before guard check

UI elements: N/A (router guard logic)

### US-14.2: Page transitions
As a **user**, I want to **see smooth page transitions** so that **navigation feels polished**.

Acceptance criteria:
- Out-in transition on route changes
- Mobile menu closes on route change

UI elements: `<transition>` wrapper on `<router-view>`

---

## Summary Statistics

| Section | User Stories | Interactive Elements |
|---------|-------------|---------------------|
| Authentication | 1 | 3 (2 inputs, 1 button) |
| App Layout & Navigation | 5 | 10 (nav links, theme toggle, hamburger, logout) |
| Dashboard | 5 | 5 (refresh, score recalc, stat cards) |
| Property List — All | 8 | 17 (filters, pagination, pipeline, clear, in-progress tab) |
| Property List — Focus | 8 | 21 (filters, bulk actions, export, checkboxes, hash routing) |
| Property Detail | 8 | 16 (status buttons, comment, photos, links, auction, CIAN, show more) |
| Sources | 6 | 10 (toggle, run, schedule edit, health) |
| Market References | 4 | 8 (form, edit, toggle) |
| Settings | 7 | 8 (inputs, checkboxes, save, logout, link) |
| Focus Rules | 5 | 7 (create, edit, toggle, delete, modal form) |
| Changelog | 3 | 5 (filter buttons, load more) |
| Documentation | 1 | 8 (TOC links, section links) |
| 404 Not Found | 1 | 1 (button) |
| Routing & Guards | 2 | 0 (logic only) |
| **Total** | **64** | **~119** |

---

## E2E Coverage Matrix

| User Story | E2E Test(s) | Status |
|------------|-------------|--------|
| US-1.1 Login | 1.1, 1.2, 1.3 | ✅ |
| US-2.1 Navigation | 8.1–8.4 | ✅ |
| US-2.2 Mobile hamburger | — | ❌ |
| US-2.3 Theme toggle | 8.6 | ✅ |
| US-2.4 Logout | 1.5, 6.2 | ✅ |
| US-2.5 Footer links | — | ❌ |
| US-3.1 Dashboard stats | 10.1, 10.2 | ✅ |
| US-3.2 Hot properties | 10.3 | ✅ |
| US-3.3 Run scoring | — | ❌ |
| US-3.4 7-day trend | — | ❌ |
| US-3.5 Refresh dashboard | 10.5 | ✅ |
| US-4.1 Properties table | 2.1–2.3 | ✅ |
| US-4.2 Sort columns | 2.9 | ✅ |
| US-4.3 Filter properties | 2.5–2.7 | ✅ |
| US-4.4 Pagination | — | ❌ |
| US-4.5 Pipeline | 2.4 | ✅ |
| US-4.6 Launch params | 2.10 | ✅ |
| US-4.7 Clear new | — | ❌ |
| US-4.8 В работе tab | — | ❌ |
| US-5.1 Focus view | 3.1, 3.4 | ✅ |
| US-5.2 Focus sort | 3.9 | ✅ |
| US-5.3 Focus filters | 3.2, 3.3, 3.11–3.18 | ✅ |
| US-5.4 Recalculate | — | ❌ |
| US-5.5 CSV export | 3.6 | ✅ |
| US-5.6 Bulk select | 3.8 | ✅ |
| US-5.7 Focus pagination | — | ❌ |
| US-5.8 Hash routing | — | ❌ |
| US-6.1 Detail view | 4.1–4.3 | ✅ |
| US-6.2 Photos (lazy load) | — | ❌ |
| US-6.3 Status change | 4.4 | ✅ |
| US-6.4 Comments | 4.5 | ✅ |
| US-6.5 Event history | 10.10 | ✅ |
| US-6.6 Auction info | — | ❌ |
| US-6.7 CIAN link | — | ❌ |
| US-6.8 Description toggle | — | ❌ |
| US-7.1 Source list | 5.1, 5.2 | ✅ |
| US-7.2 Toggle source | — | ❌ |
| US-7.3 Run parser | — | ❌ |
| US-7.4 Edit schedule | — | ❌ |
| US-7.5 Health badges | — | ❌ |
| US-8.1 Add reference | 7.2 | ✅ |
| US-8.2 References table | — | ❌ |
| US-8.3 Edit price | — | ❌ |
| US-8.4 Activate/deactivate | — | ❌ |
| US-9.1 Threshold | 6.2 | ✅ |
| US-9.2 Digest time | 6.2 | ✅ |
| US-9.3 Digest email | 6.2 | ✅ |
| US-9.4 Monitored regions | — | ❌ |
| US-9.5 Save settings | — | ❌ |
| US-9.6 Navigate to refs | — | ❌ |
| US-9.7 Logout from settings | — | ❌ |
| US-10.1 View rules | 10.6 | ✅ |
| US-10.2 Create rule | 10.7 | ✅ |
| US-10.3 Edit rule | — | ❌ |
| US-10.4 Toggle rule | 10.8 | ✅ |
| US-10.5 Delete rule | 10.9 | ✅ |
| US-11.1 View changelog | — | ❌ |
| US-11.2 Filter changelog | — | ❌ |
| US-11.3 Load more | — | ❌ |
| US-12.1 Documentation | — | ❌ |
| US-13.1 404 page | 11.1 | ✅ |
| US-14.1 Auth guard | 11.2–11.4 | ✅ |
| US-14.2 Event log | 10.10 | ✅ |

**Coverage: 34/64 user stories (53%) have E2E tests. 30 stories need tests.**
