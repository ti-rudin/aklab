#!/bin/bash

# Деплой AKLAB в development
# Usage: ./scripts/deploy-dev.sh
# Запускать на dev-сервере (192.168.11.151) от пользователя rudin.

set -euo pipefail

# NVM PATH
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
export PATH="$HOME/.nvm/versions/node/$(ls "$HOME/.nvm/versions/node" 2>/dev/null | tail -1)/bin:/usr/local/bin:$PATH"

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

# === Сервисный манифест ===
PARSER_SLUGS=$(node -e "const s=require('./services/services.json'); console.log(s.parsers.map(p=>p.slug).join(' '))")
ALL_SERVICE_SLUGS=$(node -e "const s=require('./services/services.json'); const all=[...s.parsers,...s.workers]; console.log(all.map(p=>p.slug).join(' '))")
PM2_NAMES=$(node -e "const s=require('./services/services.json'); const all=[...s.core,...s.parsers,...s.workers]; console.log(all.map(p=>p.pm2_name).join(' '))")
HEALTH_CHECKS=$(node -e "const s=require('./services/services.json'); const all=[...s.parsers,...s.workers]; console.log(all.map(p=>p.slug+':'+p.health_port).join(' '))")

# Цвета
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[deploy-dev]${NC} $1"; }
warn() { echo -e "${YELLOW}[deploy-dev]${NC} $1"; }
err()  { echo -e "${RED}[deploy-dev]${NC} $1"; }

# === PM2 daemon Node version check ===
CURRENT_NODE_VER=$(node -v 2>/dev/null | sed 's/^v//')
PM2_DAEMON_NODE=$(pm2 report 2>/dev/null | grep "node version" | awk '{print $NF}' || echo "unknown")
if [ "$PM2_DAEMON_NODE" != "unknown" ] && [ "$PM2_DAEMON_NODE" != "$CURRENT_NODE_VER" ]; then
  warn "PM2 daemon Node v${PM2_DAEMON_NODE} ≠ текущая v${CURRENT_NODE_VER}"
  pm2 update 2>/dev/null || warn "pm2 update не удался"
  log "PM2 daemon обновлён до Node v${CURRENT_NODE_VER}"
fi

# === Rollback ===
ROLLBACK_SHA=""
rollback() {
  if [ -n "$ROLLBACK_SHA" ]; then
    err "Rollback на ${ROLLBACK_SHA:0:8}..."
    git reset --hard "$ROLLBACK_SHA"
    npm rebuild better-sqlite3 2>&1 | tail -3 || true
    (cd api && npm run build 2>&1 | tail -3) || true
    (cd app && npm run build 2>&1 | tail -3) || true
    for svc in $ALL_SERVICE_SLUGS; do
      (cd "services/$svc" && npm run build 2>&1 | tail -3) || true
    done
    pm2 restart $PM2_NAMES 2>/dev/null || true
  fi
}
trap rollback ERR

# === Step 1: Git pull ===
if ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
  warn "Local changes detected — stashing"
  git stash --include-untracked 2>/dev/null || git checkout -- . 2>/dev/null || true
fi

log "Git pull..."
ROLLBACK_SHA=$(git rev-parse HEAD)
log "Rollback SHA: ${ROLLBACK_SHA:0:8}"
git pull origin main

# === Step 2: Smart npm install ===
NEED_INSTALL=false

for dir in api/node_modules app/node_modules lib/sqlite-queue/node_modules services/_shared/node_modules; do
  if [ ! -d "$dir" ]; then
    NEED_INSTALL=true
    break
  fi
done
if [ "$NEED_INSTALL" != "true" ]; then
  for svc in $ALL_SERVICE_SLUGS; do
    if [ ! -d "services/$svc/node_modules" ]; then
      NEED_INSTALL=true
      break
    fi
  done
fi

if [ "$NEED_INSTALL" != "true" ]; then
  LOCK_HASH_BEFORE=$(grep -v '"version"' "$PROJECT_ROOT/package-lock.json" 2>/dev/null | sha256sum | cut -d' ' -f1 || echo "")
  git checkout HEAD -- package-lock.json 2>/dev/null || true
  LOCK_HASH_AFTER=$(grep -v '"version"' "$PROJECT_ROOT/package-lock.json" 2>/dev/null | sha256sum | cut -d' ' -f1 || echo "")
  [ "$LOCK_HASH_BEFORE" != "$LOCK_HASH_AFTER" ] && NEED_INSTALL=true
fi

if [ "$NEED_INSTALL" = "true" ]; then
  log "npm install (root + workspaces)..."
  npm install --include=dev 2>&1 | tail -5
  log "npm install api/..."
  mkdir -p api/node_modules/@aklab
  ln -sf ../../../lib/parse-rules api/node_modules/@aklab/parse-rules
  (cd api && npm install --include=dev 2>&1 | tail -3)
  log "npm install app/..."
  (cd app && npm install 2>&1 | tail -3)
else
  log "package-lock.json не изменился — пропускаем npm install"
fi

# === Step 3: Rebuild native modules ===
log "Rebuild native modules (better-sqlite3)..."
npm rebuild better-sqlite3 2>&1 | tail -3 || true
(cd api && npm rebuild better-sqlite3 2>&1 | tail -3) || true

# === Step 4: VITE env extraction ===
log "Extract VITE_ vars → app/.env.local..."
grep -E "^VITE_" .env > app/.env.local 2>/dev/null || true

# === Step 5: Build ===
log "Build lib/sqlite-queue..."
rm -rf lib/sqlite-queue/dist
(cd lib/sqlite-queue && npm run build 2>&1 | tail -3)

log "Build services/_shared..."
rm -rf services/_shared/dist
(cd services/_shared && npm run build 2>&1 | tail -3)

log "Build API..."
rm -rf api/dist
(cd api && npm run build 2>&1 | tail -3)

log "Build App..."
rm -rf app/dist
(cd app && npm run build 2>&1 | tail -3)

log "Build services..."
for svc in $ALL_SERVICE_SLUGS; do
  if [ -d "services/$svc" ]; then
    rm -rf "services/$svc/dist"
    (cd "services/$svc" && npm run build 2>&1 | tail -3)
  fi
done

# === Step 6: PM2 restart ===
log "PM2 restart..."
pm2 stop $PM2_NAMES 2>/dev/null || true
pm2 start ecosystem.config.js
pm2 save

# === Step 7: Health check ===
log "Health check..."
sleep 10

STRAPI_OK=false
for i in $(seq 1 12); do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:1338/_health 2>/dev/null || echo "000")
  if [ "$STATUS" = "200" ] || [ "$STATUS" = "204" ]; then
    STRAPI_OK=true
    break
  fi
  warn "Strapi не отвечает (attempt $i/12), ждём 10s..."
  sleep 10
done

if [ "$STRAPI_OK" != "true" ]; then
  err "Strapi не поднялся за 2 минуты!"
  exit 1
fi
log "Strapi OK"

APP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:5174/ 2>/dev/null || echo "000")
[ "$APP_STATUS" = "200" ] && log "App OK" || warn "App вернул $APP_STATUS"

sleep 5
for svc_port in $HEALTH_CHECKS; do
  SVC_NAME="${svc_port%%:*}"
  SVC_PORT="${svc_port##*:}"
  SVC_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${SVC_PORT}/health" 2>/dev/null || echo "000")
  [ "$SVC_STATUS" = "200" ] && log "${SVC_NAME} OK (:${SVC_PORT})" || warn "${SVC_NAME} вернул ${SVC_STATUS} на :${SVC_PORT}"
done

log "Deploy dev завершён успешно!"
