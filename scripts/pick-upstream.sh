#!/usr/bin/env bash
# Picks one upstream PR onto the current branch, the way this fork takes them:
#   scripts/pick-upstream.sh <n>          fetch pull/<n>, pick it, cite it, run npm run check
#   scripts/pick-upstream.sh --finish <n> after a hand merge and cherry-pick --continue: cite and check
#   scripts/pick-upstream.sh --scan <n>   fetch pull/<n> and list its risky added lines, pick nothing
# Every commit of the PR is picked, not just its head. A PR whose history merges upstream main in is
# applied as one net diff under the author of its last commit. A conflict only in .openclaw/ is
# regenerated from skills/. Any other conflict stops for a hand merge: keeping both sides of a test
# conflict can drop a test inside the one before it.
# The check runs the PR's code, an outside contributor's: every pick first lists the added lines that reach the network,
# processes, eval, the environment or deletion. A red check ends with its failures; a green one deletes pr-<n>.
set -euo pipefail

UPSTREAM=dietrichgebert/ponytail
# The hooks the Rust binary answers (fork #7, ADR 0002), with the JS each one ports: a pick that changes one of these
# files leaves the binary on the old behaviour until the Rust catches up. Add a hook here when it is wired.
PORTED=(
  "hook subagent-start: hooks/ponytail-subagent.js hooks/ponytail-runtime.js hooks/ponytail-config.js hooks/ponytail-instructions.js"
  "map: hooks/ponytail-map.js"
  "hook prompt-submit: hooks/ponytail-mode-tracker.js hooks/ponytail-runtime.js hooks/ponytail-config.js hooks/ponytail-instructions.js"
  "hook session-start: hooks/ponytail-activate.js hooks/ponytail-runtime.js hooks/ponytail-config.js hooks/ponytail-instructions.js hooks/ponytail-prune.js hooks/ponytail-map.js"
)
RISKY='fetch\(|https?\.|XMLHttpRequest|child_process|\bspawn|\bexec(Sync|File)?\(|\.exec\(|\beval\(|new Function|process\.env\.[A-Za-z_]+ *=[^=]|delete process\.env|rmSync|unlinkSync|\$\.process\.run|\$\.http'

scan() {
  local n="$1" from hits
  from=$(git merge-base upstream/main "pr-$n")
  hits=$(git --no-pager diff "$from" "pr-$n" | awk '/^\+\+\+ /{f=substr($0,7); next} /^\+/{print f ": " substr($0,2)}' | grep -E "$RISKY" | cut -c1-180 || true)
  echo "#$n adds these lines that reach the network, processes, eval, the environment or deletion (the check runs them):"
  if [[ -n "$hits" ]]; then echo "  ${hits//$'\n'/$'\n'  }"; else echo "  (none)"; fi
  warn_ported "$n" "$from"
}

warn_ported() {
  local n="$1" changed entry file hit
  changed=$(git diff --name-only "$2" "pr-$n")
  for entry in "${PORTED[@]}"; do
    hit=()
    for file in ${entry#*:}; do
      if grep -qxF "$file" <<<"$changed"; then hit+=("$file"); fi
    done
    if (( ${#hit[@]} )); then
      echo "Warning: #$n changes ${hit[*]}, which the Rust port of \`${entry%%:*}\` reaches. Re-record the cases (node rust/cases/record.js) and run npm run check:rust: the binary keeps the old behaviour until its Rust is updated." >&2
    fi
  done
}

cite_and_check() {
  local n="$1" msg subject title log status=0
  msg=$(git log -1 --format=%B)
  subject=${msg%%$'\n'*}
  if [[ "$subject" != *"($UPSTREAM#$n)"* ]]; then
    git commit -q --amend -m "$subject ($UPSTREAM#$n)${msg:${#subject}}"
  fi
  git --no-pager log --oneline -n 1
  # A subject in another language or a vague one reads badly in the log; several commits differ from the title on purpose.
  title=$(gh pr view "$n" -R "$UPSTREAM" --json title --jq .title 2>/dev/null || true)
  if [[ -n "$title" && "${subject%" ($UPSTREAM#$n)"}" != "$title" ]]; then
    echo "Note: the subject differs from the PR title \"$title\"; reword with git commit --amend if it reads badly." >&2
  fi
  scan "$n"
  log=$(mktemp)
  npm run check 2>&1 | tee "$log" || status=$?
  if (( status != 0 )); then
    echo "" >&2
    echo "The check failed after #$n; its failures:" >&2
    grep -E -A8 '^\(fail\) |^not ok |^✖ |^check-plugin: [0-9]+ problem' "$log" >&2 || echo "  (no failure line matched: read the output above)" >&2
    rm -f "$log"
    exit "$status"
  fi
  rm -f "$log"
  git branch -q -D "pr-$n" 2>/dev/null || true
}

regenerate_or_stop() {
  local n="$1" unmerged
  while unmerged=$(git diff --name-only --diff-filter=U) && [[ -n "$unmerged" ]]; do
    if grep -qv '^\.openclaw/' <<<"$unmerged"; then
      echo "Conflict to merge by hand:" >&2
      echo "$unmerged" >&2
      echo "Resolve, git add, then: git -c core.editor=true cherry-pick --continue && $0 --finish $n" >&2
      exit 1
    fi
    node scripts/build-openclaw-skills.js >/dev/null
    git add .openclaw
    git -c core.editor=true cherry-pick --continue || true
  done
  if git rev-parse -q --verify CHERRY_PICK_HEAD >/dev/null; then
    echo "The pick stopped with nothing unmerged: git rerere reused an earlier resolution (check git diff --cached)," >&2
    echo "or the commit is empty. Then: git -c core.editor=true cherry-pick --continue && $0 --finish $n" >&2
    exit 1
  fi
}

if [[ "${1:-}" == "--finish" ]]; then
  cite_and_check "${2:?usage: $0 --finish <n>}"
  exit 0
fi

if [[ "${1:-}" == "--scan" ]]; then
  n="${2:?usage: $0 --scan <n>}"
  git fetch -q upstream main "+pull/$n/head:pr-$n"
  scan "$n"
  exit 0
fi

n="${1:?usage: $0 <n> | --finish <n> | --scan <n>}"
[[ -z "$(git status --porcelain --untracked-files=no)" ]] || { echo "Working tree has changes; commit or stash them first." >&2; exit 1; }

git fetch -q upstream main "+pull/$n/head:pr-$n"
base=$(git merge-base HEAD "pr-$n")

if [[ -n "$(git rev-list --merges "$base..pr-$n")" ]]; then
  # The PR merged upstream main in: picking its commits would bring that main along.
  from=$(git merge-base upstream/main "pr-$n")
  patch=$(mktemp)
  git --no-pager diff --output="$patch" "$from" "pr-$n"
  if ! git apply --3way "$patch"; then
    echo "Net diff applied with conflicts; resolve, then commit with --author and run: $0 --finish $n" >&2
    exit 1
  fi
  author=$(git log -1 --no-merges --format='%an <%ae>' "pr-$n")
  first=$(git log --reverse --no-merges --format=%s "$from..pr-$n" | head -n 1)
  git commit -q --author="$author" -m "$first" -m "Applied as the PR's net diff against upstream main: its history merges main in."
else
  mapfile -t commits < <(git rev-list --reverse --no-merges "$base..pr-$n")
  echo "Picking ${#commits[@]} commit(s) of #$n"
  git cherry-pick -x "${commits[@]}" || regenerate_or_stop "$n"
fi

cite_and_check "$n"
