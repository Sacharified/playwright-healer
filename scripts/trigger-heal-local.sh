#!/usr/bin/env bash
# scripts/trigger-heal-local.sh
#
# Drive the action's heal flow locally — same code path as
# .github/workflows/e2e-heal-self.yml but without GitHub Actions in the loop.
# Useful for fast iteration on src/healer/* and src/shared/*.
#
# Required env (caller exports):
#   GEMINI_API_KEY  — Gemini API key (free-tier OK with gemini-2.5-flash)
#   HEALER_PAT      — GitHub PAT with `repo` scope on this repo
#
# Optional env:
#   GITHUB_REPOSITORY  — owner/name (default: derived from `git remote get-url origin`)
#   MODEL              — provider model id (default: gemini-2.5-flash)
#   PROVIDER           — anthropic | gemini | ollama (default: gemini)
#   FIXTURE_PORT       — default 8080
#   COMMIT_SHA         — heal target SHA (default: current HEAD)
#
# One-time setup before first run:
#   npm install
#   ( cd fixture && npm install && npx playwright install chromium )
#
# Side effects on success: pushes a healer branch and opens a PR on
# GITHUB_REPOSITORY. Close (don't merge) the PR to keep the broken fixture
# state intact for future runs.

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

# ── Validate required env ────────────────────────────────────────────────
: "${GEMINI_API_KEY:?Set GEMINI_API_KEY in env}"
: "${HEALER_PAT:?Set HEALER_PAT in env (PAT with repo scope on this repo)}"

# ── Resolve GITHUB_REPOSITORY from origin remote if not given ────────────
if [ -z "${GITHUB_REPOSITORY:-}" ]; then
  REMOTE_URL=$(git remote get-url origin)
  GITHUB_REPOSITORY=$(printf '%s' "$REMOTE_URL" \
    | sed -E 's#.*github\.com[:/]([^/]+/[^/.]+)(\.git)?/?$#\1#')
fi
GITHUB_REPOSITORY_OWNER="${GITHUB_REPOSITORY%%/*}"

# ── Validate fixture deps ────────────────────────────────────────────────
if [ ! -d fixture/node_modules ]; then
  echo "fixture/node_modules missing. Run:" >&2
  echo "  ( cd fixture && npm install && npx playwright install chromium )" >&2
  exit 1
fi
if [ ! -d node_modules ]; then
  echo "node_modules missing. Run: npm install" >&2
  exit 1
fi

# ── Boot fixture server ──────────────────────────────────────────────────
FIXTURE_PORT="${FIXTURE_PORT:-8080}"
( cd fixture && exec npx http-server -p "$FIXTURE_PORT" -c-1 -s ) &
FIXTURE_PID=$!

EVENT_JSON=$(mktemp -t heal-event.XXXXXX.json)

cleanup() {
  kill "$FIXTURE_PID" 2>/dev/null || true
  rm -f "$EVENT_JSON"
}
trap cleanup EXIT INT TERM

# Wait for fixture readiness
for _ in 1 2 3 4 5; do
  if curl -fsS "http://localhost:$FIXTURE_PORT/" > /dev/null 2>&1; then
    echo "fixture: up on :$FIXTURE_PORT"
    break
  fi
  sleep 1
done

# ── Construct workflow_dispatch event.json ───────────────────────────────
HEAD_SHA="${COMMIT_SHA:-$(git rev-parse HEAD)}"
REPO_NAME="${GITHUB_REPOSITORY##*/}"
cat > "$EVENT_JSON" <<EOF
{
  "inputs": {
    "testFile": "fixture/tests/broken-selector.spec.ts",
    "testTitle": "clicks submit button and sees confirmation",
    "fixClassHint": "selectors",
    "commitSha": "$HEAD_SHA"
  },
  "repository": {
    "name": "$REPO_NAME",
    "owner": { "login": "$GITHUB_REPOSITORY_OWNER" },
    "default_branch": "main"
  }
}
EOF

# ── Set INPUT_* env vars ─────────────────────────────────────────────────
# Hyphenated env names need `export` (bash inline KEY=val rejects hyphens).
# Only override the inputs that don't have safe Zod defaults; everything else
# falls through to src/shared/config.ts defaults.
export "INPUT_MODE=heal"
export "INPUT_PROVIDER=${PROVIDER:-gemini}"
export "INPUT_MODEL=${MODEL:-gemini-2.5-flash}"
export "INPUT_API-KEY=$GEMINI_API_KEY"
export "INPUT_HEALER-TOKEN=$HEALER_PAT"
export "INPUT_GITHUB-TOKEN=$HEALER_PAT"
export "INPUT_BASE-URL=http://localhost:$FIXTURE_PORT"
export "INPUT_TEST-COMMAND=cd fixture && npx playwright test"
export "INPUT_MAX-BUDGET-USD=1.00"
export "INPUT_MAX-TURNS=10"
export "INPUT_SKIP-DETERMINISTIC-CHECK=true"
export "INPUT_SKIP-POST-FIX-VALIDATION=true"
export "INPUT_SKIP-DIFF-LINT=false"

# GitHub Actions context vars (read by @actions/github → context.payload, etc.)
export "GITHUB_REPOSITORY=$GITHUB_REPOSITORY"
export "GITHUB_REPOSITORY_OWNER=$GITHUB_REPOSITORY_OWNER"
export "GITHUB_EVENT_NAME=workflow_dispatch"
export "GITHUB_EVENT_PATH=$EVENT_JSON"
export "GITHUB_SERVER_URL=https://github.com"
export "GITHUB_RUN_ID=0"
export "GITHUB_ACTOR=${USER:-local}"

# Heal mode reads HEALER_DEFAULT_BRANCH directly (src/healer/index.ts:113)
export "HEALER_DEFAULT_BRANCH=main"
export "RUNNER_TEMP=${TMPDIR:-/tmp}"

# ── Run the action's TS entry point ──────────────────────────────────────
# Path-resolved tsx (not `npx tsx`) — npx → tsx → node spawn chain strips
# hyphenated env vars (Phase 01.2 fix; see CLAUDE.md).
echo "→ heal mode against $GITHUB_REPOSITORY @ ${HEAD_SHA:0:7}"
echo "→ provider=${PROVIDER:-gemini} model=${MODEL:-gemini-2.5-flash}"
echo "→ pushes branch + opens PR on $GITHUB_REPOSITORY on success"
echo
exec ./node_modules/.bin/tsx src/index.ts
