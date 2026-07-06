# Настройка Branch Protection — AKLAB

## main (production)
1. GitHub → Settings → Branches → Add rule
2. Branch name pattern: `main`
3. ✅ Require a pull request before merging
4. ✅ Require status checks to pass before merging (ci.yml)
5. ✅ Do not allow bypassing the above settings
6. ✅ Restrict who can push to matching branches (nobody — only PR merge)

## dev (development)
1. Branch name pattern: `dev`
2. ✅ Require a pull request before merging
3. Не требовать CI (для быстрого dev-цикла)
