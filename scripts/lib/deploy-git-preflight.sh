#!/usr/bin/env bash
# Fail-closed Git preparation for an immutable deployment worktree.
# Must be sourced from the repository root.

ensure_deploy_git_preflight() {
  local expected_sha="${1:-}"
  local branch current_sha remote_sha

  branch="$(git branch --show-current)"
  if [ "$branch" != "main" ]; then
    echo "[deploy] ERROR: deployment worktree must be on main, got '${branch:-detached}'" >&2
    return 1
  fi

  if [ -n "$(git status --porcelain)" ]; then
    echo "[deploy] ERROR: deployment worktree has local changes; refusing to stash, reset, or deploy" >&2
    git status --short >&2
    return 1
  fi

  git fetch origin main >&2
  current_sha="$(git rev-parse HEAD)"
  remote_sha="$(git rev-parse origin/main)"

  if [ -n "$expected_sha" ] && [ "$remote_sha" != "$expected_sha" ]; then
    echo "[deploy] ERROR: origin/main is ${remote_sha:0:8}, expected release ${expected_sha:0:8}; refusing a raced deploy" >&2
    return 1
  fi

  if [ "$current_sha" != "$remote_sha" ]; then
    git merge --ff-only origin/main >&2
  fi

  if [ -n "$(git status --porcelain)" ]; then
    echo "[deploy] ERROR: worktree changed during Git preparation" >&2
    git status --short >&2
    return 1
  fi

  printf '%s\n' "$(git rev-parse HEAD)"
}
