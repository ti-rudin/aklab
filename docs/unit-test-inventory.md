# AKLAB — Unit Test Inventory

> Generated: 2026-06-30  
> Runner: `npm run test` (vitest)  
> Server: dev (192.168.11.151)

## Summary

| # | File | Tests | Description |
|---|------|-------|-------------|
| 1 | `lib/sqlite-queue/__tests__/queue.test.ts` | 38 | Queue: add, process, retry, priority, batch, recovery |
| 2 | `services/_shared/__tests__/strapi-client.test.ts` | 28 | Strapi HTTP client: auth, pagination, errors, retries |
| 3 | `services/_shared/__tests__/parse-handler.test.ts` | 14 | Parse handler: enqueue, error handling, correlation |
| 4 | `services/_shared/__tests__/photo-downloader.test.ts` | 13 | Photo download: fetch, resize, store, errors |
| 5 | `services/_shared/__tests__/queue-worker.test.ts` | 12 | Queue worker: lifecycle, error handling, graceful shutdown |
| 6 | `services/_shared/__tests__/health-server.test.ts` | 6 | Health HTTP server: endpoints, responses |
| 7 | `services/analyzer/__tests__/handler.test.ts` | 13 | Analyzer: undervalued detection, market comparison |
| 8 | `services/digest/__tests__/handler.test.ts` | 15 | Digest: email composition, SMTP, template |
| 9 | `api/src/services/__tests__/focusEngine.test.ts` | 38 | Focus engine: scoreProperty (27) + scoreAllProperties (11) |
| 10 | `api/src/api/property/controllers/__tests__/property.test.ts` | 30 | Property controller: clearNew, servePhoto, getFocus |
| 11 | `api/src/api/cron/controllers/__tests__/cron.test.ts` | 26 | Cron controller: parseSource, analyzeAll, sendDigest, scoreProperties |
| **Total** | | **233** | |

## Key Patterns

- **Mocking**: `vi.mock()` for Strapi modules, `global.strapi` for controller tests
- **Queue**: Real SQLite in-memory DB for sqlite-queue tests
- **Controllers**: `vi.resetAllMocks()` + re-set `db.query.mockReturnValue()` in beforeEach
- **Property controller**: `createCoreController` factory returns function, test calls it with mock strapi

## Running

```bash
# On dev server
ssh rudin@192.168.11.151 "source ~/.nvm/nvm.sh && cd ~/aklab && npm run test"

# Locally (not recommended — needs node_modules)
cd api && npm run test
```
