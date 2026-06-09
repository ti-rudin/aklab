# Добавление нового источника парсинга

Пошаговая инструкция для добавления нового источника в AKLAB.

## Архитектура

Каждый источник парсинга — **отдельный микросервис** в `services/parser-<slug>/`.
Микросервис содержит:
- Health server (Express, порт 127.0.0.1:<PORT>)
- Queue worker (слушает очередь `parse-<slug>`)
- Парсер (реализует интерфейс `SourceParser`)

Общие модули (logger, strapi-client, health server, queue worker) вынесены
в `services/_shared/` (`@aklab/service-shared`). Каждый сервис зависит от shared.

### Схема взаимодействия

```
┌─────────────┐     cron schedule        ┌─────────────────┐
│  Strapi API │ ─────────────────────→   │   SQLite Queue  │
│  (node-cron)│                          │   (queue.db)    │
└─────────────┘                          └────────┬────────┘
                                                  │
                                    ┌─────────────┼─────────────┐
                                    │             │             │
                              ┌─────▼─────┐ ┌────▼──────┐ ┌───▼────┐
                              │ parser-   │ │ parser-   │ │ parser-│
                              │ fabrikant │ │ torgi-gov │ │ <slug> │
                              │ :1345     │ │ :1346     │ │ :13XX  │
                              └───────────┘ └───────────┘ └────────┘
                                    │             │             │
                                    └─────────────┼─────────────┘
                                                  │
                                          ┌───────▼───────┐
                                          │  Strapi API   │
                                          │  (Properties) │
                                          └───────────────┘
```

## Шаги

### 1. Создать сервис

Скопировать шаблон из существующего сервиса:

```bash
cp -r services/parser-fabrikant services/parser-<slug>
```

Изменить в новом сервисе:

**`package.json`:**
```json
{
  "name": "@aklab/parser-<slug>-service",
  ...
}
```

**`src/config.ts`** (если используется свой, иначе shared берёт из env):
- `PORT` — следующий свободный (см. таблицу портов ниже)
- `SERVICE_NAME` — `parser-<slug>`
- `QUEUE_NAME` — `parse-<slug>`

**`src/index.ts`:**
- Заменить имя сервиса в логах

**`src/queue-worker.ts`:**
- Импортировать свой handler

**`src/handler.ts`:**
- Импортировать свой парсер вместо FabrikantParser

### 2. Реализовать парсер

Файл: `services/parser-<slug>/src/sources/<parser>.ts`

Реализовать интерфейс `SourceParser` из `@aklab/service-shared`:

```typescript
import type { SourceParser, ParsedProperty } from '@aklab/service-shared';
import { logger } from '@aklab/service-shared';

export class MyParser implements SourceParser {
  name = '<slug>';

  async parse(): Promise<ParsedProperty[]> {
    // 1. Загрузить данные (HTTP, Playwright, и т.д.)
    // 2. Распарсить в ParsedProperty[]
    // 3. Вернуть массив

    const results: ParsedProperty[] = [];

    // ... логика парсинга ...

    return results;
  }
}
```

Интерфейс `ParsedProperty`:
```typescript
interface ParsedProperty {
  external_id: string;    // Уникальный ID из источника (например, "fabrikant-12345")
  url: string;            // Ссылка на лот
  title: string;          // Заголовок
  address: string;        // Адрес
  city: string;           // moscow | mo | other
  area_sqm?: number;      // Площадь м²
  price?: number;         // Цена руб
  price_per_sqm?: number; // Цена за м²
  property_type: string;  // office | warehouse | retail | production | free_purpose | other
  auction_type: string;   // bankruptcy | privatization | marketplace
  published_at?: string;  // Дата публикации в источнике (ISO)
  description?: string;   // Описание
  contacts?: string;      // Контакты
}
```

### 3. Зарегистрировать в Strapi

**3a. Добавить slug в enum парсера:**

`api/src/api/source/content-types/source/schema.json` — поле `parser`, массив `enum`:
```json
"parser": {
  "type": "enumeration",
  "enum": ["fedresurs", "fabrikant", "torgi-gov", "<slug>"],
  "required": true
}
```

**3b. Обновить seeder:**

`api/src/seeders/index.ts` — функция `seedSources`, добавить запись:
```typescript
{
  name: 'Мой источник',
  slug: '<slug>',
  url: 'https://...',
  parser: '<slug>' as const,
  auction_type: 'bankruptcy' as const,
  region: 'Москва и МО',
  is_active: true,
  schedule: '0 3 * * *',   // ежедневно в 03:00 МСК
  health_port: 13XX,        // порт health server
},
```

**3c. Обновить фронтенд:**

`app/src/views/SourceListView.vue` — массив `availableParsers`:
```typescript
const availableParsers: ParserDef[] = [
  { slug: 'fabrikant', health_port: 1345 },
  { slug: 'torgi-gov', health_port: 1346 },
  { slug: '<slug>', health_port: 13XX },
];
```

### 4. Добавить в PM2

**`ecosystem.config.js`** (prod):
```javascript
{
  name: 'aklab-parser-<slug>',
  cwd: '/home/rudin/aklab/services/parser-<slug>',
  script: 'node',
  args: 'dist/index.js',
  interpreter: 'none',
  env: {
    ...process.env,
    NODE_ENV: 'production',
    PORT: '13XX',
    SERVICE_NAME: 'parser-<slug>',
    QUEUE_NAME: 'parse-<slug>',
    NVM_DIR: '/home/rudin/.nvm',
    PATH: '/home/rudin/.nvm/versions/node/v22.20.0/bin:...',
    QUEUE_DB_PATH: '/home/rudin/aklab/queue.db',
    STRAPI_URL: process.env.STRAPI_INTERNAL_URL || 'http://localhost:1338',
    STRAPI_API_TOKEN: process.env.STRAPI_API_TOKEN || '',
  },
},
```

**`ecosystem-local.config.js`** (dev) — аналогично, PORT/SERVICE_NAME/QUEUE_NAME.

### 5. Обновить deploy-prod.sh

`scripts/deploy-prod.sh`:

В массиве сборки сервисов добавить `<slug>`:
```bash
for svc in parser-fabrikant parser-torgi-gov parser-<slug> analyzer digest; do
```

В health check добавить порт:
```bash
for svc_port in "parser-fabrikant:1345" "parser-torgi-gov:1346" "parser-<slug>:13XX" ...
```

В PM2 stop/restart добавить имя:
```bash
pm2 stop ... aklab-parser-<slug> ...
```

### 6. Обновить smoke test

`scripts/smoke-test.js` — массив microservices:
```javascript
{ name: 'Parser-<slug>', port: 13XX },
```

Имя парсера в массиве `validParsers`.

### 7. Деплой

```bash
git add -A
git commit -m "feat: add parser-<slug> microservice"
git push origin main
# Деплой по команде пользователя
```

### 8. Проверить

```bash
# PM2 — процесс online
pm2 list | grep parser-<slug>

# Health
curl http://localhost:<PORT>/health

# UI — /sources — badge зелёный
# Ручной запуск — кнопка "Запустить" на /sources
```

## Таблица портов

| Сервис               | Порт | Очередь                | PM2 name                    |
|----------------------|------|------------------------|-----------------------------|
| api (Strapi)         | 1338 | —                      | aklab-api                   |
| app (Vite preview)   | 5174 | —                      | aklab-app                   |
| parser-fabrikant     | 1345 | parse-fabrikant        | aklab-parser-fabrikant      |
| parser-torgi-gov     | 1346 | parse-torgi-gov        | aklab-parser-torgi-gov      |
| parser-fedresurs     | 1347 | parse-fedresurs        | aklab-parser-fedresurs (OFF)|
| analyzer             | 1341 | analyze-property       | aklab-analyzer-prod         |
| digest               | 1342 | digest-send            | aklab-digest-prod           |

**Следующий свободный порт: 1348**

## Расписание

По умолчанию — `0 3 * * *` (ежедневно в 03:00 МСК).

Меняется через UI на странице `/sources` (кнопка "Изменить" рядом с расписанием)
или через API: `PUT /api/sources/<documentId>` с полем `schedule`.

Формат — стандартный cron (5 полей: мин час день_мес мес день_нед).
Часовой пояс — Europe/Moscow.

Примеры:
- `0 3 * * *` — каждый день в 03:00
- `0 */6 * * *` — каждые 6 часов
- `*/30 * * * *` — каждые 30 минут
- `0 9 * * 1-5` — по будням в 09:00

## Добавление нового парсера в существующий сервис

Если новый источник использует тот же сайт/API, что и существующий парсер,
можно добавить его как подпарсер внутри существующего сервиса (без создания
отдельного микросервиса). Но для чистоты архитектуры рекомендуется отдельный
сервис.
