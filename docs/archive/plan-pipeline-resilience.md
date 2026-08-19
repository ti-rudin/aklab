# Plan: Pipeline Resilience + SSE + Progress

## Architecture

### Pipeline Service (`api/src/services/pipeline.ts`)

Единый сервис, один код для всех вызовов:

```
pipeline.parseAll(depth)          // все источники
pipeline.parseOne(slug, depth)    // один источник
pipeline.analyze(filters)         // анализ + score
pipeline.digest()                 // дайджест
pipeline.run(depth, filters)      // полный цикл
pipeline.cancel()                 // отмена
```

Каждый этап обновляет `pipeline_state` в БД → SSE broadcast.

### Pipeline State

Singleton в `setting.pipeline_state` (JSON):

```json
{
  "status": "running|idle|cancelling",
  "stage": "parsing_scan|parsing_details|analyzing|digesting|done",
  "message": "Загрузка деталей: 23/50",
  "trigger": "manual|cron",
  "sources_total": 8,
  "sources_done": 3,
  "details_fetched": 23,
  "details_needed": 50,
  "analyze_total": 0,
  "analyze_done": 0,
  "undervalued_count": 0,
  "objects_created": 0,
  "errors": ["torgi-gov: fetch failed"],
  "started_at": "2026-07-05T10:00:00Z",
  "updated_at": "2026-07-05T10:05:30Z"
}
```

### Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `POST /pipeline/start` | POST | Start pipeline (body: `{mode, depth, filters}`) |
| `POST /pipeline/cancel` | POST | Cancel running pipeline |
| `GET /pipeline/status` | GET | Current state (for reconnect) |
| `GET /pipeline/stream` | GET | SSE (realtime) |

### Message Table

| Stage | Message |
|-------|---------|
| `parsing_scan` | `Сканирование источников... (3/8)` |
| `parsing_details` | `Загрузка деталей: 23/50` |
| `parsing_done` | `✓ Парсинг: 5 новых, 50 детальных` |
| `analyzing` | `Анализ: 25/50 объектов` |
| `analyzing_done` | `✓ Анализ: 3 недооценённых из 50` |
| `digesting` | `Отправка дайджеста...` |
| `done` | `✓ Пайплайн завершён` |
| `error` | `⚠ torgi-gov: fetch failed` (pipeline continues) |

---

## Features

### 1. Idempotency Lock

```typescript
async startPipeline(options) {
  const state = await getPipelineState();
  if (state.status === 'running') {
    throw new Error(`Pipeline уже выполняется (запущен ${state.started_at})`);
  }
  if (state.status === 'cancelling') {
    throw new Error('Pipeline отменяется, подождите');
  }
  // proceed
}
```

- One pipeline at a time
- User sees "already running" if tries to start twice
- Cron job skips if pipeline is running

### 2. Cron Uses Pipeline Service

**Before** (copy-paste in cron/index.ts):
```typescript
// analyze cron — own logic
// digest cron — own logic
```

**After:**
```typescript
cron.schedule('0 8 * * *', async () => {
  await pipeline.analyze({ trigger: 'cron' });
});

cron.schedule('0 * * * *', async () => {
  // check hour
  await pipeline.digest({ trigger: 'cron' });
});
```

No code duplication. Cron-triggered runs update pipeline_state → UI shows progress.

### 3. Score Merged with Analysis

**Before:** analyze at 08:00, score at 08:05 (two separate cron jobs, fragile timing).

**After:**
```typescript
async analyze(filters) {
  updateState('analyzing', 'Анализ объектов...');
  // 1. Enqueue analysis jobs
  // 2. Wait for completion
  // 3. Run scoreAllProperties() (batch, fast)
  updateState('analyzing_done', '✓ Анализ: N недооценённых');
}
```

One stage, guaranteed ordering.

### 4. Skip Analysis if No New Objects

```typescript
async analyze(filters) {
  const unanalyzed = await countUnanalyzed(filters);
  if (unanalyzed === 0) {
    updateState('analyzing_skipped', 'Анализ пропущен — нет новых объектов');
    return { skipped: true };
  }
  // proceed
}
```

Pipeline continues to digest without waiting.

### 5. Batch Enqueue for Analysis

**Before:** `findMany(limit=-1)` → 1000+ individual `addToQueue` calls.

**After:**
```typescript
async analyze(filters) {
  const properties = await findUnanalyzed(filters);
  const total = properties.length;

  // Batch enqueue in chunks of 50
  for (let i = 0; i < total; i += 50) {
    const batch = properties.slice(i, i + 50);
    for (const prop of batch) {
      queueService.addToQueue('analyze-property', { documentId: prop.documentId });
    }
    updateState('analyzing', `Анализ: ${i}/${total} объектов`);
    await sleep(100); // yield to event loop
  }
}
```

### 6. Cancel Button

```typescript
async cancel() {
  await updatePipelineState({ status: 'cancelling', message: 'Отмена...' });
}

// Each stage checks before next iteration:
if (await isCancelled()) {
  updateState('cancelled', 'Пайплайн отменён пользователем');
  return;
}
```

UI shows "Отменить" button while pipeline is running.

### 7. Error Resilience

Each stage wrapped in try-catch. Errors collected, pipeline continues:

```typescript
async run(depth, filters) {
  const errors: string[] = [];

  try { await this.parseAll(depth); }
  catch (e) { errors.push(`Парсинг: ${e.message}`); }

  try { await this.analyze(filters); }
  catch (e) { errors.push(`Анализ: ${e.message}`); }

  try { await this.digest(); }
  catch (e) { errors.push(`Дайджест: ${e.message}`); }

  if (errors.length > 0) {
    updateState('done_with_errors', 'Пайплайн завершён с ошибками', { errors });
  } else {
    updateState('done', '✓ Пайплайн завершён');
  }
}
```

---

## Frontend: SSE-based SettingsView

### Page Load

```
GET /pipeline/status
├── status=running → show progress + connect SSE
├── status=idle → show last run summary + buttons
└── status=done → show results + buttons
```

### SSE Events

```typescript
const es = new EventSource('/pipeline/stream');
es.addEventListener('progress', (e) => {
  const data = JSON.parse(e.data);
  // Update: stage, message, counters
});
es.addEventListener('done', (e) => {
  // Show final summary
});
es.addEventListener('error', (e) => {
  // Show error banner (don't hide — pipeline continues)
});
```

### UI Layout

```
┌─────────────────────────────────────┐
│  ▶ Ручной запуск    Глубина: [200] │  ← buttons (hidden while running)
│  ◼ Отменить                         │  ← cancel button (shown while running)
├─────────────────────────────────────┤
│  ⏳ Сканирование источников... (3/8)│
│  ⏳ Загрузка деталей: 23/50         │
│  ✓ Парсинг: 5 новых               │
│  ⏳ Анализ: 25/50                   │
│  ○ Дайджест                         │
├─────────────────────────────────────┤
│  ⚠ torgi-gov: fetch failed          │  ← errors (red, non-blocking)
└─────────────────────────────────────┘
```

---

## Files

| File | Action |
|------|--------|
| `api/src/services/pipeline.ts` | **New** — orchestrator |
| `api/src/services/pipeline-sse.ts` | **New** — SSE connection manager |
| `api/src/api/cron/controllers/cron.ts` | Refactor — delegate to pipeline |
| `api/src/api/cron/routes/cron.ts` | +4 pipeline routes |
| `api/src/cron/index.ts` | Simplify — call pipeline.analyze/digest |
| `setting/schema.json` | +`pipeline_state` (json, default null) |
| `app/src/views/SettingsView.vue` | SSE-based UI |

## Implementation Order

1. `pipeline.ts` — core orchestrator with state management
2. `pipeline-sse.ts` — SSE broadcast
3. Routes + controller endpoints
4. SettingsView.vue — SSE UI
5. Refactor cron/index.ts to use pipeline
6. Tests
7. Deploy
