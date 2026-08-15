# Узкие исключения security gate для релизов

## v1.1.94 — 15.08.2026

**Статус:** явно принято владельцем для одного production release.

- **Scope:** `api/package-lock.json`: `@strapi/strapi@5.52.0` → `vite@5.4.21`.
- **Finding:** High `GHSA-fx2h-pf6j-xcff` — Vite `server.fs.deny` bypass на Windows alternate paths.
- **Почему не исправлено в этом релизе:** актуальный npm registry подтверждает, что последний совместимый `@strapi/strapi@5.52.0` всё ещё зависим от `vite@5.4.21`; `npm audit fix --dry-run` не предложил совместимого обновления. `--force`, override Vite major и downgrade Strapi не применялись.
- **Остаточный риск:** production не запускает Vite dev server; исключение не распространяется на другие зависимости, advisory или релизы.
- **Критерий отзыва:** до следующего production release повторить audit `api/`; если Strapi публикует совместимый Vite fix, обновить Strapi/lockfile и удалить это исключение. Новый High/Critical или иной dependency path требует нового явного решения владельца.
