# План: Переосмысление парсинга v2

## Текущее состояние (v1.0.53)

### Что работает
- 10 парсеров, 15 PM2 процессов, cron-расписание 03:00–06:00 МСК
- Дедупликация по `(source, external_id)` — unique index
- Generic parse handler — единый для всех парсеров
- Photo-fetcher для недооценённых объектов (скачивает фото с детальных страниц)

### Проблемы

#### P0 — Парсеры не работают
| Парсер | Результат | Причина |
|--------|-----------|---------|
| ГИС Торги | 0 объектов | `isCommercialProperty()` фильтрует всё |
| Сбербанк-АСТ | 0 объектов | Аналогично |
| Росэлторг | 0 объектов | Generic-заглушка, нет пагинации |
| Инвест МО | 0 объектов | Generic-заглушка, нет пагинации |
| Инвест Москва | 0 объектов | Generic-заглушка, нет пагинации |
| Фабрикант | 2 объекта | Коммерческих лотов мало |

#### P1 — Парсинг только со списка
Ни один парсер не заходит на страницу объекта. Данные из карточки:
- title, цена, иногда площадь (regex из title), URL

**Чего нет (критично для анализа):**
- описание (полное), адрес, координаты, дата публикации, контакты
- площадь часто = undefined → `price_per_sqm` не считается → объект теряется

#### P2 — Нет контроля глубины
Все парсеры всегда парсят MAX_PAGES страниц. Если новых объектов нет — парсер
тратит время на обработку дублей. Нет обратной связи в UI сколько реально
спарсено новых.

---

## Новая архитектура парсинга

### Ключевые принципы

1. **Двухфазный парсинг: список → детальная страница**
   - Фаза A: Страница списка → извлечь URL карточек + external_id
   - Фаза B: Для каждого НОВОГО объекта → открыть детальную страницу →
     извлечь описание, адрес, координаты, площадь, дату, контакты
   - Фото НЕ скачиваем — это делает photo-fetcher для недооценённых

2. **Антибан: рандомная пауза между запросами на один домен**
   ```
   Между карточками (детальные страницы): 2000 + Math.random() * 3000 мс
   Между страницами списка:              3000 + Math.random() * 3000 мс
   Между поисковыми запросами:           5000 + Math.random() * 5000 мс
   Retry при ошибке:                     3 попытки, backoff 5с/15с/45с
   ```

3. **Глубина парсинга (настраиваемая)**
   - Input «Глубина парсинга» рядом с кнопкой «Ручной запуск» (по умолчанию: 50)
   - Означает: парсить до N свежих (новых) объектов
   - Если пошли дубликаты — парсинг этого источника останавливается
   - Логика: объекты на страницах списка идут от новых к старым →
     если 3+ страницы подряд только дубли → дальше новых нет → break

4. **Отчёт о ручном запуске**
   - Сколько новых объектов спарсено (по источникам)
   - Сколько дубликатов пропущено
   - Сколько отфильтровано (не коммерция / нет цены)
   - Общее время выполнения

### Схема работы

```
Frontend: Кнопка «Ручной запуск» + Input «Глубина: 50»
  ↓
POST /api/cron/parse-all { depth: 50 }
  ↓
Strapi API (cron controller)
  ↓  для каждого активного источника:
  ↓  POST /api/cron/parse/:slug { depth: 50 }
  ↓  → ставит задачу в очередь parse-<slug>
  ↓
Парсер (PM2 процесс):
  1. Открывает страницу 1 списка
  2. Извлекает карточки (URL, external_id, title, цена)
  3. Для каждой карточки:
     a. propertyExists(source, external_id)?
        → да: duplicateCount++ (если duplicateCount >= 3 подряд → break)
        → нет: открываем детальную страницу (антибан пауза)
               → извлекаем: описание, адрес, площадь, координаты, дату, контакты
               → createProperty(...)
               → createdCount++
               → если createdCount >= depth → break
     b. Переходим к следующей карточке
  4. Если есть страница 2+ → пауза → goto 1
  5. Возвращаем { created, duplicates, filtered, pages_visited }
```

### Антибан

```typescript
// В _shared/src/anti-ban.ts
export function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const delay = minMs + Math.random() * (maxMs - minMs);
  return new Promise(resolve => setTimeout(resolve, delay));
}

// Между детальными страницами одного домена
await randomDelay(2000, 5000);

// Между страницами списка
await randomDelay(3000, 6000);

// Между поисковыми запросами (новый slug)
await randomDelay(5000, 10000);
```

**User-Agent ротация** — пул из 5-10 UA строк, случайный выбор при создании контекста.

**Retry логика:**
```typescript
async function retryGoto(page, url, maxAttempts = 3) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      return;
    } catch (err) {
      if (i === maxAttempts - 1) throw err;
      await randomDelay(5000 * (i + 1), 15000 * (i + 1));
    }
  }
}
```

### Глубина парсинга — API

**Frontend:**
```vue
<!-- Рядом с кнопкой "Ручной запуск" на /settings -->
<div class="flex items-center gap-2">
  <label>Глубина:</label>
  <input v-model.number="parseDepth" type="number" min="1" max="500" />
  <button @click="startPipeline">Запустить</button>
</div>
```

**Backend (cron controller):**
```typescript
// POST /api/cron/parse-all
async parseAll(ctx) {
  const depth = ctx.request.body?.depth ?? 50;
  // ... для каждого source:
  await queueService.addToQueue(`parse-${source.slug}`, {
    source: source.slug,
    depth,      // ← передаём в задачу
    // ...
  });
}
```

**Parse handler:**
```typescript
export function createParseHandler(parser: SourceParser) {
  return async function handleParseJob(job: Job) {
    const req = job.data as ParseRequest;
    const depth = req.depth ?? 50;  // ← глубина
    let created = 0, duplicates = 0, filtered = 0;
    let consecutiveDuplicates = 0;

    // ... парсинг страниц списка
    for (const page of pages) {
      const cards = await extractCards(page);
      for (const card of cards) {
        if (await propertyExists(source, card.external_id)) {
          duplicates++;
          consecutiveDuplicates++;
          if (consecutiveDuplicates >= 3) {
            // 3+ дубля подряд → новых объектов нет → стоп
            logger.info(`Smart stop: ${consecutiveDuplicates} consecutive duplicates`);
            break;
          }
          continue;
        }
        consecutiveDuplicates = 0;

        // Открываем детальную страницу
        await randomDelay(2000, 5000);
        const details = await extractDetails(page, card.url);
        
        const result = await createProperty({ ...card, ...details });
        if (result) created++;
        else filtered++;

        if (created >= depth) break;  // достигли глубины
      }
      if (created >= depth || consecutiveDuplicates >= 3) break;
      await randomDelay(3000, 6000);
    }

    return { created, duplicates, filtered };
  };
}
```

### Отчёт ручного запуска

**Frontend polling** (как сейчас, через `/api/cron/queue-stats`):
```json
{
  "fabrikant": { "created": 5, "filtered": 3, "status": "done" },
  "m-ets": { "created": 0, "filtered": 0, "status": "done" },
  "torgi-gov": { "created": 12, "filtered": 8, "status": "running" }
}
```

В UI:
```
Парсинг завершено за 4м 32с

Источник       Новых   Отфильтровано
Фабрикант      5       3
ГИС Торги      12      8
Alfalot        3       1
М-ЕТС          0       0
─────────────────────────
Итого:         20      12
```

---

## Фазы работ

### Фаза 1: Аудит (1 день)
- [ ] Зайти на каждый сайт, изучить HTML-структуру
- [ ] Определить: есть ли коммерческая недвижимость?
- [ ] Оценить объём (сколько лотов в МСК/МО?)
- [ ] Решить: реанимировать / переписать / отключить

### Фаза 2: Инфраструктура (2 дня)
- [ ] `_shared/src/anti-ban.ts` — randomDelay, UA ротация, retryGoto
- [ ] `_shared/src/types.ts` — добавить `depth` в ParseRequest
- [ ] `parse-handler.ts` — двухфазный парсинг + smart stop + depth
- [ ] cron controller — `depth` параметр в POST /api/cron/parse-all
- [ ] Frontend — input «Глубина парсинга» на /settings
- [ ] Frontend — отчёт о результатах парсинга

### Фаза 3: Починка работающих парсеров (2-3 дня)
**3.1 ГИС Торги** — JSON API, пересмотр фильтров
- Проблема: `isCommercialProperty()` отсекает всё
- Решение: пересмотр фильтров, site-specific селекторы
- API: `GET /new/api/public/lotcards/search?lotStatus=PUBLISHED&size=100&page=N`

**3.2 Сбербанк-АСТ** — Playwright, пересмотр фильтров + селекторы
**3.3 Фабрикант** — расширить поисковые запросы

### Фаза 4: Переписать generic-парсеры (3-5 дней)
- **4.1 М-ЕТС** — site-specific селекторы + пагинация + детальные страницы
- **4.2 Росэлторг** — аналогично
- **4.3 Инвест МО / Инвест Москва** — решить в Фазе 1 (есть ли что парсить?)

### Фаза 5: Детальные страницы (встроено в Фазы 3-4)
Каждый парсер, после извлечения карточек со списка:
1. Открывает URL объекта (с антибан паузой)
2. Извлекает: описание, адрес, площадь, координаты, дату, контакты
3. Обновляет/создаёт Property с полными данными

**НЕ скачать фото** — это делает photo-fetcher для недооценённых.

### Фаза 6: Геокодинг + мониторинг (2-3 дня)
- [ ] Геокодинг адресов через Nominatim (free, no key)
- [ ] Правильное определение города из адреса (не из title)
- [ ] Алерт если парсер вернул 0 новых объектов
- [ ] Метрики: количество новых/дублей/отфильтрованных за неделю

---

## Приоритеты

```
Неделя 1: Фаза 1 (аудит) + Фаза 2 (инфраструктура) + Фаза 3.1 (ГИС Торги)
Неделя 2: Фаза 3 (Сбербанк, Фабрикант) + Фаза 4.1 (М-ЕТС)
Неделя 3: Фаза 4 (Росэлторг, Инвест) + Фаза 5 (детальные страницы)
Неделя 4: Фаза 6 (геокодинг, мониторинг)
```

---

## Технические заметки

### external_id — надёжные источники
| Источник | Хороший ID | Плохой ID |
|----------|-----------|-----------|
| ГИС Торги | `lotId` из JSON API | — |
| Фабрикант | `data-id` атрибут карточки | — |
| Alfalot | `lot_id` из URL | — |
| ЕТП РФ | `lot_id` из таблицы | — |
| Агр. банкрот | `lot_id` | — |
| М-ЕТС | `lotId` с детальной страницы | `link.split('/').pop()` ⚠️ |
| Росэлторг | `lotId` с детальной страницы | `link.split('/').pop()` ⚠️ |
| Инвест МО | с детальной страницы | `link.split('/').pop()` ⚠️ |
| Инвест Москва | с детальная страницы | `link.split('/').pop()` ⚠️ |
| Сбербанк-АСТ | `purchase_id` | — |

### isCommercialProperty() — пересмотр
Текущий фильтр отсекает по keywords в title. Проблема: на гос. торгах
в title может быть "Нежилое помещение" а в description — "жилое".

**Решение:** фильтровать ПОСЛЕ парсинга детальной страницы (когда есть
больше данных), а не на этапе карточки со списка. Или: парсер классифицирует
`property_type`, а фильтрация — по `property_type` а не по строковому поиску.

### Photo-fetcher — не трогать
Photo-fetcher скачивает фото ТОЛЬКО для `is_undervalued=true` объектов.
Это правильно — экономит трафик и место. Детальная страница при парсинге
нужна для извлечения текстовых данных, не картинок.
