# План: двухфазный парсинг — посещение детальных страниц

## Проблема
Парсеры извлекают данные только со страниц списка. Это даёт минимум информации:
- Нет полного описания (только title + excerpt)
- Нет контактов организатора
- Нет деталей аукциона (даты, шаг, задаток)
- Нет точных координат
- Нет фото

## Архитектура

### Текущий flow
```
parse(depth) → [ParsedProperty] → parse-handler → propertyExists → createProperty
```

### Новый flow
```
parse(depth) → [ParsedProperty] → parse-handler → propertyExists → fetchDetails(url) → createProperty
                                                                    ↑
                                                         новая фаза: загрузка детальной страницы
```

### Принцип работы
1. **Фаза 1** (без изменений): парсер собирает список объектов со страниц поиска
2. **Фаза 2** (новая): для каждого НОВОГО объекта (не дубля) загружается детальная страница
3. **Фаза 3** (без изменений): создание объекта в Strapi

## Изменения

### 1. `_shared/src/types.ts`
Добавить новый метод в `SourceParser`:
```typescript
export interface SourceParser {
  name: string;
  parse(depth?: number): Promise<ParsedProperty[]>;
  fetchDetails?(url: string): Promise<Partial<ParsedProperty>>; // НОВЫЙ
}
```
- `fetchDetails` — опциональный метод (парсеры без детальных страниц могут не реализовывать)
- Возвращает дополнительные поля: description, contacts, coordinates, auction details

### 2. `_shared/src/parse-handler.ts`
Изменить фазу 2:
```typescript
// После propertyExists() → false (новый объект):
if (parser.fetchDetails) {
  try {
    const details = await parser.fetchDetails(prop.url);
    Object.assign(prop, details); // мержим детали в объект
  } catch (err) {
    logger.warn(`fetchDetails failed for ${prop.url}: ${err.message}`);
    // Продолжаем с тем что есть
  }
  await randomDelay(2000, 5000); // антибан между детальными страницами
}

const result = await createProperty({ ... });
```

### 3. Парсеры — реализация `fetchDetails`

#### alfalot
- URL: `https://ecosystem.alfalot.ru/showcase/lot/{lot_id}`
- Playwright (тот же browser context)
- Селекторы: `.lot-description`, `.lot-contacts`, `.lot-coordinates`
- Извлекать: description, contacts, lat/lng, auction dates

#### aggregator-bankrot
- URL: `https://xn----etbpba5admdlad.xn--p1ai{card.link}`
- Playwright
- Селекторы: `.trade-description`, `.trade-contacts`, `.lot-details`
- Извлекать: description, contacts, auction dates, deposit amount

#### torgi-gov
- URL: `https://torgi.gov.ru/new/api/public/lotcards/{lotId}` (API, не HTML)
- fetch() — уже есть данные из API, можно расширить запрос
- Извлекать: full description, contacts, auction dates, deposit

#### m-ets
- URL: `https://m-ets.ru{lot.link}`
- Playwright
- Селекторы: `.lot-info`, `.seller-contacts`
- Извлекать: description, contacts, auction details

#### etprf
- URL: детальная страница из `row.detail_url`
- Playwright
- Селекторы: `.lot-description`, `.organizer-contacts`
- Извлекать: description, contacts, auction dates

#### sberbank-ast
- URL: детальная страница из `lot.detail_url`
- Playwright
- Селекторы: `.lot-description`, `.organizer-info`
- Извлекать: description, contacts, auction dates

#### invest-mosreg, investmoscow
- Уже получают данные из API/SSR — детальные страницы не нужны
- `fetchDetails` не реализовывать

### 4. Антибан
- Пауза между детальными страницами: `randomDelay(2000, 5000)` (2-5 сек)
- Переиспользовать browser context (не создавать новый для каждой страницы)
- UA ротация уже есть в `createStealthContext`

### 5. Производительсть
- Depth=50 → ~50 объектов × 3.5 сек = ~3 минуты на парсер (вместо 30 сек)
- Depth=150 → ~150 объектов × 3.5 сек = ~9 минут на парсер
- Smart stop сработает раньше если объекты уже в БД (дубли не проходят fetchDetails)

## Приоритет реализации

### Этап 1 (сначала — самые популярные парсеры)
1. **alfalot** — 84 объекта, Playwright, хорошо структурированный HTML
2. **aggregator-bankrot** — 41 объект, Playwright
3. **torgi-gov** — 13 объектов, API (самый простой)

### Этап 2
4. **m-ets** — 26 объектов, Playwright
5. **etprf** — 29 объектов, Playwright
6. **sberbank-ast** — 19 объектов, Playwright/XML

### Этап 3 (не нужны)
7. invest-mosreg — данные из API, fetchDetails не нужен
8. investmoscow — данные из SSR, fetchDetails не нужен

## Тестирование
1. Локально: запустить 1 парсер с depth=5, проверить что fetchDetails вызывается
2. На проде: ручной запуск с depth=10, проверить что description/contacts заполняются
3. Проверить антибан: нет ли блокировок при 50+ запросах подряд

## Ожидаемый результат
- description: полное описание 500-2000 символов (сейчас ~100 из excerpt)
- contacts: телефон/email организатора (сейчас пусто у большинства)
- Координаты: lat/lng (сейчас пусто)
- Время парсинга: depth=50 → ~3 мин вместо 30 сек
