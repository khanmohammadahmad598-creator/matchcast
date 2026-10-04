#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Re-point this checkout at GitHub after the local `.git` directory was lost,
# reset or cloned fresh on top of an existing working tree.
#
# Nothing is fetched over the working tree: the remote head becomes the new
# base and everything that differs locally stays staged, so `git diff --cached`
# shows exactly the work that is not on GitHub yet.
#
#   ./scripts/git-recover.sh          # recover, keep changes staged
#   ./scripts/git-recover.sh --status # just show what is not on GitHub
#
# Overrides: REMOTE=<git url> BRANCH=<branch>
# ---------------------------------------------------------------------------

set -euo pipefail

REMOTE="${REMOTE:-https://github.com/khanmohammadahmad598-creator/matchcast.git}"
BRANCH="${BRANCH:-main}"

[ -d .git ] || { echo "No .git directory here - run this from the repo root." >&2; exit 1; }
git rev-parse --git-dir >/dev/null 2>&1 || { echo "Not a git repository." >&2; exit 1; }

# A brand new git init has no identity, which blocks the next commit.
[ -n "$(git config user.name || true)" ]  || git config user.name  "MatchCast"
[ -n "$(git config user.email || true)" ] || git config user.email "dev@matchcast.local"

git remote get-url origin >/dev/null 2>&1 || git remote add origin "$REMOTE"

echo "==> fetching origin/${BRANCH}"
git fetch --quiet origin "$BRANCH"

echo "==> moving local ${BRANCH} onto origin/${BRANCH} (work stays staged)"
git checkout --quiet -B "$BRANCH" "origin/${BRANCH}" 2>/dev/null || git reset --soft "origin/${BRANCH}"
git branch --set-upstream-to="origin/${BRANCH}" "$BRANCH" >/dev/null 2>&1 || true

echo
echo "==> not on GitHub yet (staged):"
git --no-pager diff --cached --stat
echo
echo "Next:  git commit -m '<message>'  &&  git push origin ${BRANCH}"
