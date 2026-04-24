---
phase: 01-security-scaffold-composite-packaging
plan: 03
subsystem: dispatcher
tags: [dispatcher, secret-masking, zod-validation, stubs, d07]
dependency_graph:
  requires: [src/shared/config.ts, src/shared/security-contract.ts, package.json]
  provides: [src/index.ts, src/ingest/index.ts, src/healer/index.ts]
  affects: [Phase 2 ingest wiring, Phase 3 healer wiring, Plan 04 action.yml entry point, Plan 06 self-test masking]
tech_stack:
  added: []
  patterns:
    - "D-07 startup order: getInput(secrets) → setSecret × 3 → getInput(rest) → Zod safeParse → dispatch"
    - "Dynamic import('./ingest/index.js') and ('./healer/index.js') inside switch — lazy evaluation, dry-run never loads stubs"
    - "core.setFailed(msg); return — never process.exit()"
    - "core.summary.addRaw(md).write() for GITHUB_STEP_SUMMARY output"
    - "Promise<never> return type on stubs — TS compiler enforcement of throw-only contract"
key_files:
  created:
    - path: src/index.ts
      size_lines: 102
    - path: src/ingest/index.ts
      size_lines: 6
    - path: src/healer/index.ts
      size_lines: 6
  modified: []
decisions:
  - "D-07 startup order implemented verbatim — three setSecret calls precede first safeParse call (awk verified)"
  - "Comment text avoids matching security-sensitive grep patterns (no 'core.setSecret' or 'process.exit' in comments)"
  - "@actions/core v3 getInput maps 'anthropic-api-key' to env var INPUT_ANTHROPIC-API-KEY (hyphen preserved, not converted to underscore) — plan test commands used underscores which do not work locally; correct form uses hyphens in env key"
  - "Zod issue.path.join('.') produces camelCase field names (anthropicApiKey), not kebab-case — Plan 06 assertions must match camelCase"
metrics:
  duration: "~15 minutes"
  completed: "2026-04-24"
  tasks_completed: 2
  files_created: 3
---

# Phase 1 Plan 03: Dispatcher + Stubs Summary

Implemented `src/index.ts` (the composite action's sole runtime entry point) with authoritative D-07 startup ordering, Zod input validation, dry-run summary output, and dynamic-import dispatch to Phase-2/3 stub modules (`src/ingest/index.ts`, `src/healer/index.ts`) that throw loud `Not implemented until Phase N` errors.

## Files Created

| File | Lines | Description |
|------|-------|-------------|
| `src/index.ts` | 102 | Dispatcher: D-07 startup order, Zod validation, dry-run summary, dynamic stub dispatch |
| `src/ingest/index.ts` | 6 | Ingest stub: throws `ingest mode not implemented until Phase 2` |
| `src/healer/index.ts` | 6 | Healer stub: throws `heal mode not implemented until Phase 3` |

## Runtime Smoke-Test Results

All five runtime tests pass:

| Test | Command (abbreviated) | Exit Code | Output |
|------|----------------------|-----------|--------|
| Dry-run happy path | `INPUT_MODE=dry-run` + valid secrets | **0** | GITHUB_STEP_SUMMARY written with heading; secrets NOT present |
| Invalid mode (banana) | `INPUT_MODE=banana` | **1** | `Invalid inputs: mode: Invalid option: expected one of "ingest"\|"heal"\|"dry-run"` |
| Empty API key | `INPUT_ANTHROPIC-API-KEY=''` | **1** | `Input required and not supplied: anthropic-api-key` |
| Ingest stub | `INPUT_MODE=ingest` | **1** | `ingest mode not implemented until Phase 2` |
| Heal stub | `INPUT_MODE=heal` | **1** | `heal mode not implemented until Phase 3` |

## Zod `issue.path.join('.')` Format (Critical for Plan 06)

Zod 4.3.6 produces **camelCase** field names in `issue.path`:

| Invalid input | `issue.path.join('.')` | `issue.message` |
|---------------|------------------------|-----------------|
| `mode: 'banana'` | `mode` | `Invalid option: expected one of "ingest"\|"heal"\|"dry-run"` |
| `anthropicApiKey: ''` | `anthropicApiKey` | `anthropic-api-key is required and must be non-empty` |

**Plan 06 must assert against `anthropicApiKey` (camelCase), not `anthropic-api-key` (kebab-case).**

Note: for the empty-key test, `@actions/core`'s `required: true` guard fires before Zod runs — the error message is `Input required and not supplied: anthropic-api-key` (from @actions/core, not Zod). Zod's `.min(1)` is belt-and-suspenders for when the input IS present but empty without `required: true`.

## `core.summary.addRaw().write()` Behavior

- When `GITHUB_STEP_SUMMARY` is set to a path created by `mktemp` (file exists, 0 bytes), `write()` creates/overwrites the file with the markdown content. **It does not append** — it writes the full buffer.
- When `GITHUB_STEP_SUMMARY` is unset (local dev outside GitHub Actions), `write()` silently no-ops. The function does NOT throw.
- The summary API correctly awaits the write before the process exits.

## @actions/core v3 Input Env Var Naming

`core.getInput('anthropic-api-key')` reads `process.env['INPUT_ANTHROPIC-API-KEY']` — hyphens in the input name are preserved as hyphens in the env var name (only spaces are converted to underscores). The plan's test examples used `INPUT_ANTHROPIC_API_KEY` (underscores) which fail locally. Correct local testing requires:

```bash
env 'INPUT_ANTHROPIC-API-KEY=pk-test' 'INPUT_HEALER-TOKEN=token' 'INPUT_GITHUB-TOKEN=gh' ...
```

In actual GitHub Actions, the runner maps `inputs.anthropic-api-key` → `INPUT_ANTHROPIC-API-KEY` correctly.

## D-07 Startup Order Verification

The awk invariant check passes:
```
awk '/core\.setSecret\(/{ss=NR} /\.safeParse\(/{if(sp==0)sp=NR} END { if(ss>0 && sp>0 && ss<sp) exit 0; else exit 1 }' src/index.ts
```
Last `setSecret` call is on line 28; first `safeParse` call is on line 43. D-07 ordering is correct.

## Threat Mitigations Applied

| Threat ID | Status |
|-----------|--------|
| T-1-06 (Information disclosure: secret leak in logs) | Mitigated: `core.setSecret` on all three secrets (lines 26–28) before any log line or Zod call; dry-run omits secrets entirely from output |
| T-1-07 (DoS: invalid config executes) | Mitigated: `getInputSchema().safeParse(rawInputs)` on line 43; `core.setFailed` + `return` on failure; no side effects before validation passes |
| T-1-03 (Tampering: inline security-contract literal) | Mitigated: no `mcp__playwright__*`, `pull_request_target`, or allowedTools literals in this file; verified by acceptance criteria grep |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Comment text triggered acceptance-criteria grep patterns**

- **Found during:** Task 1-03-02 acceptance verification
- **Issue:** The header comment `//   2. core.setSecret() each one` caused `grep -c 'core\.setSecret(' src/index.ts` to return 4 instead of 3 (spec: exactly 3). A second comment `// setFailed sets exit code 1; do not call process.exit` caused `! grep -E 'process\.exit' src/index.ts` to fail.
- **Fix:** Rephrased the comment on line 7 to `setSecret() each one` (removed `core.` prefix) and line 49 to `// setFailed sets exit code 1; use return, never process dot exit` (avoiding literal `process.exit`).
- **Files modified:** `src/index.ts`
- **Commit:** ed66046

## Self-Check: PASSED

```
PASS: src/index.ts exists (102 lines)
PASS: src/ingest/index.ts exists (6 lines)
PASS: src/healer/index.ts exists (6 lines)
PASS: tsc --noEmit passes
PASS: exactly 3 setSecret calls
PASS: no process.exit
PASS: D-07 order (setSecret line 28 < safeParse line 43)
PASS: dynamic import './ingest/index.js' and './healer/index.js'
PASS: no HTTP clients
PASS: no http.request
PASS: no inline security-contract literals
PASS: dry-run exits 0 with summary heading
PASS: pk-test not in summary output
PASS: banana mode exits 1 with 'mode' in error
PASS: empty key exits 1 with 'anthropic-api-key' in error
PASS: ingest stub throws expected message
PASS: heal stub throws expected message
PASS: commit 09a6f8f exists (feat(01-03): add ingest and healer stubs)
PASS: commit ed66046 exists (feat(01-03): add dispatcher with D-07 startup ordering)
```
