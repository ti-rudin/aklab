# Аудит парсеров, анализатора и pipeline

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Найти и исправить все баги в pipeline парсинга → анализа → фокуса. Объяснить почему только 37 объектов из ~15,000 найденных. Убедиться что город определяется корректно.

**Architecture:** Двухфазный парсинг (scan → fetchDetails), analyzer (deviation), focus engine (scoring). 10 парсеров, Strapi 5 backend, SQLite.

---

## Контекст проблемы (июль 2026)

### Что уже исправлено (v1.1.49-v1.1.51)
- preFilterProperty: пропускает city='other' в Phase 1
- parse-handler: пересчёт города после fetchDetails (только если city='other')
- focusEngine: деактивированы city_match и large_area правила
- fetchDetails: Moscow fallback в fabrikant, roseltorg, aggregator-bankrot, etprf, sberbank-ast

### Что НЕ работает
1. **Всего 37 объектов** из ~15,000 найденных (0.24% конверсия)
2. **Объект из Дагестана** попал с city='moscow' (alfalot-91995) — `detectCity` нашёл "Москва" в описании с детальной страницы
3. **fabrikant, torgi-gov, sberbank-ast, roseltorg** — 0 объектов создано
4. **alfalot** — 12 объектов, но есть ложные (Дагестан = moscow)

### Корневые гипотезы
- **H1:** parse-handler fallback `detectCity(title+address+description)` ищет "Москва" в ОПИСАНИИ с детальной страницы, а не в адресе. Описание может содержать "Москва" в шаблонном тексте площадки.
- **H2:** Некоторые парсеры не находят адрес на детальной странице → city остаётся 'other' → createProperty отсекает.
- **H3:** Конверсия alfalot 4032→12 — card.region содержит регион (не город), большинство регионов ≠ Москва.
- **H4:** fabrikant 1200→0 — даже с Moscow fallback адрес не содержит "Москва" (fabrikant — федеральная площадка, мало московских объектов).

---

## Фаза 0: Диагностика (readonly, 15 мин)

### Task 0.1: Проверить alfalot-91995 на alfalot.ru
**Цель:** Понять откуда взялось city='moscow' для дагестанского объекта.

1. Открыть Playwright: `https://ecosystem.alfalot.ru/showcase/lot/91995`
2. Найти на странице:
   - `.address` элемент — что в нём?
   - Текст описания — содержит ли "Москва"?
   - Регион в карточке — "Республика Дагестан"?
3. Проверить `detectCity` на найденном тексте

### Task 0.2: Проверить alfalot listing — сколько объектов из Москвы
**Цель:** Понять реальное соотношение Москва/не-Москва на alfalot.

1. Открыть Playwright: `https://ecosystem.alfalot.ru/showcase` (с фильтром по коммерческой недвижимости)
2. Посчитать первые 50 карточек — сколько содержат "Москва" в регионе
3. Проверить: card.region для московских объектов содержит "Москва" или "г. Москва"?

### Task 0.3: Проверить fabrikant — есть ли московские объекты
**Цель:** Понять почему fabrikant 1200→0.

1. Открыть Playwright: `https://www.fabrikant.ru/procedure/search/sales`
2. Найти 5-10 объектов с адресом в Москве
3. Проверить: заголовок содержит "Москва"? Адрес на детальной странице?
4. Проверить extractAddress regex на реальных заголовках

### Task 0.4: Проверить torgi-gov, sberbank-ast, roseltorg
**Цель:** Понять почему 0 объектов.

Для каждого:
1. Открыть Playwright на сайт-источник
2. Найти коммерческую недвижимость в Москве
3. Проверить: какие данные доступны в Phase 1 (список) и Phase 2 (детали)
4. Сверить с кодом парсера

### Task 0.5: Проверить analyzer — как считается deviation
**Цель:** Понять почему deviation=0 у всех объектов.

1. Проверить market_references в БД — есть ли активные эталоны для moscow
2. Проверить analyzer code — как ищет совпадение property ↔ market_reference
3. Проверить: совпадают ли property_type между property и market_reference?

---

## Фаза 1: Исправление detectCity (30 мин)

### Task 1.1: Исправить parse-handler — приоритет address над description
**Проблема:** Fallback `detectCity(title+address+description)` ищет "Москва" в описании, которое может быть шаблонным текстом площадки.

**Решение:** Если `details.address` содержит конкретный регион (Дагестан, Кировская и т.д.) — НЕ перезаписывать город.

**Файл:** `services/_shared/src/parse-handler.ts`

```typescript
// Текущий код (строки 194-202):
if (prop.city === 'other' && details.address) {
  prop.city = detectCity(details.address + ' ' + (prop.title || ''));
}
if (prop.city === 'other') {
  const searchText = [prop.title, prop.address, prop.description].filter(Boolean).join(' ');
  prop.city = detectCity(searchText);
}

// Новый код:
if (prop.city === 'other') {
  // Приоритет 1: address + title (адрес — самый точный источник)
  if (details.address) {
    prop.city = detectCity(details.address + ' ' + (prop.title || ''));
  }
  // Приоритет 2: только address (без description — описание может содержать "Москва" из шаблона)
  if (prop.city === 'other' && prop.address) {
    prop.city = detectCity(prop.address + ' ' + (prop.title || ''));
  }
  // НЕ ищем в description — это источник ложных срабатываний
}
```

### Task 1.2: Добавить blacklist регионов в detectCity
**Проблема:** "Москва" может быть в тексте описания даже если объект в другом регионе.

**Файл:** `services/_shared/src/city-detect.ts`

Добавить проверку: если текст содержит явные НЕ-московские регионы → return 'other' (не пытаться определить город).

```typescript
const NON_MOSCOW_REGIONS = [
  'республика дагестан', 'республика башкортостан', 'кировская область',
  'алтайский край', 'камчатский край', 'республика татарстан',
  'новосибирск', 'екатеринбург', 'нижний новгород', 'казань',
  'краснодар', 'ростов', 'самара', 'воронеж', 'пермь',
  // ... добавить по мере необходимости
];

export function detectCity(text: string): 'moscow' | 'mo' | 'other' {
  const lower = text.toLowerCase();

  // Если текст содержит явный НЕ-московский регион — не определяем как Москву
  if (NON_MOSCOW_REGIONS.some(region => lower.includes(region))) {
    // Но сначала проверяем Московскую область
    if (MO_KEYWORDS.some(kw => lower.includes(kw))) return 'mo';
    return 'other';
  }

  // ... остальной код
}
```

### Task 1.3: Тесты для detectCity с edge cases
**Файл:** `services/_shared/src/__tests__/city-detect.test.ts`

Добавить тесты:
- `detectCity('Республика Дагестан, описание... упоминание Москвы')` → 'other'
- `detectCity('Земельный участок в Республика Дагестан')` → 'other'
- `detectCity('Нежилое помещение, г. Москва, ул. Ленина')` → 'moscow'

---

## Фаза 2: Аудит парсеров с Playwright (60 мин)

### Task 2.1: Alfalot — проверка Phase 1 и Phase 2
**Цель:** Проверить card.region и fetchDetails на реальных данных.

1. Playwright: открыть `https://ecosystem.alfalot.ru/showcase` с фильтром "коммерческая"
2. Извлечь 10 карточек: title, region, price
3. Проверить detectCity(region) для каждой
4. Открыть 3 детальные страницы, проверить:
   - `.address` элемент
   - описание (содержит ли "Москва"?)
   - contacts
5. Сверить с кодом alfalot.ts Phase 1 и Phase 2

### Task 2.2: Fabrikant — проверка Phase 1 и Phase 2
1. Playwright: `https://www.fabrikant.ru/procedure/search/sales`
2. Найти 5 объектов, извлечь title, price
3. Проверить extractAddress(title) на реальных заголовках
4. Открыть 3 детальные страницы:
   - Проверить allText — есть ли "адрес", "Москва"?
   - Проверить новые regex паттерны
5. Сверить с кодом fabrikant.ts

### Task 2.3: Aggregator-bankrot — проверка Phase 1 и Phase 2
1. Playwright: `https://bankrot.fedresurs.ru/`
2. Найти коммерческую недвижимость в Москве
3. Проверить: excerpt содержит адрес? title содержит "Москва"?
4. Детальная страница: #info панель, адрес местонахождения

### Task 2.4: Roseltorg — проверка Phase 1 и Phase 2
1. Playwright: `https://roseltorg.ru/imuschestvo/nedvizhimost/kommercheskaya-nedvizhimost`
2. Проверить: table rows содержат адрес/город?
3. Детальная страница: allText — есть ли "адрес"?

### Task 2.5: Sberbank-ast — проверка Phase 1 и Phase 2
1. Playwright: `https://www.sberbank-ast.ru/`
2. Найти коммерческую недвижимость в Москве
3. Проверить XML data — есть ли GeoDataAddress?
4. Детальная страница: textAddress, orgaddressjur

### Task 2.6: Etprf — проверка Phase 1 и Phase 2
1. Playwright: `https://sale.etprf.ru/`
2. Проверить: subject содержит "Москва"?
3. Детальная страница: есть ли адрес в tab2?

### Task 2.7: M-ets — проверка Phase 1 и Phase 2
1. Playwright: `https://www.m-ets.ru/`
2. Проверить: title+region+description — что передаётся в detectCity?
3. Детальная страница: address regex

### Task 2.8: Torgi-gov — проверка region codes
1. Playwright: `https://torgi.gov.ru/`
2. Проверить: есть ли объекты с regionCode=77 (Москва)?
3. API: `/new/api/public/lotcards?subjectRFCode=77`

---

## Фаза 3: Исправления по результатам аудита (45 мин)

### Task 3.1: Исправить парсеры по результатам Playwright-аудита
На основе данных из Фазы 2 — исправить конкретные парсеры:
- Обновить regex для адресов
- Добавить/убрать Moscow fallback
- Исправить extractAddress

### Task 3.2: Исправить analyzer — проверить deviation calculation
1. Проверить market_references — все ли property_type покрыты
2. Проверить формулу deviation — совпадает ли с ожидаемой
3. Проверить: analyzer обновляет deviation_percent для ВСЕХ объектов или только новых?

### Task 3.3: Исправить focus engine — проверить scoring rules
1. Проверить активные focus rules
2. Проверить: score=0 у всех объектов — это правильно?
3. Проверить: deviation_threshold rules — работают ли с текущими данными?

### Task 3.4: Обновить тесты
- Добавить тесты для новых edge cases в detectCity
- Добавить тесты для parse-handler Phase 2 re-detection
- Обновить тесты парсеров с реальными данными

---

## Фаза 4: Деплой и верификация (15 мин)

### Task 4.1: Деплой на prod
```bash
ssh -p 5733 root@213.184.136.221 'su - rudin -c "source ~/.nvm/nvm.sh && cd ~/aklab && bash scripts/deploy-prod.sh"'
```

### Task 4.2: Запуск pipeline с мониторингом
1. Запустить парсинг из UI (depth=200, city=moscow)
2. Мониторить логи в реальном времени
3. Проверить: сколько объектов создано, каких городов

### Task 4.3: Верификация
1. Проверить БД: все объекты с city='moscow' — действительно Москва?
2. Проверить: нет ли объектов из других регионов с city='moscow'
3. Проверить: deviation_percent — рассчитан ли для новых объектов
4. Проверить: focus_score — начислен ли

---

## Файлы которые будут изменены

| Файл | Изменения |
|------|-----------|
| `services/_shared/src/city-detect.ts` | Blacklist не-московских регионов |
| `services/_shared/src/parse-handler.ts` | Приоритет address, убрать description из fallback |
| `services/_shared/src/__tests__/city-detect.test.ts` | Новые тесты |
| `services/parser-*/src/sources/*.ts` | Исправления по результатам аудита |
| `services/analyzer/src/handler.ts` | Проверка deviation calculation |
| `api/src/services/focusEngine.ts` | Проверка scoring rules |

## Риски

1. **Blacklist регионов** может быть неполным — нужен мониторинг
2. **Убрать description из fallback** может снизить количество московских объектов (если адрес не найден)
3. **fabrikant/torgi-gov** могут реально не иметь московских объектов на торгах
4. **Analyzer deviation** может не работать из-за несовпадения property_type

## Open Questions

1. Сколько реальных московских объектов должно быть на каждой площадке?
2. Какой property_type используется для market_references? Совпадает ли с парсерами?
3. Нужно ли добавить больше московских ключевых слов в detectCity (например "Новая Москва")?
