#!/usr/bin/env bash
# Fail-closed Git preparation for an immutable deployment worktree.
# Must be sourced from the repository root.

parse_pm2_daemon_node_version() {
  local versions count
  versions="$(awk '
    /^--- Daemon[-[:space:]]*$/ { in_daemon = 1; next }
    in_daemon && /^--- / { exit }
    in_daemon && /^[[:space:]]*node version[[:space:]]*:/ { print $NF }
  ')"
  if [ -n "$versions" ] && grep -Evq '^[0-9]+\.[0-9]+\.[0-9]+$' <<< "$versions"; then
    echo "[deploy] ERROR: PM2 report contains an invalid daemon Node version" >&2
    return 1
  fi
  versions="$(printf '%s\n' "$versions" | sort -u)"
  count="$(printf '%s\n' "$versions" | awk 'NF { count += 1 } END { print count + 0 }')"
  case "$count" in
    0)
      echo "[deploy] ERROR: PM2 report does not contain a daemon Node version" >&2
      return 1
      ;;
    1) printf '%s\n' "$versions" ;;
    *)
      echo "[deploy] ERROR: PM2 report contains conflicting daemon Node versions" >&2
      return 1
      ;;
  esac
}

validate_deploy_artifact_path() {
  case "${1:-}" in
    ''|/*|..|../*|*/..|*/../*)
      echo "[deploy] ERROR: unsafe runtime artifact path: ${1:-<empty>}" >&2
      return 1
      ;;
  esac
}

snapshot_deploy_artifacts() {
  local snapshot_root="$1" path
  shift
  mkdir -p "$snapshot_root" || return 1
  for path in "$@"; do
    validate_deploy_artifact_path "$path" || return 1
    if [ -e "$path" ] || [ -L "$path" ]; then
      mkdir -p "$snapshot_root/$(dirname "$path")" || return 1
      cp -a "$path" "$snapshot_root/$path" || return 1
    fi
  done
}

restore_deploy_artifacts() {
  local snapshot_root="$1" path parent base staged previous restore_rc=0 rollback_rc=0 i
  local -a paths swapped
  shift
  paths=("$@")
  swapped=()

  for path in "${paths[@]}"; do
    validate_deploy_artifact_path "$path" || return 1
  done

  # Stage every snapshot artifact before mutating any live path.
  for path in "${paths[@]}"; do
    parent="$(dirname "$path")"
    base="$(basename "$path")"
    staged="$parent/.${base}.restore.$$"
    previous="$parent/.${base}.previous.$$"
    mkdir -p "$parent" || { restore_rc=1; break; }
    rm -rf "$staged" "$previous" || { restore_rc=1; break; }
    if [ -e "$snapshot_root/$path" ] || [ -L "$snapshot_root/$path" ]; then
      cp -a "$snapshot_root/$path" "$staged" || { restore_rc=1; break; }
    fi
  done
  if [ "$restore_rc" -ne 0 ]; then
    for path in "${paths[@]}"; do
      parent="$(dirname "$path")"
      base="$(basename "$path")"
      rm -rf "$parent/.${base}.restore.$$" || true
    done
    return 1
  fi

  # Swap only after every staged copy is complete.
  for path in "${paths[@]}"; do
    parent="$(dirname "$path")"
    base="$(basename "$path")"
    staged="$parent/.${base}.restore.$$"
    previous="$parent/.${base}.previous.$$"
    if [ -e "$path" ] || [ -L "$path" ]; then
      mv "$path" "$previous" || { restore_rc=1; break; }
    fi
    swapped+=("$path")
    if [ -e "$snapshot_root/$path" ] || [ -L "$snapshot_root/$path" ]; then
      mv "$staged" "$path" || { restore_rc=1; break; }
    fi
  done

  if [ "$restore_rc" -ne 0 ]; then
    for ((i=${#swapped[@]} - 1; i >= 0; i--)); do
      path="${swapped[$i]}"
      parent="$(dirname "$path")"
      base="$(basename "$path")"
      previous="$parent/.${base}.previous.$$"
      if ! rm -rf "$path"; then
        rollback_rc=1
        continue
      fi
      if [ -e "$previous" ] || [ -L "$previous" ]; then
        mv "$previous" "$path" || rollback_rc=1
      fi
    done
    for path in "${paths[@]}"; do
      parent="$(dirname "$path")"
      base="$(basename "$path")"
      rm -rf "$parent/.${base}.restore.$$" || true
    done
    [ "$rollback_rc" -eq 0 ] || echo "[deploy] ERROR: runtime artifact restore rollback was incomplete" >&2
    return 1
  fi

  for path in "${paths[@]}"; do
    parent="$(dirname "$path")"
    base="$(basename "$path")"
    rm -rf "$parent/.${base}.previous.$$" "$parent/.${base}.restore.$$" \
      || echo "[deploy] WARN: stale artifact swap temp retained for $path" >&2
  done
}

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
