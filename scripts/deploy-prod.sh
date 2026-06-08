#!/bin/bash

# Деплой AKLAB в production
# Usage: ./scripts/deploy-prod.sh [--force]

set -e

# NVM PATH
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
export PATH="$HOME/.nvm/versions/node/$(ls "$HOME/.nvm/versions/node" 2>/dev/null | tail -1)/bin:/usr/local/bin:$PATH"

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

FORCE=false
[[ "$1" == "--force" ]] && FORCE=true

# Цвета
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[deploy]${NC} $1"; }
warn() { echo -e "${YELLOW}[deploy]${NC} $1"; }
err()  { echo -e "${RED}[deploy]${NC} $1"; }

# Telegram notification
notify() {
  local msg="$1"
  if [ -n "$TELEGRAM_BOT_TOKEN" ] && [ -n "$TELEGRAM_CHAT_ID" ]; then
    curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      -d "chat_id=${TELEGRAM_CHAT_ID}" \
      -d "text=${msg}" \
      -d "parse_mode=HTML" > /dev/null 2>&1 || true
  fi
}

# Rollback
ROLLBACK_SHA=""
rollback() {
  if [ -n "$ROLLBACK_SHA" ]; then
    err "Rollback на ${ROLLBACK_SHA:0:8}..."
    git checkout "$ROLLBACK_SHA" -- .
    if [ -f "api/.tmp/data.db.bak" ]; then
      cp api/.tmp/data.db.bak api/.tmp/data.db
      log "DB восстановлен из backup"
    fi
    pm2 restart aklab-api aklab-app aklab-parser-bankruptcy-prod aklab-analyzer-prod aklab-digest-prod 2>/dev/null || true
    notify "❌ AKLAB deploy FAILED — rollback к ${ROLLBACK_SHA:0:8}"
  fi
}
trap rollback ERR

# === Step 1: Git pull ===
log "Git pull..."
ROLLBACK_SHA=$(git rev-parse HEAD)
log "Rollback SHA: ${ROLLBACK_SHA:0:8}"
git pull origin main

# === Step 1.5: Bump patch version ===
CURRENT_VERSION=$(node -e "console.log(require('./package.json').version)")
log "Bump version ${CURRENT_VERSION} → next patch..."
NEW_VERSION=$(node -e "
  const fs = require('fs');
  const pkg = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
  const parts = pkg.version.split('.').map(Number);
  parts[2]++;
  pkg.version = parts.join('.');
  fs.writeFileSync('./package.json', JSON.stringify(pkg, null, 2) + '\n');
  console.log(pkg.version);
")
log "New version: ${NEW_VERSION}"

# === Step 2: Pre-flight ===
log "Pre-flight checks..."
node scripts/check-env.js

# Disk space (min 512 MB)
DISK_FREE=$(df -m "$PROJECT_ROOT" | tail -1 | awk '{print $4}')
if [ "$DISK_FREE" -lt 512 ]; then
  err "Недостаточно места на диске: ${DISK_FREE}MB (нужно 512MB)"
  exit 1
fi

# === Step 3: DB backup ===
log "Backup SQLite..."
if [ -f "api/.tmp/data.db" ]; then
  if command -v sqlite3 &> /dev/null; then
    sqlite3 api/.tmp/data.db ".backup api/.tmp/data.db.bak"
    log "Backup: api/.tmp/data.db.bak"
  else
    warn "sqlite3 не установлен — пропускаем backup (apt install sqlite3)"
    cp api/.tmp/data.db api/.tmp/data.db.bak 2>/dev/null || true
  fi
fi

# === Step 4: Smart npm install ===
NEED_INSTALL=false

# node_modules отсутствует — обязательно ставим
if [ ! -d "api/node_modules" ] || [ ! -d "app/node_modules" ] || [ ! -d "lib/sqlite-queue/node_modules" ]; then
  NEED_INSTALL=true
  log "node_modules отсутствует — npm install обязателен"
fi

# Сравниваем hash package-lock.json
if [ "$NEED_INSTALL" != "true" ]; then
  LOCK_HASH_BEFORE=$(grep -v '"version"' "$PROJECT_ROOT/package-lock.json" 2>/dev/null | sha256sum | cut -d' ' -f1 || echo "")
  git checkout HEAD -- package-lock.json 2>/dev/null || true
  LOCK_HASH_AFTER=$(grep -v '"version"' "$PROJECT_ROOT/package-lock.json" 2>/dev/null | sha256sum | cut -d' ' -f1 || echo "")

  if [ "$LOCK_HASH_BEFORE" != "$LOCK_HASH_AFTER" ] || [ "$FORCE" = "true" ]; then
    NEED_INSTALL=true
  fi
fi

if [ "$NEED_INSTALL" = "true" ]; then
  log "npm install (root + workspaces)..."
  npm install --include=dev 2>&1 | tail -5
else
  log "package-lock.json не изменился — пропускаем npm install"
fi

# === Step 5: VITE env extraction ===
log "Extract VITE_ vars → app/.env.local..."
grep -E "^VITE_" .env > app/.env.local 2>/dev/null || true

# === Step 6: Build ===
log "Build lib/sqlite-queue..."
(cd lib/sqlite-queue && npm run build 2>&1 | tail -3)

log "Build API..."
(cd api && npm run build 2>&1 | tail -3)

log "Build App..."
(cd app && npm run build 2>&1 | tail -3)

log "Build services..."
for svc in parser-bankruptcy analyzer digest; do
  if [ -d "services/$svc" ]; then
    log "  Build services/$svc..."
    (cd "services/$svc" && npm run build 2>&1 | tail -3)
  fi
done

# === Step 7: PM2 restart ===
log "PM2 restart (all 5 processes)..."
pm2 stop aklab-api aklab-app aklab-parser-bankruptcy-prod aklab-analyzer-prod aklab-digest-prod 2>/dev/null || true
pm2 start ecosystem.config.js

# === Step 8: Health check ===
# Strapi admin build занимает ~140s + ~10-20s на старт runtime.
# Ждём до 3 минут (18 × 10s) — иначе rollback.
log "Health check..."
sleep 10

STRAPI_OK=false
for i in $(seq 1 18); do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:1338/_health 2>/dev/null || echo "000")
  if [ "$STATUS" = "200" ] || [ "$STATUS" = "204" ]; then
    STRAPI_OK=true
    break
  fi
  warn "Strapi не отвечает (attempt $i/18), ждём 10s..."
  sleep 10
done

if [ "$STRAPI_OK" != "true" ]; then
  err "Strapi не поднялся за 3 минуты!"
  exit 1
fi
log "Strapi OK"

APP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:4173/ 2>/dev/null || echo "000")
if [ "$APP_STATUS" = "200" ]; then
  log "App OK"
else
  warn "App вернул $APP_STATUS (может быть нормально для SPA)"
fi

# Проверяем health микросервисов (не блокирующий — warn)
sleep 5
for svc_port in "parser-bankruptcy:1340" "analyzer:1341" "digest:1342"; do
  SVC_NAME="${svc_port%%:*}"
  SVC_PORT="${svc_port##*:}"
  SVC_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${SVC_PORT}/health" 2>/dev/null || echo "000")
  if [ "$SVC_STATUS" = "200" ]; then
    log "${SVC_NAME} OK (:${SVC_PORT})"
  else
    warn "${SVC_NAME} вернул ${SVC_STATUS} на :${SVC_PORT} (проверьте pm2 logs aklab-${SVC_NAME}-prod)"
  fi
done

# === Step 9: Git commit ===
VERSION=$(node -e "console.log(require('./package.json').version)")
log "Version: $VERSION"
git add package.json api/package.json app/package.json
git commit -m "[release] v${VERSION} -- Deploy production" --allow-empty 2>/dev/null || true
git push origin main 2>/dev/null || warn "Git push не удался (проверьте права)"

# === Done ===
log "Deploy завершён успешно!"
notify "✅ AKLAB v${VERSION} задеплоен"
