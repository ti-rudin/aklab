#!/bin/bash

# Деплой AKLAB в production
# Usage: ./scripts/deploy-prod.sh [--force] [--ci]

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

# Telegram credentials из .env (если не заданы в shell)
if [ -z "${TELEGRAM_BOT_TOKEN:-}" ] && [ -f .env ]; then
  export TELEGRAM_BOT_TOKEN="$(grep -E '^TELEGRAM_BOT_TOKEN=' .env | cut -d= -f2-)"
  export TELEGRAM_CHAT_ID="$(grep -E '^TELEGRAM_CHAT_ID=' .env | cut -d= -f2-)"
fi

FORCE=false
CI_MODE=false
for arg in "$@"; do
  case $arg in
    --force) FORCE=true ;;
    --ci) CI_MODE=true ;;
  esac
done

# Цвета
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[deploy]${NC} $1"; }
warn() { echo -e "${YELLOW}[deploy]${NC} $1"; }
err()  { echo -e "${RED}[deploy]${NC} $1"; }

# === PM2 daemon Node version check ===
CURRENT_NODE_VER=$(node -v 2>/dev/null | sed 's/^v//')
PM2_DAEMON_NODE=$(pm2 report 2>/dev/null | grep "node version" | awk '{print $NF}' || echo "unknown")
if [ "$PM2_DAEMON_NODE" != "unknown" ] && [ "$PM2_DAEMON_NODE" != "$CURRENT_NODE_VER" ]; then
  warn "PM2 daemon Node v${PM2_DAEMON_NODE} ≠ текущая v${CURRENT_NODE_VER}"
  warn "Daemon перезапускается с правильным окружением..."
  pm2 update 2>/dev/null || warn "pm2 update не удался — проверьте вручную"
  log "PM2 daemon обновлён до Node v${CURRENT_NODE_VER}"
  # Обновить systemd-сервис чтобы при перезагрузке использовалась правильная Node
  PM2_SERVICE="/etc/systemd/system/pm2-rudin.service"
  if [ -f "$PM2_SERVICE" ] && [ -w "$PM2_SERVICE" ]; then
    NODE_BIN=$(which node)
    NODE_DIR=$(dirname "$NODE_BIN")
    if ! grep -q "$NODE_DIR" "$PM2_SERVICE"; then
      sed -i "s|Environment=PATH=.*|Environment=PATH=$NODE_DIR:/usr/local/bin:/usr/bin:/bin|" "$PM2_SERVICE"
      systemctl daemon-reload 2>/dev/null || true
      log "systemd pm2-rudin.service обновлён: PATH → $NODE_DIR"
    fi
  fi
fi

# Telegram notification
notify() {
  local msg="$1"
  if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ]; then
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
    git reset --hard "$ROLLBACK_SHA"
    # Rebuild после rollback (dist/ может содержать новую версию)
    log "Rebuild на rollback SHA..."
    npm rebuild better-sqlite3 2>&1 | tail -3 || true
    (cd api && npm rebuild better-sqlite3 2>&1 | tail -3) || true
    (cd lib/sqlite-queue && npm run build 2>&1 | tail -3) || true
    (cd services/_shared && npm run build 2>&1 | tail -3) || true
    (cd api && npm run build 2>&1 | tail -3) || true
    (cd app && npm run build 2>&1 | tail -3) || true
    for svc in $ALL_SERVICE_SLUGS; do
      (cd "services/$svc" && npm run build 2>&1 | tail -3) || true
    done
    if [ -f "api/.tmp/data.db.bak" ]; then
      cp api/.tmp/data.db.bak api/.tmp/data.db
      log "DB восстановлен из backup"
    fi
    pm2 restart $PM2_NAMES 2>/dev/null || true
    if [ "$CI_MODE" = "true" ]; then
      bash "$PROJECT_ROOT/scripts/notify-deploy.sh" failure prod "unknown" "" "Rollback to ${ROLLBACK_SHA:0:8}"
    else
      notify "❌ AKLAB deploy FAILED — rollback к ${ROLLBACK_SHA:0:8}"
    fi
  fi
}
trap rollback ERR

# ВАЖНО: .env файл и PM2 daemon env — два разных источника секретов.
# PM2 daemon env захватывается в момент `pm2 start`. Если .env изменён
# ПОСЛЕ старта — PM2 процессы используют старые значения.
# Решение: `pm2 restart --update-env` или явная синхронизация (ниже).
# См. gotchas #24, #33.

# === Step 0.5: Critical env vars sync check ===
if [ -f ".env" ]; then
  ENV_SALT=$(grep -E "^API_TOKEN_SALT=" .env 2>/dev/null | cut -d= -f2 || echo "")
  PM2_SALT=$(pm2 jlist 2>/dev/null | node -e "try{const a=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));const e=a.find(x=>x.name==='aklab-api');console.log((e&&e.pm2_env&&e.pm2_env.API_TOKEN_SALT)||'')}catch{console.log('')}" 2>/dev/null || echo "")
  if [ -n "$ENV_SALT" ] && [ -n "$PM2_SALT" ] && [ "$ENV_SALT" != "$PM2_SALT" ]; then
    warn ".env API_TOKEN_SALT ≠ PM2 daemon env — обновляю .env из PM2"
    # PM2 daemon env — source of truth (так как он используется при запуске)
    sed -i "s|^API_TOKEN_SALT=.*|API_TOKEN_SALT=${PM2_SALT}|" .env
    log ".env API_TOKEN_SALT синхронизирован с PM2 daemon"
  fi
fi

# === Step 1: Checkout main and git pull ===
# Discard uncommitted local changes (package-lock.json, etc.) that block git pull
if ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
  warn "Local changes detected — stashing before checkout"
  git stash --include-untracked 2>/dev/null || git checkout -- . 2>/dev/null || true
fi

log "Checkout main..."
CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" != "main" ]; then
  # Stash local changes if any
  if ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
    log "Stashing local changes before checkout..."
    git stash
  fi
  git checkout main
fi
log "Git pull..."
ROLLBACK_SHA=$(git rev-parse HEAD)
log "Rollback SHA: ${ROLLBACK_SHA:0:8}"
if [ "$CI_MODE" = "true" ]; then
  # CI mode: discard local changes (version bump & changelog are committed by CI)
  git reset --hard HEAD 2>/dev/null || true
fi
git pull origin main

# === Step 1.5: Bump patch version (local only) ===
if [ "$CI_MODE" != "true" ]; then
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
else
  NEW_VERSION=$(node -e "console.log(require('./package.json').version)")
  log "CI mode: version ${NEW_VERSION} (bumped by CI workflow)"
fi

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
BACKUP_DIR="$HOME/aklab-backups"
mkdir -p "$BACKUP_DIR"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

if [ -f "api/.tmp/data.db" ]; then
  if command -v sqlite3 &> /dev/null; then
    sqlite3 api/.tmp/data.db ".backup api/.tmp/data.db.bak"
    sqlite3 api/.tmp/data.db ".backup $BACKUP_DIR/data-${TIMESTAMP}.db"
    log "Backup: api/.tmp/data.db.bak + $BACKUP_DIR/data-${TIMESTAMP}.db"
  else
    warn "sqlite3 не установлен — пропускаем backup (apt install sqlite3)"
    cp api/.tmp/data.db api/.tmp/data.db.bak 2>/dev/null || true
    cp api/.tmp/data.db "$BACKUP_DIR/data-${TIMESTAMP}.db" 2>/dev/null || true
  fi
  # Хранить последние 7 бэкапов
  ls -t "$BACKUP_DIR"/data-*.db 2>/dev/null | tail -n +8 | xargs rm -f 2>/dev/null || true
fi

if [ -f "queue.db" ]; then
  cp queue.db "$BACKUP_DIR/queue-${TIMESTAMP}.db" 2>/dev/null || true
  log "Backup: queue.db → $BACKUP_DIR/queue-${TIMESTAMP}.db"
fi

# === Step 4: Smart npm install ===
NEED_INSTALL=false

# node_modules отсутствует — обязательно ставим
for dir in api/node_modules app/node_modules lib/sqlite-queue/node_modules services/_shared/node_modules; do
  if [ ! -d "$dir" ]; then
    NEED_INSTALL=true
    log "node_modules отсутствует в $dir — npm install обязателен"
    break
  fi
done
if [ "$NEED_INSTALL" != "true" ]; then
  for svc in $ALL_SERVICE_SLUGS; do
    if [ ! -d "services/$svc/node_modules" ]; then
      NEED_INSTALL=true
      log "node_modules отсутствует в services/$svc — npm install обязателен"
      break
    fi
  done
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
  log "npm install api/..."
  # Link local workspace packages for api/ (not in root workspaces)
  mkdir -p api/node_modules/@aklab
  ln -sf ../../../lib/parse-rules api/node_modules/@aklab/parse-rules
  (cd api && npm install --include=dev 2>&1 | tail -3)
  log "npm install app/..."
  (cd app && npm install 2>&1 | tail -3)
  log "Install Playwright system deps + chromium..."
  npx playwright install-deps chromium 2>&1 | tail -3 || true
  npx playwright install chromium 2>&1 | tail -3
   # Symlinks для headless chromium если версии не совпадают (Ubuntu 26.04 workaround)
   PW_CACHE="$HOME/.cache/ms-playwright"
   for dir in "$PW_CACHE"/chromium-122[0-9]; do
     [ -d "$dir" ] || continue
     target="${dir%-*}-1223"
     [ -d "$target" ] || ln -sf "$dir" "$target" 2>/dev/null || true
   done
   for dir in "$PW_CACHE"/chromium_headless_shell-122[0-9]; do
     [ -d "$dir" ] || continue
     target="${dir%-*}-1223"
     [ -d "$target" ] || ln -sf "$dir" "$target" 2>/dev/null || true
   done
else
  log "package-lock.json не изменился — пропускаем npm install"
  # app/ и api/ не в workspaces — проверяем их node_modules отдельно
  if [ ! -d "api/node_modules" ] || [ ! -d "app/node_modules" ]; then
    log "node_modules отсутствует в api/ или app/ — install обязателен"
    (cd api && npm install --include=dev 2>&1 | tail -3)
    (cd app && npm install 2>&1 | tail -3)
  fi
fi

# === Step 4.5: Rebuild native modules for current Node ===
log "Rebuild native modules (better-sqlite3)..."
npm rebuild better-sqlite3 2>&1 | tail -3 || true
(cd api && npm rebuild better-sqlite3 2>&1 | tail -3) || true
# Services with better-sqlite3 (analyzer, digest, photo-fetcher use it via sqlite-queue)
for svc in analyzer digest photo-fetcher; do
  if [ -d "services/$svc/node_modules/better-sqlite3" ]; then
    (cd "services/$svc" && npm rebuild better-sqlite3 2>&1 | tail -3) || true
  fi
done

# === Step 5: VITE env extraction ===
log "Extract VITE_ vars → app/.env.local..."
grep -E "^VITE_" .env > app/.env.local 2>/dev/null || true

# === Step 6: Build ===
log "Build lib/sqlite-queue (clean dist first)..."
rm -rf lib/sqlite-queue/dist
(cd lib/sqlite-queue && npm run build 2>&1 | tail -3)

log "Build services/_shared (clean dist first)..."
rm -rf services/_shared/dist
(cd services/_shared && npm run build 2>&1 | tail -3)
if [ ! -f services/_shared/dist/parse-handler.js ]; then
  err "_shared build FAILED — parse-handler.js missing"
  exit 1
fi
log "_shared build verified"

log "Build API (clean dist first)..."
rm -rf api/dist
(cd api && npm run build 2>&1 | tail -3)

log "Build App (clean dist first)..."
rm -rf app/dist
(cd app && npm run build 2>&1 | tail -3)

log "Build services..."
for svc in $ALL_SERVICE_SLUGS; do
  if [ -d "services/$svc" ]; then
    log "  Build services/$svc (clean dist first)..."
    rm -rf "services/$svc/dist"
    (cd "services/$svc" && npm run build 2>&1 | tail -3)
  fi
done

# === Step 7: PM2 restart ===
log "PM2 restart (all processes)..."
pm2 stop $PM2_NAMES 2>/dev/null || true
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
for svc_port in $HEALTH_CHECKS; do
  SVC_NAME="${svc_port%%:*}"
  SVC_PORT="${svc_port##*:}"
  SVC_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${SVC_PORT}/health" 2>/dev/null || echo "000")
  if [ "$SVC_STATUS" = "200" ]; then
    log "${SVC_NAME} OK (:${SVC_PORT})"
  else
    warn "${SVC_NAME} вернул ${SVC_STATUS} на :${SVC_PORT} (проверьте pm2 logs aklab-${SVC_NAME}-prod)"
  fi
done


# === Step 9: Generate changelog (local only — CI handles this) ===
if [ "$CI_MODE" != "true" ]; then
log "Генерация changelog..."
CHANGELOG_JSON="$PROJECT_ROOT/app/public/changelog.json"
CHANGELOG_ITEMS=$(node "$PROJECT_ROOT/scripts/generate-changelog-ai.js" "$NEW_VERSION" 2>/tmp/changelog-ai.log || echo '')

if [ -z "$CHANGELOG_ITEMS" ] || [ "$CHANGELOG_ITEMS" = '[]' ]; then
  log "AI changelog пуст — fallback на rule-based"
  CHANGELOG_ITEMS=$(node "$PROJECT_ROOT/scripts/generate-changelog.js" "$NEW_VERSION" 2>/tmp/changelog-gen.log || echo '')
fi

if [ -n "$CHANGELOG_ITEMS" ] && [ "$CHANGELOG_ITEMS" != '[{"text":"Улучшения стабильности и производительности","type":"improvement"}]' ]; then
  # Дата и время по Москве (UTC+3), русские названия месяцев
  MOSCOW_DATE=$(node -e "
    const d = new Date();
    const msk = new Date(d.toLocaleString('en-US', {timeZone:'Europe/Moscow'}));
    const months = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
    process.stdout.write(msk.getDate() + ' ' + months[msk.getMonth()] + ' ' + msk.getFullYear());
  ")
  CHANGELOG_TIME=$(node -e "
    const d = new Date();
    const msk = new Date(d.toLocaleString('en-US', {timeZone:'Europe/Moscow'}));
    process.stdout.write(String(msk.getHours()).padStart(2,'0') + ':' + String(msk.getMinutes()).padStart(2,'0'));
  ")
  CHANGELOG_DATE="$MOSCOW_DATE"

  # Добавляем новую запись в начало changelog.json
  node -e "
    const fs = require('fs');
    const items = JSON.parse(process.argv[1]);
    const changelog = JSON.parse(fs.readFileSync('$CHANGELOG_JSON', 'utf8'));
    changelog.unshift({
      version: 'v$NEW_VERSION',
      date: '$CHANGELOG_DATE',
      time: '$CHANGELOG_TIME',
      items: items
    });
    fs.writeFileSync('$CHANGELOG_JSON', JSON.stringify(changelog, null, 2) + '\n');
  " "$CHANGELOG_ITEMS"
  log "changelog.json обновлён: v${NEW_VERSION}"
else
  log "Changelog: fallback (нет коммитов для генерации)"
fi

# Копируем changelog.json в dist (build уже был на шаге 6)
cp "$CHANGELOG_JSON" "$PROJECT_ROOT/app/dist/changelog.json" 2>/dev/null && log "changelog.json → dist/"
else
  log "CI mode: changelog generated by CI workflow"
  # Копируем changelog.json в dist (пришёл из CI через git pull)
  cp "$PROJECT_ROOT/app/public/changelog.json" "$PROJECT_ROOT/app/dist/changelog.json" 2>/dev/null && log "changelog.json → dist/"
fi

# === Step 10: Git commit (local only — CI handles this) ===
VERSION=$(node -e "console.log(require('./package.json').version)")
log "Version: $VERSION"

if [ "$CI_MODE" != "true" ]; then
# Ensure git identity for CI environments
git config user.email "deploy@aklab.tirobots.ru" 2>/dev/null || true
git config user.name "AKLAB Deploy" 2>/dev/null || true

git add package.json api/package.json app/package.json app/public/changelog.json
git commit -m "[release] v${VERSION} -- Deploy production" || warn "Git commit не удался"
git push origin main || warn "Git push не удался (проверьте права)"
else
  log "CI mode: git commit/push handled by CI workflow"
fi

# === Done ===
log "Deploy завершён успешно!"

CHANGELOG_JSON="$PROJECT_ROOT/app/public/changelog.json"

if [ "$CI_MODE" = "true" ]; then
  # В CI-режиме — email вместо Telegram
  bash "$PROJECT_ROOT/scripts/notify-deploy.sh" success prod "$VERSION" "$CHANGELOG_JSON"
else
  notify "✅ AKLAB v${VERSION} задеплоен"
fi
