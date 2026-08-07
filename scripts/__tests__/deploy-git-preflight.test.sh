#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=../lib/deploy-git-preflight.sh
source "$ROOT/scripts/lib/deploy-git-preflight.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
assert_eq() { [ "$1" = "$2" ] || fail "expected '$1', got '$2'"; }

PM2_SECTIONED_REPORT=$'--- Daemon --------------------------------------------------------------------\nnode version         : 22.20.0\n--- CLI -----------------------------------------------------------------------\nnode version         : 20.19.0\n'
assert_eq "$(printf '%s' "$PM2_SECTIONED_REPORT" | parse_pm2_daemon_node_version)" '22.20.0'
PM2_DUPLICATE_DAEMON_REPORT=$'--- Daemon --------------------------------------------------------------------\nnode version         : 22.20.0\nnode version         : 22.20.0\n--- CLI -----------------------------------------------------------------------\nnode version         : 20.19.0\n'
assert_eq "$(printf '%s' "$PM2_DUPLICATE_DAEMON_REPORT" | parse_pm2_daemon_node_version)" '22.20.0'
if printf '%s' $'--- Daemon ---\nnode version : 22.20.0\nnode version : 20.19.0\n--- CLI ---\nnode version : 22.20.0\n' | parse_pm2_daemon_node_version >/dev/null; then
  fail 'conflicting PM2 daemon versions unexpectedly passed parsing'
fi
if printf '%s' $'--- CLI ---\nnode version : 22.20.0\n' | parse_pm2_daemon_node_version >/dev/null; then
  fail 'CLI-only PM2 node version unexpectedly passed as daemon evidence'
fi
if printf '%s\n' 'PM2 report without runtime metadata' | parse_pm2_daemon_node_version >/dev/null; then
  fail 'missing PM2 daemon version unexpectedly passed parsing'
fi
for invalid_node_version in ':' 'not-a-version' 'v22.20.0' '22.20'; do
  if printf '%s\n' '--- Daemon ---' "node version : $invalid_node_version" | parse_pm2_daemon_node_version >/dev/null; then
    fail "invalid PM2 daemon Node version unexpectedly passed parsing: $invalid_node_version"
  fi
done

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
ARTIFACT_ROOT="$TMP/artifact-root"
ARTIFACT_SNAPSHOT="$TMP/artifact-snapshot"
mkdir -p "$ARTIFACT_ROOT/api/dist" "$ARTIFACT_ROOT/fragile/dist"
printf 'baseline\n' > "$ARTIFACT_ROOT/api/dist/index.js"
printf 'fragile-baseline\n' > "$ARTIFACT_ROOT/fragile/dist/index.js"
(
  cd "$ARTIFACT_ROOT"
  snapshot_deploy_artifacts "$ARTIFACT_SNAPSHOT" api/dist fragile/dist services/missing/dist
  printf 'candidate\n' > api/dist/index.js
  mkdir -p services/missing/dist
  printf 'candidate-only\n' > services/missing/dist/index.js
  restore_deploy_artifacts "$ARTIFACT_SNAPSHOT" api/dist services/missing/dist
  assert_eq "$(< api/dist/index.js)" 'baseline'
  [ ! -e services/missing/dist ] || fail 'restore retained an artifact absent before deploy'
  printf 'api-candidate-before-failed-restore\n' > api/dist/index.js
  printf 'fragile-candidate\n' > fragile/dist/index.js
  chmod 000 "$ARTIFACT_SNAPSHOT/fragile/dist/index.js"
  if restore_deploy_artifacts "$ARTIFACT_SNAPSHOT" api/dist fragile/dist; then
    fail 'restore unexpectedly succeeded with an unreadable snapshot artifact'
  fi
  chmod 600 "$ARTIFACT_SNAPSHOT/fragile/dist/index.js"
  assert_eq "$(< api/dist/index.js)" 'api-candidate-before-failed-restore'
  assert_eq "$(< fragile/dist/index.js)" 'fragile-candidate'
)
REMOTE="$TMP/remote.git"
SEED="$TMP/seed"
SERVER="$TMP/server"

git init --bare "$REMOTE" >/dev/null
git clone "$REMOTE" "$SEED" >/dev/null 2>&1
(
  cd "$SEED"
  git config user.name Test
  git config user.email test@example.invalid
  git checkout -b main >/dev/null
  printf 'base\n' > tracked.txt
  git add tracked.txt
  git commit -m base >/dev/null
  git push -u origin main >/dev/null
)
git clone --branch main "$REMOTE" "$SERVER" >/dev/null 2>&1
BASE_SHA="$(git -C "$SERVER" rev-parse HEAD)"

# A dirty tracked file must fail without stashing, merging, or changing HEAD.
printf 'local-only\n' >> "$SERVER/tracked.txt"
if (cd "$SERVER" && ensure_deploy_git_preflight); then
  fail 'dirty worktree unexpectedly passed preflight'
fi
assert_eq "$(git -C "$SERVER" rev-parse HEAD)" "$BASE_SHA"
assert_eq "$(git -C "$SERVER" stash list | wc -l | tr -d ' ')" "0"

# A clean worktree must fast-forward exactly to origin/main.
git -C "$SERVER" restore tracked.txt
(
  cd "$SEED"
  printf 'remote\n' >> tracked.txt
  git add tracked.txt
  git commit -m remote >/dev/null
  git push >/dev/null
)
EXPECTED_SHA="$(git -C "$SEED" rev-parse HEAD)"
ACTUAL_SHA="$(cd "$SERVER" && ensure_deploy_git_preflight "$EXPECTED_SHA")"
assert_eq "$ACTUAL_SHA" "$EXPECTED_SHA"
assert_eq "$(git -C "$SERVER" rev-parse HEAD)" "$EXPECTED_SHA"
[ -z "$(git -C "$SERVER" status --porcelain)" ] || fail 'worktree is not clean after fast-forward'

# Any untracked path must also fail without moving HEAD or creating a stash.
printf 'untracked\n' > "$SERVER/local-only.txt"
if (cd "$SERVER" && ensure_deploy_git_preflight "$EXPECTED_SHA"); then
  fail 'untracked worktree unexpectedly passed preflight'
fi
assert_eq "$(git -C "$SERVER" rev-parse HEAD)" "$EXPECTED_SHA"
assert_eq "$(git -C "$SERVER" stash list | wc -l | tr -d ' ')" "0"
rm "$SERVER/local-only.txt"

# A raced expected SHA must fail and preserve the current exact commit.
if (cd "$SERVER" && ensure_deploy_git_preflight "$BASE_SHA"); then
  fail 'mismatched expected SHA unexpectedly passed preflight'
fi
assert_eq "$(git -C "$SERVER" rev-parse HEAD)" "$EXPECTED_SHA"

# Dev deploy must use the same immutable helper and deterministic installs.
bash -n "$ROOT/scripts/deploy-dev.sh"
grep -q 'ensure_deploy_git_preflight.*EXPECTED_SHA' "$ROOT/scripts/deploy-dev.sh" || fail 'deploy-dev does not use exact-SHA preflight'
grep -q -- '--rollback-ref' "$ROOT/scripts/deploy-dev.sh" || fail 'deploy-dev has no explicit rollback ref'
grep -q 'LAST_SUCCESS_FILE' "$ROOT/scripts/deploy-dev.sh" || fail 'deploy-dev has no persistent last-success state'
if grep -q 'ROLLBACK_SHA="$CHECKOUT_SHA"' "$ROOT/scripts/deploy-dev.sh"; then
  fail 'deploy falls back to an unproven checkout SHA when no last-success state exists'
fi
grep -q 'requires --rollback-ref' "$ROOT/scripts/deploy-dev.sh" || fail 'first deploy does not require an explicit rollback ref'
grep -q 'verify_runtime_health' "$ROOT/scripts/deploy-dev.sh" || fail 'deploy-dev has no reusable health gate'
grep -q 'trap - ERR' "$ROOT/scripts/deploy-dev.sh" || fail 'rollback does not disable recursive ERR traps'
ROLLBACK_BODY="$(awk '/^rollback\(\) \{/{in_rollback=1} in_rollback{print} in_rollback && /^}/{exit}' "$ROOT/scripts/deploy-dev.sh")"
REBUILD_BODY="$(awk '/^run_rollback_rebuild\(\) \{/{in_rebuild=1} in_rebuild{print} in_rebuild && /^}/{exit}' "$ROOT/scripts/deploy-dev.sh")"
RESTORE_RUNTIME_BODY="$(awk '/^restore_predeploy_runtime\(\) \{/{in_restore=1} in_restore{print} in_restore && /^}/{exit}' "$ROOT/scripts/deploy-dev.sh")"
CLEANUP_BODY="$(awk '/^cleanup_artifact_backup\(\) \{/{in_cleanup=1} in_cleanup{print} in_cleanup && /^}/{exit}' "$ROOT/scripts/deploy-dev.sh")"
(
  eval "$CLEANUP_BODY"
  ARTIFACT_BACKUP_DIR="$TMP/cleanup-failure-snapshot"
  PRESERVE_ARTIFACT_BACKUP=false
  mkdir -p "$ARTIFACT_BACKUP_DIR"
  rm() { return 1; }
  if cleanup_artifact_backup; then
    fail 'artifact cleanup failure unexpectedly returned success'
  fi
  assert_eq "$ARTIFACT_BACKUP_DIR" "$TMP/cleanup-failure-snapshot"
)
(
  eval "$CLEANUP_BODY"
  ARTIFACT_BACKUP_DIR="$TMP/preserved-snapshot"
  PRESERVE_ARTIFACT_BACKUP=true
  mkdir -p "$ARTIFACT_BACKUP_DIR"
  rm() { fail 'preserved artifact snapshot cleanup invoked rm'; }
  cleanup_artifact_backup
  assert_eq "$ARTIFACT_BACKUP_DIR" "$TMP/preserved-snapshot"
)
grep -q 'for path in "${RUNTIME_ARTIFACT_PATHS\[@\]}"' <<< "$REBUILD_BODY" || fail 'clean rollback rebuild does not cover every snapshotted runtime artifact'
grep -q 'rm -rf "$path" || return 1' <<< "$REBUILD_BODY" || fail 'clean rollback rebuild does not remove stale generated output'
grep -q 'restore_predeploy_runtime' <<< "$ROLLBACK_BODY" || fail 'rollback has no pre-deploy artifact restore fallback'
if grep -q 'failed_sha.*ROLLBACK_SHA' <<< "$ROLLBACK_BODY"; then
  fail 'rollback skips recovery when failed and rollback SHA are equal'
fi
grep -q 'restore_deploy_artifacts.*|| return 1' <<< "$RESTORE_RUNTIME_BODY" || fail 'fallback continues after an incomplete artifact restore'
grep -q 'PRESERVE_ARTIFACT_BACKUP=true' <<< "$ROLLBACK_BODY" || fail 'incomplete fallback does not retain its recovery snapshot'
START_OR_RESTART_COUNT="$(grep -c 'pm2 startOrRestart ecosystem.config.js' "$ROOT/scripts/deploy-dev.sh" || true)"
assert_eq "$START_OR_RESTART_COUNT" '3'
if grep -q 'pm2 start ecosystem.config.js' "$ROOT/scripts/deploy-dev.sh"; then
  fail 'deploy uses PM2 start, which rejects already-managed AKLAB applications'
fi
SNAPSHOT_CALL_LINE="$(awk '$0 == "create_artifact_backup" { print NR; exit }' "$ROOT/scripts/deploy-dev.sh")"
TRAP_CALL_LINE="$(awk '$0 == "trap rollback ERR" { print NR; exit }' "$ROOT/scripts/deploy-dev.sh")"
[ -n "$SNAPSHOT_CALL_LINE" ] && [ -n "$TRAP_CALL_LINE" ] && [ "$SNAPSHOT_CALL_LINE" -lt "$TRAP_CALL_LINE" ] || fail 'rollback trap is armed before the runtime artifact snapshot is complete'
SUCCESS_RECORD_LINE="$(awk '$0 == "record_last_success \"$DEPLOY_SHA\"" { print NR; exit }' "$ROOT/scripts/deploy-dev.sh")"
SUCCESS_TRAP_LINE="$(awk -v start="$SUCCESS_RECORD_LINE" 'NR > start && $0 == "trap - ERR" { print NR; exit }' "$ROOT/scripts/deploy-dev.sh")"
SUCCESS_CLEANUP_LINE="$(awk -v start="$SUCCESS_RECORD_LINE" 'NR > start && $0 ~ /^if ! cleanup_artifact_backup;/ { print NR; exit }' "$ROOT/scripts/deploy-dev.sh")"
[ -n "$SUCCESS_RECORD_LINE" ] && [ -n "$SUCCESS_TRAP_LINE" ] && [ -n "$SUCCESS_CLEANUP_LINE" ] \
  && [ "$SUCCESS_RECORD_LINE" -lt "$SUCCESS_TRAP_LINE" ] && [ "$SUCCESS_TRAP_LINE" -lt "$SUCCESS_CLEANUP_LINE" ] \
  || fail 'successful deploy cleanup is not warning-only after disabling ERR rollback'
grep -q "^trap 'cleanup_artifact_backup || true' EXIT$" "$ROOT/scripts/deploy-dev.sh" || fail 'EXIT cleanup can override deploy status'
grep -q 'npm ci --include=dev' "$ROOT/scripts/deploy-dev.sh" || fail 'deploy-dev does not use npm ci'
if grep -Eq 'git stash|git pull|npm install|git checkout -- \.' "$ROOT/scripts/deploy-dev.sh"; then
  fail 'deploy-dev contains a mutable deployment operation'
fi

echo 'PASS: deploy git preflight rejects dirty/raced state and deploy-dev uses immutable exact-SHA flow'
