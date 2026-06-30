# AKLAB E2E Test Inventory

> Source: `tests/e2e.spec.ts` (~1380 lines)  
> Runner: `npx playwright test` (chromium, headless)  
> Updated: 2026-07-01  
> Base URL: `https://aklab-dev.tirobots.ru`

## Summary

| Section | Name | Tests |
|---------|------|-------|
| 1 | Авторизация | 5 |
| 2 | Список объектов — Все объекты | 10 |
| 3 | Таб "В фокусе" | 18 |
| 4 | Страница объекта (detail) | 6 |
| 5 | Страница Источники | 2 |
| 6 | Страница Настройки | 2 |
| 7 | Страница Эталоны стоимости | 2 |
| 8 | Навигация | 6 |
| 9 | API Smoke Tests | 10 |
| 10 | Dashboard + Rules + Event Log | 10 |
| 11 | Граничные случаи | 5 |
| 12 | Регрессия — фильтр city | 5 |
| 13 | Dashboard — действия | 4 |
| 14 | Список объектов — доп. фичи | 5 |
| 15 | Таб «В фокусе» — доп. фичи | 3 |
| 16 | Детали объекта — доп. фичи | 5 |
| 17 | Источники — доп. фичи | 4 |
| 18 | Рыночные эталоны — доп. фичи | 4 |
| 19 | Настройки — доп. фичи | 3 |
| 20 | Журнал изменений и документация | 3 |
| 21 | Подвал (Footer) | 1 |
| **Total** | | **113** (108 pass, 5 skip) |

## Login Helper — JWT Caching

```ts
// ONE API call per entire test suite — no rate limit issues
let _cachedJWT: string | null = null;

async function ensureAuth(page) {
  if (!_cachedJWT) {
    // Single POST /api/auth/local
    _cachedJWT = body.jwt;
  }
  // Inject into localStorage — no UI login needed
  page.evaluate(() => { localStorage.setItem('jwt', token); });
}
```

**Why**: Strapi `users-permissions` rate limiter (5 req/5min per user+IP) blocks
UI login when 113 tests each call `/api/auth/local`. JWT caching = 1 request total.

## Key Patterns

- All test names in Russian
- `if (await X.isVisible({ timeout }).catch(() => false))` for optional elements
- No hardcoded waits > 5000ms except 2000ms data load
- API tests use `loginAPI(request)` for JWT (also cached)
- Status buttons: click any enabled button, not hardcoded label

## Running

```bash
# On dev server (~5.5 min)
ssh rudin@192.168.11.151 "source ~/.nvm/nvm.sh && cd ~/aklab && npx playwright test"

# Single test
npx playwright test --grep '1.1'

# Specific section
npx playwright test --grep '18\.'
```

## Fix History

| Date | Test | Issue | Fix |
|------|------|-------|-----|
| 2026-06-30 | 10.1 Dashboard | Frontend build stale | Rebuilt `app/` on dev server |
| 2026-06-30 | 16.5 Source link | Nav "Источники" matched regex | Nav → "Парсеры" + aria-label |
| 2026-06-30 | 18.4 Add etalon | Submit text matched addBtn | Submit → "Сохранить" |
| 2026-07-01 | 2.8, 10.1, 11.5, 14.2, 16.1 | Strapi rate limiter (5 req/5min) | JWT caching — 1 API call per suite |
| 2026-07-01 | 16.1 Status change | Button disabled (already in status) | Click any enabled status button |
