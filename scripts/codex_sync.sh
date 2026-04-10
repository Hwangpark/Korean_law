#!/bin/zsh

set -euo pipefail

script_dir=${0:A:h}
repo_dir=${script_dir:h}
state_dir="$HOME/Library/Application Support/CodexBridge/KoreanLaw"
log_dir="$HOME/Library/Logs/CodexBridge"
log_file="$log_dir/KoreanLaw.log"
branch="codex"
remote="origin"
debounce_seconds=4

mkdir -p "$state_dir" "$log_dir"
touch "$log_file"

exec >> "$log_file" 2>&1

timestamp() {
  date "+%Y-%m-%d %H:%M:%S %Z"
}

echo "[$(timestamp)] sync triggered"

lock_dir="$state_dir/lock"
if ! mkdir "$lock_dir" 2>/dev/null; then
  echo "[$(timestamp)] sync already running; skipping"
  exit 0
fi

cleanup() {
  rmdir "$lock_dir" 2>/dev/null || true
}

trap cleanup EXIT INT TERM

sleep "$debounce_seconds"

cd "$repo_dir"

current_branch=$(git branch --show-current 2>/dev/null || true)
if [[ "$current_branch" != "$branch" ]]; then
  echo "[$(timestamp)] current branch is '${current_branch:-detached}', expected '$branch'; skipping"
  exit 0
fi

has_changes=0
if ! git diff --quiet --ignore-submodules -- || ! git diff --cached --quiet --ignore-submodules -- || [[ -n "$(git ls-files --others --exclude-standard)" ]]; then
  has_changes=1
fi

if [[ "$has_changes" -eq 1 ]]; then
  git add -A

  if ! git diff --cached --quiet --ignore-submodules --; then
    commit_message="auto: sync codex $(date '+%Y-%m-%d %H:%M:%S %Z')"
    git commit -m "$commit_message"
    echo "[$(timestamp)] committed changes"
  else
    echo "[$(timestamp)] nothing staged after git add"
  fi
fi

git fetch "$remote" --prune || echo "[$(timestamp)] fetch failed; continuing with local state"

remote_ref="refs/remotes/$remote/$branch"
local_head=$(git rev-parse HEAD)
remote_head=""

if git show-ref --verify --quiet "$remote_ref"; then
  remote_head=$(git rev-parse "$remote_ref")
fi

if [[ -n "$remote_head" ]] && ! git merge-base --is-ancestor "$remote_head" "$local_head"; then
  echo "[$(timestamp)] remote '$branch' has commits not in local branch; manual sync required"
  exit 0
fi

if [[ -z "$remote_head" || "$local_head" != "$remote_head" ]]; then
  git push "$remote" "HEAD:$branch"
  echo "[$(timestamp)] pushed '$branch'"
else
  echo "[$(timestamp)] branch already up to date"
fi
