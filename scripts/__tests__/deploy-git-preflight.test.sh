#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=../lib/deploy-git-preflight.sh
source "$ROOT/scripts/lib/deploy-git-preflight.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
assert_eq() { [ "$1" = "$2" ] || fail "expected '$1', got '$2'"; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
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

echo 'PASS: deploy git preflight rejects dirty state without stash and fast-forwards exact SHA'
