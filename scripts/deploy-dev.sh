#!/usr/bin/env bash

# Immutable deploy AKLAB to development.
# Usage: ./scripts/deploy-dev.sh --ref <exact-origin-main-sha> [--rollback-ref <last-known-good-sha>] [--force]
# Run on dev server (192.168.11.151) as user rudin.

set -Eeuo pipefail
umask 077

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
export PATH="$HOME/.nvm/versions/node/$(ls "$HOME/.nvm/versions/node" 2>/dev/null | tail -1)/bin:/usr/local/bin:$PATH"

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"
# shellcheck source=lib/deploy-git-preflight.sh
source "$PROJECT_ROOT/scripts/lib/deploy-git-preflight.sh"

FORCE=false
EXPECTED_SHA=""
EXPLICIT_ROLLBACK_SHA=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --force) FORCE=true ;;
    --ref)
      [ "$#" -ge 2 ] || { echo "[deploy-dev] ERROR: --ref требует SHA" >&2; exit 2; }
      EXPECTED_SHA="$2"
      shift
      ;;
    --rollback-ref)
      [ "$#" -ge 2 ] || { echo "[deploy-dev] ERROR: --rollback-ref требует SHA" >&2; exit 2; }
      EXPLICIT_ROLLBACK_SHA="$2"
      shift
      ;;
    *) echo "[deploy-dev] ERROR: неизвестный аргумент: $1" >&2; exit 2 ;;
  esac
  shift
done
[ -n "$EXPECTED_SHA" ] || { echo "[deploy-dev] ERROR: обязателен --ref <exact SHA>" >&2; exit 2; }

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'
log()  { echo -e "${GREEN}[deploy-dev]${NC} $1"; }
warn() { echo -e "${YELLOW}[deploy-dev]${NC} $1"; }
err()  { echo -e "${RED}[deploy-dev]${NC} $1"; }

# Git must be clean before any PM2, build, DB or filesystem side effect.
CHECKOUT_SHA="$(git rev-parse HEAD)"
DEPLOY_SHA="$(ensure_deploy_git_preflight "$EXPECTED_SHA")"
log "Deploy SHA: ${DEPLOY_SHA:0:8}"

STATE_DIR="$HOME/aklab-deploy-state"
LAST_SUCCESS_FILE="$STATE_DIR/dev-last-successful-sha"
if [ -n "$EXPLICIT_ROLLBACK_SHA" ]; then
  ROLLBACK_SHA="$EXPLICIT_ROLLBACK_SHA"
elif [ -s "$LAST_SUCCESS_FILE" ]; then
  ROLLBACK_SHA="$(tr -d '[:space:]' < "$LAST_SUCCESS_FILE")"
else
  err "No recorded last-success SHA; first deploy requires --rollback-ref <exact LKG SHA>"
  false
fi
[[ "$ROLLBACK_SHA" =~ ^[0-9a-f]{40}$ ]] || { err "Rollback SHA must be exact 40-character lowercase hex"; false; }
git cat-file -e "${ROLLBACK_SHA}^{commit}" 2>/dev/null || { err "Rollback SHA is not a local commit"; false; }
git merge-base --is-ancestor "$ROLLBACK_SHA" "$DEPLOY_SHA" || { err "Rollback SHA is not an ancestor of deploy SHA"; false; }
log "Rollback SHA: ${ROLLBACK_SHA:0:8}"

PARSER_SLUGS=$(node -e "const s=require('./services/services.json'); console.log(s.parsers.map(p=>p.slug).join(' '))")
ALL_SERVICE_SLUGS=$(node -e "const s=require('./services/services.json'); const all=[...s.parsers,...s.workers]; console.log(all.map(p=>p.slug).join(' '))")
PM2_NAMES=$(node -e "const s=require('./services/services.json'); const all=[...s.core,...s.parsers,...s.workers]; console.log(all.map(p=>p.pm2_name).join(' '))")
HEALTH_CHECKS=$(node -e "const s=require('./services/services.json'); const all=[...s.parsers,...s.workers]; console.log(all.map(p=>p.slug+':'+p.health_port).join(' '))")
RUNTIME_ARTIFACT_PATHS=(api/dist app/dist lib/sqlite-queue/dist services/_shared/dist)
for svc in $ALL_SERVICE_SLUGS; do
  RUNTIME_ARTIFACT_PATHS+=("services/$svc/dist")
done
ARTIFACT_BACKUP_DIR=""
PRESERVE_ARTIFACT_BACKUP=false

record_last_success() {
  local sha="$1" tmp
  mkdir -p "$STATE_DIR" || return 1
  chmod 700 "$STATE_DIR" || return 1
  tmp="$LAST_SUCCESS_FILE.tmp.$$"
  printf '%s\n' "$sha" > "$tmp" || return 1
  chmod 600 "$tmp" || return 1
  mv "$tmp" "$LAST_SUCCESS_FILE" || return 1
}

verify_runtime_health() {
  local label="${1:-runtime}" status app_status svc_port svc_name svc_port_number svc_status
  local strapi_ok=false failed_health=0

  sleep 10
  for i in $(seq 1 18); do
    status="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:1338/_health 2>/dev/null || true)"
    status="${status:-000}"
    if [ "$status" = 200 ] || [ "$status" = 204 ]; then strapi_ok=true; break; fi
    warn "$label Strapi attempt $i/18 returned $status"
    sleep 10
  done
  if [ "$strapi_ok" != true ]; then err "$label Strapi health timeout"; return 1; fi

  app_status="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:5174/ 2>/dev/null || true)"
  app_status="${app_status:-000}"
  if [ "$app_status" != 200 ]; then err "$label app returned $app_status"; return 1; fi

  sleep 5
  for svc_port in $HEALTH_CHECKS; do
    svc_name="${svc_port%%:*}"
    svc_port_number="${svc_port##*:}"
    svc_status="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${svc_port_number}/health" 2>/dev/null || true)"
    svc_status="${svc_status:-000}"
    if [ "$svc_status" = 200 ]; then
      log "$label $svc_name OK"
    else
      err "$label $svc_name returned $svc_status"
      failed_health=$((failed_health + 1))
    fi
  done
  if [ "$failed_health" -ne 0 ]; then err "$label: $failed_health service health checks failed"; return 1; fi
}

create_artifact_backup() {
  local tmp
  mkdir -p "$STATE_DIR" || return 1
  chmod 700 "$STATE_DIR" || return 1
  tmp="$(mktemp -d "$STATE_DIR/runtime-artifacts.XXXXXX")" || return 1
  if ! snapshot_deploy_artifacts "$tmp" "${RUNTIME_ARTIFACT_PATHS[@]}"; then
    rm -rf "$tmp"
    return 1
  fi
  PRESERVE_ARTIFACT_BACKUP=false
  ARTIFACT_BACKUP_DIR="$tmp"
  log "Pre-deploy runtime artifacts snapshotted"
}

cleanup_artifact_backup() {
  if [ "$PRESERVE_ARTIFACT_BACKUP" = true ]; then
    return 0
  fi
  if [ -n "$ARTIFACT_BACKUP_DIR" ] && [ -d "$ARTIFACT_BACKUP_DIR" ]; then
    rm -rf "$ARTIFACT_BACKUP_DIR" || return 1
  fi
  ARTIFACT_BACKUP_DIR=""
}

run_rollback_rebuild() {
  local path
  git reset --hard "$ROLLBACK_SHA" || return 1
  npm ci --include=dev 2>&1 | tail -5 || return 1
  mkdir -p api/node_modules/@aklab || return 1
  ln -sfn ../../../lib/parse-rules api/node_modules/@aklab/parse-rules || return 1
  (cd api && npm ci --include=dev 2>&1 | tail -3) || return 1
  (cd app && npm ci 2>&1 | tail -3) || return 1
  npm rebuild better-sqlite3 2>&1 | tail -3 || true
  (cd api && npm rebuild better-sqlite3 2>&1 | tail -3) || true
  for path in "${RUNTIME_ARTIFACT_PATHS[@]}"; do
    rm -rf "$path" || return 1
  done
  (cd lib/sqlite-queue && npm run build 2>&1 | tail -3) || return 1
  (cd services/_shared && npm run build 2>&1 | tail -3) || return 1
  (cd api && npm run build 2>&1 | tail -3) || return 1
  (cd app && npm run build 2>&1 | tail -3) || return 1
  for svc in $ALL_SERVICE_SLUGS; do
    (cd "services/$svc" && npm run build 2>&1 | tail -3) || return 1
  done
  pm2 startOrRestart ecosystem.config.js >/dev/null || return 1
  pm2 save >/dev/null || return 1
  verify_runtime_health rollback || return 1
  record_last_success "$ROLLBACK_SHA" || return 1
}

restore_predeploy_runtime() {
  if [ -z "$ARTIFACT_BACKUP_DIR" ] || [ ! -d "$ARTIFACT_BACKUP_DIR" ]; then
    err "Pre-deploy runtime artifact snapshot is unavailable"
    return 1
  fi
  git reset --hard "$ROLLBACK_SHA" || return 1
  restore_deploy_artifacts "$ARTIFACT_BACKUP_DIR" "${RUNTIME_ARTIFACT_PATHS[@]}" || return 1
  pm2 startOrRestart ecosystem.config.js >/dev/null || return 1
  pm2 save >/dev/null || return 1
}

rollback() {
  trap - ERR
  err "Rollback приложения на ${ROLLBACK_SHA:0:8}; DB/backups/additive rows не удаляются"
  if run_rollback_rebuild; then
    if ! cleanup_artifact_backup; then
      warn "Rollback succeeded but runtime artifact snapshot cleanup failed"
    fi
    log "Rollback accepted: sha=$ROLLBACK_SHA"
    return
  fi

  err "Clean rollback rebuild failed; restoring pre-deploy runtime artifacts"
  if restore_predeploy_runtime; then
    log "Pre-deploy runtime artifacts restored after rollback build failure"
    if ! cleanup_artifact_backup; then
      warn "Fallback restore succeeded but runtime artifact snapshot cleanup failed"
    fi
  else
    PRESERVE_ARTIFACT_BACKUP=true
    err "Pre-deploy runtime artifact restore was incomplete; snapshot retained for manual recovery"
  fi
  return 1
}

# Wave A must start with the feature disabled. Do not normalize case/whitespace.
if [ -f .env ] && grep -qx 'MULTIUSER_ENABLED=true' .env; then
  err "Wave A требует MULTIUSER_ENABLED != exact true"
  false
fi

CURRENT_NODE_VER="$(node -v 2>/dev/null | sed 's/^v//')"
if ! PM2_DAEMON_NODE="$(pm2 report 2>/dev/null | parse_pm2_daemon_node_version)"; then
  err "Cannot determine one authoritative PM2 daemon Node version"
  false
fi
if [ "$PM2_DAEMON_NODE" != "$CURRENT_NODE_VER" ]; then
  err "PM2 daemon Node v${PM2_DAEMON_NODE} != current v${CURRENT_NODE_VER}"
  err "Shared dev daemon also owns TODOIT; refusing automatic pm2 update"
  false
fi

log "Environment preflight"
node scripts/check-env.js
DISK_FREE="$(df -m "$PROJECT_ROOT" | tail -1 | awk '{print $4}')"
[ "$DISK_FREE" -ge 512 ] || { err "Недостаточно места: ${DISK_FREE}MB"; false; }

# Transaction-consistent baseline backup before Strapi can create additive tables.
if [ -f api/.tmp/data.db ]; then
  command -v sqlite3 >/dev/null || { err "sqlite3 обязателен для WAL-safe baseline backup"; false; }
  BACKUP_DIR="$HOME/aklab-backups/multiuser"
  TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
  BASELINE_BACKUP="$BACKUP_DIR/data-before-${DEPLOY_SHA:0:12}-${TIMESTAMP}.db"
  mkdir -p "$BACKUP_DIR"
  sqlite3 api/.tmp/data.db ".backup '$BASELINE_BACKUP'"
  BACKUP_INTEGRITY="$(sqlite3 -readonly "$BASELINE_BACKUP" 'PRAGMA integrity_check;')"
  [ "$BACKUP_INTEGRITY" = ok ] || { err "Baseline backup integrity failed"; false; }
  chmod 600 "$BASELINE_BACKUP"
  log "Baseline backup verified: path=$BASELINE_BACKUP bytes=$(wc -c < "$BASELINE_BACKUP" | tr -d ' ') sha256=$(sha256sum "$BASELINE_BACKUP" | cut -d' ' -f1) integrity=ok"
fi

create_artifact_backup
trap rollback ERR
trap 'cleanup_artifact_backup || true' EXIT

NEED_INSTALL=false
for dir in node_modules api/node_modules app/node_modules lib/sqlite-queue/node_modules services/_shared/node_modules; do
  if [ ! -d "$dir" ]; then NEED_INSTALL=true; break; fi
done
if [ "$NEED_INSTALL" != true ]; then
  for svc in $ALL_SERVICE_SLUGS; do
    if [ ! -d "services/$svc/node_modules" ]; then NEED_INSTALL=true; break; fi
  done
fi
if ! git diff --quiet "$ROLLBACK_SHA"..HEAD -- package-lock.json api/package-lock.json app/package-lock.json || [ "$FORCE" = true ]; then
  NEED_INSTALL=true
fi

if [ "$NEED_INSTALL" = true ]; then
  log "npm ci root/api/app"
  npm ci --include=dev 2>&1 | tail -5
  mkdir -p api/node_modules/@aklab
  ln -sfn ../../../lib/parse-rules api/node_modules/@aklab/parse-rules
  (cd api && npm ci --include=dev 2>&1 | tail -3)
  (cd app && npm ci 2>&1 | tail -3)
else
  log "Lockfiles unchanged and dependencies present; npm ci skipped"
fi

log "Rebuild native modules"
npm rebuild better-sqlite3 2>&1 | tail -3 || true
(cd api && npm rebuild better-sqlite3 2>&1 | tail -3) || true

grep -E '^VITE_' .env > app/.env.local 2>/dev/null || true

log "Build libraries"
rm -rf lib/sqlite-queue/dist services/_shared/dist
(cd lib/sqlite-queue && npm run build 2>&1 | tail -3)
(cd services/_shared && npm run build 2>&1 | tail -3)
[ -f services/_shared/dist/parse-handler.js ] || { err "_shared build artifact missing"; false; }

log "Build API and app"
rm -rf api/dist app/dist
(cd api && npm run build 2>&1 | tail -3)
(cd app && npm run build 2>&1 | tail -3)

log "Build services"
for svc in $ALL_SERVICE_SLUGS; do
  rm -rf "services/$svc/dist"
  (cd "services/$svc" && npm run build 2>&1 | tail -3)
done

log "Start AKLAB PM2 processes"
pm2 startOrRestart ecosystem.config.js
pm2 save

log "Health checks"
verify_runtime_health deploy

[ "$(git rev-parse HEAD)" = "$EXPECTED_SHA" ] || { err "Runtime SHA drift"; false; }
if [ -n "$(git status --porcelain)" ]; then
  err "Deploy changed worktree"
  git status --short >&2
  false
fi

record_last_success "$DEPLOY_SHA"
trap - ERR
if ! cleanup_artifact_backup; then
  warn "Deploy succeeded but runtime artifact snapshot cleanup failed"
fi
log "Deploy dev complete: sha=$EXPECTED_SHA flag=OFF"
