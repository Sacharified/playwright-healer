---
status: partial
phase: 03-manual-healer-selectors-waits-issue-fallback
source: [03-VERIFICATION.md]
started: 2026-04-27T15:15:00Z
updated: 2026-04-27T15:15:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. End-to-end heal pass with fixture broken selector

expected: Manually trigger the healer workflow with a fixture test containing
`page.locator('#wrong-id')` where the actual element is `#correct-id`. Verify a
PR titled `[playwright-healer] Fix flaky <test title>` appears with CI checks
actually running on it — not a vacuous "all checks passed" with zero check runs.
PR creation requires a PAT (`healer-token` input) — `GITHUB_TOKEN` cannot trigger
downstream CI on bot-opened PRs (GitHub recursion guard).

result: [pending]

### 2. No zombie processes after startup timeout / clean app PID cleanup

expected: Configure a `start-command` that intentionally never reaches the
`base-url` ready state, with `startup-timeout-seconds: 10`. After workflow
completes, verify no orphaned `playwright-mcp`, `chromium`, or app processes
remain on the runner. Specifically per IN-01: when `start-command` is
`npm run dev`, verify SIGTERM propagation from the npm wrapper PID (captured
by Step 5's `bash -c "exec ${start-command}"` spawn) reaches the underlying
node child. The outer `pkill` cleanup (action.yml Step 7, D-12 layer 2) is
the safety net.

result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
