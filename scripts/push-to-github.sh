#!/usr/bin/env bash
#
# Create a GitHub repository for MatchCast and push this workspace to it.
#
# Prerequisites
#   * git installed and this directory already committed (bash scripts/setup.sh)
#   * a GitHub Personal Access Token with the "repo" scope
#     https://github.com/settings/tokens  ->  Generate new token (classic)
#     or a fine-grained token with Read/Write on "Administration" + "Contents".
#
# Usage
#   GITHUB_USER=your-user GITHUB_TOKEN=ghp_xxx bash scripts/push-to-github.sh [repo] [private|public]
#
#   GITHUB_USER=octocat GITHUB_TOKEN=ghp_xxx bash scripts/push-to-github.sh matchcast private
#
set -euo pipefail

REPO="${1:-matchcast}"
VISIBILITY="${2:-private}"
BRANCH="${BRANCH:-main}"

if [ -z "${GITHUB_USER:-}" ] || [ -z "${GITHUB_TOKEN:-}" ]; then
  echo "ERROR: set GITHUB_USER and GITHUB_TOKEN first." >&2
  echo "       GITHUB_USER=you GITHUB_TOKEN=ghp_xxx bash $0 $REPO $VISIBILITY" >&2
  exit 1
fi

if [ "$VISIBILITY" != "private" ] && [ "$VISIBILITY" != "public" ]; then
  echo "ERROR: visibility must be 'private' or 'public' (got '$VISIBILITY')." >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# ---------------------------------------------------------------- safe guards
if git ls-files --error-unmatch .env backend/.env stream-worker/.env frontend/.env >/dev/null 2>&1; then
  echo "ERROR: a real .env file is tracked. Untrack it before pushing:" >&2
  echo "       git rm --cached .env backend/.env stream-worker/.env frontend/.env" >&2
  exit 1
fi

# ------------------------------------------------------------- local commit
if [ -z "$(git rev-parse --verify HEAD 2>/dev/null)" ]; then
  echo "==> No commits yet - creating the initial commit"
  git add -A
  git -c user.name="${GIT_AUTHOR_NAME:-MatchCast}" \
      -c user.email="${GIT_AUTHOR_EMAIL:-dev@matchcast.local}" \
      commit -q -m "feat: MatchCast - AI live match streaming & commentary platform"
fi

git branch -M "$BRANCH"

# ------------------------------------------------------- create the repo
echo "==> Checking whether github.com/$GITHUB_USER/$REPO exists"
STATUS="$(curl -s -o /dev/null -w '%{http_code}' \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H 'Accept: application/vnd.github+json' \
  "https://api.github.com/repos/$GITHUB_USER/$REPO")"

if [ "$STATUS" = "200" ]; then
  echo "==> Repository exists - reusing it"
else
  echo "==> Creating $VISIBILITY repository $REPO"
  PRIVATE=true
  if [ "$VISIBILITY" = "public" ]; then PRIVATE=false; fi
  CREATE="$(curl -s -X POST https://api.github.com/user/repos \
    -H "Authorization: Bearer $GITHUB_TOKEN" \
    -H 'Accept: application/vnd.github+json' \
    -d "{\"name\":\"$REPO\",\"private\":$PRIVATE,\"description\":\"MatchCast - AI live match streaming, scoreboard graphics and Hindi/Hinglish commentary for authorised sports broadcasts\"}")"
  if printf '%s' "$CREATE" | grep -q '"full_name"'; then
    echo "==> Created: $(printf '%s' "$CREATE" | grep -o '"full_name":"[^"]*"' | head -1)"
  else
    echo "ERROR: could not create the repository:" >&2
    printf '%s\n' "$CREATE" >&2
    exit 1
  fi
fi

# ------------------------------------------------------------------- push
# The token is only used for this one push; the stored remote stays clean.
echo "==> Pushing $BRANCH"
git push -q "https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_USER}/${REPO}.git" "$BRANCH"

git remote remove origin 2>/dev/null || true
git remote add origin "https://github.com/${GITHUB_USER}/${REPO}.git"
git branch --set-upstream-to="origin/$BRANCH" "$BRANCH" 2>/dev/null || true

echo
echo "==> Done: https://github.com/$GITHUB_USER/$REPO"
echo "    The access token was used for the push only and is not stored in the remote URL."
