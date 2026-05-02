---
phase: 5
slug: auto-merge
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-02
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> See `05-RESEARCH.md` §"Validation Architecture" for surface-level test design.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts (implicit defaults) |
| **Quick run command** | `./node_modules/.bin/vitest run --reporter=dot --pool=forks` |
| **Full suite command** | `./node_modules/.bin/vitest run && ./node_modules/.bin/tsc --noEmit` |
| **Estimated runtime** | ~30 seconds (full suite) |

---

## Sampling Rate

- **After every task commit:** Run `./node_modules/.bin/vitest run --reporter=dot` for the modified test file region.
- **After every plan wave:** Run `./node_modules/.bin/vitest run && ./node_modules/.bin/tsc --noEmit`.
- **Before `/gsd-verify-work`:** Full suite must be green AND both D-11 manual gates green.
- **Max feedback latency:** 30 seconds.

---

## Per-Task Verification Map

> **Filled by gsd-planner during PLAN.md authoring.** Each task in each PLAN.md frontmatter
> must include an `<automated>` verify command (or be explicitly flagged as a `checkpoint:human-verify`
> task — see Manual-Only Verifications below).

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD     | TBD  | TBD  | MRG-01..04  | TBD        | TBD             | TBD       | TBD               | TBD         | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. Each task that creates a new source-file region uses inline `<behavior>` blocks listing test cases; no separate Wave 0 plan is needed. This matches the project's existing test-first discipline (`pr-writer.test.ts`, `validator.test.ts`, `config.test.ts` all alongside their source files).

Tests that may be NEW (planner to confirm during plan authoring):
- `src/healer/pr-writer.test.ts` — extend existing file with `evaluateAutoMerge`, `enableAutoMerge`, `renderAutoMergeBand` cases (likely partial extend, not new file)
- `src/shared/config.test.ts` — extend with the three new Zod fields and the auto-merge superRefine misconfig case (partial extend)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `enable_auto_merge: false` zero-behavior-change demo | MRG-01 + ROADMAP SC #1 | Requires GitHub Actions runtime + real PAT | Re-run Phase 03.1 e2e on `Sacharified/playwright-healer-test` with default config; verify PR opens, reasoning band renders `auto_merge: eligible \| enable_auto_merge=false (informational only)`, NO `enablePullRequestAutoMerge` GraphQL call in run log |
| `enable_auto_merge: true` happy-path demo | MRG-03 + ROADMAP SC #2 | Requires GitHub Actions runtime + branch-protection-configured fixture | Re-run Phase 03.1 e2e on a fixture branch with branch protection ON (Settings → Branches → Add rule → Require status checks); verify PR opens, mutation succeeds (`autoMergeRequest.enabledAt` populated in band), `fixture-ci.yml` passes, PR auto-squashes to `main` |
| Reasoning-band format stable across builds | MRG-04 + ROADMAP SC #4 | Requires real heal artifact for visual review | Inspect run summary on the two demo runs above; confirm markdown table renders correctly in GitHub Actions UI (no broken cells, condition rows match RESEARCH §Pattern 5 shape) |
| Out-of-test-dir blocking demo | ROADMAP SC #3 | Requires synthesized agent diff that escapes tests/ — hard to automate without LLM call | Manually craft a unified diff touching `src/foo.ts`, run gate harness against it (test-only entry point); verify reasoning band renders `scope: blocked by: files outside test directory (src/foo.ts)` AND `auto_merge: blocked` even with all other conditions matched. Planner may opt to make this automated by exposing a CLI test harness instead. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or are explicit `checkpoint:human-verify`
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (NEW or extended test files declared inline)
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter (planner flips after Per-Task map is complete)

**Approval:** pending — planner to complete Per-Task Verification Map and flip frontmatter `status: draft → ready`, `nyquist_compliant: false → true`, `wave_0_complete: false → true`.
