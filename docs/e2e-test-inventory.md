# AKLAB E2E Test Inventory

> Source: `tests/e2e.spec.ts` (~1365 lines)  
> Runner: `npx playwright test` (chromium, headless)  
> Generated: 2026-06-30  
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
| **Total** | | **~113** |

## Login Helper

```ts
async function login(page) {
  // 3 retries, waitForURL, timeout 20000
  // Credentials: TEST_USER_EMAIL / TEST_USER_PASSWORD env vars
}
```

## Key Patterns

- All test names in Russian
- `if (await X.isVisible({ timeout }).catch(() => false))` for optional elements
- No hardcoded waits > 5000ms except 2000ms data load
- API tests use `loginAPI(request)` for JWT

## Running

```bash
# On dev server
ssh rudin@192.168.11.151 "source ~/.nvm/nvm.sh && cd ~/aklab && npx playwright test"

# Single test
npx playwright test --grep '1.1'

# Specific section
npx playwright test --grep '18\.'
```

## Frontend Fixes Applied (2026-06-30)

| Test | Issue | Fix |
|------|-------|-----|
| 10.1 Dashboard | Frontend build stale | Rebuilt `app/` on dev server |
| 16.5 Source link | Nav "Источники" matched regex before detail link | Nav → "Парсеры" + aria-label="Источники" |
| 18.4 Add etalon | Submit "Добавить" matched addBtn regex | Submit text → "Сохранить", isFormValid accepts name |
| 11.5 Not found | Already implemented | No change needed |
| 14.2 Clear dialog | Already implemented | No change needed |
