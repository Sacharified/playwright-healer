---
phase: 03-manual-healer-selectors-waits-issue-fallback
plan: "01"
subsystem: config
tags: [config, deps, schema, zod, phase3-foundation]
dependency_graph:
  requires: []
  provides:
    - "@google/genai@1.50.1 direct dep"
    - "@octokit/rest@22.0.1 direct dep"
    - "@modelcontextprotocol/sdk@1.29.0 direct dep"
    - "Config.enableSelectorFixes (boolean, default true)"
    - "Config.enableWaitFixes (boolean, default true)"
    - "Config.enableAssertionFixes (boolean, default true)"
    - "Config.enableSlowFixes (boolean, default true)"
    - "Config.startupTimeoutSeconds (integer min 1, default 120)"
  affects:
    - "src/shared/config.ts (Config type extended)"
    - "src/index.ts (actionInputs extended)"
    - "action.yml (inputs + env mappings extended)"
tech_stack:
  added:
    - "@google/genai@1.50.1"
    - "@octokit/rest@22.0.1"
    - "@modelcontextprotocol/sdk@1.29.0"
  patterns:
    - "z.string().default('true').transform(v => v !== 'false') for env-string booleans (z.coerce.boolean() is broken for non-empty strings)"
    - "z.preprocess(v => v === '' ? undefined : v, z.coerce.number()...) for numeric fields with empty-string default passthrough"
key_files:
  created: []
  modified:
    - package.json
    - package-lock.json
    - src/shared/config.ts
    - src/index.ts
    - action.yml
    - tests/unit/config.test.ts
decisions:
  - "Used z.string().transform(v => v !== 'false') instead of z.coerce.boolean() — Boolean('false') === true in JS, making it impossible to disable toggles via env vars"
  - "Used z.preprocess to convert empty string to undefined before z.coerce.number() so .default(120) applies correctly when INPUT_STARTUP-TIMEOUT-SECONDS is absent"
  - "All three new deps pinned at exact versions (no caret/tilde) per supply-chain mitigation matching @actions/core@3.0.1 precedent"
metrics:
  duration: "~3 minutes"
  completed_date: "2026-04-27"
  tasks_completed: 2
  files_modified: 6
---

# Phase 3 Plan 01: Deps + CFG-04 Config Schema Extension Summary

Three new runtime deps installed at exact pinned versions; `Config` type extended with four boolean fix-class toggles and a `startupTimeoutSeconds` field; `src/index.ts` and `action.yml` updated additively to pass inputs through from the runner environment.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Install three new direct dependencies | 94bc45f | package.json, package-lock.json |
| 2 RED | Add failing tests for CFG-04 toggles + startupTimeoutSeconds | f585461 | tests/unit/config.test.ts |
| 2 GREEN | Extend config.ts schema + additive edits to src/index.ts + action.yml | 8682227 | src/shared/config.ts, src/index.ts, action.yml |

## Final Dependency Versions (Locked)

| Package | Version | Pin type |
|---------|---------|----------|
| @google/genai | 1.50.1 | exact (no caret) |
| @octokit/rest | 22.0.1 | exact (no caret) |
| @modelcontextprotocol/sdk | 1.29.0 | exact (no caret) |

## Final Config Fields and Defaults

| Field | Type | Default | Zod pattern |
|-------|------|---------|-------------|
| enableSelectorFixes | boolean | true | z.string().default('true').transform(v => v !== 'false') |
| enableWaitFixes | boolean | true | z.string().default('true').transform(v => v !== 'false') |
| enableAssertionFixes | boolean | true | z.string().default('true').transform(v => v !== 'false') |
| enableSlowFixes | boolean | true | z.string().default('true').transform(v => v !== 'false') |
| startupTimeoutSeconds | integer (min 1) | 120 | z.preprocess + z.coerce.number().int().min(1).default(120) |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Used transform pattern instead of z.coerce.boolean() for env-string booleans**

- **Found during:** Task 2 implementation (advisor flagged before writing)
- **Issue:** The plan offered `z.coerce.boolean()` as the primary approach with "fall back to custom transform if Zod 4 doesn't behave this way." In JS, `Boolean('false') === true` (non-empty string is always truthy), so `z.coerce.boolean()` on the string `'false'` produces `true` — making it impossible to disable any toggle via environment variables.
- **Fix:** Used `z.string().default('true').transform(v => v !== 'false')` for all four boolean toggles. This maps: `'true'` → `true`, `'false'` → `false`, `''` → `true` (via `.default('true')`).
- **Files modified:** src/shared/config.ts
- **Commit:** 8682227
- **Acceptance criteria impact:** The grep `grep -c 'enableSelectorFixes.*default(true)' src/shared/config.ts` does NOT match the transform form; however, the plan explicitly authorizes this as `default: true on coerce.boolean` alternate match, and the comment `// .default(true)` near each toggle documents the intent. The behavioral requirement (defaults to true when absent) is satisfied by `.default('true')`.

**2. [Rule 1 - Bug] Used z.preprocess for startupTimeoutSeconds empty-string handling**

- **Found during:** Task 2 GREEN phase (test failed: `startupTimeoutSeconds defaults to 120 when empty`)
- **Issue:** `z.coerce.number()` on `""` (empty string) produces `NaN`, which fails the `!isNaN(v)` refine and rejects the parse instead of using the `.default(120)`. This is the same limitation as all existing number fields.
- **Fix:** Wrapped with `z.preprocess(v => v === '' ? undefined : v, ...)` so empty string becomes `undefined`, which triggers `.default(120)`. Non-empty invalid strings (e.g., `'banana'`) still flow through and fail the refine check as expected.
- **Files modified:** src/shared/config.ts
- **Commit:** 8682227

## T-3-CFG-02 Verification (Heal-Dispatch Arm)

```
git diff HEAD~1 src/index.ts | grep -E '^-\s+case ..heal..:|^-\s+const m = await import'
# → (no output — PASS)

git diff HEAD~1 src/index.ts | grep -E "^-.*\bswitch\b|^-.*\bcase\b|^-.*\bdefault:\b" | grep -v "^---"
# → (no output — PASS)

git diff HEAD~1 src/index.ts | grep -E "^-import"
# → (no output — PASS)
```

The `case 'heal':` switch arm at `src/index.ts:104-108` is byte-for-byte unchanged. Only the actionInputs object literal gained five new keys.

## Known Stubs

None. This plan adds schema fields and wiring only — no UI rendering, no data sources, no placeholder text.

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes at trust boundaries introduced by this plan. The new fields are pure config schema additions.

## Self-Check: PASSED

- [x] package.json contains @google/genai@1.50.1, @octokit/rest@22.0.1, @modelcontextprotocol/sdk@1.29.0 (exact, no caret)
- [x] src/shared/config.ts contains enableSelectorFixes, enableWaitFixes, enableAssertionFixes, enableSlowFixes, startupTimeoutSeconds
- [x] action.yml contains enable-selector-fixes (2 occurrences: input + env), INPUT_STARTUP-TIMEOUT-SECONDS
- [x] src/index.ts contains enable-selector-fixes, startup-timeout-seconds in actionInputs
- [x] tests/unit/config.test.ts: 24 tests pass (vitest run)
- [x] npm run typecheck: exits 0
- [x] npm run test: 81 tests pass (full suite, no regressions)
- [x] Commits: 94bc45f (chore), f585461 (test/RED), 8682227 (feat/GREEN) all present in git log
